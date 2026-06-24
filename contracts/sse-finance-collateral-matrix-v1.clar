;; sse-finance-collateral-matrix-v1.clar
;;
;; The collateral<->market risk matrix for SSE Finance. A config table answering,
;; for each {market, collateral} pair: is this collateral accepted to borrow this
;; stablecoin, and at what risk parameters? One row = one accepted pair; the
;; ABSENCE of a row means the pair is not borrowable.
;;
;; Per-pair parameters (the five risk params), copying the config shape of
;; collateral-registry-v6's stablecoin-collateral-configs:
;;   - min-collateral-ratio   (open/withdraw floor, bps of value, > 100)
;;   - liquidation-ratio      (health threshold, > 100, <= min-collateral-ratio)
;;   - liquidation-penalty    (bonus collateral seized on liquidation)
;;   - debt-floor             (minimum debt for a position)
;;   - debt-ceiling           (per-market cap for THIS collateral)
;;
;; market-id is defined by sse-finance-market-registry-v1; add-collateral-to-market
;; validates the market exists there, so the matrix can never reference a phantom
;; market. Structure mirrors collateral-registry-v6: enumerable per-market list +
;; per-key config + governance gate.
;;
;; INTEREST-FREE: there is deliberately no stability-fee / interest field here.

(define-constant CONTRACT-OWNER tx-sender)

;; ============================================
;; Error Constants
;; ============================================
(define-constant ERR_UNAUTHORIZED u900)
(define-constant ERR_BOOTSTRAP_LOCKED u901)
(define-constant ERR_MARKET_NOT_FOUND u902)
(define-constant ERR_PAIR_EXISTS u903)
(define-constant ERR_PAIR_NOT_FOUND u904)
(define-constant ERR_INVALID_RATIO u905)

;; ============================================
;; Governance (mirrors the rest of the SSE Finance package)
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

;; The risk row for a {market, collateral} pair. No row = pair not borrowable.
(define-map risk-configs
  {market-id: uint, collateral: principal}
  {
    min-collateral-ratio: uint,
    liquidation-ratio: uint,
    liquidation-penalty: uint,
    debt-floor: uint,
    debt-ceiling: uint,
    enabled: bool
  }
)

;; Per-market enumeration of configured collaterals.
(define-map market-collateral-count {market-id: uint} {count: uint})
(define-map market-collateral-list {market-id: uint, index: uint} {collateral: principal})

;; The price oracle for each collateral asset, GLOBAL (one oracle per asset, shared
;; across every market that accepts it -- mirrors how collateral-registry-v6 stores
;; the oracle on its global per-asset config). The vault validates the caller's
;; oracle trait against this principal before pricing, and fails closed on mismatch.
(define-map collateral-oracles {asset: principal} {oracle: principal})

;; ============================================
;; Internal validation
;; ============================================

(define-private (ratios-valid (min-ratio uint) (liq-ratio uint))
  (and
    (> min-ratio u100)
    (> liq-ratio u100)
    (<= liq-ratio min-ratio)
  )
)

(define-private (market-exists (market-id uint))
  (is-some (contract-call? .sse-finance-market-registry-v1 get-market market-id))
)

;; ============================================
;; Matrix CRUD (governance-gated)
;; ============================================

;; Add a new {market, collateral} risk row. Fails if the market does not exist in
;; the registry, if the pair is already configured, or if the ratios are invalid.
;; Appends to the per-market enumeration. The row is enabled on creation.
(define-public (add-collateral-to-market
    (market-id uint)
    (collateral principal)
    (min-collateral-ratio uint)
    (liquidation-ratio uint)
    (liquidation-penalty uint)
    (debt-floor uint)
    (debt-ceiling uint)
  )
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (asserts! (market-exists market-id) (err ERR_MARKET_NOT_FOUND))
    (asserts!
      (is-none (map-get? risk-configs {market-id: market-id, collateral: collateral}))
      (err ERR_PAIR_EXISTS)
    )
    (asserts! (ratios-valid min-collateral-ratio liquidation-ratio) (err ERR_INVALID_RATIO))

    (map-set risk-configs
      {market-id: market-id, collateral: collateral}
      {
        min-collateral-ratio: min-collateral-ratio,
        liquidation-ratio: liquidation-ratio,
        liquidation-penalty: liquidation-penalty,
        debt-floor: debt-floor,
        debt-ceiling: debt-ceiling,
        enabled: true
      }
    )

    (let ((current-count (default-to u0 (get count (map-get? market-collateral-count {market-id: market-id})))))
      (map-set market-collateral-list {market-id: market-id, index: current-count} {collateral: collateral})
      (map-set market-collateral-count {market-id: market-id} {count: (+ current-count u1)})
    )

    (print {
      event: "collateral-added-to-market",
      market-id: market-id,
      collateral: collateral,
      min-collateral-ratio: min-collateral-ratio,
      liquidation-ratio: liquidation-ratio
    })
    (ok true)
  )
)

