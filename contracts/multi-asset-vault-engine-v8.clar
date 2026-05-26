;; multi-asset-vault-engine-v8.clar
;;
;; Final engine refactor: trait-based oracle dispatch. The engine now reads the
;; oracle principal from collateral-registry-v6 (which already stored it in v6
;; but was ignored by v7) and accepts the oracle as a trait reference at every
;; pricing call site. After this one-time migration, adding any new collateral
;; with any new price source is deployment-free at the engine level -- only a
;; small oracle wrapper (or none, if reusing an existing feed) plus a single
;; governance call to collateral-registry-v6::add-collateral-type is required.
;;
;; Changes vs v7:
;;   - REMOVED: hardcoded if/else in get-oracle-price-by-id; removed the
;;     asset-oracle-id map and register-asset-oracle function entirely. The
;;     oracle for each asset lives exclusively in collateral-registry-v6 now.
;;   - ADDED: every public/read-only function that prices collateral now takes
;;     an (oracle <oracle-trait>) parameter. The engine validates that
;;     (contract-of oracle) matches the principal registered in the registry
;;     for the given asset. Mismatch => price returned as u0, which causes
;;     mint/withdraw safety checks to refuse the operation.
;;   - REMOVED: governance data-var, bootstrap-set-governance, lock-bootstrap
;;     gating around register-asset-oracle (there is no register-asset-oracle
;;     anymore; all admin surface for collateral/oracle config lives in the
;;     registry and remains timelock-governed).
;;   - liquidate-position now checks contract-caller against
;;     .liquidation-engine-v8.
;;
;; Everything else (vault state shape, deposit/withdraw/mint/repay flows,
;; health-factor math, token transfers) is byte-for-byte identical to v7.

