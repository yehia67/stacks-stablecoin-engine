;; Stablecoin Factory
;; Manages registration of new stablecoins with configurable fees

;; ============================================
;; Constants
;; ============================================
(define-constant CONTRACT-OWNER tx-sender)

;; Error codes
(define-constant ERR_UNAUTHORIZED u700)
(define-constant ERR_INSUFFICIENT_FEE u701)
(define-constant ERR_STABLECOIN_ALREADY_REGISTERED u702)
(define-constant ERR_STABLECOIN_NOT_FOUND u703)
(define-constant ERR_INVALID_FEE u704)
(define-constant ERR_TRANSFER_FAILED u705)
(define-constant ERR_INVALID_TREASURY u706)

;; ============================================
;; Data Variables
;; ============================================

;; Registration fee in microSTX (1 STX = 1,000,000 microSTX)
;; Default: 10 STX = 10,000,000 microSTX
;; Set to 0 to disable fee
(define-data-var registration-fee uint u10000000)

;; Treasury address where fees are sent
(define-data-var treasury-address principal CONTRACT-OWNER)

;; Counter for registered stablecoins
(define-data-var stablecoin-count uint u0)

;; ============================================
;; Data Maps
;; ============================================

;; Registry of all registered stablecoins
(define-map registered-stablecoins
  {stablecoin-id: uint}
  {
    name: (string-ascii 32),
    symbol: (string-ascii 10),
    creator: principal,
    token-contract: (optional principal),
    registered-at: uint,
    fee-paid: uint
  }
)

;; Map from creator to their stablecoin IDs
(define-map creator-stablecoins
  {creator: principal, index: uint}
  {stablecoin-id: uint}
)

;; Count of stablecoins per creator
(define-map creator-stablecoin-count
  {creator: principal}
  {count: uint}
)

;; Check if a name is already taken
(define-map stablecoin-names
  {name: (string-ascii 32)}
  {stablecoin-id: uint}
)

;; Check if a symbol is already taken
(define-map stablecoin-symbols
  {symbol: (string-ascii 10)}
  {stablecoin-id: uint}
)

;; ============================================
;; Private Functions
;; ============================================

(define-private (is-owner)
  (is-eq tx-sender CONTRACT-OWNER)
)

;; ============================================
;; Admin Functions
;; ============================================

;; Set the registration fee (only owner)
;; Fee of 0 disables the fee requirement
(define-public (set-registration-fee (new-fee uint))
  (begin
    (asserts! (is-owner) (err ERR_UNAUTHORIZED))
    (var-set registration-fee new-fee)
    (print {event: "registration-fee-updated", new-fee: new-fee})
    (ok true)
  )
)

;; Set the treasury address (only owner)
(define-public (set-treasury-address (new-treasury principal))
  (begin
    (asserts! (is-owner) (err ERR_UNAUTHORIZED))
    ;; Cannot set treasury to the zero address (contract itself as proxy check)
    (asserts! (not (is-eq new-treasury (as-contract tx-sender))) (err ERR_INVALID_TREASURY))
    (var-set treasury-address new-treasury)
    (print {event: "treasury-updated", new-treasury: new-treasury})
    (ok true)
  )
)

;; ============================================
;; Registration Functions
;; ============================================

