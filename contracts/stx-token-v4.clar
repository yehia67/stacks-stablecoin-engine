(impl-trait .sip-010-trait.sip-010-trait)

(define-constant TOKEN-NAME "Test STX")
(define-constant TOKEN-SYMBOL "STX")
(define-constant TOKEN-DECIMALS u6)

(define-constant ERR_UNAUTHORIZED u401)

(define-fungible-token stx-token)

;; Open faucet mint for testing only.
(define-public (faucet-mint (amount uint) (recipient principal))
  (ft-mint? stx-token amount recipient)
)

(define-public (transfer (amount uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR_UNAUTHORIZED))
    (ft-transfer? stx-token amount sender recipient)
  )
)

(define-read-only (get-name) (ok TOKEN-NAME))
(define-read-only (get-symbol) (ok TOKEN-SYMBOL))
(define-read-only (get-decimals) (ok TOKEN-DECIMALS))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance stx-token who)))
(define-read-only (get-total-supply) (ok (ft-get-supply stx-token)))
(define-read-only (get-token-uri) (ok none))
