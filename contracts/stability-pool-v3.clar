(use-trait sip-010-trait .sip-010-trait.sip-010-trait)

(define-constant ERR_INSUFFICIENT_BALANCE u500)
(define-constant ERR_TOKEN_MISMATCH u501)
(define-constant ERR_STABLECOIN_NOT_FOUND u502)
(define-constant ERR_TOKEN_NOT_LINKED u503)

;; Per-stablecoin user balances
(define-map balances
  {owner: principal, stablecoin-id: uint}
  {balance: uint}
)

;; Per-stablecoin total deposits
(define-map total-deposits
  {stablecoin-id: uint}
  {amount: uint}
)

;; ---------------------
;; Internal helpers
;; ---------------------

(define-private (get-linked-token (stablecoin-id uint))
  (match (contract-call? .stablecoin-factory-v3 get-stablecoin stablecoin-id)
    stablecoin (get token-contract stablecoin)
    none
  )
)

;; ---------------------
;; Read-only functions
;; ---------------------

(define-read-only (balance-of-for-stablecoin (owner principal) (stablecoin-id uint))
  (match (map-get? balances {owner: owner, stablecoin-id: stablecoin-id})
    entry (get balance entry)
    u0
  )
)

(define-read-only (get-total-deposits (stablecoin-id uint))
  (match (map-get? total-deposits {stablecoin-id: stablecoin-id})
    entry (get amount entry)
    u0
  )
)

;; ---------------------
;; Public functions
;; ---------------------

(define-public (deposit (stablecoin-id uint) (stablecoin-token <sip-010-trait>) (amount uint))
  (let (
      (linked-token (get-linked-token stablecoin-id))
      (current (balance-of-for-stablecoin tx-sender stablecoin-id))
      (pool-total (get-total-deposits stablecoin-id))
    )
    ;; Validate stablecoin exists and has a linked token
    (asserts! (is-some linked-token) (err ERR_TOKEN_NOT_LINKED))
    ;; Validate the passed token matches the factory-linked token
    (asserts! (is-eq (contract-of stablecoin-token) (unwrap-panic linked-token)) (err ERR_TOKEN_MISMATCH))
    ;; Transfer stablecoin from user to pool custody
    (try! (contract-call? stablecoin-token transfer amount tx-sender (as-contract tx-sender)))
    ;; Update user balance and total deposits
    (map-set balances
      {owner: tx-sender, stablecoin-id: stablecoin-id}
      {balance: (+ current amount)}
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
      total-user-balance: (+ current amount),
      total-pool-deposits: (+ pool-total amount)
    })
    (ok true)
  )
)

(define-public (withdraw (stablecoin-id uint) (stablecoin-token <sip-010-trait>) (amount uint))
  (let (
      (linked-token (get-linked-token stablecoin-id))
      (current (balance-of-for-stablecoin tx-sender stablecoin-id))
      (pool-total (get-total-deposits stablecoin-id))
      (user tx-sender)
    )
    ;; Validate stablecoin exists and has a linked token
    (asserts! (is-some linked-token) (err ERR_TOKEN_NOT_LINKED))
    ;; Validate the passed token matches the factory-linked token
    (asserts! (is-eq (contract-of stablecoin-token) (unwrap-panic linked-token)) (err ERR_TOKEN_MISMATCH))
    ;; Check sufficient balance
    (asserts! (>= current amount) (err ERR_INSUFFICIENT_BALANCE))
    ;; Transfer stablecoin from pool custody back to user
    ;; TODO(stability-pool): account for liquidation redistribution and reward accounting.
    (try! (as-contract (contract-call? stablecoin-token transfer amount tx-sender user)))
    ;; Update user balance and total deposits
    (map-set balances
      {owner: user, stablecoin-id: stablecoin-id}
      {balance: (- current amount)}
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
      remaining-user-balance: (- current amount),
      total-pool-deposits: (- pool-total amount)
    })
    (ok true)
  )
)
