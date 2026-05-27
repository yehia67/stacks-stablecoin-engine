(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(impl-trait .stablecoin-engine-token-trait.stablecoin-engine-token-trait)

(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR_UNAUTHORIZED u401)

(define-constant TOKEN-NAME "SSE Stablecoin")
(define-constant TOKEN-SYMBOL "SSEUSD")
(define-constant TOKEN-DECIMALS u6)

(define-fungible-token sse-stablecoin)

(define-data-var vault-engine (optional principal) none)
(define-data-var bridge-adapter (optional principal) none)

(define-read-only (is-vault-engine (caller principal))
  (match (var-get vault-engine)
    ve (is-eq ve caller)
    false
  )
)

(define-read-only (is-bridge-adapter (caller principal))
  (match (var-get bridge-adapter)
    adapter (is-eq adapter caller)
    false
  )
)

(define-public (set-vault-engine (new principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (var-set vault-engine (some new))
    (ok true)
  )
)

(define-public (set-bridge-adapter (new principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (var-set bridge-adapter (some new))
    (ok true)
  )
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR_UNAUTHORIZED))
    (try! (ft-transfer? sse-stablecoin amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-vault-engine contract-caller) (err ERR_UNAUTHORIZED))
    (ft-mint? sse-stablecoin amount recipient)
  )
)

(define-public (burn (amount uint) (owner principal))
  (begin
    (asserts! (is-vault-engine contract-caller) (err ERR_UNAUTHORIZED))
    (ft-burn? sse-stablecoin amount owner)
  )
)

;; ============================================
;; Bridge Functions (Cross-Chain Support)
;; ============================================

;; Mint tokens from a cross-chain deposit
;; Only callable by the authorized bridge adapter
(define-public (mint-from-bridge (amount uint) (recipient principal))
  (begin
    (asserts! (is-bridge-adapter contract-caller) (err ERR_UNAUTHORIZED))
    (ft-mint? sse-stablecoin amount recipient)
  )
)

;; Burn tokens to initiate a cross-chain withdrawal
;; Called by the bridge adapter on behalf of the user
;; Emits event data for the attestation service
(define-public (burn-to-remote
    (amount uint)
    (owner principal)
    (remote-recipient (buff 32))
    (remote-chain-id uint))
  (begin
    (asserts! (is-bridge-adapter contract-caller) (err ERR_UNAUTHORIZED))
    (try! (ft-burn? sse-stablecoin amount owner))
    ;; Print event for attestation service to pick up
    (print {
      event: "burn-to-remote",
      amount: amount,
      owner: owner,
      remote-recipient: remote-recipient,
      remote-chain-id: remote-chain-id
    })
    (ok true)
  )
)

(define-read-only (get-name)
  (ok TOKEN-NAME)
)

(define-read-only (get-symbol)
  (ok TOKEN-SYMBOL)
)

(define-read-only (get-decimals)
  (ok TOKEN-DECIMALS)
)

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance sse-stablecoin who))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply sse-stablecoin))
)

(define-read-only (get-token-uri)
  (ok none)
)

(define-read-only (get-bridge-adapter)
  (var-get bridge-adapter)
)
