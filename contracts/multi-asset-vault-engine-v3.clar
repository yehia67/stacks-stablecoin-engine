;; Multi-Asset Vault Engine
;; Supports multiple collateral types and per-stablecoin vault namespaces.

(use-trait token-trait .stablecoin-engine-token-trait.stablecoin-engine-token-trait)

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
(define-constant ERR_UNKNOWN_ORACLE u214)

;; ============================================
;; Constants
;; ============================================
(define-constant CONTRACT-OWNER tx-sender)
(define-constant PRICE-SCALE u100000000)  ;; 1e8 for price precision
(define-constant RATIO-SCALE u100)        ;; Ratios are in percentage (150 = 150%)
(define-constant ZERO-DEBT-HEALTH-FACTOR u1000000)

;; Known oracle IDs
(define-constant ORACLE-SBTC u1)
(define-constant ORACLE-STX u2)

;; ============================================
;; Data Maps
;; ============================================

;; A user can own one vault per stablecoin-id.
(define-map vaults
  {owner: principal, stablecoin-id: uint}
  {
    total-debt: uint,
    created-at: uint
  }
)

;; Per-asset collateral positions within a vault namespace.
(define-map vault-collateral
  {owner: principal, stablecoin-id: uint, asset: principal}
  {
    amount: uint,
    debt-share: uint
  }
)

;; Track which assets are present in each stablecoin vault namespace.
(define-map vault-asset-count
  {owner: principal, stablecoin-id: uint}
  {count: uint}
)

(define-map vault-asset-list
  {owner: principal, stablecoin-id: uint, index: uint}
  {asset: principal}
)

;; ============================================
;; Per-Asset Oracle Registry
;; ============================================

(define-map asset-oracle-id {asset: principal} {oracle-id: uint})

