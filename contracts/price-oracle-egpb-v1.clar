;; price-oracle-egpb-v1.clar
;;
;; Constant $1 USD oracle for EGP Bond A (EGPB).
;; EGPB is an SSE-issued bond token with a fixed $1.00 standard price --
;; mint/burn is owner-gated in egpb-token-v1, so for SSE's collateral math
;; EGPB is treated as a USD-stable asset.
;;
;; Returns u100000000 (= $1.00 at the 8-decimal PRICE-SCALE used throughout
;; the vault engine). No data vars, no admin, no staleness logic.
;;
;; If the bond's pricing model ever changes, the response is to:
;;   1. Asigna calls collateral-registry-v6::set-collateral-enabled(asset, false)
;;      via the timelock emergency whitelist (no delay).
;;   2. Deploy a new oracle wrapper that reflects the new pricing reality.
;;   3. Asigna re-points EGPB's oracle via collateral-registry-v6::update-oracle.

(impl-trait .oracle-trait.oracle-trait)

(define-constant PRICE-USD-1 u100000000)

(define-read-only (get-price)
  (ok PRICE-USD-1)
)
