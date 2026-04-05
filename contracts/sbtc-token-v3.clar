(impl-trait .sip-010-trait.sip-010-trait)

(define-constant TOKEN-NAME "Test sBTC")
(define-constant TOKEN-SYMBOL "sBTC")
(define-constant TOKEN-DECIMALS u8)

(define-constant ERR_UNAUTHORIZED u401)
(define-constant ERR_INSUFFICIENT_BALANCE u402)

(define-map balances { owner: principal } { balance: uint })
(define-data-var total-supply uint u0)

(define-private (balance-of-internal (owner principal))
  (default-to u0 (get balance (map-get? balances { owner: owner })))
)

;; Open faucet mint for testing only.
(define-public (faucet-mint (amount uint) (recipient principal))
  (begin
    (map-set balances { owner: recipient } { balance: (+ (balance-of-internal recipient) amount) })
    (var-set total-supply (+ (var-get total-supply) amount))
    (ok true)
  )
)

(define-public (transfer (amount uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR_UNAUTHORIZED))
    (let ((sender-balance (balance-of-internal sender))
          (recipient-balance (balance-of-internal recipient)))
      (asserts! (>= sender-balance amount) (err ERR_INSUFFICIENT_BALANCE))
      (map-set balances { owner: sender } { balance: (- sender-balance amount) })
      (map-set balances { owner: recipient } { balance: (+ recipient-balance amount) })
      (ok true)
    )
  )
)

(define-read-only (get-name) (ok TOKEN-NAME))
(define-read-only (get-symbol) (ok TOKEN-SYMBOL))
(define-read-only (get-decimals) (ok TOKEN-DECIMALS))
(define-read-only (get-balance (who principal)) (ok (balance-of-internal who)))
(define-read-only (get-total-supply) (ok (var-get total-supply)))
(define-read-only (get-token-uri) (ok none))
