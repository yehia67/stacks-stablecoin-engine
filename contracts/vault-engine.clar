(define-constant ERR_VAULT_EXISTS u200)
(define-constant ERR_NO_VAULT u201)
(define-constant ERR_INSUFFICIENT_COLLATERAL u202)
(define-constant ERR_INSUFFICIENT_DEBT u203)

(define-map vaults
  {owner: principal}
  {collateral: uint, debt: uint}
)

(define-public (open-vault)
  (begin
    (asserts! (is-none (map-get? vaults {owner: tx-sender})) (err ERR_VAULT_EXISTS))
    (map-set vaults {owner: tx-sender} {collateral: u0, debt: u0})
    (ok true)
  )
)

(define-public (deposit-collateral (amount uint))
  (match (map-get? vaults {owner: tx-sender})
    vault
      (let ((new-collateral (+ (get collateral vault) amount)))
        ;; TODO: transfer sBTC from user to vault
        (map-set vaults
          {owner: tx-sender}
          {collateral: new-collateral, debt: (get debt vault)}
        )
        (ok new-collateral)
      )
    (err ERR_NO_VAULT)
  )
)

(define-public (mint (amount uint))
  (match (map-get? vaults {owner: tx-sender})
    vault
      (let ((new-debt (+ (get debt vault) amount)))
        ;; TODO: use oracle + collateral registry for health checks
        (try! (contract-call? .stablecoin-token mint amount tx-sender))
        (map-set vaults
          {owner: tx-sender}
          {collateral: (get collateral vault), debt: new-debt}
        )
        (ok new-debt)
      )
    (err ERR_NO_VAULT)
  )
)

(define-public (burn (amount uint))
  (match (map-get? vaults {owner: tx-sender})
    vault
      (begin
        (asserts! (>= (get debt vault) amount) (err ERR_INSUFFICIENT_DEBT))
        (try! (contract-call? .stablecoin-token burn amount tx-sender))
        (map-set vaults
          {owner: tx-sender}
          {collateral: (get collateral vault), debt: (- (get debt vault) amount)}
        )
        (ok true)
      )
    (err ERR_NO_VAULT)
  )
)

(define-public (withdraw-collateral (amount uint))
  (match (map-get? vaults {owner: tx-sender})
    vault
      (begin
        (asserts! (>= (get collateral vault) amount) (err ERR_INSUFFICIENT_COLLATERAL))
        (let ((new-collateral (- (get collateral vault) amount)))
          ;; TODO: enforce health factor checks
          ;; TODO: transfer sBTC back to user
          (map-set vaults
            {owner: tx-sender}
            {collateral: new-collateral, debt: (get debt vault)}
          )
          (ok new-collateral)
        )
      )
    (err ERR_NO_VAULT)
  )
)

(define-read-only (get-health-factor (owner principal))
  (let ((vault (default-to {collateral: u0, debt: u0} (map-get? vaults {owner: owner}))))
    (if (is-eq (get debt vault) u0)
      u1000000
      (/ (* (get collateral vault) u100) (get debt vault))
    )
  )
)
