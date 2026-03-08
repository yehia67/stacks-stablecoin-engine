(define-constant ERR_VAULT_EXISTS u200)
(define-constant ERR_NO_VAULT u201)
(define-constant ERR_INSUFFICIENT_COLLATERAL u202)
(define-constant ERR_INSUFFICIENT_DEBT u203)
(define-constant ERR_UNSAFE_HEALTH_FACTOR u204)

(define-constant MIN-HEALTH-FACTOR u150)
(define-constant ZERO-DEBT-HEALTH-FACTOR u1000000)
(define-constant PRICE-SCALE u100000000)

(define-map vaults
  {owner: principal}
  {collateral: uint, debt: uint}
)

(define-private (get-oracle-price)
  ;; TODO(oracle): add stale-price checks, decimals normalization, and feed reliability rules.
  (unwrap-panic (contract-call? .price-oracle-mock get-price))
)

(define-private (calculate-health-factor (collateral uint) (debt uint))
  (if (is-eq debt u0)
    ZERO-DEBT-HEALTH-FACTOR
    (/ (* (* collateral (get-oracle-price)) u100) (* debt PRICE-SCALE))
  )
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
        ;; TODO(sBTC): transfer sBTC from user to protocol custody vault
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
      (let (
          (collateral (get collateral vault))
          (new-debt (+ (get debt vault) amount))
          (health-factor (calculate-health-factor (get collateral vault) (+ (get debt vault) amount)))
        )
        ;; Placeholder health check uses mock-oracle price and fixed scale assumptions.
        ;; TODO: use oracle + collateral registry + asset-specific risk parameters for production checks.
        (asserts! (>= health-factor MIN-HEALTH-FACTOR) (err ERR_UNSAFE_HEALTH_FACTOR))
        (try! (contract-call? .stablecoin-token mint amount tx-sender))
        (map-set vaults
          {owner: tx-sender}
          {collateral: collateral, debt: new-debt}
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
        (let (
            (debt (get debt vault))
            (new-collateral (- (get collateral vault) amount))
            (health-factor (calculate-health-factor (- (get collateral vault) amount) (get debt vault)))
          )
          (if (is-eq debt u0)
            true
            (asserts! (>= health-factor MIN-HEALTH-FACTOR) (err ERR_UNSAFE_HEALTH_FACTOR))
          )
          ;; TODO(sBTC): transfer sBTC from protocol custody vault back to user
          (map-set vaults
            {owner: tx-sender}
            {collateral: new-collateral, debt: debt}
          )
          (ok new-collateral)
        )
      )
    (err ERR_NO_VAULT)
  )
)

(define-read-only (get-health-factor (owner principal))
  (let ((vault (default-to {collateral: u0, debt: u0} (map-get? vaults {owner: owner}))))
    ;; Minimal placeholder ratio math using oracle price. Not production-grade risk logic.
    (calculate-health-factor (get collateral vault) (get debt vault))
  )
)
