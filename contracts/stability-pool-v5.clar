(use-trait sip-010-trait .sip-010-trait.sip-010-trait)

;; ============================================
;; Error Constants
;; ============================================
(define-constant ERR_INSUFFICIENT_BALANCE u500)
(define-constant ERR_TOKEN_MISMATCH u501)
(define-constant ERR_STABLECOIN_NOT_FOUND u502)
(define-constant ERR_TOKEN_NOT_LINKED u503)
(define-constant ERR_UNAUTHORIZED u504)
(define-constant ERR_INVALID_REWARD_PCT u505)
(define-constant ERR_EMPTY_POOL u506)
(define-constant ERR_NO_REWARD u507)
(define-constant ERR_NOT_LIQUIDATION_ENGINE u508)

;; ============================================
;; Constants
;; ============================================
(define-constant SCALE_FACTOR u1000000000000) ;; 1e12
(define-constant MAX_REWARD_PCT u5000) ;; 50% max in basis points (100 = 1%)

;; ============================================
;; Data Maps
;; ============================================

;; Per-stablecoin user balances (compacted to current product on each interaction)
(define-map balances
  {owner: principal, stablecoin-id: uint}
  {balance: uint}
)

;; Per-stablecoin total deposits (decreases when liquidation offsets debt)
(define-map total-deposits
  {stablecoin-id: uint}
  {amount: uint}
)

;; Running product for deposit scaling due to liquidation losses.
;; Starts at SCALE_FACTOR. Decreases multiplicatively on each liquidation.
(define-map pool-product
  {stablecoin-id: uint}
  {product: uint}
)

;; User's product snapshot at last deposit/withdraw
(define-map user-product-snapshot
  {owner: principal, stablecoin-id: uint}
  {product: uint}
)

;; Creator-configurable liquidation reward percentage (basis points, 100 = 1%)
(define-map reward-config
  {stablecoin-id: uint}
  {reward-pct: uint}
)

;; Cumulative collateral reward per token of deposit, per (stablecoin, collateral asset)
(define-map cumulative-reward-per-token
  {stablecoin-id: uint, asset: principal}
  {reward-per-token: uint}
)

;; User's snapshot of reward-per-token at last claim
(define-map user-reward-snapshot
  {owner: principal, stablecoin-id: uint, asset: principal}
  {reward-per-token: uint}
)

;; Accumulated pending collateral rewards (accrued but not yet claimed)
(define-map pending-collateral-rewards
  {owner: principal, stablecoin-id: uint, asset: principal}
  {amount: uint}
)

;; ============================================
;; Internal Helpers
;; ============================================

(define-private (get-linked-token (stablecoin-id uint))
  (match (contract-call? .stablecoin-factory-v3 get-stablecoin stablecoin-id)
    stablecoin (get token-contract stablecoin)
    none
  )
)

(define-private (get-stablecoin-creator (stablecoin-id uint))
  (contract-call? .stablecoin-factory-v3 get-stablecoin-creator stablecoin-id)
)

(define-private (get-current-product (stablecoin-id uint))
  (default-to SCALE_FACTOR
    (get product (map-get? pool-product {stablecoin-id: stablecoin-id}))
  )
)

(define-private (get-user-snapshot-product (owner principal) (stablecoin-id uint))
  (default-to SCALE_FACTOR
    (get product (map-get? user-product-snapshot {owner: owner, stablecoin-id: stablecoin-id}))
  )
)

(define-private (get-raw-balance (owner principal) (stablecoin-id uint))
  (default-to u0
    (get balance (map-get? balances {owner: owner, stablecoin-id: stablecoin-id}))
  )
)

(define-private (get-current-rpt (stablecoin-id uint) (asset principal))
  (default-to u0
    (get reward-per-token (map-get? cumulative-reward-per-token {stablecoin-id: stablecoin-id, asset: asset}))
  )
)

(define-private (get-user-rpt-snapshot (owner principal) (stablecoin-id uint) (asset principal))
  (default-to u0
    (get reward-per-token (map-get? user-reward-snapshot {owner: owner, stablecoin-id: stablecoin-id, asset: asset}))
  )
)

(define-private (get-pending-reward (owner principal) (stablecoin-id uint) (asset principal))
  (default-to u0
    (get amount (map-get? pending-collateral-rewards {owner: owner, stablecoin-id: stablecoin-id, asset: asset}))
  )
)

;; Compute effective balance accounting for liquidation losses via the product
(define-private (compute-effective-balance (owner principal) (stablecoin-id uint))
  (let (
      (raw (get-raw-balance owner stablecoin-id))
      (current-product (get-current-product stablecoin-id))
      (snapshot-product (get-user-snapshot-product owner stablecoin-id))
    )
    (if (is-eq snapshot-product u0)
      u0
      (/ (* raw current-product) snapshot-product)
    )
  )
)