;; Update an existing pair's risk params. Preserves the enabled flag (use
;; set-pair-enabled to toggle that). Fails if the pair has no row.
(define-public (update-collateral-risk
    (market-id uint)
    (collateral principal)
    (min-collateral-ratio uint)
    (liquidation-ratio uint)
    (liquidation-penalty uint)
    (debt-floor uint)
    (debt-ceiling uint)
  )
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (asserts! (ratios-valid min-collateral-ratio liquidation-ratio) (err ERR_INVALID_RATIO))
    (match (map-get? risk-configs {market-id: market-id, collateral: collateral})
      existing
        (begin
          (map-set risk-configs
            {market-id: market-id, collateral: collateral}
            {
              min-collateral-ratio: min-collateral-ratio,
              liquidation-ratio: liquidation-ratio,
              liquidation-penalty: liquidation-penalty,
              debt-floor: debt-floor,
              debt-ceiling: debt-ceiling,
              enabled: (get enabled existing)
            }
          )
          (print {event: "collateral-risk-updated", market-id: market-id, collateral: collateral})
          (ok true)
        )
      (err ERR_PAIR_NOT_FOUND)
    )
  )
)

;; Enable / disable an existing pair without disturbing its params.
(define-public (set-pair-enabled (market-id uint) (collateral principal) (enabled bool))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (match (map-get? risk-configs {market-id: market-id, collateral: collateral})
      existing
        (begin
          (map-set risk-configs
            {market-id: market-id, collateral: collateral}
            (merge existing {enabled: enabled})
          )
          (print {event: "pair-enabled-changed", market-id: market-id, collateral: collateral, enabled: enabled})
          (ok true)
        )
      (err ERR_PAIR_NOT_FOUND)
    )
  )
)

;; Set (or re-point) the global price oracle for a collateral asset. Governance-
;; gated. Re-pointing here lets a collateral move to a different oracle principal
;; (e.g. a live feed) with no redeploy.
(define-public (set-collateral-oracle (asset principal) (oracle principal))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (map-set collateral-oracles {asset: asset} {oracle: oracle})
    (print {event: "collateral-oracle-set", asset: asset, oracle: oracle})
    (ok true)
  )
)

;; ============================================
;; Read-Only Functions
;; ============================================

(define-read-only (get-collateral-oracle (asset principal))
  (match (map-get? collateral-oracles {asset: asset}) entry (some (get oracle entry)) none)
)

;; The full risk row for a pair (enabled + all five params) in one call. None
;; means the pair is not borrowable.
(define-read-only (get-collateral-risk (market-id uint) (collateral principal))
  (map-get? risk-configs {market-id: market-id, collateral: collateral})
)

;; True only if the pair has a row AND that row is enabled. Absence => false.
(define-read-only (is-pair-enabled (market-id uint) (collateral principal))
  (match (map-get? risk-configs {market-id: market-id, collateral: collateral})
    config (get enabled config)
    false
  )
)

;; The vault's one-call health-check helper: returns the enabled flag together
;; with the ratios/penalty/floor/ceiling, or none if the pair is not configured.
(define-read-only (get-pair-status (market-id uint) (collateral principal))
  (match (map-get? risk-configs {market-id: market-id, collateral: collateral})
    config (some {
      enabled: (get enabled config),
      min-collateral-ratio: (get min-collateral-ratio config),
      liquidation-ratio: (get liquidation-ratio config),
      liquidation-penalty: (get liquidation-penalty config),
      debt-floor: (get debt-floor config),
      debt-ceiling: (get debt-ceiling config)
    })
    none
  )
)

(define-read-only (get-market-collateral-count (market-id uint))
  (default-to u0 (get count (map-get? market-collateral-count {market-id: market-id})))
)

(define-read-only (get-market-collateral-at-index (market-id uint) (index uint))
  (map-get? market-collateral-list {market-id: market-id, index: index})
)
