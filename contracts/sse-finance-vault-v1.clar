;; sse-finance-vault-v1.clar
;;
;; Borrower-facing vault for SSE Finance: collateral custody + position state,
;; keyed by {owner, market-id}. Multi-asset positions, enumerable, with a
;; health-checked withdraw. Shape and health-factor math copied from
;; multi-asset-vault-engine-v8 (stablecoin-id -> market-id).
;;
;; INTEREST-FREE: debt is a flat principal (borrow-principal); it never grows on
;; its own -- it changes ONLY on borrow / repay / liquidate. borrow draws from the
;; pool (which charges the one-time borrow fee, netted from the disbursed amount)
;; and records the full principal as debt; repay returns principal to the pool.
;; liquidate-position lands in the liquidation task.
;;
;; Pricing: each collateral asset has a GLOBAL oracle registered in
;; sse-finance-collateral-matrix-v1. Every pricing call validates the caller's
;; oracle trait against that registered principal and FAILS CLOSED on mismatch
;; (identical to engine v8 price-asset-via). Risk params (min ratio, etc.) for a
;; {market, collateral} pair come from the same matrix.

(use-trait sse-finance-sip-010-trait .sse-finance-sip-010-trait.sse-finance-sip-010-trait)
(use-trait sse-finance-oracle-trait .sse-finance-oracle-trait.sse-finance-oracle-trait)

(define-constant CONTRACT-OWNER tx-sender)
(define-constant PRICE-SCALE u100000000)        ;; 8-decimal USD price ($1 = 1e8)
(define-constant RATIO-SCALE u100)              ;; ratios in whole percent (150 = 150%)
(define-constant ZERO-DEBT-HEALTH-FACTOR u1000000)

;; ============================================
;; Error Constants
;; ============================================
(define-constant ERR_NO_VAULT u300)
(define-constant ERR_INSUFFICIENT_COLLATERAL u301)
(define-constant ERR_UNSAFE_HEALTH_FACTOR u302)
(define-constant ERR_PAIR_NOT_ENABLED u303)
(define-constant ERR_NO_COLLATERAL_POSITION u304)
(define-constant ERR_ASSET_MISMATCH u305)
(define-constant ERR_ORACLE_MISMATCH u306)
(define-constant ERR_INVALID_AMOUNT u307)
(define-constant ERR_UNAUTHORIZED u308)
(define-constant ERR_BOOTSTRAP_LOCKED u309)
(define-constant ERR_INSUFFICIENT_DEBT u310)
(define-constant ERR_BELOW_DEBT_FLOOR u311)
(define-constant ERR_BORROW_CAP u312)
(define-constant ERR_NOT_LIQUIDATOR u313)

;; ============================================
;; Governance (for the wiring the borrow/liquidation tasks add later)
;; ============================================
(define-data-var governance principal CONTRACT-OWNER)
(define-data-var bootstrap-locked bool false)

(define-read-only (get-governance) (var-get governance))
(define-read-only (is-bootstrap-locked) (var-get bootstrap-locked))

(define-public (bootstrap-set-governance (new-gov principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (asserts! (not (var-get bootstrap-locked)) (err ERR_BOOTSTRAP_LOCKED))
    (var-set governance new-gov)
    (ok true)
  )
)

(define-public (lock-bootstrap)
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (var-set bootstrap-locked true)
    (ok true)
  )
)

(define-private (is-governance-caller)
  (or
    (is-eq contract-caller (var-get governance))
    (and (not (var-get bootstrap-locked)) (is-eq tx-sender CONTRACT-OWNER))
  )
)

;; The single liquidation engine permitted to call liquidate-position. Set by
;; governance at deploy (a principal, not a hardcoded contract literal, so the
;; vault carries no circular dependency on the liquidation contract).
(define-data-var liquidator (optional principal) none)
(define-read-only (get-liquidator) (var-get liquidator))