;; ============================================
;; Read-Only Functions
;; ============================================

(define-read-only (balance-of-for-stablecoin (owner principal) (stablecoin-id uint))
  (let (
      (raw (get-raw-balance owner stablecoin-id))
      (current-product (get-current-product stablecoin-id))
      (snapshot-product (get-user-snapshot-product owner stablecoin-id))
    )
    (if (is-eq snapshot-product u0)
      u0
      (/ (* raw current-product) snapshot-product)
    )
  )
)

(define-read-only (get-total-deposits (stablecoin-id uint))
  (default-to u0
    (get amount (map-get? total-deposits {stablecoin-id: stablecoin-id}))
  )
)

(define-read-only (get-liquidation-reward-pct (stablecoin-id uint))
  (default-to u0
    (get reward-pct (map-get? reward-config {stablecoin-id: stablecoin-id}))
  )
)

(define-read-only (get-pool-product-value (stablecoin-id uint))
  (get-current-product stablecoin-id)
)

(define-read-only (get-claimable-collateral-reward (owner principal) (stablecoin-id uint) (asset principal))
  (let (
      (raw-bal (get-raw-balance owner stablecoin-id))
      (current-rpt (get-current-rpt stablecoin-id asset))
      (user-rpt (get-user-rpt-snapshot owner stablecoin-id asset))
      (pending (get-pending-reward owner stablecoin-id asset))
      (new-reward (if (> current-rpt user-rpt)
                    (/ (* raw-bal (- current-rpt user-rpt)) SCALE_FACTOR)
                    u0))
    )
    (+ pending new-reward)
  )
)

;; ============================================
;; Admin Functions (Creator Only)
;; ============================================

(define-public (set-liquidation-reward-pct (stablecoin-id uint) (pct uint))
  (let ((creator (get-stablecoin-creator stablecoin-id)))
    (asserts! (is-some creator) (err ERR_STABLECOIN_NOT_FOUND))
    (asserts! (is-eq tx-sender (unwrap-panic creator)) (err ERR_UNAUTHORIZED))
    (asserts! (<= pct MAX_REWARD_PCT) (err ERR_INVALID_REWARD_PCT))
    (map-set reward-config {stablecoin-id: stablecoin-id} {reward-pct: pct})
    (print {
      event: "reward-pct-updated",
      stablecoin-id: stablecoin-id,
      reward-pct: pct,
      set-by: tx-sender
    })
    (ok true)
  )
)

;; ============================================
;; Public Functions: Deposit & Withdraw
;; ============================================

(define-public (deposit (stablecoin-id uint) (stablecoin-token <sip-010-trait>) (amount uint))
  (let (
      (linked-token (get-linked-token stablecoin-id))
      (effective-bal (compute-effective-balance tx-sender stablecoin-id))
      (pool-total (get-total-deposits stablecoin-id))
      (current-product (get-current-product stablecoin-id))
    )
    (asserts! (is-some linked-token) (err ERR_TOKEN_NOT_LINKED))
    (asserts! (is-eq (contract-of stablecoin-token) (unwrap-panic linked-token)) (err ERR_TOKEN_MISMATCH))
    ;; Transfer stablecoin from user to pool
    (try! (contract-call? stablecoin-token transfer amount tx-sender (as-contract tx-sender)))
    ;; Compact balance to current product and add deposit
    (map-set balances
      {owner: tx-sender, stablecoin-id: stablecoin-id}
      {balance: (+ effective-bal amount)}
    )
    (map-set user-product-snapshot
      {owner: tx-sender, stablecoin-id: stablecoin-id}
      {product: current-product}
    )
    (map-set total-deposits
      {stablecoin-id: stablecoin-id}
      {amount: (+ pool-total amount)}
    )
    (print {
      event: "pool-deposit",
      owner: tx-sender,
      stablecoin-id: stablecoin-id,
      amount: amount,
      effective-balance: (+ effective-bal amount),
      total-pool-deposits: (+ pool-total amount)
    })
    (ok true)
  )
)

