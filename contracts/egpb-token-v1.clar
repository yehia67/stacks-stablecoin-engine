;; egpb-token-v1.clar
;;
;; EGP Bond A (EGPB) -- SSE-issued bond token, mainnet collateral #3.
;; SIP-010 fungible token with OWNER-GATED mint and burn: SSE is the sole
;; issuer (mint) and redeemer (burn). No faucet, no open mint. Hard $1.00
;; standard price -- priced via the constant price-oracle-egpb-v1.
;;
;; Redemption flow: a holder transfers EGPB back to the owner, who then
;; burns from the owner's own balance.
;;
;; Owner starts as the deployer key. set-owner allows a future handoff
;; (e.g. to the Asigna multisig) but is NOT exercised at launch.
;;
;; Native FT asset name is "EGPBv1" -- the frontend's Pc.ft()
;; post-conditions key on this exact identifier (FT_ASSET_NAMES).

(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-constant TOKEN-NAME "EGP Bond A")
(define-constant TOKEN-SYMBOL "EGPB")
(define-constant TOKEN-DECIMALS u8)

(define-constant ERR_UNAUTHORIZED u401)

(define-fungible-token EGPBv1)

(define-data-var contract-owner principal tx-sender)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR_UNAUTHORIZED))
    (ft-mint? EGPBv1 amount recipient)
  )
)

(define-public (burn (amount uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR_UNAUTHORIZED))
    (ft-burn? EGPBv1 amount tx-sender)
  )
)

(define-public (set-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR_UNAUTHORIZED))
    (ok (var-set contract-owner new-owner))
  )
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR_UNAUTHORIZED))
    (try! (ft-transfer? EGPBv1 amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

(define-read-only (get-name) (ok TOKEN-NAME))
(define-read-only (get-symbol) (ok TOKEN-SYMBOL))
(define-read-only (get-decimals) (ok TOKEN-DECIMALS))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance EGPBv1 who)))
(define-read-only (get-total-supply) (ok (ft-get-supply EGPBv1)))
(define-read-only (get-token-uri) (ok none))
(define-read-only (get-owner) (ok (var-get contract-owner)))
