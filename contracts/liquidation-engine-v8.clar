;; liquidation-engine-v8.clar
;;
;; Cross-reference bump from v7 + adds (oracle <oracle-trait>) parameter to
;; pass-through to vault-engine-v8's price-aware read-only functions.
;;
;; Logic unchanged from v7: read health factor, refuse if healthy, compute
;; debt-to-offset against the stability pool, compute collateral-to-seize
;; (base + reward bonus), settle through vault-engine-v8::liquidate-position,
;; then notify stability pool of the reward distribution.
;;
;; The oracle the liquidator passes is validated by vault-engine-v8 against
;; the principal registered in collateral-registry-v6 for the given asset.

(use-trait sip-010-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(use-trait token-trait .stablecoin-engine-token-trait.stablecoin-engine-token-trait)
(use-trait oracle-trait .oracle-trait.oracle-trait)

;; ============================================
;; Error Constants
;; ============================================
(define-constant ERR_HEALTHY u300)
(define-constant ERR_NO_VAULT u301)
(define-constant ERR_NO_POSITION u302)
(define-constant ERR_EMPTY_POOL u303)
(define-constant ERR_ZERO_DEBT u304)

;; ============================================
;; Constants
;; ============================================
(define-constant MIN_HEALTH u150)
(define-constant PRICE_SCALE u100000000)
(define-constant BASIS_POINTS u10000)

;; ============================================
;; Public Functions
;; ============================================

(define-constant ERR_BAD_ORACLE u305)

(define-public (liquidate
    (owner principal)
    (stablecoin-id uint)
    (asset principal)
    (collateral-token <sip-010-trait>)
    (stablecoin-token <token-trait>)
    (oracle <oracle-trait>))
  (let (
      ;; Validate oracle matches the registered principal for this asset, then
      ;; resolve the price to a uint we can pass into the engine's read-only
      ;; health-factor query (read-only functions can't dispatch through traits).
      (registered-oracle (unwrap! (contract-call? .collateral-registry-v6 get-oracle asset) (err ERR_BAD_ORACLE)))
      (price (begin
        (asserts! (is-eq (contract-of oracle) registered-oracle) (err ERR_BAD_ORACLE))
        (try! (contract-call? oracle get-price))
      ))
      (health-factor (contract-call? .multi-asset-vault-engine-v8
        get-position-health-factor-for-stablecoin owner stablecoin-id asset price))
    )
    (asserts! (< health-factor MIN_HEALTH) (err ERR_HEALTHY))

    (let (
        (position (unwrap! (contract-call? .multi-asset-vault-engine-v8
          get-collateral-position-for-stablecoin owner stablecoin-id asset) (err ERR_NO_POSITION)))
        (vault-debt (get debt-share position))
        (vault-collateral (get amount position))
        (pool-deposits (contract-call? .stability-pool-v7 get-total-deposits stablecoin-id))
        (reward-pct (contract-call? .stability-pool-v7 get-liquidation-reward-pct stablecoin-id))
      )
      (asserts! (> vault-debt u0) (err ERR_ZERO_DEBT))
      (asserts! (> pool-deposits u0) (err ERR_EMPTY_POOL))

      (let (
          (debt-to-offset (if (<= vault-debt pool-deposits) vault-debt pool-deposits))
          (collateral-base (/ (* vault-collateral debt-to-offset) vault-debt))
          (reward-bonus (/ (* collateral-base reward-pct) BASIS_POINTS))
          (total-seize-raw (+ collateral-base reward-bonus))
          (collateral-to-seize (if (<= total-seize-raw vault-collateral) total-seize-raw vault-collateral))
        )

        (try! (contract-call? .multi-asset-vault-engine-v8 liquidate-position
          owner stablecoin-id asset collateral-token stablecoin-token
          debt-to-offset collateral-to-seize))

        (try! (contract-call? .stability-pool-v7 distribute-liquidation-reward
          stablecoin-id asset debt-to-offset collateral-to-seize))

        (print {
          event: "vault-liquidated",
          owner: owner,
          stablecoin-id: stablecoin-id,
          asset: asset,
          debt-offset: debt-to-offset,
          collateral-seized: collateral-to-seize,
          reward-pct: reward-pct,
          reward-bonus: reward-bonus
        })
        (ok {
          debt-offset: debt-to-offset,
          collateral-seized: collateral-to-seize,
          reward-bonus: reward-bonus
        })
      )
    )
  )
)
