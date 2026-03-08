(impl-trait .oracle-trait.oracle-trait)

(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR_UNAUTHORIZED u600)
(define-data-var price uint u100000000)

(define-public (set-price (new-price uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    ;; TODO(oracle): validate heartbeat/staleness before accepting updates.
    ;; TODO(oracle): replace single-source mock with aggregated production feeds.
    (var-set price new-price)
    (ok true)
  )
)

(define-read-only (get-price)
  ;; TODO(oracle): add fallback feed and circuit-breaker logic.
  (ok (var-get price))
)
