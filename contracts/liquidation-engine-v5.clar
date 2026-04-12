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
(define-constant PRICE_SCALE u100000000) ;; 1e8, matches vault engine
(define-constant BASIS_POINTS u10000)

;; ============================================
;; Public Functions
;; ============================================

;; Liquidate an unhealthy vault position.
;; The stability pool absorbs the bad debt and depositors receive seized collateral as reward.
;; Flow:
;;   1. Verify vault is unhealthy (health factor < MIN_HEALTH)
;;   2. Calculate debt to offset (min of vault debt and pool deposits)
;;   3. Calculate collateral to seize (debt value in collateral + reward bonus)
;;   4. Vault engine seizes collateral -> pool, burns pool stablecoins
;;   5. Stability pool updates internal accounting (product + rewards)
(define-public (liquidate
    (owner principal)
    (stablecoin-id uint)
    (asset principal)
    (collateral-token <sip-010-trait>)
    (stablecoin-token <token-trait>))
  (let (
      (health-factor (contract-call? .multi-asset-vault-engine-v5
        get-position-health-factor-for-stablecoin owner stablecoin-id asset))
    )
    (asserts! (< health-factor MIN_HEALTH) (err ERR_HEALTHY))

    (let (
        (position (unwrap! (contract-call? .multi-asset-vault-engine-v5
          get-collateral-position-for-stablecoin owner stablecoin-id asset) (err ERR_NO_POSITION)))
        (vault-debt (get debt-share position))
        (vault-collateral (get amount position))
        (pool-deposits (contract-call? .stability-pool-v4 get-total-deposits stablecoin-id))
        (reward-pct (contract-call? .stability-pool-v4 get-liquidation-reward-pct stablecoin-id))
      )
      ;; Must have debt to liquidate
      (asserts! (> vault-debt u0) (err ERR_ZERO_DEBT))
      ;; Pool must have deposits to absorb
      (asserts! (> pool-deposits u0) (err ERR_EMPTY_POOL))

      (let (
          ;; Debt to offset = min(vault_debt, pool_deposits)
          (debt-to-offset (if (<= vault-debt pool-deposits) vault-debt pool-deposits))
          ;; Collateral value of the debt: debt * PRICE_SCALE / oracle_price
          ;; But simpler: proportional to the vault's collateral based on debt share
          ;; collateral_to_seize_base = vault_collateral * debt_to_offset / vault_debt
          (collateral-base (/ (* vault-collateral debt-to-offset) vault-debt))
          ;; Bonus collateral from reward percentage
          (reward-bonus (/ (* collateral-base reward-pct) BASIS_POINTS))
          ;; Total collateral to seize (capped at vault's total collateral)
          (total-seize-raw (+ collateral-base reward-bonus))
          (collateral-to-seize (if (<= total-seize-raw vault-collateral) total-seize-raw vault-collateral))
        )

        ;; Step 1: Vault engine seizes collateral and burns stablecoins
        (try! (contract-call? .multi-asset-vault-engine-v5 liquidate-position
          owner stablecoin-id asset collateral-token stablecoin-token
          debt-to-offset collateral-to-seize))

        ;; Step 2: Stability pool updates accounting (product shrinkage + reward distribution)
        (try! (contract-call? .stability-pool-v4 distribute-liquidation-reward
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