(define-public (set-liquidator (engine principal))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (var-set liquidator (some engine))
    (print {event: "liquidator-set", engine: engine})
    (ok true)
  )
)

;; ============================================
;; Data Maps
;; ============================================
(define-map vaults
  {owner: principal, market-id: uint}
  {borrow-principal: uint, created-at: uint}
)

(define-map vault-collateral
  {owner: principal, market-id: uint, asset: principal}
  {amount: uint, debt-share: uint}
)

(define-map vault-asset-count {owner: principal, market-id: uint} {count: uint})
(define-map vault-asset-list {owner: principal, market-id: uint, index: uint} {asset: principal})

;; ============================================
;; Private helpers
;; ============================================

(define-private (read-asset-count (owner principal) (market-id uint))
  (default-to u0 (get count (map-get? vault-asset-count {owner: owner, market-id: market-id})))
)

;; Validate the caller-supplied oracle against the matrix-registered principal for
;; this collateral, then return its price. Returns u0 on any failure (mismatch,
;; missing registry entry, or oracle error) so downstream health checks refuse.
(define-private (price-asset-via (asset principal) (oracle <sse-finance-oracle-trait>))
  (match (contract-call? .sse-finance-collateral-matrix-v1 get-collateral-oracle asset)
    registered
      (if (is-eq (contract-of oracle) registered)
        (match (contract-call? oracle get-price) price price err-code u0)
        u0
      )
    u0
  )
)

;; True iff the caller-supplied oracle matches the registered one (or none is
;; registered yet). Used to fail closed even when debt is 0.
(define-private (oracle-matches (asset principal) (oracle <sse-finance-oracle-trait>))
  (match (contract-call? .sse-finance-collateral-matrix-v1 get-collateral-oracle asset)
    registered (is-eq (contract-of oracle) registered)
    true
  )
)

(define-private (compute-collateral-value (price uint) (amount uint))
  (/ (* amount price) PRICE-SCALE)
)

(define-private (calculate-position-health-factor (collateral-value uint) (debt uint) (min-ratio uint))
  (if (is-eq debt u0)
    ZERO-DEBT-HEALTH-FACTOR
    (/ (* collateral-value u10000) (* debt min-ratio))
  )
)

(define-private (get-pair-status (market-id uint) (asset principal))
  (contract-call? .sse-finance-collateral-matrix-v1 get-pair-status market-id asset)
)

;; ============================================
;; Collateral deposit / withdraw
;; ============================================

;; Deposit a supported collateral into a {owner, market} position. Auto-opens the
;; vault on first use. The {market, collateral} pair must exist and be enabled in
;; the matrix.
(define-public (deposit-collateral
    (market-id uint)
    (asset principal)
    (collateral-token <sse-finance-sip-010-trait>)
    (amount uint)
  )
  (begin
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    (asserts! (is-eq (contract-of collateral-token) asset) (err ERR_ASSET_MISMATCH))
    (asserts!
      (match (get-pair-status market-id asset) status (get enabled status) false)
      (err ERR_PAIR_NOT_ENABLED)
    )

    ;; auto-open the vault
    (if (is-none (map-get? vaults {owner: tx-sender, market-id: market-id}))
      (begin
        (map-set vaults {owner: tx-sender, market-id: market-id}
          {borrow-principal: u0, created-at: stacks-block-height})
        (map-set vault-asset-count {owner: tx-sender, market-id: market-id} {count: u0})
        true
      )
      true
    )

    (let (
        (position (default-to {amount: u0, debt-share: u0}
          (map-get? vault-collateral {owner: tx-sender, market-id: market-id, asset: asset})))
        (is-new (is-none (map-get? vault-collateral {owner: tx-sender, market-id: market-id, asset: asset})))
      )
      (let ((new-amount (+ (get amount position) amount)))
        (map-set vault-collateral {owner: tx-sender, market-id: market-id, asset: asset}
          {amount: new-amount, debt-share: (get debt-share position)})

        (if is-new
          (let ((count (read-asset-count tx-sender market-id)))
            (map-set vault-asset-list {owner: tx-sender, market-id: market-id, index: count} {asset: asset})
            (map-set vault-asset-count {owner: tx-sender, market-id: market-id} {count: (+ count u1)})
          )
          true
        )

        (try! (contract-call? collateral-token transfer amount tx-sender (as-contract tx-sender) none))
        (print {
          event: "collateral-deposited",
          owner: tx-sender,
          market-id: market-id,
          asset: asset,
          amount: amount,
          total: new-amount
        })
        (ok new-amount)
      )
    )
  )
)

