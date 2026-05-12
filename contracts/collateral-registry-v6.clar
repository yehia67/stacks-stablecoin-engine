;; collateral-registry-v6.clar
;; Same product surface as v5. Changes:
;;  - Global admin functions are now governance-gated (via sse-timelock-v1).
;;  - References factory v4 and pre-authorizes vault-engine v7.
;;  - Creator-only per-stablecoin functions are unchanged.

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
(define-constant ERR_NOT_WHITELISTED u106)
(define-constant ERR_NOT_CREATOR u107)
(define-constant ERR_BELOW_GLOBAL_MINIMUM u108)
(define-constant ERR_ALREADY_CONFIGURED u109)
(define-constant ERR_NOT_CONFIGURED u110)
(define-constant ERR_BOOTSTRAP_LOCKED u111)

;; ============================================
;; Governance
;; ============================================

(define-data-var governance principal CONTRACT-OWNER)
(define-data-var bootstrap-locked bool false)

(define-read-only (get-governance) (var-get governance))
(define-read-only (is-bootstrap-locked) (var-get bootstrap-locked))

(define-public (bootstrap-set-governance (new-gov principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (asserts! (not (var-get bootstrap-locked)) (err ERR_BOOTSTRAP_LOCKED))
    (var-set governance new-gov)
    (ok true)
  )
)

(define-public (lock-bootstrap)
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (var-set bootstrap-locked true)
    (ok true)
  )
)

(define-private (is-governance-caller)
  (or
    (is-eq contract-caller (var-get governance))
    (and (not (var-get bootstrap-locked)) (is-eq tx-sender CONTRACT-OWNER))
  )
)

;; ============================================
;; Data Maps
;; ============================================

(define-map collateral-debt
  {asset: principal}
  {total-debt: uint}
)

(define-map collateral-configs
  {asset: principal}
  {
    min-collateral-ratio: uint,
    liquidation-ratio: uint,
    liquidation-penalty: uint,
    stability-fee: uint,
    debt-ceiling: uint,
    debt-floor: uint,
    enabled: bool,
    oracle: principal
  }
)

(define-data-var collateral-count uint u0)
(define-map collateral-list
  {index: uint}
  {asset: principal}
)

(define-map stablecoin-collateral-configs
  {stablecoin-id: uint, asset: principal}
  {
    min-collateral-ratio: uint,
    liquidation-ratio: uint,
    liquidation-penalty: uint,
    stability-fee: uint,
    debt-ceiling: uint,
    debt-floor: uint,
    enabled: bool
  }
)

(define-map stablecoin-collateral-debt
  {stablecoin-id: uint, asset: principal}
  {total-debt: uint}
)

(define-map stablecoin-collateral-count
  {stablecoin-id: uint}
  {count: uint}
)

(define-map stablecoin-collateral-list
  {stablecoin-id: uint, index: uint}
  {asset: principal}
)

;; ============================================
;; Admin Functions (governance-gated)
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
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (asserts! (is-none (map-get? collateral-configs {asset: asset})) (err ERR_ASSET_ALREADY_EXISTS))
    (asserts! (> min-collateral-ratio u100) (err ERR_INVALID_RATIO))
    (asserts! (> liquidation-ratio u100) (err ERR_INVALID_RATIO))
    (asserts! (<= liquidation-ratio min-collateral-ratio) (err ERR_INVALID_RATIO))

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

    (map-set collateral-debt {asset: asset} {total-debt: u0})

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
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
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
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
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
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
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
;; Per-Stablecoin Collateral Configuration (creator-gated, unchanged)
;; ============================================

(define-private (is-stablecoin-creator (stablecoin-id uint))
  (match (contract-call? .stablecoin-factory-v4 get-stablecoin-creator stablecoin-id)
    creator (is-eq tx-sender creator)
    false
  )
)

