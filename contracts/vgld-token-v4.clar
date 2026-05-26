;; vgld-token-v4.clar
;;
;; Test/simnet stand-in for VoltFi vGold (vGLD). Production deployments wire
;; the real VoltFi vGLD principal via sse.config.json::networks.<net>.collaterals[].assetPrincipal
;; -- this contract only ships on testnet/simnet for end-to-end vault flow tests.
;; vGLD is hard-pegged 1:1 USD with 8 decimals. Open faucet for test convenience.

(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-constant TOKEN-NAME "Test vGold")
(define-constant TOKEN-SYMBOL "vGLD")
(define-constant TOKEN-DECIMALS u8)

(define-constant ERR_UNAUTHORIZED u401)

(define-fungible-token vgld-token)

(define-public (faucet-mint (amount uint) (recipient principal))
  (ft-mint? vgld-token amount recipient)
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR_UNAUTHORIZED))
    (try! (ft-transfer? vgld-token amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

(define-read-only (get-name) (ok TOKEN-NAME))
(define-read-only (get-symbol) (ok TOKEN-SYMBOL))
(define-read-only (get-decimals) (ok TOKEN-DECIMALS))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance vgld-token who)))
(define-read-only (get-total-supply) (ok (ft-get-supply vgld-token)))
(define-read-only (get-token-uri) (ok none))
