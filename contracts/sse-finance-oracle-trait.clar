;; sse-finance-oracle-trait.clar
;;
;; Fresh, in-package copy of the price-oracle trait for the SSE Finance
;; deployment. Identical surface to the existing oracle-trait.clar, but
;; redeclared here so every SSE Finance contract `use-trait`s its OWN trait set
;; and nothing points at an externally-deployed trait contract.
;;
;; get-price returns a USD price at the 8-decimal PRICE-SCALE used throughout
;; SSE (u100000000 = $1.00). Any contract implementing this trait can serve as a
;; market's oracle, so a market can be re-pointed at a different oracle principal
;; without redeploying the consumer.

(define-trait sse-finance-oracle-trait
  (
    (get-price () (response uint uint))
  )
)
