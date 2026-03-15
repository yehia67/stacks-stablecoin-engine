;; Multi-Asset Vault Engine
;; Supports multiple collateral types with per-asset accounting

;; ============================================
;; Error Constants
;; ============================================
(define-constant ERR_VAULT_EXISTS u200)
(define-constant ERR_NO_VAULT u201)
(define-constant ERR_INSUFFICIENT_COLLATERAL u202)
(define-constant ERR_INSUFFICIENT_DEBT u203)
(define-constant ERR_UNSAFE_HEALTH_FACTOR u204)
(define-constant ERR_ASSET_NOT_SUPPORTED u205)
(define-constant ERR_ASSET_DISABLED u206)
(define-constant ERR_NO_COLLATERAL_POSITION u207)
(define-constant ERR_BELOW_DEBT_FLOOR u208)
(define-constant ERR_UNAUTHORIZED u209)

;; ============================================
;; Constants
;; ============================================
(define-constant PRICE-SCALE u100000000)  ;; 1e8 for price precision
(define-constant RATIO-SCALE u100)        ;; Ratios are in percentage (150 = 150%)
(define-constant ZERO-DEBT-HEALTH-FACTOR u1000000)

;; ============================================
;; Data Maps
;; ============================================

;; Track whether a user has an active vault
(define-map vaults
  {owner: principal}
  {
    total-debt: uint,           ;; Total stablecoin debt across all collateral
    created-at: uint            ;; Block height when vault was created
  }
)

;; Per-asset collateral positions within a vault
(define-map vault-collateral
  {owner: principal, asset: principal}
  {
    amount: uint,               ;; Amount of this collateral deposited
    debt-share: uint            ;; Portion of total debt attributed to this collateral
  }
)

;; Track which assets a user has deposited (for enumeration)
(define-map vault-asset-count
  {owner: principal}
  {count: uint}
)

(define-map vault-asset-list
  {owner: principal, index: uint}
  {asset: principal}
)

;; ============================================
;; Private Helper Functions
;; ============================================

(define-private (get-asset-price (asset principal))
  ;; Get price from the asset's configured oracle
  ;; For now, use the mock oracle; in production, this would call the asset-specific oracle
  (unwrap-panic (contract-call? .price-oracle-mock get-price))
)

(define-private (get-asset-config (asset principal))
  (contract-call? .collateral-registry get-collateral-config asset)
)

(define-private (get-min-ratio-for-asset (asset principal))
  (default-to u150 (contract-call? .collateral-registry get-min-collateral-ratio asset))
)

(define-private (get-liquidation-ratio-for-asset (asset principal))
  (default-to u120 (contract-call? .collateral-registry get-liquidation-ratio asset))
)

(define-private (calculate-collateral-value (asset principal) (amount uint))
  ;; Calculate USD value of collateral: (amount * price) / PRICE-SCALE
  (let ((price (get-asset-price asset)))
    (/ (* amount price) PRICE-SCALE)
  )
)

(define-private (calculate-position-health-factor (collateral-value uint) (debt uint) (min-ratio uint))
  ;; Health factor = (collateral-value * 100) / (debt * min-ratio / 100)
  ;; Simplified: (collateral-value * 100 * 100) / (debt * min-ratio)
  (if (is-eq debt u0)
    ZERO-DEBT-HEALTH-FACTOR
    (/ (* collateral-value u10000) (* debt min-ratio))
  )
)

;; ============================================
;; Vault Management
;; ============================================

(define-public (open-vault)
  (begin
    (asserts! (is-none (map-get? vaults {owner: tx-sender})) (err ERR_VAULT_EXISTS))
    (map-set vaults 
      {owner: tx-sender} 
      {
        total-debt: u0,
        created-at: stacks-block-height
      }
    )
    (map-set vault-asset-count {owner: tx-sender} {count: u0})
    (print {event: "vault-opened", owner: tx-sender})
    (ok true)
  )
)

;; ============================================
;; Collateral Operations
;; ============================================

