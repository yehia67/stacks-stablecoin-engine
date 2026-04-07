;; DIA Oracle Adapter
;; ---
;; Local adapter that mirrors DIA's on-chain oracle interface.
;; In simnet/devnet this acts as an owner-settable mock.
;; For testnet/mainnet, deploy a version that forwards to the real DIA contract:
;;   Testnet: ST1S5ZGRZV5K4S9205RWPRTX9RGS9JV40KQMR4G1J.dia-oracle
;;   Mainnet: SP1G48FZ4Y7JY8G2Z0N51QTCYGBQ6F4J43J77BQC0.dia-oracle

(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR_UNAUTHORIZED u700)
(define-constant ERR_PAIR_NOT_FOUND u701)

;; Stores price data per pair string, e.g. "BTC/USD", "STX/USD"
(define-map price-data
  {pair: (string-ascii 20)}
  {value: uint, timestamp: uint}
)

;; Owner-only: set price for a pair (simnet/devnet testing)
(define-public (set-value (pair (string-ascii 20)) (new-value uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (map-set price-data
      {pair: pair}
      {value: new-value, timestamp: (unwrap-panic (get-stacks-block-info? time (- stacks-block-height u1)))}
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