(define-public (register-asset-oracle (asset principal) (oracle-id uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (asserts! (or (is-eq oracle-id ORACLE-SBTC) (is-eq oracle-id ORACLE-STX)) (err ERR_UNKNOWN_ORACLE))
    (map-set asset-oracle-id {asset: asset} {oracle-id: oracle-id})
    (ok true)
  )
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

(define-private (get-oracle-price-by-id (oracle-id uint))
  (if (is-eq oracle-id ORACLE-SBTC)
    (unwrap-panic (contract-call? .price-oracle-sbtc-v3 get-price))
    (if (is-eq oracle-id ORACLE-STX)
      (unwrap-panic (contract-call? .price-oracle-stx-v3 get-price))
      u0
    )
  )
)

(define-private (get-asset-price (asset principal))
  (match (map-get? asset-oracle-id {asset: asset})
    entry (get-oracle-price-by-id (get oracle-id entry))
    u0
  )
)

(define-private (get-asset-config (asset principal))
  (contract-call? .collateral-registry-v3 get-collateral-config asset)
)

(define-private (get-asset-config-for-stablecoin (stablecoin-id uint) (asset principal))
  (contract-call? .collateral-registry-v3 get-effective-collateral-config stablecoin-id asset)
)

(define-private (get-min-ratio-for-asset (asset principal))
  (default-to u150 (contract-call? .collateral-registry-v3 get-min-collateral-ratio asset))
)

(define-private (get-min-ratio-for-stablecoin-asset (stablecoin-id uint) (asset principal))
  (default-to u150 (contract-call? .collateral-registry-v3 get-effective-min-collateral-ratio stablecoin-id asset))
)

(define-private (get-liquidation-ratio-for-asset (asset principal))
  (default-to u120 (contract-call? .collateral-registry-v3 get-liquidation-ratio asset))
)

(define-private (get-liquidation-ratio-for-stablecoin-asset (stablecoin-id uint) (asset principal))
  (default-to u120 (contract-call? .collateral-registry-v3 get-effective-liquidation-ratio stablecoin-id asset))
)

(define-private (calculate-collateral-value (asset principal) (amount uint))
  (let ((price (get-asset-price asset)))
    (/ (* amount price) PRICE-SCALE)
  )
)

(define-private (calculate-position-health-factor (collateral-value uint) (debt uint) (min-ratio uint))
  (if (is-eq debt u0)
    ZERO-DEBT-HEALTH-FACTOR
    (/ (* collateral-value u10000) (* debt min-ratio))
  )
)

(define-private (get-linked-token-contract (stablecoin-id uint))
  (match (contract-call? .stablecoin-factory-v3 get-stablecoin stablecoin-id)
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

(define-private (deposit-collateral-internal (stablecoin-id uint) (asset principal) (amount uint))
  (begin
    (asserts!
      (is-some (map-get? vaults {owner: tx-sender, stablecoin-id: stablecoin-id}))
      (err ERR_NO_VAULT)
    )

    ;; Use per-stablecoin config for non-zero stablecoin-id, global for u0
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

            ;; TODO(sBTC/SIP-010): transfer collateral from user to protocol custody.
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
      ;; No config found means asset not whitelisted for this stablecoin
      (err ERR_ASSET_NOT_WHITELISTED)
    )
  )
)

(define-private (withdraw-collateral-internal (stablecoin-id uint) (asset principal) (amount uint))
  (begin
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
                  (new-collateral-value (calculate-collateral-value asset new-amount))
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

                ;; TODO(sBTC/SIP-010): transfer collateral back to user.
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

(define-private (mint-with-default-token (stablecoin-id uint) (asset principal) (amount uint))
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
                      (collateral-value (calculate-collateral-value asset collateral-amount))
                      (min-ratio (get min-collateral-ratio config))
                      (debt-floor (get debt-floor config))
                      (health-factor (calculate-position-health-factor collateral-value new-debt-share min-ratio))
                    )
                    (asserts! (>= health-factor RATIO-SCALE) (err ERR_UNSAFE_HEALTH_FACTOR))
                    (asserts! (or (is-eq new-debt-share u0) (>= new-debt-share debt-floor)) (err ERR_BELOW_DEBT_FLOOR))

                    (try! (contract-call? .collateral-registry-v3 increase-stablecoin-debt stablecoin-id asset amount))

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

                    (try! (contract-call? .stablecoin-token-v3 mint amount tx-sender))

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
                      (collateral-value (calculate-collateral-value asset collateral-amount))
                      (min-ratio (get min-collateral-ratio config))
                      (debt-floor (get debt-floor config))
                      (health-factor (calculate-position-health-factor collateral-value new-debt-share min-ratio))
                    )
                    (asserts! (>= health-factor RATIO-SCALE) (err ERR_UNSAFE_HEALTH_FACTOR))
                    (asserts! (or (is-eq new-debt-share u0) (>= new-debt-share debt-floor)) (err ERR_BELOW_DEBT_FLOOR))

                    (try! (contract-call? .collateral-registry-v3 increase-stablecoin-debt stablecoin-id asset amount))

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

                    (try! (contract-call? .stablecoin-token-v3 burn amount tx-sender))
                    (try! (contract-call? .collateral-registry-v3 decrease-stablecoin-debt stablecoin-id asset amount))

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
                    (try! (contract-call? .collateral-registry-v3 decrease-stablecoin-debt stablecoin-id asset amount))

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

;; Backward-compatible default namespace for legacy integrations.
(define-public (open-vault)
  (open-vault-internal u0)
)

(define-public (open-vault-for-stablecoin (stablecoin-id uint))
  (begin
    (try! (get-linked-token-contract stablecoin-id))
    (open-vault-internal stablecoin-id)
  )
)

;; Backward-compatible default namespace for legacy integrations.
(define-public (deposit-collateral (asset principal) (amount uint))
  (deposit-collateral-internal u0 asset amount)
)

(define-public (deposit-collateral-for-stablecoin (stablecoin-id uint) (asset principal) (amount uint))
  (deposit-collateral-internal stablecoin-id asset amount)
)

;; Backward-compatible default namespace for legacy integrations.
(define-public (withdraw-collateral (asset principal) (amount uint))
  (withdraw-collateral-internal u0 asset amount)
)

(define-public (withdraw-collateral-for-stablecoin (stablecoin-id uint) (asset principal) (amount uint))
  (withdraw-collateral-internal stablecoin-id asset amount)
)

;; Backward-compatible default token minting path.
(define-public (mint-against-asset (asset principal) (amount uint))
  (mint-with-default-token u0 asset amount)
)

(define-public (mint-against-asset-for-stablecoin
    (stablecoin-id uint)
    (asset principal)
    (token <token-trait>)
    (amount uint)
  )
  (mint-with-token-for-stablecoin stablecoin-id asset token amount)
)

;; Backward-compatible default token repay path.
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

;; Backward-compatible default namespace read.
(define-read-only (get-vault (owner principal))
  (map-get? vaults {owner: owner, stablecoin-id: u0})
)

(define-read-only (get-vault-for-stablecoin (owner principal) (stablecoin-id uint))
  (map-get? vaults {owner: owner, stablecoin-id: stablecoin-id})
)

;; Backward-compatible default namespace read.
(define-read-only (get-collateral-position (owner principal) (asset principal))
  (map-get? vault-collateral {owner: owner, stablecoin-id: u0, asset: asset})
)

(define-read-only (get-collateral-position-for-stablecoin (owner principal) (stablecoin-id uint) (asset principal))
  (map-get? vault-collateral {owner: owner, stablecoin-id: stablecoin-id, asset: asset})
)

;; Backward-compatible default namespace read.
(define-read-only (get-position-health-factor (owner principal) (asset principal))
  (match (map-get? vault-collateral {owner: owner, stablecoin-id: u0, asset: asset})
    position
      (let (
          (collateral-value (calculate-collateral-value asset (get amount position)))
          (debt-share (get debt-share position))
          (min-ratio (get-min-ratio-for-asset asset))
        )
        (calculate-position-health-factor collateral-value debt-share min-ratio)
      )
    ZERO-DEBT-HEALTH-FACTOR
  )
)

(define-read-only (get-position-health-factor-for-stablecoin (owner principal) (stablecoin-id uint) (asset principal))
  (match (map-get? vault-collateral {owner: owner, stablecoin-id: stablecoin-id, asset: asset})
    position
      (let (
          (collateral-value (calculate-collateral-value asset (get amount position)))
          (debt-share (get debt-share position))
          (min-ratio (get-min-ratio-for-stablecoin-asset stablecoin-id asset))
        )
        (calculate-position-health-factor collateral-value debt-share min-ratio)
      )
    ZERO-DEBT-HEALTH-FACTOR
  )
)

;; Backward-compatible default namespace read.
(define-read-only (get-position-liquidation-status (owner principal) (asset principal))
  (match (map-get? vault-collateral {owner: owner, stablecoin-id: u0, asset: asset})
    position
      (let (
          (collateral-value (calculate-collateral-value asset (get amount position)))
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

(define-read-only (get-position-liquidation-status-for-stablecoin (owner principal) (stablecoin-id uint) (asset principal))
  (match (map-get? vault-collateral {owner: owner, stablecoin-id: stablecoin-id, asset: asset})
    position
      (let (
          (collateral-value (calculate-collateral-value asset (get amount position)))
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

;; Backward-compatible default namespace read.
(define-read-only (get-vault-asset-count (owner principal))
  (read-asset-count owner u0)
)

(define-read-only (get-vault-asset-count-for-stablecoin (owner principal) (stablecoin-id uint))
  (read-asset-count owner stablecoin-id)
)

;; Backward-compatible default namespace read.
(define-read-only (get-vault-asset-at-index (owner principal) (index uint))
  (map-get? vault-asset-list {owner: owner, stablecoin-id: u0, index: index})
)

(define-read-only (get-vault-asset-at-index-for-stablecoin (owner principal) (stablecoin-id uint) (index uint))
  (map-get? vault-asset-list {owner: owner, stablecoin-id: stablecoin-id, index: index})
)

;; Backward-compatible default namespace read.
(define-read-only (get-max-mintable (owner principal) (asset principal))
  (match (map-get? vault-collateral {owner: owner, stablecoin-id: u0, asset: asset})
    position
      (let (
          (collateral-value (calculate-collateral-value asset (get amount position)))
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

(define-read-only (get-max-mintable-for-stablecoin (owner principal) (stablecoin-id uint) (asset principal))
  (match (map-get? vault-collateral {owner: owner, stablecoin-id: stablecoin-id, asset: asset})
    position
      (let (
          (collateral-value (calculate-collateral-value asset (get amount position)))
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

;; Backward-compatible default namespace read.
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
