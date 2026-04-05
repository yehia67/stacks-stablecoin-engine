(define-trait stablecoin-engine-token-trait
  (
    (mint (uint principal) (response bool uint))
    (burn (uint principal) (response bool uint))
  )
)
