;; sse-finance-sip-010-trait.clar
;;
;; Fresh, in-package copy of the standard SIP-010 fungible-token trait for the
;; SSE Finance deployment. Redeclared here so SSE Finance points only at its own
;; trait set, never an externally-deployed trait contract.
;;
;; This is the canonical SIP-010 surface (including the optional memo on
;; transfer) so that real external stablecoins onboarded as borrow tokens, and
;; their collateral assets, satisfy it as plain SIP-010 references.
;;
;; PLAIN SIP-010 ONLY -- no mint/burn capability is part of this trait. SSE
;; Finance never mints: borrow tokens are moved from the pool's existing balance,
;; not minted, and collateral is custodied, not issued.

(define-trait sse-finance-sip-010-trait
  (
    ;; Transfer amount of token from sender to recipient, with optional memo.
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    (get-name () (response (string-ascii 32) uint))
    (get-symbol () (response (string-ascii 32) uint))
    (get-decimals () (response uint uint))
    (get-balance (principal) (response uint uint))
    (get-total-supply () (response uint uint))
    (get-token-uri () (response (optional (string-utf8 256)) uint))
  )
)
