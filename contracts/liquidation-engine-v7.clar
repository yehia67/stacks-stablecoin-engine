;; liquidation-engine-v7.clar
;; Cross-reference bump from v6. References vault-engine v7 and stability-pool v6.
;; Logic unchanged.

(use-trait sip-010-trait .sip-010-trait.sip-010-trait)
(use-trait token-trait .stablecoin-engine-token-trait.stablecoin-engine-token-trait)

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

(define-public (liquidate
    (owner principal)
    (stablecoin-id uint)
    (asset principal)
    (collateral-token <sip-010-trait>)
    (stablecoin-token <token-trait>))
  (let (
      (health-factor (contract-call? .multi-asset-vault-engine-v7
        get-position-health-factor-for-stablecoin owner stablecoin-id asset))
    )
    (asserts! (< health-factor MIN_HEALTH) (err ERR_HEALTHY))

    (let (
        (position (unwrap! (contract-call? .multi-asset-vault-engine-v7
          get-collateral-position-for-stablecoin owner stablecoin-id asset) (err ERR_NO_POSITION)))
        (vault-debt (get debt-share position))
        (vault-collateral (get amount position))
        (pool-deposits (contract-call? .stability-pool-v6 get-total-deposits stablecoin-id))
        (reward-pct (contract-call? .stability-pool-v6 get-liquidation-reward-pct stablecoin-id))
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

        (try! (contract-call? .multi-asset-vault-engine-v7 liquidate-position
          owner stablecoin-id asset collateral-token stablecoin-token
          debt-to-offset collateral-to-seize))

        (try! (contract-call? .stability-pool-v6 distribute-liquidation-reward
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
