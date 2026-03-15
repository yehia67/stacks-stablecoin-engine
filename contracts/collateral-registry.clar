(define-constant CONTRACT-OWNER tx-sender)

;; ============================================
;; Error Constants
;; ============================================
(define-constant ERR_UNAUTHORIZED u100)
(define-constant ERR_ASSET_NOT_FOUND u101)
(define-constant ERR_ASSET_ALREADY_EXISTS u102)
(define-constant ERR_ASSET_DISABLED u103)
(define-constant ERR_INVALID_RATIO u104)
(define-constant ERR_DEBT_CEILING_EXCEEDED u105)

;; ============================================
;; Data Variables
;; ============================================

;; Track total debt issued against each collateral type
(define-map collateral-debt
  {asset: principal}
  {total-debt: uint}
)

;; Extended collateral configuration with more parameters
(define-map collateral-configs
  {asset: principal}
  {
    min-collateral-ratio: uint,      ;; Minimum collateral ratio (e.g., 150 = 150%)
    liquidation-ratio: uint,          ;; Ratio at which liquidation can occur (e.g., 120 = 120%)
    liquidation-penalty: uint,        ;; Penalty on liquidation (e.g., 10 = 10%)
    stability-fee: uint,              ;; Annual stability fee in basis points (e.g., 200 = 2%)
    debt-ceiling: uint,               ;; Maximum debt allowed for this collateral type
    debt-floor: uint,                 ;; Minimum debt per vault (dust limit)
    enabled: bool,                    ;; Whether this collateral type is active
    oracle: principal                 ;; Oracle contract for this asset's price
  }
)

;; List of registered collateral assets (for enumeration)
(define-data-var collateral-count uint u0)
(define-map collateral-list
  {index: uint}
  {asset: principal}
)

;; ============================================
;; Admin Functions
;; ============================================

(define-public (add-collateral-type
    (asset principal)
    (min-collateral-ratio uint)
    (liquidation-ratio uint)
    (liquidation-penalty uint)
    (stability-fee uint)
    (debt-ceiling uint)
    (debt-floor uint)
    (oracle principal)
  )
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (asserts! (is-none (map-get? collateral-configs {asset: asset})) (err ERR_ASSET_ALREADY_EXISTS))
    (asserts! (> min-collateral-ratio u100) (err ERR_INVALID_RATIO))
    (asserts! (> liquidation-ratio u100) (err ERR_INVALID_RATIO))
    (asserts! (<= liquidation-ratio min-collateral-ratio) (err ERR_INVALID_RATIO))
    
    ;; Store config
    (map-set collateral-configs
      {asset: asset}
      {
        min-collateral-ratio: min-collateral-ratio,
        liquidation-ratio: liquidation-ratio,
        liquidation-penalty: liquidation-penalty,
        stability-fee: stability-fee,
        debt-ceiling: debt-ceiling,
        debt-floor: debt-floor,
        enabled: true,
        oracle: oracle
      }
    )
    
    ;; Initialize debt tracking
    (map-set collateral-debt {asset: asset} {total-debt: u0})
    
    ;; Add to collateral list for enumeration
    (let ((current-count (var-get collateral-count)))
      (map-set collateral-list {index: current-count} {asset: asset})
      (var-set collateral-count (+ current-count u1))
    )
    
    (print {event: "collateral-added", asset: asset, min-ratio: min-collateral-ratio})
    (ok true)
  )
)

(define-public (update-collateral-params
    (asset principal)
    (min-collateral-ratio uint)
    (liquidation-ratio uint)
    (liquidation-penalty uint)
    (stability-fee uint)
    (debt-ceiling uint)
    (debt-floor uint)
  )
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (asserts! (> min-collateral-ratio u100) (err ERR_INVALID_RATIO))
    (asserts! (> liquidation-ratio u100) (err ERR_INVALID_RATIO))
    (asserts! (<= liquidation-ratio min-collateral-ratio) (err ERR_INVALID_RATIO))
    
    (match (map-get? collateral-configs {asset: asset})
      config
        (begin
          (map-set collateral-configs
            {asset: asset}
            {
              min-collateral-ratio: min-collateral-ratio,
              liquidation-ratio: liquidation-ratio,
              liquidation-penalty: liquidation-penalty,
              stability-fee: stability-fee,
              debt-ceiling: debt-ceiling,
              debt-floor: debt-floor,
              enabled: (get enabled config),
              oracle: (get oracle config)
            }
          )
          (print {event: "collateral-updated", asset: asset})
          (ok true)
        )
      (err ERR_ASSET_NOT_FOUND)
    )
  )
)

