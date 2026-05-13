;; xreserve-adapter-v5.clar
;; Same as v4, but admin functions are governance-gated and references bridge-registry-v4.

(impl-trait .bridge-adapter-trait.bridge-adapter-trait)

;; ============================================
;; Constants
;; ============================================

(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR_UNAUTHORIZED u500)
(define-constant ERR_INVALID_CHAIN u501)
(define-constant ERR_INVALID_AMOUNT u502)
(define-constant ERR_PAUSED u503)
(define-constant ERR_BOOTSTRAP_LOCKED u504)

(define-constant STACKS_DOMAIN_ID u10003)
(define-constant ETHEREUM_CHAIN_ID u1)
(define-constant ETHEREUM_SEPOLIA_CHAIN_ID u11155111)

;; ============================================
;; Governance
;; ============================================

(define-data-var governance principal CONTRACT-OWNER)
(define-data-var bootstrap-locked bool false)

(define-read-only (get-governance) (var-get governance))
(define-read-only (is-bootstrap-locked) (var-get bootstrap-locked))

(define-public (bootstrap-set-governance (new-gov principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (asserts! (not (var-get bootstrap-locked)) (err ERR_BOOTSTRAP_LOCKED))
    (var-set governance new-gov)
    (ok true)
  )
)

(define-public (lock-bootstrap)
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (var-set bootstrap-locked true)
    (ok true)
  )
)

(define-private (is-governance-caller)
  (or
    (is-eq contract-caller (var-get governance))
    (and (not (var-get bootstrap-locked)) (is-eq tx-sender CONTRACT-OWNER))
  )
)

;; ============================================
;; Data Variables
;; ============================================

(define-data-var attestation-service (optional principal) none)
(define-data-var bridged-token (optional principal) none)
(define-data-var paused bool false)

;; ============================================
;; Data Maps
;; ============================================

(define-map supported-chains
  {chain-id: uint}
  {enabled: bool, name: (string-ascii 32)}
)

(define-map processed-txs
  {remote-tx-id: (buff 32), remote-chain-id: uint}
  {processed: bool, block-height: uint}
)

;; ============================================
;; Authorization Functions (governance-gated)
;; ============================================

(define-public (set-attestation-service (new-service principal))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (var-set attestation-service (some new-service))
    (ok true)
  )
)

(define-public (set-bridged-token (token principal))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (var-set bridged-token (some token))
    (ok true)
  )
)

(define-public (set-paused (new-paused-state bool))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (var-set paused new-paused-state)
    (ok true)
  )
)

(define-public (add-supported-chain (target-chain-id uint) (chain-name (string-ascii 32)))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (map-set supported-chains {chain-id: target-chain-id} {enabled: true, name: chain-name})
    (ok true)
  )
)

(define-public (remove-supported-chain (target-chain-id uint))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
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

(define-read-only (get-attestation-service) (var-get attestation-service))
(define-read-only (get-bridged-token) (var-get bridged-token))
(define-read-only (get-paused) (var-get paused))

;; ============================================
;; Private Helpers
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

(define-public (mint-from-remote
    (amount uint)
    (recipient principal)
    (remote-tx-id (buff 32))
    (remote-chain-id uint))
  (begin
    (asserts! (not (var-get paused)) (err ERR_PAUSED))
    (asserts! (is-attestation-service contract-caller) (err ERR_UNAUTHORIZED))
    (asserts! (is-chain-supported remote-chain-id) (err ERR_INVALID_CHAIN))
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    (asserts! (not (is-tx-processed remote-tx-id remote-chain-id)) (err ERR_UNAUTHORIZED))

    (map-set processed-txs
      {remote-tx-id: remote-tx-id, remote-chain-id: remote-chain-id}
      {processed: true, block-height: stacks-block-height}
    )

    (match (var-get bridged-token)
      token (contract-call? .stablecoin-token-v4 mint-from-bridge amount recipient)
      (err ERR_UNAUTHORIZED)
    )
  )
)

(define-public (burn-to-remote
    (amount uint)
    (remote-recipient (buff 32))
    (remote-chain-id uint))
  (begin
    (asserts! (not (var-get paused)) (err ERR_PAUSED))
    (asserts! (is-chain-supported remote-chain-id) (err ERR_INVALID_CHAIN))
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    (contract-call? .stablecoin-token-v4 burn-to-remote amount tx-sender remote-recipient remote-chain-id)
  )
)