(define-public (configure-collateral-for-stablecoin
    (stablecoin-id uint)
    (asset principal)
    (min-collateral-ratio uint)
    (liquidation-ratio uint)
    (liquidation-penalty uint)
    (stability-fee uint)
    (debt-ceiling uint)
    (debt-floor uint)
  )
  (begin
    (asserts! (is-stablecoin-creator stablecoin-id) (err ERR_NOT_CREATOR))
    (asserts! (is-none (map-get? stablecoin-collateral-configs {stablecoin-id: stablecoin-id, asset: asset})) (err ERR_ALREADY_CONFIGURED))

    (match (map-get? collateral-configs {asset: asset})
      global-config
        (begin
          (asserts! (get enabled global-config) (err ERR_ASSET_DISABLED))

          (asserts! (> min-collateral-ratio u100) (err ERR_INVALID_RATIO))
          (asserts! (> liquidation-ratio u100) (err ERR_INVALID_RATIO))
          (asserts! (<= liquidation-ratio min-collateral-ratio) (err ERR_INVALID_RATIO))

          (asserts! (>= min-collateral-ratio (get min-collateral-ratio global-config)) (err ERR_BELOW_GLOBAL_MINIMUM))
          (asserts! (>= liquidation-ratio (get liquidation-ratio global-config)) (err ERR_BELOW_GLOBAL_MINIMUM))
          (asserts! (>= liquidation-penalty (get liquidation-penalty global-config)) (err ERR_BELOW_GLOBAL_MINIMUM))

          (map-set stablecoin-collateral-configs
            {stablecoin-id: stablecoin-id, asset: asset}
            {
              min-collateral-ratio: min-collateral-ratio,
              liquidation-ratio: liquidation-ratio,
              liquidation-penalty: liquidation-penalty,
              stability-fee: stability-fee,
              debt-ceiling: debt-ceiling,
              debt-floor: debt-floor,
              enabled: true
            }
          )

          (map-set stablecoin-collateral-debt {stablecoin-id: stablecoin-id, asset: asset} {total-debt: u0})

          (let ((current-count (default-to u0 (get count (map-get? stablecoin-collateral-count {stablecoin-id: stablecoin-id})))))
            (map-set stablecoin-collateral-list {stablecoin-id: stablecoin-id, index: current-count} {asset: asset})
            (map-set stablecoin-collateral-count {stablecoin-id: stablecoin-id} {count: (+ current-count u1)})
          )

          (print {
            event: "stablecoin-collateral-configured",
            stablecoin-id: stablecoin-id,
            asset: asset,
            min-collateral-ratio: min-collateral-ratio,
            liquidation-ratio: liquidation-ratio
          })
          (ok true)
        )
      (err ERR_ASSET_NOT_FOUND)
    )
  )
)

(define-public (update-collateral-for-stablecoin
    (stablecoin-id uint)
    (asset principal)
    (min-collateral-ratio uint)
    (liquidation-ratio uint)
    (liquidation-penalty uint)
    (stability-fee uint)
    (debt-ceiling uint)
    (debt-floor uint)
  )
  (begin
    (asserts! (is-stablecoin-creator stablecoin-id) (err ERR_NOT_CREATOR))

    (match (map-get? collateral-configs {asset: asset})
      global-config
        (begin
          (asserts! (get enabled global-config) (err ERR_ASSET_DISABLED))
          (match (map-get? stablecoin-collateral-configs {stablecoin-id: stablecoin-id, asset: asset})
            existing-config
              (begin
                (asserts! (> min-collateral-ratio u100) (err ERR_INVALID_RATIO))
                (asserts! (> liquidation-ratio u100) (err ERR_INVALID_RATIO))
                (asserts! (<= liquidation-ratio min-collateral-ratio) (err ERR_INVALID_RATIO))

                (asserts! (>= min-collateral-ratio (get min-collateral-ratio global-config)) (err ERR_BELOW_GLOBAL_MINIMUM))
                (asserts! (>= liquidation-ratio (get liquidation-ratio global-config)) (err ERR_BELOW_GLOBAL_MINIMUM))
                (asserts! (>= liquidation-penalty (get liquidation-penalty global-config)) (err ERR_BELOW_GLOBAL_MINIMUM))

                (map-set stablecoin-collateral-configs
                  {stablecoin-id: stablecoin-id, asset: asset}
                  {
                    min-collateral-ratio: min-collateral-ratio,
                    liquidation-ratio: liquidation-ratio,
                    liquidation-penalty: liquidation-penalty,
                    stability-fee: stability-fee,
                    debt-ceiling: debt-ceiling,
                    debt-floor: debt-floor,
                    enabled: (get enabled existing-config)
                  }
                )

                (print {
                  event: "stablecoin-collateral-updated",
                  stablecoin-id: stablecoin-id,
                  asset: asset
                })
                (ok true)
              )
            (err ERR_NOT_CONFIGURED)
          )
        )
      (err ERR_ASSET_NOT_FOUND)
    )
  )
)

