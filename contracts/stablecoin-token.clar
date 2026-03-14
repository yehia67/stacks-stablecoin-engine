(impl-trait .sip-010-trait.sip-010-trait)

(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR_UNAUTHORIZED u401)
(define-constant ERR_INSUFFICIENT_BALANCE u402)

(define-constant TOKEN-NAME "SSE Stablecoin")
(define-constant TOKEN-SYMBOL "SSEUSD")
(define-constant TOKEN-DECIMALS u6)

(define-data-var total-supply uint u0)
(define-data-var vault-engine (optional principal) none)
(define-data-var bridge-adapter (optional principal) none)

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

(define-public (transfer (amount uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR_UNAUTHORIZED))
    (let ((sender-balance (balance-of sender))
          (recipient-balance (balance-of recipient)))
      (asserts! (>= sender-balance amount) (err ERR_INSUFFICIENT_BALANCE))
      (map-set balances {owner: sender} {balance: (- sender-balance amount)})
      (map-set balances {owner: recipient} {balance: (+ recipient-balance amount)})
      (ok true)
    )
  )
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-vault-engine contract-caller) (err ERR_UNAUTHORIZED))
    (let ((current (balance-of recipient)))
      (map-set balances {owner: recipient} {balance: (+ current amount)})
      (var-set total-supply (+ (var-get total-supply) amount))
      (ok true)
    )
  )
)

(define-public (burn (amount uint) (owner principal))
  (begin
    (asserts! (is-vault-engine contract-caller) (err ERR_UNAUTHORIZED))
    (let ((current (balance-of owner)))
      (asserts! (>= current amount) (err ERR_INSUFFICIENT_BALANCE))
      (map-set balances {owner: owner} {balance: (- current amount)})
      (var-set total-supply (- (var-get total-supply) amount))
      (ok true)
    )
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
    (let ((current (balance-of recipient)))
      (map-set balances {owner: recipient} {balance: (+ current amount)})
      (var-set total-supply (+ (var-get total-supply) amount))
      (ok true)
    )
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
    ;; Allow either the bridge adapter or the token owner (via adapter) to call
    (asserts! (is-bridge-adapter contract-caller) (err ERR_UNAUTHORIZED))
    (let ((current (balance-of owner)))
      (asserts! (>= current amount) (err ERR_INSUFFICIENT_BALANCE))
      (map-set balances {owner: owner} {balance: (- current amount)})
      (var-set total-supply (- (var-get total-supply) amount))
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
  (ok (balance-of who))
)

(define-read-only (get-total-supply)
  (ok (var-get total-supply))
)

(define-read-only (get-token-uri)
  (ok none)
)

(define-read-only (get-bridge-adapter)
  (var-get bridge-adapter)
)
