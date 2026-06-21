;; price-oracle-pegged-usd-v1.clar
;;
;; Reusable governance-pegged USD oracle for SSE Finance.
;;
;; One deployed instance serves EVERY USD stablecoin market (USDC, USDA, USDCX,
;; ...): they all share a single governance-settable peg of ~$1. There is no
;; per-token state, so no per-token oracle is required. A market that needs a
;; live feed instead simply points at a different oracle principal (any contract
;; implementing sse-finance-oracle-trait) -- no redeploy of this contract or of
;; the consumer.
;;
;; Guards:
;;   - Deviation guard (always on): set-peg-price rejects any peg outside a
;;     governance-set band around $1, so a fat-fingered or malicious peg can
;;     never move the price arbitrarily far from the dollar.
;;   - Staleness guard (opt-in): if max-staleness > 0, get-price fails once the
;;     peg has not been re-attested within that many seconds. Default is u0
;;     (disabled) because the common case is a constant $1 peg that needs no
;;     refresh; enabling it forces periodic governance re-attestation.
;;
;; The oracle-trait get-price returns only the uint price (kept compatible with
;; all consumers). The freshness / last-update signal is exposed separately via
;; get-last-update and get-price-info.

(impl-trait .sse-finance-oracle-trait.sse-finance-oracle-trait)

(define-constant CONTRACT-OWNER tx-sender)

;; 8-decimal price scale, matching the SSE vault engine. $1.00 = u100000000.
(define-constant PRICE-SCALE u100000000)
(define-constant PRICE-USD-1 PRICE-SCALE)
(define-constant BPS-DENOM u10000)

;; ============================================
;; Error Constants
;; ============================================
(define-constant ERR_UNAUTHORIZED u700)
(define-constant ERR_BOOTSTRAP_LOCKED u701)
(define-constant ERR_DEVIATION_TOO_LARGE u702)
(define-constant ERR_STALE_PRICE u703)
(define-constant ERR_INVALID_PARAM u704)

;; ============================================
;; Governance (mirrors collateral-registry-v6)
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
;; Peg state
;; ============================================
;; Current peg price (8-decimal). Starts at exactly $1.00.
(define-data-var peg-price uint PRICE-USD-1)
;; stacks-block time (seconds) at the last set-peg-price call. u0 = never set.
(define-data-var last-update uint u0)
;; Max allowed deviation of the peg from $1, in bps. Default 200 = 2%.
(define-data-var max-deviation-bps uint u200)
;; Staleness window in seconds; u0 disables the staleness check (default).
(define-data-var max-staleness uint u0)

;; Best-effort current time from the previous Stacks block. u0 if unavailable.
(define-read-only (current-time)
  (default-to u0 (get-stacks-block-info? time (- stacks-block-height u1)))
)

;; True iff price is within max-deviation-bps of $1. bps is capped at BPS-DENOM
;; on set, so band <= PRICE-USD-1 and the lower bound never underflows.
(define-private (within-band (price uint))
  (let (
      (band (/ (* PRICE-USD-1 (var-get max-deviation-bps)) BPS-DENOM))
    )
    (and (>= price (- PRICE-USD-1 band)) (<= price (+ PRICE-USD-1 band)))
  )
)

;; ============================================
;; Governance-gated setters
;; ============================================

;; Set the peg, rejecting anything outside the deviation band around $1.
(define-public (set-peg-price (new-price uint))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (asserts! (within-band new-price) (err ERR_DEVIATION_TOO_LARGE))
    (var-set peg-price new-price)
    (var-set last-update (current-time))
    (ok true)
  )
)

(define-public (set-max-deviation-bps (bps uint))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (asserts! (<= bps BPS-DENOM) (err ERR_INVALID_PARAM))
    (var-set max-deviation-bps bps)
    (ok true)
  )
)

(define-public (set-max-staleness (secs uint))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (var-set max-staleness secs)
    (ok true)
  )
)

;; ============================================
;; Oracle trait implementation
;; ============================================

;; Returns the peg price. If a staleness window is configured, fails when the
;; peg has not been re-attested within it.
(define-read-only (get-price)
  (let ((staleness (var-get max-staleness)))
    (if (is-eq staleness u0)
      (ok (var-get peg-price))
      (let (
          (now (current-time))
          (lu (var-get last-update))
          (age (if (>= now lu) (- now lu) u0))
        )
        (asserts! (<= age staleness) (err ERR_STALE_PRICE))
        (ok (var-get peg-price))
      )
    )
  )
)

;; ============================================
;; Freshness / introspection read-onlys
;; ============================================
(define-read-only (get-peg-price) (var-get peg-price))
(define-read-only (get-last-update) (var-get last-update))
(define-read-only (get-max-staleness) (var-get max-staleness))
(define-read-only (get-max-deviation-bps) (var-get max-deviation-bps))

;; Full price + freshness snapshot for consumers/monitors.
(define-read-only (get-price-info)
  (let (
      (now (current-time))
      (lu (var-get last-update))
      (staleness (var-get max-staleness))
      (age (if (>= now lu) (- now lu) u0))
    )
    {
      price: (var-get peg-price),
      last-update: lu,
      now: now,
      age: age,
      max-staleness: staleness,
      max-deviation-bps: (var-get max-deviation-bps),
      fresh: (or (is-eq staleness u0) (<= age staleness))
    }
  )
)
