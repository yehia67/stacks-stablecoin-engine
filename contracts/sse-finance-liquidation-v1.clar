;; sse-finance-liquidation-v1.clar
;;
;; Liquidation engine for SSE Finance -- Mechanism A (pro-rata in-kind, the launch
;; default). A permissionless `liquidate` trigger:
;;   1. validates the oracle and reads the position's health against the pair's
;;      liquidation-ratio; reverts if the position is healthy;
;;   2. computes debt-to-offset = min(positionDebt, pool capacity) and
;;      collateral-to-seize = base + penalty (capped at the available collateral);
;;   3. settles via the vault's liquidate-position (which moves the seized
;;      collateral to the pool);
;;   4. splits the penalty: protocol-liq-share-bps of it is earmarked to the
;;      registry treasury-accrued, the remainder is distributed to LPs through the
;;      pool's cumulative-reward-per-token.
;;
;; The discount (penalty) is the LP's whole return in the interest-free model.
;; Wiring (deploy time): this engine must be the vault's liquidator, and an
;; authorized caller in both the pool (distribute) and the registry (accrue-fee).

(use-trait sse-finance-sip-010-trait .sse-finance-sip-010-trait.sse-finance-sip-010-trait)
(use-trait sse-finance-oracle-trait .sse-finance-oracle-trait.sse-finance-oracle-trait)

(define-constant CONTRACT-OWNER tx-sender)
(define-constant PRICE-SCALE u100000000)
(define-constant RATIO-SCALE u100)
(define-constant BPS-DENOM u10000)

;; ============================================
;; Error Constants
;; ============================================
(define-constant ERR_UNAUTHORIZED u400)
(define-constant ERR_BOOTSTRAP_LOCKED u401)
(define-constant ERR_POSITION_HEALTHY u402)
(define-constant ERR_NO_POSITION u403)
(define-constant ERR_ORACLE_MISMATCH u404)
(define-constant ERR_PAIR_NOT_FOUND u405)
(define-constant ERR_EMPTY_POOL u406)

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

;; Optional fixed reward for whoever triggers a liquidation (config only; payout
;; wiring is left to an off-chain incentive or a future funded path).
(define-data-var trigger-reward uint u0)
(define-read-only (get-trigger-reward) (var-get trigger-reward))
(define-public (set-trigger-reward (amount uint))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (var-set trigger-reward amount)
    (ok true)
  )
)

;; ============================================
;; Liquidation records
;; ============================================
(define-data-var liquidation-count uint u0)
(define-map liquidations
  {id: uint}
  {
    owner: principal,
    market-id: uint,
    asset: principal,
    debt-written-off: uint,
    collateral-seized: uint,
    protocol-cut: uint,
    block: uint
  }
)
(define-read-only (get-liquidation-count) (var-get liquidation-count))
(define-read-only (get-liquidation (id uint)) (map-get? liquidations {id: id}))

;; ============================================
;; Helpers
;; ============================================

(define-private (min-uint (a uint) (b uint)) (if (<= a b) a b))

(define-private (oracle-matches (asset principal) (oracle <sse-finance-oracle-trait>))
  (match (contract-call? .sse-finance-collateral-matrix-v1 get-collateral-oracle asset)
    registered (is-eq (contract-of oracle) registered)
    false
  )
)

(define-private (price-asset-via (asset principal) (oracle <sse-finance-oracle-trait>))
  (match (contract-call? .sse-finance-collateral-matrix-v1 get-collateral-oracle asset)
    registered
      (if (is-eq (contract-of oracle) registered)
        (match (contract-call? oracle get-price) price price err-code u0)
        u0
      )
    u0
  )
)

(define-private (health-factor (collateral-value uint) (debt uint) (ratio uint))
  (if (is-eq debt u0) u1000000 (/ (* collateral-value u10000) (* debt ratio)))
)

(define-private (protocol-liq-share (market-id uint))
  (match (contract-call? .sse-finance-market-registry-v1 get-fee-config market-id)
    cfg (get protocol-liq-share-bps cfg)
    u0
  )
)