(define-public (set-collateral-enabled (asset principal) (is-enabled bool))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (match (map-get? collateral-configs {asset: asset})
      config
        (begin
          (map-set collateral-configs
            {asset: asset}
            (merge config {enabled: is-enabled})
          )
          (print {event: "collateral-status-changed", asset: asset, enabled: is-enabled})
          (ok true)
        )
      (err ERR_ASSET_NOT_FOUND)
    )
  )
)

(define-public (update-oracle (asset principal) (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (match (map-get? collateral-configs {asset: asset})
      config
        (begin
          (map-set collateral-configs
            {asset: asset}
            (merge config {oracle: new-oracle})
          )
          (print {event: "oracle-updated", asset: asset, oracle: new-oracle})
          (ok true)
        )
      (err ERR_ASSET_NOT_FOUND)
    )
  )
)

;; ============================================
;; Debt Tracking Functions (called by vault-engine)
;; ============================================

(define-public (increase-debt (asset principal) (amount uint))
  (match (map-get? collateral-configs {asset: asset})
    config
      (begin
        (asserts! (get enabled config) (err ERR_ASSET_DISABLED))
        (let ((current-debt (default-to u0 (get total-debt (map-get? collateral-debt {asset: asset})))))
          (asserts! (<= (+ current-debt amount) (get debt-ceiling config)) (err ERR_DEBT_CEILING_EXCEEDED))
          (map-set collateral-debt {asset: asset} {total-debt: (+ current-debt amount)})
          (ok (+ current-debt amount))
        )
      )
    (err ERR_ASSET_NOT_FOUND)
  )
)

(define-public (decrease-debt (asset principal) (amount uint))
  (match (map-get? collateral-debt {asset: asset})
    debt-info
      (let ((new-debt (if (>= (get total-debt debt-info) amount)
                          (- (get total-debt debt-info) amount)
                          u0)))
        (map-set collateral-debt {asset: asset} {total-debt: new-debt})
        (ok new-debt)
      )
    (err ERR_ASSET_NOT_FOUND)
  )
)

;; ============================================
;; Read-Only Functions
;; ============================================

(define-read-only (get-collateral-config (asset principal))
  (map-get? collateral-configs {asset: asset})
)

(define-read-only (is-collateral-enabled (asset principal))
  (match (map-get? collateral-configs {asset: asset})
    config (get enabled config)
    false
  )
)

(define-read-only (get-min-collateral-ratio (asset principal))
  (match (map-get? collateral-configs {asset: asset})
    config (some (get min-collateral-ratio config))
    none
  )
)

(define-read-only (get-liquidation-ratio (asset principal))
  (match (map-get? collateral-configs {asset: asset})
    config (some (get liquidation-ratio config))
    none
  )
)

(define-read-only (get-liquidation-penalty (asset principal))
  (match (map-get? collateral-configs {asset: asset})
    config (some (get liquidation-penalty config))
    none
  )
)

(define-read-only (get-oracle (asset principal))
  (match (map-get? collateral-configs {asset: asset})
    config (some (get oracle config))
    none
  )
)

(define-read-only (get-debt-ceiling (asset principal))
  (match (map-get? collateral-configs {asset: asset})
    config (some (get debt-ceiling config))
    none
  )
)

(define-read-only (get-total-debt (asset principal))
  (default-to u0 (get total-debt (map-get? collateral-debt {asset: asset})))
)

(define-read-only (get-available-debt-capacity (asset principal))
  (match (map-get? collateral-configs {asset: asset})
    config
      (let ((current-debt (get-total-debt asset)))
        (if (>= (get debt-ceiling config) current-debt)
          (some (- (get debt-ceiling config) current-debt))
          (some u0)
        )
      )
    none
  )
)

(define-read-only (get-collateral-count)
  (var-get collateral-count)
)

(define-read-only (get-collateral-at-index (index uint))
  (map-get? collateral-list {index: index})
)