(use-trait token-trait .stablecoin-engine-token-trait.stablecoin-engine-token-trait)
(use-trait sip-010-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(use-trait oracle-trait .oracle-trait.oracle-trait)

;; ============================================
;; Error Constants
;; ============================================
(define-constant ERR_VAULT_EXISTS u200)
(define-constant ERR_NO_VAULT u201)
(define-constant ERR_INSUFFICIENT_COLLATERAL u202)
(define-constant ERR_INSUFFICIENT_DEBT u203)
(define-constant ERR_UNSAFE_HEALTH_FACTOR u204)
(define-constant ERR_ASSET_NOT_SUPPORTED u205)
(define-constant ERR_ASSET_DISABLED u206)
(define-constant ERR_NO_COLLATERAL_POSITION u207)
(define-constant ERR_BELOW_DEBT_FLOOR u208)
(define-constant ERR_UNAUTHORIZED u209)
(define-constant ERR_STABLECOIN_NOT_FOUND u210)
(define-constant ERR_TOKEN_NOT_LINKED u211)
(define-constant ERR_TOKEN_MISMATCH u212)
(define-constant ERR_ASSET_NOT_WHITELISTED u213)
(define-constant ERR_ORACLE_MISMATCH u214)
(define-constant ERR_ASSET_MISMATCH u215)
(define-constant ERR_NOT_LIQUIDATION_ENGINE u216)
(define-constant ERR_NO_ORACLE u218)

;; ============================================
;; Constants
;; ============================================
(define-constant CONTRACT-OWNER tx-sender)
(define-constant PRICE-SCALE u100000000)
(define-constant RATIO-SCALE u100)
(define-constant ZERO-DEBT-HEALTH-FACTOR u1000000)

;; ============================================
;; Data Maps
;; ============================================

(define-map vaults
  {owner: principal, stablecoin-id: uint}
  {
    total-debt: uint,
    created-at: uint
  }
)

(define-map vault-collateral
  {owner: principal, stablecoin-id: uint, asset: principal}
  {
    amount: uint,
    debt-share: uint
  }
)

(define-map vault-asset-count
  {owner: principal, stablecoin-id: uint}
  {count: uint}
)

(define-map vault-asset-list
  {owner: principal, stablecoin-id: uint, index: uint}
  {asset: principal}
)

;; ============================================
;; Private Helper Functions
;; ============================================

(define-private (read-asset-count (owner principal) (stablecoin-id uint))
  (match (map-get? vault-asset-count {owner: owner, stablecoin-id: stablecoin-id})
    entry (get count entry)
    u0
  )
)

;; Validates the caller-supplied oracle trait against the principal stored
;; in collateral-registry-v6 for this asset, then returns the live price.
;; Returns u0 on any failure -- mismatched oracle, missing registry entry,
;; or oracle call error -- which causes downstream health checks to refuse
;; the operation.
(define-private (price-asset-via (asset principal) (oracle <oracle-trait>))
  (match (contract-call? .collateral-registry-v6 get-oracle asset)
    registered
      (if (is-eq (contract-of oracle) registered)
        (match (contract-call? oracle get-price)
          price price
          err-code u0
        )
        u0
      )
    u0
  )
)

(define-private (get-asset-config (asset principal))
  (contract-call? .collateral-registry-v6 get-collateral-config asset)
)

(define-private (get-asset-config-for-stablecoin (stablecoin-id uint) (asset principal))
  (contract-call? .collateral-registry-v6 get-effective-collateral-config stablecoin-id asset)
)

(define-private (get-min-ratio-for-asset (asset principal))
  (default-to u150 (contract-call? .collateral-registry-v6 get-min-collateral-ratio asset))
)

(define-private (get-min-ratio-for-stablecoin-asset (stablecoin-id uint) (asset principal))
  (default-to u150 (contract-call? .collateral-registry-v6 get-effective-min-collateral-ratio stablecoin-id asset))
)

(define-private (get-liquidation-ratio-for-asset (asset principal))
  (default-to u120 (contract-call? .collateral-registry-v6 get-liquidation-ratio asset))
)

(define-private (get-liquidation-ratio-for-stablecoin-asset (stablecoin-id uint) (asset principal))
  (default-to u120 (contract-call? .collateral-registry-v6 get-effective-liquidation-ratio stablecoin-id asset))
)

(define-private (compute-collateral-value (price uint) (amount uint))
  (/ (* amount price) PRICE-SCALE)
)

(define-private (calculate-collateral-value-via (asset principal) (oracle <oracle-trait>) (amount uint))
  (compute-collateral-value (price-asset-via asset oracle) amount)
)

(define-private (calculate-position-health-factor (collateral-value uint) (debt uint) (min-ratio uint))
  (if (is-eq debt u0)
    ZERO-DEBT-HEALTH-FACTOR
    (/ (* collateral-value u10000) (* debt min-ratio))
  )
)

(define-private (get-linked-token-contract (stablecoin-id uint))
  (match (contract-call? .stablecoin-factory-v4 get-stablecoin stablecoin-id)
    stablecoin-entry
      (match (get token-contract stablecoin-entry)
        token-contract (ok token-contract)
        (err ERR_TOKEN_NOT_LINKED)
      )
    (err ERR_STABLECOIN_NOT_FOUND)
  )
)

(define-private (assert-token-contract-match
    (stablecoin-id uint)
    (token <token-trait>)
  )
  (let ((token-principal (contract-of token)))
    (match (get-linked-token-contract stablecoin-id)
      registered-token
        (begin
          (asserts! (is-eq registered-token token-principal) (err ERR_TOKEN_MISMATCH))
          (ok true)
        )
      err-code (err err-code)
    )
  )
)

(define-private (open-vault-internal (stablecoin-id uint))
  (begin
    (asserts!
      (is-none (map-get? vaults {owner: tx-sender, stablecoin-id: stablecoin-id}))
      (err ERR_VAULT_EXISTS)
    )
    (map-set vaults
      {owner: tx-sender, stablecoin-id: stablecoin-id}
      {
        total-debt: u0,
        created-at: stacks-block-height
      }
    )
    (map-set vault-asset-count {owner: tx-sender, stablecoin-id: stablecoin-id} {count: u0})
    (print {event: "vault-opened", owner: tx-sender, stablecoin-id: stablecoin-id})
    (ok true)
  )
)

(define-private (deposit-collateral-internal (stablecoin-id uint) (asset principal) (collateral-token <sip-010-trait>) (amount uint))
  (begin
    (asserts! (is-eq (contract-of collateral-token) asset) (err ERR_ASSET_MISMATCH))
    (asserts!
      (is-some (map-get? vaults {owner: tx-sender, stablecoin-id: stablecoin-id}))
      (err ERR_NO_VAULT)
    )

    (match (get-asset-config-for-stablecoin stablecoin-id asset)
      config
        (begin
          (asserts! (get enabled config) (err ERR_ASSET_DISABLED))

          (let (
              (current-position (default-to
                {amount: u0, debt-share: u0}
                (map-get? vault-collateral {owner: tx-sender, stablecoin-id: stablecoin-id, asset: asset})
              ))
              (new-amount (+ (get amount current-position) amount))
              (is-new-position (is-eq (get amount current-position) u0))
            )
            (map-set vault-collateral
              {owner: tx-sender, stablecoin-id: stablecoin-id, asset: asset}
              {
                amount: new-amount,
                debt-share: (get debt-share current-position)
              }
            )

            (if is-new-position
              (let ((current-count (read-asset-count tx-sender stablecoin-id)))
                (map-set vault-asset-list
                  {owner: tx-sender, stablecoin-id: stablecoin-id, index: current-count}
                  {asset: asset}
                )
                (map-set vault-asset-count
                  {owner: tx-sender, stablecoin-id: stablecoin-id}
                  {count: (+ current-count u1)}
                )
              )
              true
            )

            (try! (contract-call? collateral-token transfer amount tx-sender (as-contract tx-sender) none))
            (print {
              event: "collateral-deposited",
              owner: tx-sender,
              stablecoin-id: stablecoin-id,
              asset: asset,
              amount: amount,
              total: new-amount
            })
            (ok new-amount)
          )
        )
      (err ERR_ASSET_NOT_WHITELISTED)
    )
  )
)

(define-private (withdraw-collateral-internal
    (stablecoin-id uint)
    (asset principal)
    (collateral-token <sip-010-trait>)
    (oracle <oracle-trait>)
    (amount uint)
  )
  (begin
    (asserts! (is-eq (contract-of collateral-token) asset) (err ERR_ASSET_MISMATCH))
    (match (map-get? vaults {owner: tx-sender, stablecoin-id: stablecoin-id})
      vault
        (match (map-get? vault-collateral {owner: tx-sender, stablecoin-id: stablecoin-id, asset: asset})
          position
            (begin
              (asserts! (>= (get amount position) amount) (err ERR_INSUFFICIENT_COLLATERAL))

              (let (
                  (new-amount (- (get amount position) amount))
                  (debt-share (get debt-share position))
                  (min-ratio (get-min-ratio-for-stablecoin-asset stablecoin-id asset))
                  (new-collateral-value (calculate-collateral-value-via asset oracle new-amount))
                  (user tx-sender)
                )
                (if (> debt-share u0)
                  (let ((health-factor (calculate-position-health-factor new-collateral-value debt-share min-ratio)))
                    (asserts! (>= health-factor RATIO-SCALE) (err ERR_UNSAFE_HEALTH_FACTOR))
                  )
                  true
                )

                (map-set vault-collateral
                  {owner: tx-sender, stablecoin-id: stablecoin-id, asset: asset}
                  {
                    amount: new-amount,
                    debt-share: debt-share
                  }
                )

                (try! (as-contract (contract-call? collateral-token transfer amount tx-sender user none)))
                (print {
                  event: "collateral-withdrawn",
                  owner: tx-sender,
                  stablecoin-id: stablecoin-id,
                  asset: asset,
                  amount: amount,
                  remaining: new-amount
                })
                (ok new-amount)
              )
            )
          (err ERR_NO_COLLATERAL_POSITION)
        )
      (err ERR_NO_VAULT)
    )
  )
)

(define-private (mint-with-default-token
    (stablecoin-id uint)
    (asset principal)
    (oracle <oracle-trait>)
    (amount uint)
  )
  (begin
    (match (map-get? vaults {owner: tx-sender, stablecoin-id: stablecoin-id})
      vault
        (match (map-get? vault-collateral {owner: tx-sender, stablecoin-id: stablecoin-id, asset: asset})
          position
            (match (get-asset-config-for-stablecoin stablecoin-id asset)
              config
                (begin
                  (asserts! (get enabled config) (err ERR_ASSET_DISABLED))

                  (let (
                      (collateral-amount (get amount position))
                      (current-debt-share (get debt-share position))
                      (new-debt-share (+ current-debt-share amount))
                      (collateral-value (calculate-collateral-value-via asset oracle collateral-amount))
                      (min-ratio (get min-collateral-ratio config))
                      (debt-floor (get debt-floor config))
                      (health-factor (calculate-position-health-factor collateral-value new-debt-share min-ratio))
                    )
                    (asserts! (>= health-factor RATIO-SCALE) (err ERR_UNSAFE_HEALTH_FACTOR))
                    (asserts! (or (is-eq new-debt-share u0) (>= new-debt-share debt-floor)) (err ERR_BELOW_DEBT_FLOOR))

                    (try! (contract-call? .collateral-registry-v6 increase-stablecoin-debt stablecoin-id asset amount))

                    (map-set vault-collateral
                      {owner: tx-sender, stablecoin-id: stablecoin-id, asset: asset}
                      {
                        amount: collateral-amount,
                        debt-share: new-debt-share
                      }
                    )

                    (map-set vaults
                      {owner: tx-sender, stablecoin-id: stablecoin-id}
                      {
                        total-debt: (+ (get total-debt vault) amount),
                        created-at: (get created-at vault)
                      }
                    )

                    (try! (contract-call? .stablecoin-token-v4 mint amount tx-sender))

                    (print {
                      event: "debt-minted",
                      owner: tx-sender,
                      stablecoin-id: stablecoin-id,
                      asset: asset,
                      amount: amount,
                      total-debt-share: new-debt-share,
                      health-factor: health-factor
                    })
                    (ok new-debt-share)
                  )
                )
              (err ERR_ASSET_NOT_WHITELISTED)
            )
          (err ERR_NO_COLLATERAL_POSITION)
        )
      (err ERR_NO_VAULT)
    )
  )
)

(define-private (mint-with-token-for-stablecoin
    (stablecoin-id uint)
    (asset principal)
    (token <token-trait>)
    (oracle <oracle-trait>)
    (amount uint)
  )
  (begin
    (try! (assert-token-contract-match stablecoin-id token))

    (match (map-get? vaults {owner: tx-sender, stablecoin-id: stablecoin-id})
      vault
        (match (map-get? vault-collateral {owner: tx-sender, stablecoin-id: stablecoin-id, asset: asset})
          position
            (match (get-asset-config-for-stablecoin stablecoin-id asset)
              config
                (begin
                  (asserts! (get enabled config) (err ERR_ASSET_DISABLED))

                  (let (
                      (collateral-amount (get amount position))
                      (current-debt-share (get debt-share position))
                      (new-debt-share (+ current-debt-share amount))
                      (collateral-value (calculate-collateral-value-via asset oracle collateral-amount))
                      (min-ratio (get min-collateral-ratio config))
                      (debt-floor (get debt-floor config))
                      (health-factor (calculate-position-health-factor collateral-value new-debt-share min-ratio))
                    )
                    (asserts! (>= health-factor RATIO-SCALE) (err ERR_UNSAFE_HEALTH_FACTOR))
                    (asserts! (or (is-eq new-debt-share u0) (>= new-debt-share debt-floor)) (err ERR_BELOW_DEBT_FLOOR))

                    (try! (contract-call? .collateral-registry-v6 increase-stablecoin-debt stablecoin-id asset amount))

                    (map-set vault-collateral
                      {owner: tx-sender, stablecoin-id: stablecoin-id, asset: asset}
                      {
                        amount: collateral-amount,
                        debt-share: new-debt-share
                      }
                    )

                    (map-set vaults
                      {owner: tx-sender, stablecoin-id: stablecoin-id}
                      {
                        total-debt: (+ (get total-debt vault) amount),
                        created-at: (get created-at vault)
                      }
                    )

                    (try! (contract-call? token mint amount tx-sender))

                    (print {
                      event: "debt-minted",
                      owner: tx-sender,
                      stablecoin-id: stablecoin-id,
                      asset: asset,
                      amount: amount,
                      total-debt-share: new-debt-share,
                      health-factor: health-factor
                    })
                    (ok new-debt-share)
                  )
                )
              (err ERR_ASSET_NOT_WHITELISTED)
            )
          (err ERR_NO_COLLATERAL_POSITION)
        )
      (err ERR_NO_VAULT)
    )
  )
)

(define-private (repay-with-default-token (stablecoin-id uint) (asset principal) (amount uint))
  (begin
    (match (map-get? vaults {owner: tx-sender, stablecoin-id: stablecoin-id})
      vault
        (match (map-get? vault-collateral {owner: tx-sender, stablecoin-id: stablecoin-id, asset: asset})
          position
            (match (get-asset-config-for-stablecoin stablecoin-id asset)
              config
                (begin
                  (asserts! (>= (get debt-share position) amount) (err ERR_INSUFFICIENT_DEBT))

                  (let (
                      (new-debt-share (- (get debt-share position) amount))
                      (debt-floor (get debt-floor config))
                    )
                    (asserts! (or (is-eq new-debt-share u0) (>= new-debt-share debt-floor)) (err ERR_BELOW_DEBT_FLOOR))

                    (try! (contract-call? .stablecoin-token-v4 burn amount tx-sender))
                    (try! (contract-call? .collateral-registry-v6 decrease-stablecoin-debt stablecoin-id asset amount))

                    (map-set vault-collateral
                      {owner: tx-sender, stablecoin-id: stablecoin-id, asset: asset}
                      {
                        amount: (get amount position),
                        debt-share: new-debt-share
                      }
                    )

                    (map-set vaults
                      {owner: tx-sender, stablecoin-id: stablecoin-id}
                      {
                        total-debt: (- (get total-debt vault) amount),
                        created-at: (get created-at vault)
                      }
                    )

                    (print {
                      event: "debt-repaid",
                      owner: tx-sender,
                      stablecoin-id: stablecoin-id,
                      asset: asset,
                      amount: amount,
                      remaining-debt: new-debt-share
                    })
                    (ok new-debt-share)
                  )
                )
              (err ERR_ASSET_NOT_SUPPORTED)
            )
          (err ERR_NO_COLLATERAL_POSITION)
        )
      (err ERR_NO_VAULT)
    )
  )
)

(define-private (repay-with-token-for-stablecoin
    (stablecoin-id uint)
    (asset principal)
    (token <token-trait>)
    (amount uint)
  )
  (begin
    (try! (assert-token-contract-match stablecoin-id token))

    (match (map-get? vaults {owner: tx-sender, stablecoin-id: stablecoin-id})
      vault
        (match (map-get? vault-collateral {owner: tx-sender, stablecoin-id: stablecoin-id, asset: asset})
          position
            (match (get-asset-config-for-stablecoin stablecoin-id asset)
              config
                (begin
                  (asserts! (>= (get debt-share position) amount) (err ERR_INSUFFICIENT_DEBT))

                  (let (
                      (new-debt-share (- (get debt-share position) amount))
                      (debt-floor (get debt-floor config))
                    )
                    (asserts! (or (is-eq new-debt-share u0) (>= new-debt-share debt-floor)) (err ERR_BELOW_DEBT_FLOOR))

                    (try! (contract-call? token burn amount tx-sender))
                    (try! (contract-call? .collateral-registry-v6 decrease-stablecoin-debt stablecoin-id asset amount))

                    (map-set vault-collateral
                      {owner: tx-sender, stablecoin-id: stablecoin-id, asset: asset}
                      {
                        amount: (get amount position),
                        debt-share: new-debt-share
                      }
                    )

                    (map-set vaults
                      {owner: tx-sender, stablecoin-id: stablecoin-id}
                      {
                        total-debt: (- (get total-debt vault) amount),
                        created-at: (get created-at vault)
                      }
                    )

                    (print {
                      event: "debt-repaid",
                      owner: tx-sender,
                      stablecoin-id: stablecoin-id,
                      asset: asset,
                      amount: amount,
                      remaining-debt: new-debt-share
                    })
                    (ok new-debt-share)
                  )
                )
              (err ERR_ASSET_NOT_SUPPORTED)
            )
          (err ERR_NO_COLLATERAL_POSITION)
        )
      (err ERR_NO_VAULT)
    )
  )
)

;; ============================================
;; Public Write Functions
;; ============================================

(define-public (open-vault)
  (open-vault-internal u0)
)

(define-public (open-vault-for-stablecoin (stablecoin-id uint))
  (begin
    (try! (get-linked-token-contract stablecoin-id))
    (open-vault-internal stablecoin-id)
  )
)

(define-public (deposit-collateral (asset principal) (collateral-token <sip-010-trait>) (amount uint))
  (deposit-collateral-internal u0 asset collateral-token amount)
)

(define-public (deposit-collateral-for-stablecoin (stablecoin-id uint) (asset principal) (collateral-token <sip-010-trait>) (amount uint))
  (deposit-collateral-internal stablecoin-id asset collateral-token amount)
)

(define-public (withdraw-collateral
    (asset principal)
    (collateral-token <sip-010-trait>)
    (oracle <oracle-trait>)
    (amount uint)
  )
  (withdraw-collateral-internal u0 asset collateral-token oracle amount)
)

(define-public (withdraw-collateral-for-stablecoin
    (stablecoin-id uint)
    (asset principal)
    (collateral-token <sip-010-trait>)
    (oracle <oracle-trait>)
    (amount uint)
  )
  (withdraw-collateral-internal stablecoin-id asset collateral-token oracle amount)
)

(define-public (mint-against-asset
    (asset principal)
    (oracle <oracle-trait>)
    (amount uint)
  )
  (mint-with-default-token u0 asset oracle amount)
)

(define-public (mint-against-asset-for-stablecoin
    (stablecoin-id uint)
    (asset principal)
    (token <token-trait>)
    (oracle <oracle-trait>)
    (amount uint)
  )
  (mint-with-token-for-stablecoin stablecoin-id asset token oracle amount)
)

(define-public (repay-against-asset (asset principal) (amount uint))
  (repay-with-default-token u0 asset amount)
)

(define-public (repay-against-asset-for-stablecoin
    (stablecoin-id uint)
    (asset principal)
    (token <token-trait>)
    (amount uint)
  )
  (repay-with-token-for-stablecoin stablecoin-id asset token amount)
)

;; ============================================
;; Read-Only Functions
;; ============================================

(define-read-only (get-vault (owner principal))
  (map-get? vaults {owner: owner, stablecoin-id: u0})
)

(define-read-only (get-vault-for-stablecoin (owner principal) (stablecoin-id uint))
  (map-get? vaults {owner: owner, stablecoin-id: stablecoin-id})
)

(define-read-only (get-collateral-position (owner principal) (asset principal))
  (map-get? vault-collateral {owner: owner, stablecoin-id: u0, asset: asset})
)

(define-read-only (get-collateral-position-for-stablecoin (owner principal) (stablecoin-id uint) (asset principal))
  (map-get? vault-collateral {owner: owner, stablecoin-id: stablecoin-id, asset: asset})
)

;; Read-only price-aware functions take (price uint) directly because Clarity
;; forbids calling a trait function (potentially writing) from a read-only.
;; Off-chain consumers fetch the live price by calling the oracle's read-only
;; get-price first, then pass the uint here.

(define-read-only (get-position-health-factor
    (owner principal)
    (asset principal)
    (price uint)
  )
  (match (map-get? vault-collateral {owner: owner, stablecoin-id: u0, asset: asset})
    position
      (let (
          (collateral-value (compute-collateral-value price (get amount position)))
          (debt-share (get debt-share position))
          (min-ratio (get-min-ratio-for-asset asset))
        )
        (calculate-position-health-factor collateral-value debt-share min-ratio)
      )
    ZERO-DEBT-HEALTH-FACTOR
  )
)

(define-read-only (get-position-health-factor-for-stablecoin
    (owner principal)
    (stablecoin-id uint)
    (asset principal)
    (price uint)
  )
  (match (map-get? vault-collateral {owner: owner, stablecoin-id: stablecoin-id, asset: asset})
    position
      (let (
          (collateral-value (compute-collateral-value price (get amount position)))
          (debt-share (get debt-share position))
          (min-ratio (get-min-ratio-for-stablecoin-asset stablecoin-id asset))
        )
        (calculate-position-health-factor collateral-value debt-share min-ratio)
      )
    ZERO-DEBT-HEALTH-FACTOR
  )
)

(define-read-only (get-position-liquidation-status
    (owner principal)
    (asset principal)
    (price uint)
  )
  (match (map-get? vault-collateral {owner: owner, stablecoin-id: u0, asset: asset})
    position
      (let (
          (collateral-value (compute-collateral-value price (get amount position)))
          (debt-share (get debt-share position))
          (liq-ratio (get-liquidation-ratio-for-asset asset))
          (health-factor (calculate-position-health-factor collateral-value debt-share liq-ratio))
        )
        {
          is-liquidatable: (< health-factor RATIO-SCALE),
          health-factor: health-factor,
          collateral-value: collateral-value,
          debt: debt-share
        }
      )
    {
      is-liquidatable: false,
      health-factor: ZERO-DEBT-HEALTH-FACTOR,
      collateral-value: u0,
      debt: u0
    }
  )
)

(define-read-only (get-position-liquidation-status-for-stablecoin
    (owner principal)
    (stablecoin-id uint)
    (asset principal)
    (price uint)
  )
  (match (map-get? vault-collateral {owner: owner, stablecoin-id: stablecoin-id, asset: asset})
    position
      (let (
          (collateral-value (compute-collateral-value price (get amount position)))
          (debt-share (get debt-share position))
          (liq-ratio (get-liquidation-ratio-for-stablecoin-asset stablecoin-id asset))
          (health-factor (calculate-position-health-factor collateral-value debt-share liq-ratio))
        )
        {
          is-liquidatable: (< health-factor RATIO-SCALE),
          health-factor: health-factor,
          collateral-value: collateral-value,
          debt: debt-share
        }
      )
    {
      is-liquidatable: false,
      health-factor: ZERO-DEBT-HEALTH-FACTOR,
      collateral-value: u0,
      debt: u0
    }
  )
)

(define-read-only (get-vault-asset-count (owner principal))
  (read-asset-count owner u0)
)

(define-read-only (get-vault-asset-count-for-stablecoin (owner principal) (stablecoin-id uint))
  (read-asset-count owner stablecoin-id)
)

(define-read-only (get-vault-asset-at-index (owner principal) (index uint))
  (map-get? vault-asset-list {owner: owner, stablecoin-id: u0, index: index})
)

(define-read-only (get-vault-asset-at-index-for-stablecoin (owner principal) (stablecoin-id uint) (index uint))
  (map-get? vault-asset-list {owner: owner, stablecoin-id: stablecoin-id, index: index})
)

(define-read-only (get-max-mintable
    (owner principal)
    (asset principal)
    (price uint)
  )
  (match (map-get? vault-collateral {owner: owner, stablecoin-id: u0, asset: asset})
    position
      (let (
          (collateral-value (compute-collateral-value price (get amount position)))
          (current-debt (get debt-share position))
          (min-ratio (get-min-ratio-for-asset asset))
          (max-debt (/ (* collateral-value RATIO-SCALE) min-ratio))
        )
        (if (> max-debt current-debt)
          (- max-debt current-debt)
          u0
        )
      )
    u0
  )
)

(define-read-only (get-max-mintable-for-stablecoin
    (owner principal)
    (stablecoin-id uint)
    (asset principal)
    (price uint)
  )
  (match (map-get? vault-collateral {owner: owner, stablecoin-id: stablecoin-id, asset: asset})
    position
      (let (
          (collateral-value (compute-collateral-value price (get amount position)))
          (current-debt (get debt-share position))
          (min-ratio (get-min-ratio-for-stablecoin-asset stablecoin-id asset))
          (max-debt (/ (* collateral-value RATIO-SCALE) min-ratio))
        )
        (if (> max-debt current-debt)
          (- max-debt current-debt)
          u0
        )
      )
    u0
  )
)

(define-read-only (get-total-vault-value (owner principal))
  (match (map-get? vaults {owner: owner, stablecoin-id: u0})
    vault (get total-debt vault)
    u0
  )
)

(define-read-only (get-total-vault-value-for-stablecoin (owner principal) (stablecoin-id uint))
  (match (map-get? vaults {owner: owner, stablecoin-id: stablecoin-id})
    vault (get total-debt vault)
    u0
  )
)

;; ============================================
;; Liquidation Support (called by liquidation-engine-v8)
;; ============================================

(define-public (liquidate-position
    (owner principal)
    (stablecoin-id uint)
    (asset principal)
    (collateral-token <sip-010-trait>)
    (stablecoin-token <token-trait>)
    (debt-to-offset uint)
    (collateral-to-seize uint))
  (begin
    (asserts! (is-eq contract-caller .liquidation-engine-v8) (err ERR_NOT_LIQUIDATION_ENGINE))
    (asserts! (is-eq (contract-of collateral-token) asset) (err ERR_ASSET_MISMATCH))
    (try! (assert-token-contract-match stablecoin-id stablecoin-token))

    (match (map-get? vaults {owner: owner, stablecoin-id: stablecoin-id})
      vault
        (match (map-get? vault-collateral {owner: owner, stablecoin-id: stablecoin-id, asset: asset})
          position
            (begin
              (asserts! (>= (get amount position) collateral-to-seize) (err ERR_INSUFFICIENT_COLLATERAL))
              (asserts! (>= (get debt-share position) debt-to-offset) (err ERR_INSUFFICIENT_DEBT))

              (map-set vault-collateral
                {owner: owner, stablecoin-id: stablecoin-id, asset: asset}
                {
                  amount: (- (get amount position) collateral-to-seize),
                  debt-share: (- (get debt-share position) debt-to-offset)
                }
              )
              (map-set vaults
                {owner: owner, stablecoin-id: stablecoin-id}
                {
                  total-debt: (- (get total-debt vault) debt-to-offset),
                  created-at: (get created-at vault)
                }
              )
              (try! (contract-call? .collateral-registry-v6 decrease-stablecoin-debt stablecoin-id asset debt-to-offset))
              (try! (as-contract (contract-call? collateral-token transfer collateral-to-seize tx-sender .stability-pool-v7 none)))
              (try! (contract-call? stablecoin-token burn debt-to-offset .stability-pool-v7))

              (print {
                event: "position-liquidated",
                owner: owner,
                stablecoin-id: stablecoin-id,
                asset: asset,
                debt-offset: debt-to-offset,
                collateral-seized: collateral-to-seize
              })
              (ok true)
            )
          (err ERR_NO_COLLATERAL_POSITION)
        )
      (err ERR_NO_VAULT)
    )
  )
)