;; Withdraw collateral. The oracle is validated against the registered principal
;; first (fails closed on mismatch). When the position carries debt, the remaining
;; collateral must keep the position at/above the min ratio.
(define-public (withdraw-collateral
    (market-id uint)
    (asset principal)
    (collateral-token <sse-finance-sip-010-trait>)
    (oracle <sse-finance-oracle-trait>)
    (amount uint)
  )
  (begin
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    (asserts! (is-eq (contract-of collateral-token) asset) (err ERR_ASSET_MISMATCH))
    (asserts! (is-some (map-get? vaults {owner: tx-sender, market-id: market-id})) (err ERR_NO_VAULT))
    (asserts! (oracle-matches asset oracle) (err ERR_ORACLE_MISMATCH))

    (match (map-get? vault-collateral {owner: tx-sender, market-id: market-id, asset: asset})
      position
        (begin
          (asserts! (>= (get amount position) amount) (err ERR_INSUFFICIENT_COLLATERAL))
          (let (
              (new-amount (- (get amount position) amount))
              (debt-share (get debt-share position))
              (user tx-sender)
            )
            ;; health check only matters once the position carries debt
            (if (> debt-share u0)
              (let (
                  (min-ratio (match (get-pair-status market-id asset) s (get min-collateral-ratio s) u0))
                  (new-value (compute-collateral-value (price-asset-via asset oracle) new-amount))
                  (hf (calculate-position-health-factor
                        (compute-collateral-value (price-asset-via asset oracle) new-amount)
                        debt-share min-ratio))
                )
                (asserts! (>= hf RATIO-SCALE) (err ERR_UNSAFE_HEALTH_FACTOR))
              )
              true
            )

            (map-set vault-collateral {owner: user, market-id: market-id, asset: asset}
              {amount: new-amount, debt-share: debt-share})
            (try! (as-contract (contract-call? collateral-token transfer amount tx-sender user none)))
            (print {
              event: "collateral-withdrawn",
              owner: user,
              market-id: market-id,
              asset: asset,
              amount: amount,
              remaining: new-amount
            })
            (ok new-amount)
          )
        )
      (err ERR_NO_COLLATERAL_POSITION)
    )
  )
)

;; ============================================
;; Borrow / repay (flat principal)
;; ============================================