(define-public (withdraw (stablecoin-id uint) (stablecoin-token <sip-010-trait>) (amount uint))
  (let (
      (linked-token (get-linked-token stablecoin-id))
      (effective-bal (compute-effective-balance tx-sender stablecoin-id))
      (pool-total (get-total-deposits stablecoin-id))
      (current-product (get-current-product stablecoin-id))
      (user tx-sender)
    )
    (asserts! (is-some linked-token) (err ERR_TOKEN_NOT_LINKED))
    (asserts! (is-eq (contract-of stablecoin-token) (unwrap-panic linked-token)) (err ERR_TOKEN_MISMATCH))
    (asserts! (>= effective-bal amount) (err ERR_INSUFFICIENT_BALANCE))
    ;; Transfer stablecoin from pool to user
    (try! (as-contract (contract-call? stablecoin-token transfer amount tx-sender user)))
    ;; Compact balance to current product minus withdrawal
    (map-set balances
      {owner: user, stablecoin-id: stablecoin-id}
      {balance: (- effective-bal amount)}
    )
    (map-set user-product-snapshot
      {owner: user, stablecoin-id: stablecoin-id}
      {product: current-product}
    )
    (map-set total-deposits
      {stablecoin-id: stablecoin-id}
      {amount: (- pool-total amount)}
    )
    (print {
      event: "pool-withdrawal",
      owner: user,
      stablecoin-id: stablecoin-id,
      amount: amount,
      effective-balance: (- effective-bal amount),
      total-pool-deposits: (- pool-total amount)
    })
    (ok true)
  )
)

;; ============================================
;; Liquidation Distribution (called by liquidation engine)
;; ============================================

;; Called by the liquidation engine after vault collateral is seized and pool stablecoins burned.
;; Updates internal accounting: deposit shrinkage (product) and collateral rewards.
(define-public (distribute-liquidation-reward
    (stablecoin-id uint)
    (asset principal)
    (debt-offset uint)
    (collateral-earned uint))
  (let (
      (pool-total (get-total-deposits stablecoin-id))
      (current-product (get-current-product stablecoin-id))
      (current-rpt (get-current-rpt stablecoin-id asset))
    )
    ;; Only the liquidation engine can call this
    (asserts! (is-eq contract-caller .liquidation-engine-v6) (err ERR_NOT_LIQUIDATION_ENGINE))
    ;; Pool must have deposits to distribute against
    (asserts! (> pool-total u0) (err ERR_EMPTY_POOL))
    (asserts! (>= pool-total debt-offset) (err ERR_INSUFFICIENT_BALANCE))
    ;; Update deposit product: product *= (pool-total - debt-offset) / pool-total
    (map-set pool-product
      {stablecoin-id: stablecoin-id}
      {product: (/ (* current-product (- pool-total debt-offset)) pool-total)}
    )
    ;; Update cumulative reward per token: rpt += collateral * SCALE / pool-total
    (map-set cumulative-reward-per-token
      {stablecoin-id: stablecoin-id, asset: asset}
      {reward-per-token: (+ current-rpt (/ (* collateral-earned SCALE_FACTOR) pool-total))}
    )
    ;; Reduce total deposits by the stablecoins burned
    (map-set total-deposits
      {stablecoin-id: stablecoin-id}
      {amount: (- pool-total debt-offset)}
    )
    (print {
      event: "liquidation-reward-distributed",
      stablecoin-id: stablecoin-id,
      asset: asset,
      debt-offset: debt-offset,
      collateral-earned: collateral-earned,
      new-pool-total: (- pool-total debt-offset),
      new-reward-per-token: (+ current-rpt (/ (* collateral-earned SCALE_FACTOR) pool-total))
    })
    (ok true)
  )
)

;; ============================================
;; Claim Collateral Rewards
;; ============================================

(define-public (claim-collateral-reward
    (stablecoin-id uint)
    (asset principal)
    (collateral-token <sip-010-trait>))
  (let (
      (raw-bal (get-raw-balance tx-sender stablecoin-id))
      (current-rpt (get-current-rpt stablecoin-id asset))
      (user-rpt (get-user-rpt-snapshot tx-sender stablecoin-id asset))
      (existing-pending (get-pending-reward tx-sender stablecoin-id asset))
      (new-reward (if (> current-rpt user-rpt)
                    (/ (* raw-bal (- current-rpt user-rpt)) SCALE_FACTOR)
                    u0))
      (total-claimable (+ existing-pending new-reward))
      (user tx-sender)
    )
    ;; Validate collateral token matches the asset
    (asserts! (is-eq (contract-of collateral-token) asset) (err ERR_TOKEN_MISMATCH))
    ;; Must have something to claim
    (asserts! (> total-claimable u0) (err ERR_NO_REWARD))
    ;; Transfer collateral from pool to user
    (try! (as-contract (contract-call? collateral-token transfer total-claimable tx-sender user)))
    ;; Reset pending and update snapshot
    (map-set pending-collateral-rewards
      {owner: user, stablecoin-id: stablecoin-id, asset: asset}
      {amount: u0}
    )
    (map-set user-reward-snapshot
      {owner: user, stablecoin-id: stablecoin-id, asset: asset}
      {reward-per-token: current-rpt}
    )
    (print {
      event: "collateral-reward-claimed",
      owner: user,
      stablecoin-id: stablecoin-id,
      asset: asset,
      amount: total-claimable
    })
    (ok total-claimable)
  )
)