(define-public (disable-collateral-for-stablecoin (stablecoin-id uint) (asset principal))
  (begin
    (asserts! (is-stablecoin-creator stablecoin-id) (err ERR_NOT_CREATOR))
    (match (map-get? stablecoin-collateral-configs {stablecoin-id: stablecoin-id, asset: asset})
      config
        (begin
          (map-set stablecoin-collateral-configs
            {stablecoin-id: stablecoin-id, asset: asset}
            (merge config {enabled: false})
          )
          (print {event: "stablecoin-collateral-disabled", stablecoin-id: stablecoin-id, asset: asset})
          (ok true)
        )
      (err ERR_NOT_CONFIGURED)
    )
  )
)

(define-public (enable-collateral-for-stablecoin (stablecoin-id uint) (asset principal))
  (begin
    (asserts! (is-stablecoin-creator stablecoin-id) (err ERR_NOT_CREATOR))
    (match (map-get? collateral-configs {asset: asset})
      global-config
        (begin
          (asserts! (get enabled global-config) (err ERR_ASSET_DISABLED))
          (match (map-get? stablecoin-collateral-configs {stablecoin-id: stablecoin-id, asset: asset})
            config
              (begin
                (map-set stablecoin-collateral-configs
                  {stablecoin-id: stablecoin-id, asset: asset}
                  (merge config {enabled: true})
                )
                (print {event: "stablecoin-collateral-enabled", stablecoin-id: stablecoin-id, asset: asset})
                (ok true)
              )
            (err ERR_NOT_CONFIGURED)
          )
        )
      (err ERR_ASSET_NOT_FOUND)
    )
  )
)

;; ============================================
;; Authorized Vault Engine Callers
;; ============================================

(define-map authorized-vault-engines principal bool)

;; Pre-authorize the v7 vault engine at deploy time
(map-set authorized-vault-engines .multi-asset-vault-engine-v7 true)

(define-private (is-authorized-caller)
  (default-to false (map-get? authorized-vault-engines contract-caller))
)

(define-public (set-vault-engine-authorized (engine principal) (authorized bool))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (map-set authorized-vault-engines engine authorized)
    (ok true)
  )
)

;; ============================================
;; Per-Stablecoin Debt Tracking
;; ============================================

(define-public (increase-stablecoin-debt (stablecoin-id uint) (asset principal) (amount uint))
  (begin
    (asserts! (is-authorized-caller) (err ERR_UNAUTHORIZED))
    (match (map-get? stablecoin-collateral-configs {stablecoin-id: stablecoin-id, asset: asset})
      config
        (begin
          (asserts! (get enabled config) (err ERR_ASSET_DISABLED))
          (let ((current-debt (default-to u0 (get total-debt (map-get? stablecoin-collateral-debt {stablecoin-id: stablecoin-id, asset: asset})))))
            (asserts! (<= (+ current-debt amount) (get debt-ceiling config)) (err ERR_DEBT_CEILING_EXCEEDED))
            (map-set stablecoin-collateral-debt {stablecoin-id: stablecoin-id, asset: asset} {total-debt: (+ current-debt amount)})
            (ok (+ current-debt amount))
          )
        )
      (err ERR_NOT_CONFIGURED)
    )
  )
)