;; Borrow against an existing collateral position. Reverts if the draw would push
;; the position below the min ratio, over the market's borrow cap, or below the
;; debt floor. The one-time borrow fee is charged by the pool at draw (netted from
;; the disbursed amount); the FULL principal `amount` is recorded as flat debt.
(define-public (borrow
    (market-id uint)
    (asset principal)
    (borrow-token <sse-finance-sip-010-trait>)
    (oracle <sse-finance-oracle-trait>)
    (amount uint)
  )
  (begin
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    (asserts! (oracle-matches asset oracle) (err ERR_ORACLE_MISMATCH))
    (match (map-get? vaults {owner: tx-sender, market-id: market-id})
      vault
        (match (map-get? vault-collateral {owner: tx-sender, market-id: market-id, asset: asset})
          position
            (match (get-pair-status market-id asset)
              status
                (begin
                  (asserts! (get enabled status) (err ERR_PAIR_NOT_ENABLED))
                  (let (
                      (new-debt-share (+ (get debt-share position) amount))
                      (collateral-value (compute-collateral-value (price-asset-via asset oracle) (get amount position)))
                      (min-ratio (get min-collateral-ratio status))
                      (debt-floor (get debt-floor status))
                      (cap (default-to u0 (contract-call? .sse-finance-market-registry-v1 get-borrow-cap market-id)))
                      (current-borrows (contract-call? .sse-finance-pool-v1 get-total-borrows market-id))
                    )
                    (asserts!
                      (>= (calculate-position-health-factor collateral-value new-debt-share min-ratio) RATIO-SCALE)
                      (err ERR_UNSAFE_HEALTH_FACTOR)
                    )
                    (asserts! (>= new-debt-share debt-floor) (err ERR_BELOW_DEBT_FLOOR))
                    (asserts! (<= (+ current-borrows amount) cap) (err ERR_BORROW_CAP))

                    ;; draw from the pool: charges the one-time fee, transfers the
                    ;; net amount to the borrower, bumps pool total-borrows
                    (try! (contract-call? .sse-finance-pool-v1 borrow-out market-id borrow-token tx-sender amount))

                    (map-set vault-collateral {owner: tx-sender, market-id: market-id, asset: asset}
                      {amount: (get amount position), debt-share: new-debt-share})
                    (map-set vaults {owner: tx-sender, market-id: market-id}
                      (merge vault {borrow-principal: (+ (get borrow-principal vault) amount)}))
                    (print {
                      event: "borrow",
                      owner: tx-sender,
                      market-id: market-id,
                      asset: asset,
                      amount: amount,
                      debt-share: new-debt-share
                    })
                    (ok new-debt-share)
                  )
                )
              (err ERR_PAIR_NOT_ENABLED)
            )
          (err ERR_NO_COLLATERAL_POSITION)
        )
      (err ERR_NO_VAULT)
    )
  )
)

;; Repay flat principal. Owed = the position's debt-share. Returns borrow-token to
;; the pool and reduces the principal by exactly the repaid amount. The remaining
;; debt must be 0 or stay at/above the debt floor.
(define-public (repay
    (market-id uint)
    (asset principal)
    (borrow-token <sse-finance-sip-010-trait>)
    (amount uint)
  )
  (begin
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    (match (map-get? vaults {owner: tx-sender, market-id: market-id})
      vault
        (match (map-get? vault-collateral {owner: tx-sender, market-id: market-id, asset: asset})
          position
            (match (get-pair-status market-id asset)
              status
                (begin
                  (asserts! (>= (get debt-share position) amount) (err ERR_INSUFFICIENT_DEBT))
                  (let ((new-debt-share (- (get debt-share position) amount)))
                    (asserts!
                      (or (is-eq new-debt-share u0) (>= new-debt-share (get debt-floor status)))
                      (err ERR_BELOW_DEBT_FLOOR)
                    )
                    ;; return principal to the pool (pulls from the borrower)
                    (try! (contract-call? .sse-finance-pool-v1 repay-in market-id borrow-token amount))

                    (map-set vault-collateral {owner: tx-sender, market-id: market-id, asset: asset}
                      {amount: (get amount position), debt-share: new-debt-share})
                    (map-set vaults {owner: tx-sender, market-id: market-id}
                      (merge vault {borrow-principal: (- (get borrow-principal vault) amount)}))
                    (print {
                      event: "repay",
                      owner: tx-sender,
                      market-id: market-id,
                      asset: asset,
                      amount: amount,
                      debt-share: new-debt-share
                    })
                    (ok new-debt-share)
                  )
                )
              (err ERR_PAIR_NOT_ENABLED)
            )
          (err ERR_NO_COLLATERAL_POSITION)
        )
      (err ERR_NO_VAULT)
    )
  )
)

;; ============================================
;; Liquidation settlement (liquidator-only)
;; ============================================