;; Register a new stablecoin
;; Charges the registration fee in STX and transfers to treasury
(define-public (register-stablecoin 
    (name (string-ascii 32))
    (symbol (string-ascii 10))
  )
  (let (
      (fee (var-get registration-fee))
      (treasury (var-get treasury-address))
      (new-id (var-get stablecoin-count))
      (creator-count (default-to u0 (get count (map-get? creator-stablecoin-count {creator: tx-sender}))))
    )
    ;; Check name is not already taken
    (asserts! (is-none (map-get? stablecoin-names {name: name})) (err ERR_STABLECOIN_ALREADY_REGISTERED))
    
    ;; Check symbol is not already taken
    (asserts! (is-none (map-get? stablecoin-symbols {symbol: symbol})) (err ERR_STABLECOIN_ALREADY_REGISTERED))
    
    ;; Transfer fee if fee > 0
    (if (> fee u0)
      (try! (stx-transfer? fee tx-sender treasury))
      true
    )
    
    ;; Register the stablecoin
    (map-set registered-stablecoins
      {stablecoin-id: new-id}
      {
        name: name,
        symbol: symbol,
        creator: tx-sender,
        token-contract: none,
        registered-at: block-height,
        fee-paid: fee
      }
    )
    
    ;; Reserve the name and symbol
    (map-set stablecoin-names {name: name} {stablecoin-id: new-id})
    (map-set stablecoin-symbols {symbol: symbol} {stablecoin-id: new-id})
    
    ;; Track creator's stablecoins
    (map-set creator-stablecoins
      {creator: tx-sender, index: creator-count}
      {stablecoin-id: new-id}
    )
    (map-set creator-stablecoin-count
      {creator: tx-sender}
      {count: (+ creator-count u1)}
    )
    
    ;; Increment global counter
    (var-set stablecoin-count (+ new-id u1))
    
    (print {
      event: "stablecoin-registered",
      stablecoin-id: new-id,
      name: name,
      symbol: symbol,
      creator: tx-sender,
      fee-paid: fee
    })
    
    (ok new-id)
  )
)

;; Link a deployed token contract to a registered stablecoin
;; Only the creator can do this
(define-public (set-token-contract (stablecoin-id uint) (token-contract principal))
  (match (map-get? registered-stablecoins {stablecoin-id: stablecoin-id})
    stablecoin
      (begin
        (asserts! (is-eq tx-sender (get creator stablecoin)) (err ERR_UNAUTHORIZED))
        (map-set registered-stablecoins
          {stablecoin-id: stablecoin-id}
          (merge stablecoin {token-contract: (some token-contract)})
        )
        (print {event: "token-contract-linked", stablecoin-id: stablecoin-id, token-contract: token-contract})
        (ok true)
      )
    (err ERR_STABLECOIN_NOT_FOUND)
  )
)

;; ============================================
;; Read-Only Functions
;; ============================================

(define-read-only (get-registration-fee)
  (var-get registration-fee)
)

(define-read-only (get-treasury-address)
  (var-get treasury-address)
)

(define-read-only (get-stablecoin-count)
  (var-get stablecoin-count)
)

(define-read-only (get-stablecoin (stablecoin-id uint))
  (map-get? registered-stablecoins {stablecoin-id: stablecoin-id})
)

(define-read-only (get-stablecoin-by-name (name (string-ascii 32)))
  (match (map-get? stablecoin-names {name: name})
    name-entry (map-get? registered-stablecoins {stablecoin-id: (get stablecoin-id name-entry)})
    none
  )
)

(define-read-only (get-stablecoin-by-symbol (symbol (string-ascii 10)))
  (match (map-get? stablecoin-symbols {symbol: symbol})
    symbol-entry (map-get? registered-stablecoins {stablecoin-id: (get stablecoin-id symbol-entry)})
    none
  )
)

(define-read-only (is-name-taken (name (string-ascii 32)))
  (is-some (map-get? stablecoin-names {name: name}))
)

(define-read-only (is-symbol-taken (symbol (string-ascii 10)))
  (is-some (map-get? stablecoin-symbols {symbol: symbol}))
)

(define-read-only (get-creator-stablecoin-count (creator principal))
  (default-to u0 (get count (map-get? creator-stablecoin-count {creator: creator})))
)

(define-read-only (get-creator-stablecoin-at-index (creator principal) (index uint))
  (match (map-get? creator-stablecoins {creator: creator, index: index})
    entry (map-get? registered-stablecoins {stablecoin-id: (get stablecoin-id entry)})
    none
  )
)
