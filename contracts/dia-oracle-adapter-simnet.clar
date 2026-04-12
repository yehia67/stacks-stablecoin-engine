;; DIA Oracle Adapter (Simnet Testing Only)
;; ---
;; Mock adapter for local Clarinet testing. Allows setting prices via set-value.
;; This contract is ONLY for simnet tests and should NEVER be deployed to testnet/mainnet.
;; 
;; For testnet/mainnet, use dia-oracle-adapter.clar which forwards to the real DIA oracle.

(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR_UNAUTHORIZED u700)
(define-constant ERR_PAIR_NOT_FOUND u701)

;; Stores price data per pair string, e.g. "BTC/USD", "STX/USD"
(define-map price-data
  {pair: (string-ascii 20)}
  {value: uint, timestamp: uint}
)

;; Owner-only: set price for a pair (simnet testing only)
(define-public (set-value (pair (string-ascii 20)) (new-value uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (map-set price-data
      {pair: pair}
      {value: new-value, timestamp: (* (unwrap-panic (get-stacks-block-info? time (- stacks-block-height u1))) u1000)}
    )
    (ok true)
  )
)

;; Owner-only: set price with explicit timestamp (for staleness testing)
(define-public (set-value-with-timestamp (pair (string-ascii 20)) (new-value uint) (ts uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (map-set price-data
      {pair: pair}
      {value: new-value, timestamp: ts}
    )
    (ok true)
  )
)

;; Read-only: matches DIA oracle's get-value interface
(define-read-only (get-value (pair (string-ascii 20)))
  (match (map-get? price-data {pair: pair})
    entry (ok entry)
    (err ERR_PAIR_NOT_FOUND)
  )
)