;; Settle a liquidation: reduce the position's collateral and debt by the seized /
;; offset amounts and move the seized collateral to the pool (which distributes it
;; to LPs and earmarks the protocol penalty cut). Callable only by the configured
;; liquidation engine. The engine computes the amounts; this just applies them.
(define-public (liquidate-position
    (owner principal)
    (market-id uint)
    (asset principal)
    (collateral-token <sse-finance-sip-010-trait>)
    (debt-to-offset uint)
    (collateral-to-seize uint)
  )
  (begin
    (asserts! (is-eq (some contract-caller) (var-get liquidator)) (err ERR_NOT_LIQUIDATOR))
    (asserts! (is-eq (contract-of collateral-token) asset) (err ERR_ASSET_MISMATCH))
    (match (map-get? vaults {owner: owner, market-id: market-id})
      vault
        (match (map-get? vault-collateral {owner: owner, market-id: market-id, asset: asset})
          position
            (begin
              (asserts! (>= (get amount position) collateral-to-seize) (err ERR_INSUFFICIENT_COLLATERAL))
              (asserts! (>= (get debt-share position) debt-to-offset) (err ERR_INSUFFICIENT_DEBT))

              (map-set vault-collateral {owner: owner, market-id: market-id, asset: asset}
                {amount: (- (get amount position) collateral-to-seize),
                 debt-share: (- (get debt-share position) debt-to-offset)})
              (map-set vaults {owner: owner, market-id: market-id}
                (merge vault {borrow-principal: (- (get borrow-principal vault) debt-to-offset)}))

              ;; move the seized collateral to the pool for LP distribution +
              ;; protocol-cut earmarking
              (try! (as-contract (contract-call? collateral-token transfer collateral-to-seize tx-sender .sse-finance-pool-v1 none)))

              (print {
                event: "position-liquidated",
                owner: owner,
                market-id: market-id,
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

;; ============================================
;; Read-only views
;; ============================================

(define-read-only (get-vault (owner principal) (market-id uint))
  (map-get? vaults {owner: owner, market-id: market-id})
)

(define-read-only (get-collateral-position (owner principal) (market-id uint) (asset principal))
  (map-get? vault-collateral {owner: owner, market-id: market-id, asset: asset})
)

(define-read-only (get-vault-asset-count (owner principal) (market-id uint))
  (read-asset-count owner market-id)
)

(define-read-only (get-vault-asset-at-index (owner principal) (market-id uint) (index uint))
  (map-get? vault-asset-list {owner: owner, market-id: market-id, index: index})
)

;; Health factor for a position given a price (read-onlys can't call the oracle
;; trait; off-chain consumers pass the live price). >= RATIO-SCALE (100) is safe.
(define-read-only (get-position-health-factor (owner principal) (market-id uint) (asset principal) (price uint))
  (match (map-get? vault-collateral {owner: owner, market-id: market-id, asset: asset})
    position
      (calculate-position-health-factor
        (compute-collateral-value price (get amount position))
        (get debt-share position)
        (match (get-pair-status market-id asset) s (get min-collateral-ratio s) RATIO-SCALE))
    ZERO-DEBT-HEALTH-FACTOR
  )
)

(define-read-only (get-position-liquidation-status (owner principal) (market-id uint) (asset principal) (price uint))
  (match (map-get? vault-collateral {owner: owner, market-id: market-id, asset: asset})
    position
      (let (
          (collateral-value (compute-collateral-value price (get amount position)))
          (debt-share (get debt-share position))
          (liq-ratio (match (get-pair-status market-id asset) s (get liquidation-ratio s) RATIO-SCALE))
          (hf (calculate-position-health-factor
                (compute-collateral-value price (get amount position))
                (get debt-share position)
                (match (get-pair-status market-id asset) s (get liquidation-ratio s) RATIO-SCALE)))
        )
        {is-liquidatable: (< hf RATIO-SCALE), health-factor: hf, collateral-value: collateral-value, debt: debt-share}
      )
    {is-liquidatable: false, health-factor: ZERO-DEBT-HEALTH-FACTOR, collateral-value: u0, debt: u0}
  )
)
