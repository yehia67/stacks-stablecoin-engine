;; xreserve-adapter.clar
;; Adapter implementing bridge-adapter-trait for Circle's xReserve protocol.
;; Handles mint-from-remote (called by attestation service) and burn-to-remote (called by users).

(impl-trait .bridge-adapter-trait.bridge-adapter-trait)

;; ============================================
;; Constants
;; ============================================

(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR_UNAUTHORIZED u500)
(define-constant ERR_INVALID_CHAIN u501)
(define-constant ERR_INVALID_AMOUNT u502)
(define-constant ERR_PAUSED u503)

;; Stacks domain ID used by xReserve protocol
(define-constant STACKS_DOMAIN_ID u10003)

;; Ethereum mainnet chain ID
(define-constant ETHEREUM_CHAIN_ID u1)

;; Ethereum Sepolia testnet chain ID
(define-constant ETHEREUM_SEPOLIA_CHAIN_ID u11155111)

;; ============================================
;; Data Variables
;; ============================================

;; Authorized attestation service principal (can call mint-from-remote)
(define-data-var attestation-service (optional principal) none)

;; Token contract this adapter is authorized to mint/burn
(define-data-var bridged-token (optional principal) none)

;; Pause flag for emergency stops
(define-data-var paused bool false)

;; ============================================
;; Data Maps
;; ============================================

;; Supported remote chains
(define-map supported-chains
  {chain-id: uint}
  {enabled: bool, name: (string-ascii 32)}
)

;; Processed remote transactions (prevent replay)
(define-map processed-txs
  {remote-tx-id: (buff 32), remote-chain-id: uint}
  {processed: bool, block-height: uint}
)

;; ============================================
;; Authorization Functions
;; ============================================

(define-public (set-attestation-service (new-service principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (var-set attestation-service (some new-service))
    (ok true)
  )
)

(define-public (set-bridged-token (token principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (var-set bridged-token (some token))
    (ok true)
  )
)

(define-public (set-paused (new-paused-state bool))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (var-set paused new-paused-state)
    (ok true)
  )
)

(define-public (add-supported-chain (target-chain-id uint) (chain-name (string-ascii 32)))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (map-set supported-chains {chain-id: target-chain-id} {enabled: true, name: chain-name})
    (ok true)
  )
)

(define-public (remove-supported-chain (target-chain-id uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (map-set supported-chains {chain-id: target-chain-id} {enabled: false, name: ""})
    (ok true)
  )
)

;; ============================================
;; Read-Only Functions
;; ============================================

(define-read-only (is-chain-supported (target-chain-id uint))
  (match (map-get? supported-chains {chain-id: target-chain-id})
    chain-info (get enabled chain-info)
    false
  )
)

(define-read-only (is-tx-processed (tx-id (buff 32)) (tx-chain-id uint))
  (match (map-get? processed-txs {remote-tx-id: tx-id, remote-chain-id: tx-chain-id})
    tx-info (get processed tx-info)
    false
  )
)

(define-read-only (get-attestation-service)
  (var-get attestation-service)
)

(define-read-only (get-bridged-token)
  (var-get bridged-token)
)

(define-read-only (get-paused)
  (var-get paused)
)

;; ============================================
;; Private Helper Functions
;; ============================================

(define-private (is-attestation-service (caller principal))
  (match (var-get attestation-service)
    service (is-eq service caller)
    false
  )
)

;; ============================================
;; Bridge Adapter Trait Implementation
;; ============================================

;; Mint tokens after deposit is confirmed on remote chain
;; Only callable by the authorized attestation service
(define-public (mint-from-remote 
    (amount uint) 
    (recipient principal) 
    (remote-tx-id (buff 32)) 
    (remote-chain-id uint))
  (begin
    ;; Check not paused
    (asserts! (not (var-get paused)) (err ERR_PAUSED))
    
    ;; Check caller is attestation service
    (asserts! (is-attestation-service contract-caller) (err ERR_UNAUTHORIZED))
    
    ;; Check chain is supported
    (asserts! (is-chain-supported remote-chain-id) (err ERR_INVALID_CHAIN))
    
    ;; Check amount is valid
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    
    ;; Check transaction not already processed (replay protection)
    (asserts! (not (is-tx-processed remote-tx-id remote-chain-id)) (err ERR_UNAUTHORIZED))
    
    ;; Mark transaction as processed
    (map-set processed-txs 
      {remote-tx-id: remote-tx-id, remote-chain-id: remote-chain-id}
      {processed: true, block-height: stacks-block-height}
    )
    
    ;; Call mint on the bridged token
    ;; The token contract must authorize this adapter to mint
    (match (var-get bridged-token)
      token (contract-call? .stablecoin-token mint-from-bridge amount recipient)
      (err ERR_UNAUTHORIZED)
    )
  )
)

;; Burn tokens to initiate withdrawal to remote chain
;; Callable by any token holder
(define-public (burn-to-remote 
    (amount uint) 
    (remote-recipient (buff 32)) 
    (remote-chain-id uint))
  (begin
    ;; Check not paused
    (asserts! (not (var-get paused)) (err ERR_PAUSED))
    
    ;; Check chain is supported
    (asserts! (is-chain-supported remote-chain-id) (err ERR_INVALID_CHAIN))
    
    ;; Check amount is valid
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    
    ;; Call burn-to-remote on the token contract
    ;; This will burn the tokens and emit an event for the attestation service
    (contract-call? .stablecoin-token burn-to-remote amount tx-sender remote-recipient remote-chain-id)
  )
)
