(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR_UNAUTHORIZED u100)

(define-map collateral-configs
  {asset: principal}
  {min-collateral-ratio: uint, liquidation-penalty: uint, debt-ceiling: uint}
)

(define-public (add-collateral-type
    (asset principal)
    (min-collateral-ratio uint)
    (liquidation-penalty uint)
    (debt-ceiling uint)
  )
  (begin
    ;; TODO(governance): replace owner-only writes with timelocked governance control.
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    ;; TODO(governance): add governance-managed per-asset config update flow.
    (map-set collateral-configs
      {asset: asset}
      {
        min-collateral-ratio: min-collateral-ratio,
        liquidation-penalty: liquidation-penalty,
        debt-ceiling: debt-ceiling
      }
    )
    (ok true)
  )
)

(define-read-only (get-collateral-config (asset principal))
  (map-get? collateral-configs {asset: asset})
)