;; ============================================
;; Liquidate (permissionless)
;; ============================================
(define-public (liquidate
    (owner principal)
    (market-id uint)
    (asset principal)
    (collateral-token <sse-finance-sip-010-trait>)
    (oracle <sse-finance-oracle-trait>)
  )
  (begin
    (asserts! (oracle-matches asset oracle) (err ERR_ORACLE_MISMATCH))
    (match (contract-call? .sse-finance-vault-v1 get-collateral-position owner market-id asset)
      position
        (match (contract-call? .sse-finance-collateral-matrix-v1 get-collateral-risk market-id asset)
          risk
            (let (
                (price (price-asset-via asset oracle))
                (coll-amount (get amount position))
                (debt (get debt-share position))
                (liq-ratio (get liquidation-ratio risk))
                (penalty-bps (get liquidation-penalty risk))
                (collateral-value (/ (* coll-amount price) PRICE-SCALE))
                (capacity (contract-call? .sse-finance-pool-v1 get-total-supplied market-id))
              )
              (asserts! (> debt u0) (err ERR_NO_POSITION))
              (asserts! (< (health-factor collateral-value debt liq-ratio) RATIO-SCALE) (err ERR_POSITION_HEALTHY))
              (asserts! (> capacity u0) (err ERR_EMPTY_POOL))

              (let (
                  (debt-to-offset (min-uint debt capacity))
                )
                (let (
                    (base-collateral (/ (* debt-to-offset PRICE-SCALE) price))
                  )
                  (let (
                      (penalty-collateral (/ (* base-collateral penalty-bps) BPS-DENOM))
                    )
                    (let (
                        (collateral-to-seize (min-uint (+ base-collateral penalty-collateral) coll-amount))
                        (protocol-cut-raw (/ (* penalty-collateral (protocol-liq-share market-id)) BPS-DENOM))
                      )
                      (let (
                          (protocol-cut (min-uint protocol-cut-raw collateral-to-seize))
                        )
                        (let (
                            (lp-collateral (- collateral-to-seize protocol-cut))
                            (id (var-get liquidation-count))
                          )
                          ;; 1. settle on the vault (moves seized collateral to the pool)
                          (try! (contract-call? .sse-finance-vault-v1 liquidate-position
                                  owner market-id asset collateral-token debt-to-offset collateral-to-seize))
                          ;; 2. distribute the LP share + socialise the offset loss
                          (try! (contract-call? .sse-finance-pool-v1 distribute-liquidation-reward
                                  market-id asset debt-to-offset lp-collateral))
                          ;; 3. earmark the protocol penalty cut
                          (if (> protocol-cut u0)
                            (try! (contract-call? .sse-finance-market-registry-v1 accrue-fee market-id asset protocol-cut))
                            u0
                          )

                          (map-set liquidations {id: id}
                            {
                              owner: owner,
                              market-id: market-id,
                              asset: asset,
                              debt-written-off: debt-to-offset,
                              collateral-seized: collateral-to-seize,
                              protocol-cut: protocol-cut,
                              block: stacks-block-height
                            })
                          (var-set liquidation-count (+ id u1))
                          (print {
                            event: "liquidation",
                            id: id,
                            owner: owner,
                            market-id: market-id,
                            asset: asset,
                            debt-written-off: debt-to-offset,
                            collateral-seized: collateral-to-seize,
                            protocol-cut: protocol-cut,
                            lp-collateral: lp-collateral,
                            triggered-by: tx-sender
                          })
                          (ok {
                            debt-written-off: debt-to-offset,
                            collateral-seized: collateral-to-seize,
                            protocol-cut: protocol-cut,
                            lp-collateral: lp-collateral
                          })
                        )
                      )
                    )
                  )
                )
              )
            )
          (err ERR_PAIR_NOT_FOUND)
        )
      (err ERR_NO_POSITION)
    )
  )
)
