;; bridge-registry.clar
;; Registry for tracking bridge-enabled tokens and their remote chain configurations.
;; Maps token principals to their bridge adapters and remote chain metadata.

(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR_UNAUTHORIZED u600)
(define-constant ERR_TOKEN_NOT_REGISTERED u601)
(define-constant ERR_TOKEN_ALREADY_REGISTERED u602)
(define-constant ERR_CHAIN_NOT_SUPPORTED u603)

;; ============================================
;; Data Maps
;; ============================================

;; Token registration: maps token principal to its bridge configuration
(define-map registered-tokens
  {token: principal}
  {
    adapter: principal,
    enabled: bool,
    registered-at: uint
  }
)

;; Remote chain configurations for each token
;; A token can be bridged to multiple chains
(define-map token-chains
  {token: principal, chain-id: uint}
  {
    remote-token-address: (buff 32),
    enabled: bool,
    min-bridge-amount: uint,
    max-bridge-amount: uint
  }
)

;; Global list of supported chain IDs
(define-map supported-chains
  {chain-id: uint}
  {
    name: (string-ascii 32),
    enabled: bool
  }
)

;; ============================================
;; Admin Functions
;; ============================================

;; Add a new supported chain
(define-public (add-chain (target-chain-id uint) (chain-name (string-ascii 32)))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (map-set supported-chains 
      {chain-id: target-chain-id} 
      {name: chain-name, enabled: true}
    )
    (ok true)
  )
)

;; Disable a chain
(define-public (disable-chain (target-chain-id uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (match (map-get? supported-chains {chain-id: target-chain-id})
      chain-info 
        (begin
          (map-set supported-chains 
            {chain-id: target-chain-id} 
            {name: (get name chain-info), enabled: false}
          )
          (ok true)
        )
      (err ERR_CHAIN_NOT_SUPPORTED)
    )
  )
)

;; ============================================
;; Token Registration Functions
;; ============================================

;; Register a new token for bridging
(define-public (register-token (target-token principal) (target-adapter principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (asserts! (is-none (map-get? registered-tokens {token: target-token})) (err ERR_TOKEN_ALREADY_REGISTERED))
    (map-set registered-tokens
      {token: target-token}
      {
        adapter: target-adapter,
        enabled: true,
        registered-at: stacks-block-height
      }
    )
    (print {event: "token-registered", token: target-token, adapter: target-adapter})
    (ok true)
  )
)

;; Update token's bridge adapter
(define-public (update-token-adapter (target-token principal) (new-adapter principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (match (map-get? registered-tokens {token: target-token})
      token-info
        (begin
          (map-set registered-tokens
            {token: target-token}
            {
              adapter: new-adapter,
              enabled: (get enabled token-info),
              registered-at: (get registered-at token-info)
            }
          )
          (ok true)
        )
      (err ERR_TOKEN_NOT_REGISTERED)
    )
  )
)

;; Enable/disable a token for bridging
(define-public (set-token-enabled (target-token principal) (is-enabled bool))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (match (map-get? registered-tokens {token: target-token})
      token-info
        (begin
          (map-set registered-tokens
            {token: target-token}
            {
              adapter: (get adapter token-info),
              enabled: is-enabled,
              registered-at: (get registered-at token-info)
            }
          )
          (ok true)
        )
      (err ERR_TOKEN_NOT_REGISTERED)
    )
  )
)

;; Configure a token for a specific remote chain
(define-public (configure-token-chain 
    (target-token principal) 
    (target-chain-id uint) 
    (remote-addr (buff 32))
    (min-amount uint)
    (max-amount uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (asserts! (is-some (map-get? registered-tokens {token: target-token})) (err ERR_TOKEN_NOT_REGISTERED))
    (asserts! (is-chain-supported target-chain-id) (err ERR_CHAIN_NOT_SUPPORTED))
    (map-set token-chains
      {token: target-token, chain-id: target-chain-id}
      {
        remote-token-address: remote-addr,
        enabled: true,
        min-bridge-amount: min-amount,
        max-bridge-amount: max-amount
      }
    )
    (print {
      event: "token-chain-configured", 
      token: target-token, 
      chain-id: target-chain-id,
      remote-token-address: remote-addr
    })
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

(define-read-only (get-chain-info (target-chain-id uint))
  (map-get? supported-chains {chain-id: target-chain-id})
)

(define-read-only (is-token-registered (target-token principal))
  (is-some (map-get? registered-tokens {token: target-token}))
)

(define-read-only (get-token-info (target-token principal))
  (map-get? registered-tokens {token: target-token})
)

(define-read-only (is-token-enabled (target-token principal))
  (match (map-get? registered-tokens {token: target-token})
    token-info (get enabled token-info)
    false
  )
)

(define-read-only (get-token-adapter (target-token principal))
  (match (map-get? registered-tokens {token: target-token})
    token-info (some (get adapter token-info))
    none
  )
)

(define-read-only (get-token-chain-config (target-token principal) (target-chain-id uint))
  (map-get? token-chains {token: target-token, chain-id: target-chain-id})
)

(define-read-only (is-token-chain-enabled (target-token principal) (target-chain-id uint))
  (match (map-get? token-chains {token: target-token, chain-id: target-chain-id})
    config (get enabled config)
    false
  )
)

(define-read-only (get-bridge-limits (target-token principal) (target-chain-id uint))
  (match (map-get? token-chains {token: target-token, chain-id: target-chain-id})
    config (some {min: (get min-bridge-amount config), max: (get max-bridge-amount config)})
    none
  )
)
