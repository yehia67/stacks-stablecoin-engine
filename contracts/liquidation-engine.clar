(define-constant ERR_HEALTHY u300)
(define-constant MIN_HEALTH u150)

(define-public (liquidate (owner principal))
  (let ((health-factor (contract-call? .vault-engine get-health-factor owner)))
    (if (>= health-factor MIN_HEALTH)
      (err ERR_HEALTHY)
      (begin
        ;; TODO(liquidation): offset vault debt against stability pool balances.
        ;; TODO(liquidation): account collateral seizure and liquidator settlement.
        ;; TODO(liquidation): add detailed event/accounting outputs.
        (ok true)
      )
    )
  )
)
