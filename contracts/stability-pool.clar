(define-constant ERR_INSUFFICIENT_BALANCE u500)

(define-map balances
  {owner: principal}
  {balance: uint}
)

(define-read-only (balance-of (owner principal))
  (match (map-get? balances {owner: owner})
    entry (get balance entry)
    u0
  )
)

(define-public (deposit (amount uint))
  (let ((current (balance-of tx-sender)))
    ;; TODO(stability-pool): transfer stablecoin from user to pool custody.
    (map-set balances {owner: tx-sender} {balance: (+ current amount)})
    (ok true)
  )
)

(define-public (withdraw (amount uint))
  (let ((current (balance-of tx-sender)))
    (asserts! (>= current amount) (err ERR_INSUFFICIENT_BALANCE))
    ;; TODO(stability-pool): transfer stablecoin back from pool custody to user.
    ;; TODO(stability-pool): account for liquidation redistribution and reward accounting.
    (map-set balances {owner: tx-sender} {balance: (- current amount)})
    (ok true)
  )
)
