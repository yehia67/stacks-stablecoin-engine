;; Stablecoin Factory v4
;; Same product surface as v3, but admin functions are now gated on the timelock
;; (set via bootstrap, then locked). See contracts/sse-timelock-v1.clar.

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
(define-constant ERR_BOOTSTRAP_LOCKED u707)

;; ============================================
;; Governance
;; ============================================

;; Principal allowed to invoke admin functions. Bootstrap-set by deployer to the
;; sse-timelock-v1 principal, then locked.
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

;; Registration fee in microSTX. Default: 10 STX. Fee 0 disables.
(define-data-var registration-fee uint u10000000)

;; Treasury address where fees are sent
(define-data-var treasury-address principal CONTRACT-OWNER)

;; Counter for registered stablecoins
(define-data-var stablecoin-count uint u0)

;; ============================================
;; Data Maps
;; ============================================

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

(define-map creator-stablecoins
  {creator: principal, index: uint}
  {stablecoin-id: uint}
)

(define-map creator-stablecoin-count
  {creator: principal}
  {count: uint}
)

(define-map stablecoin-names
  {name: (string-ascii 32)}
  {stablecoin-id: uint}
)

(define-map stablecoin-symbols
  {symbol: (string-ascii 10)}
  {stablecoin-id: uint}
)

;; ============================================
;; Admin Functions (governance-gated)
;; ============================================

(define-public (set-registration-fee (new-fee uint))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (var-set registration-fee new-fee)
    (print {event: "registration-fee-updated", new-fee: new-fee})
    (ok true)
  )
)

(define-public (set-treasury-address (new-treasury principal))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (asserts! (not (is-eq new-treasury (as-contract tx-sender))) (err ERR_INVALID_TREASURY))
    (var-set treasury-address new-treasury)
    (print {event: "treasury-updated", new-treasury: new-treasury})
    (ok true)
  )
)

;; ============================================
;; Registration Functions
;; ============================================

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
    (asserts! (is-none (map-get? stablecoin-names {name: name})) (err ERR_STABLECOIN_ALREADY_REGISTERED))
    (asserts! (is-none (map-get? stablecoin-symbols {symbol: symbol})) (err ERR_STABLECOIN_ALREADY_REGISTERED))

    (if (and (> fee u0) (not (is-eq tx-sender treasury)))
      (try! (stx-transfer? fee tx-sender treasury))
      true
    )

    (map-set registered-stablecoins
      {stablecoin-id: new-id}
      {
        name: name,
        symbol: symbol,
        creator: tx-sender,
        token-contract: none,
        registered-at: stacks-block-height,
        fee-paid: fee
      }
    )

    (map-set stablecoin-names {name: name} {stablecoin-id: new-id})
    (map-set stablecoin-symbols {symbol: symbol} {stablecoin-id: new-id})

    (map-set creator-stablecoins
      {creator: tx-sender, index: creator-count}
      {stablecoin-id: new-id}
    )
    (map-set creator-stablecoin-count
      {creator: tx-sender}
      {count: (+ creator-count u1)}
    )

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
;; Read-Only
;; ============================================

(define-read-only (get-registration-fee) (var-get registration-fee))
(define-read-only (get-treasury-address) (var-get treasury-address))
(define-read-only (get-stablecoin-count) (var-get stablecoin-count))

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

(define-read-only (get-stablecoin-creator (stablecoin-id uint))
  (match (map-get? registered-stablecoins {stablecoin-id: stablecoin-id})
    stablecoin (some (get creator stablecoin))
    none
  )
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
