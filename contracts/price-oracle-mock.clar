(impl-trait .oracle-trait.oracle-trait)

(define-constant PRICE u100000000)

(define-read-only (get-price)
  (ok PRICE)
)
