(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-constant TOKEN-NAME "Test sBTC")
(define-constant TOKEN-SYMBOL "sBTC")
(define-constant TOKEN-DECIMALS u8)

(define-constant ERR_UNAUTHORIZED u401)

(define-fungible-token sbtc-token)

;; Open faucet mint for testing only.
(define-public (faucet-mint (amount uint) (recipient principal))
  (ft-mint? sbtc-token amount recipient)
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR_UNAUTHORIZED))
    (try! (ft-transfer? sbtc-token amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

(define-read-only (get-name) (ok TOKEN-NAME))
(define-read-only (get-symbol) (ok TOKEN-SYMBOL))
(define-read-only (get-decimals) (ok TOKEN-DECIMALS))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance sbtc-token who)))
(define-read-only (get-total-supply) (ok (ft-get-supply sbtc-token)))
(define-read-only (get-token-uri) (ok none))