(define-public (deposit-collateral (asset principal) (amount uint))
  (begin
    ;; Verify vault exists
    (asserts! (is-some (map-get? vaults {owner: tx-sender})) (err ERR_NO_VAULT))
    
    ;; Verify asset is supported and enabled
    (match (get-asset-config asset)
      config
        (begin
          (asserts! (get enabled config) (err ERR_ASSET_DISABLED))
          
          ;; Get or create collateral position
          (let (
              (current-position (default-to 
                {amount: u0, debt-share: u0} 
                (map-get? vault-collateral {owner: tx-sender, asset: asset})
              ))
              (new-amount (+ (get amount current-position) amount))
              (is-new-position (is-eq (get amount current-position) u0))
            )
            
            ;; Update collateral position
            (map-set vault-collateral
              {owner: tx-sender, asset: asset}
              {
                amount: new-amount,
                debt-share: (get debt-share current-position)
              }
            )
            
            ;; If new position, add to asset list
            (if is-new-position
              (let ((current-count (default-to u0 (get count (map-get? vault-asset-count {owner: tx-sender})))))
                (map-set vault-asset-list 
                  {owner: tx-sender, index: current-count} 
                  {asset: asset}
                )
                (map-set vault-asset-count 
                  {owner: tx-sender} 
                  {count: (+ current-count u1)}
                )
              )
              true
            )
            
            ;; TODO(sBTC/SIP-010): transfer asset from user to protocol custody
            (print {event: "collateral-deposited", owner: tx-sender, asset: asset, amount: amount, total: new-amount})
            (ok new-amount)
          )
        )
      (err ERR_ASSET_NOT_SUPPORTED)
    )
  )
)

(define-public (withdraw-collateral (asset principal) (amount uint))
  (begin
    ;; Verify vault exists
    (match (map-get? vaults {owner: tx-sender})
      vault
        (match (map-get? vault-collateral {owner: tx-sender, asset: asset})
          position
            (begin
              ;; Check sufficient collateral
              (asserts! (>= (get amount position) amount) (err ERR_INSUFFICIENT_COLLATERAL))
              
              (let (
                  (new-amount (- (get amount position) amount))
                  (debt-share (get debt-share position))
                  (min-ratio (get-min-ratio-for-asset asset))
                  (new-collateral-value (calculate-collateral-value asset new-amount))
                )
                
                ;; If there's debt on this position, check health factor
                (if (> debt-share u0)
                  (let ((health-factor (calculate-position-health-factor new-collateral-value debt-share min-ratio)))
                    (asserts! (>= health-factor RATIO-SCALE) (err ERR_UNSAFE_HEALTH_FACTOR))
                  )
                  true
                )
                
                ;; Update position
                (map-set vault-collateral
                  {owner: tx-sender, asset: asset}
                  {
                    amount: new-amount,
                    debt-share: debt-share
                  }
                )
                
                ;; TODO(sBTC/SIP-010): transfer asset from protocol custody to user
                (print {event: "collateral-withdrawn", owner: tx-sender, asset: asset, amount: amount, remaining: new-amount})
                (ok new-amount)
              )
            )
          (err ERR_NO_COLLATERAL_POSITION)
        )
      (err ERR_NO_VAULT)
    )
  )
)

;; ============================================
;; Debt Operations
;; ============================================

(define-public (mint-against-asset (asset principal) (amount uint))
  (begin
    ;; Verify vault exists
    (match (map-get? vaults {owner: tx-sender})
      vault
        (match (map-get? vault-collateral {owner: tx-sender, asset: asset})
          position
            (match (get-asset-config asset)
              config
                (begin
                  (asserts! (get enabled config) (err ERR_ASSET_DISABLED))
                  
                  (let (
                      (collateral-amount (get amount position))
                      (current-debt-share (get debt-share position))
                      (new-debt-share (+ current-debt-share amount))
                      (collateral-value (calculate-collateral-value asset collateral-amount))
                      (min-ratio (get min-collateral-ratio config))
                      (debt-floor (get debt-floor config))
                      (health-factor (calculate-position-health-factor collateral-value new-debt-share min-ratio))
                    )
                    
                    ;; Check health factor
                    (asserts! (>= health-factor RATIO-SCALE) (err ERR_UNSAFE_HEALTH_FACTOR))
                    
                    ;; Check debt floor (minimum debt per position)
                    (asserts! (or (is-eq new-debt-share u0) (>= new-debt-share debt-floor)) (err ERR_BELOW_DEBT_FLOOR))
                    
                    ;; Update debt tracking in registry (checks ceiling)
                    (try! (contract-call? .collateral-registry increase-debt asset amount))
                    
                    ;; Update position debt share
                    (map-set vault-collateral
                      {owner: tx-sender, asset: asset}
                      {
                        amount: collateral-amount,
                        debt-share: new-debt-share
                      }
                    )
                    
                    ;; Update vault total debt
                    (map-set vaults
                      {owner: tx-sender}
                      {
                        total-debt: (+ (get total-debt vault) amount),
                        created-at: (get created-at vault)
                      }
                    )
                    
                    ;; Mint stablecoins
                    (try! (contract-call? .stablecoin-token mint amount tx-sender))
                    
                    (print {
                      event: "debt-minted", 
                      owner: tx-sender, 
                      asset: asset, 
                      amount: amount, 
                      total-debt-share: new-debt-share,
                      health-factor: health-factor
                    })
                    (ok new-debt-share)
                  )
                )
              (err ERR_ASSET_NOT_SUPPORTED)
            )
          (err ERR_NO_COLLATERAL_POSITION)
        )
      (err ERR_NO_VAULT)
    )
  )
)

