;; price-oracle-vgld-v1.clar
;;
;; Constant $1 USD oracle for VoltFi vGold (vGLD).
;; vGLD is a hard-pegged USD share token from VoltFi's gold carry vault --
;; 1 vGLD always equals exactly $1 USD. Yield is paid out via a separate
;; mechanism (off-chain/separate token), so for SSE's collateral math vGLD
;; is treated as a USD-stable asset.
;;
;; Returns u100000000 (= $1.00 at the 8-decimal PRICE-SCALE used throughout
;; the vault engine). No data vars, no admin, no staleness logic.
;;
;; If VoltFi ever breaks the hard peg, the response is to:
;;   1. Asigna calls collateral-registry-v6::set-collateral-enabled(asset, false)
;;      via the timelock emergency whitelist (no delay).
;;   2. Deploy a new oracle wrapper that reflects the new pricing reality.
;;   3. Asigna re-points vGLD's oracle via collateral-registry-v6::update-oracle.

(impl-trait .oracle-trait.oracle-trait)

(define-constant PRICE-USD-1 u100000000)

(define-read-only (get-price)
  (ok PRICE-USD-1)
)
