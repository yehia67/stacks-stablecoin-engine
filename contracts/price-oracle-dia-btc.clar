;; DIA-backed BTC/USD Price Oracle
;; ---
;; Implements oracle-trait by reading BTC/USD from the DIA oracle adapter.
;; Includes configurable staleness guard -- rejects prices older than MAX_STALENESS seconds.

(impl-trait .oracle-trait.oracle-trait)

(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR_UNAUTHORIZED u600)
(define-constant ERR_STALE_PRICE u601)
(define-constant ERR_NO_PRICE u602)
(define-constant PAIR "BTC/USD")

;; Default max staleness: 3600 seconds (1 hour)
(define-data-var max-staleness uint u3600)

;; Owner-only: tune staleness threshold
(define-public (set-max-staleness (new-max uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (var-set max-staleness new-max)
    (ok true)
  )
)

(define-read-only (get-max-staleness)
  (var-get max-staleness)
)

;; oracle-trait implementation
(define-read-only (get-price)
  (let (
      (dia-data (unwrap! (contract-call? .dia-oracle-adapter get-value PAIR) (err ERR_NO_PRICE)))
      (price-value (get value dia-data))
      (price-ts (get timestamp dia-data))
      (current-ts (unwrap! (get-stacks-block-info? time (- stacks-block-height u1)) (err ERR_NO_PRICE)))
      (age (- current-ts price-ts))
    )
    (asserts! (<= age (var-get max-staleness)) (err ERR_STALE_PRICE))
    (ok price-value)
  )
)
