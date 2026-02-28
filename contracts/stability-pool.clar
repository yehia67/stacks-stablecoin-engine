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
    ;; TODO: transfer stablecoin from user to stability pool
    (map-set balances {owner: tx-sender} {balance: (+ current amount)})
    (ok true)
  )
)

(define-public (withdraw (amount uint))
  (let ((current (balance-of tx-sender)))
    (asserts! (>= current amount) (err ERR_INSUFFICIENT_BALANCE))
    ;; TODO: transfer stablecoin back to user
    ;; TODO: account for liquidation rewards distribution
    (map-set balances {owner: tx-sender} {balance: (- current amount)})
    (ok true)
  )
)