(define-public (decrease-stablecoin-debt (stablecoin-id uint) (asset principal) (amount uint))
  (begin
    (asserts! (is-authorized-caller) (err ERR_UNAUTHORIZED))
    (match (map-get? stablecoin-collateral-debt {stablecoin-id: stablecoin-id, asset: asset})
      debt-info
        (let ((new-debt (if (>= (get total-debt debt-info) amount)
                            (- (get total-debt debt-info) amount)
                            u0)))
          (map-set stablecoin-collateral-debt {stablecoin-id: stablecoin-id, asset: asset} {total-debt: new-debt})
          (ok new-debt)
        )
      (err ERR_NOT_CONFIGURED)
    )
  )
)

;; ============================================
;; Global Debt Tracking (called by vault-engine)
;; ============================================

(define-public (increase-debt (asset principal) (amount uint))
  (begin
    (asserts! (is-authorized-caller) (err ERR_UNAUTHORIZED))
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
)

(define-public (decrease-debt (asset principal) (amount uint))
  (begin
    (asserts! (is-authorized-caller) (err ERR_UNAUTHORIZED))
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

(define-read-only (get-collateral-count) (var-get collateral-count))

(define-read-only (get-collateral-at-index (index uint))
  (map-get? collateral-list {index: index})
)

(define-read-only (get-stablecoin-collateral-config (stablecoin-id uint) (asset principal))
  (map-get? stablecoin-collateral-configs {stablecoin-id: stablecoin-id, asset: asset})
)

(define-read-only (get-effective-collateral-config (stablecoin-id uint) (asset principal))
  (match (map-get? stablecoin-collateral-configs {stablecoin-id: stablecoin-id, asset: asset})
    sc-config
      (if (get enabled sc-config)
        (match (map-get? collateral-configs {asset: asset})
          global-config
            (some {
              min-collateral-ratio: (if (> (get min-collateral-ratio sc-config) (get min-collateral-ratio global-config))
                                      (get min-collateral-ratio sc-config)
                                      (get min-collateral-ratio global-config)),
              liquidation-ratio: (if (> (get liquidation-ratio sc-config) (get liquidation-ratio global-config))
                                    (get liquidation-ratio sc-config)
                                    (get liquidation-ratio global-config)),
              liquidation-penalty: (if (> (get liquidation-penalty sc-config) (get liquidation-penalty global-config))
                                      (get liquidation-penalty sc-config)
                                      (get liquidation-penalty global-config)),
              stability-fee: (get stability-fee sc-config),
              debt-ceiling: (get debt-ceiling sc-config),
              debt-floor: (get debt-floor sc-config),
              enabled: true,
              oracle: (get oracle global-config)
            })
          none
        )
        none
      )
    none
  )
)

(define-read-only (get-effective-min-collateral-ratio (stablecoin-id uint) (asset principal))
  (match (get-effective-collateral-config stablecoin-id asset)
    config (some (get min-collateral-ratio config))
    none
  )
)

(define-read-only (get-effective-liquidation-ratio (stablecoin-id uint) (asset principal))
  (match (get-effective-collateral-config stablecoin-id asset)
    config (some (get liquidation-ratio config))
    none
  )
)

(define-read-only (is-collateral-enabled-for-stablecoin (stablecoin-id uint) (asset principal))
  (match (map-get? stablecoin-collateral-configs {stablecoin-id: stablecoin-id, asset: asset})
    config (get enabled config)
    false
  )
)

(define-read-only (get-stablecoin-collateral-count-ro (stablecoin-id uint))
  (default-to u0 (get count (map-get? stablecoin-collateral-count {stablecoin-id: stablecoin-id})))
)

(define-read-only (get-stablecoin-collateral-at-index (stablecoin-id uint) (index uint))
  (map-get? stablecoin-collateral-list {stablecoin-id: stablecoin-id, index: index})
)

(define-read-only (get-stablecoin-collateral-debt-ro (stablecoin-id uint) (asset principal))
  (default-to u0 (get total-debt (map-get? stablecoin-collateral-debt {stablecoin-id: stablecoin-id, asset: asset})))
)