(define-public (repay-against-asset (asset principal) (amount uint))
  (begin
    ;; Verify vault exists
    (match (map-get? vaults {owner: tx-sender})
      vault
        (match (map-get? vault-collateral {owner: tx-sender, asset: asset})
          position
            (begin
              ;; Check sufficient debt
              (asserts! (>= (get debt-share position) amount) (err ERR_INSUFFICIENT_DEBT))
              
              (let (
                  (new-debt-share (- (get debt-share position) amount))
                  (debt-floor (default-to u0 (get debt-floor (get-asset-config asset))))
                )
                
                ;; Check debt floor (can't leave dust debt)
                (asserts! (or (is-eq new-debt-share u0) (>= new-debt-share debt-floor)) (err ERR_BELOW_DEBT_FLOOR))
                
                ;; Burn stablecoins
                (try! (contract-call? .stablecoin-token burn amount tx-sender))
                
                ;; Update debt tracking in registry
                (try! (contract-call? .collateral-registry decrease-debt asset amount))
                
                ;; Update position
                (map-set vault-collateral
                  {owner: tx-sender, asset: asset}
                  {
                    amount: (get amount position),
                    debt-share: new-debt-share
                  }
                )
                
                ;; Update vault total debt
                (map-set vaults
                  {owner: tx-sender}
                  {
                    total-debt: (- (get total-debt vault) amount),
                    created-at: (get created-at vault)
                  }
                )
                
                (print {event: "debt-repaid", owner: tx-sender, asset: asset, amount: amount, remaining-debt: new-debt-share})
                (ok new-debt-share)
              )
            )
          (err ERR_NO_COLLATERAL_POSITION)
        )
      (err ERR_NO_VAULT)
    )
  )
)

;; ============================================
;; Read-Only Functions
;; ============================================

(define-read-only (get-vault (owner principal))
  (map-get? vaults {owner: owner})
)

(define-read-only (get-collateral-position (owner principal) (asset principal))
  (map-get? vault-collateral {owner: owner, asset: asset})
)

(define-read-only (get-position-health-factor (owner principal) (asset principal))
  (match (map-get? vault-collateral {owner: owner, asset: asset})
    position
      (let (
          (collateral-value (calculate-collateral-value asset (get amount position)))
          (debt-share (get debt-share position))
          (min-ratio (get-min-ratio-for-asset asset))
        )
        (calculate-position-health-factor collateral-value debt-share min-ratio)
      )
    ZERO-DEBT-HEALTH-FACTOR
  )
)

(define-read-only (get-position-liquidation-status (owner principal) (asset principal))
  (match (map-get? vault-collateral {owner: owner, asset: asset})
    position
      (let (
          (collateral-value (calculate-collateral-value asset (get amount position)))
          (debt-share (get debt-share position))
          (liq-ratio (get-liquidation-ratio-for-asset asset))
          (health-factor (calculate-position-health-factor collateral-value debt-share liq-ratio))
        )
        {
          is-liquidatable: (< health-factor RATIO-SCALE),
          health-factor: health-factor,
          collateral-value: collateral-value,
          debt: debt-share
        }
      )
    {
      is-liquidatable: false,
      health-factor: ZERO-DEBT-HEALTH-FACTOR,
      collateral-value: u0,
      debt: u0
    }
  )
)

(define-read-only (get-vault-asset-count (owner principal))
  (default-to u0 (get count (map-get? vault-asset-count {owner: owner})))
)

(define-read-only (get-vault-asset-at-index (owner principal) (index uint))
  (map-get? vault-asset-list {owner: owner, index: index})
)

(define-read-only (get-max-mintable (owner principal) (asset principal))
  ;; Calculate maximum additional debt that can be minted against this collateral
  (match (map-get? vault-collateral {owner: owner, asset: asset})
    position
      (let (
          (collateral-value (calculate-collateral-value asset (get amount position)))
          (current-debt (get debt-share position))
          (min-ratio (get-min-ratio-for-asset asset))
          ;; max-debt = collateral-value * 100 / min-ratio
          (max-debt (/ (* collateral-value RATIO-SCALE) min-ratio))
        )
        (if (> max-debt current-debt)
          (- max-debt current-debt)
          u0
        )
      )
    u0
  )
)

(define-read-only (get-total-vault-value (owner principal))
  ;; Sum up value of all collateral positions
  ;; Note: This is a simplified version; full implementation would iterate through all positions
  (match (map-get? vaults {owner: owner})
    vault (get total-debt vault)
    u0
  )
)
