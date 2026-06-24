;; sse-finance-market-registry-v1.clar
;;
;; The market registry for SSE Finance: the single, standard mechanism by which
;; any plain SIP-010 stablecoin becomes borrowable. A "market" is one borrowable
;; stablecoin together with its oracle, borrow cap, and enabled/paused flags. A
;; *separate* fee-config map holds the economic fee dials, independently
;; updatable from the market wiring.
;;
;; Structure mirrors collateral-registry-v6:
;;   - enumerable market list (sequential market-id == enumeration index),
;;   - per-key config (markets) + a separate per-key fee-config,
;;   - a governance gate (bootstrap owner -> timelock, then lock-bootstrap),
;;   - an authorized-caller map so the vault/pool can record protocol fees.
;;
;; INTEREST-FREE (Liquity-style): there is deliberately NO reserve-factor /
;; interest-rate / index field anywhere. Protocol revenue is only the one-time
;; borrow fee + a cut of the liquidation penalty, accrued into treasury-accrued
;; and later swept to the governance-set treasury.

;; The borrow-token and oracle are stored as plain principals (as
;; collateral-registry-v6 stores its oracle). Trait typing (use-trait) happens at
;; the vault/pool call sites that actually invoke transfer / get-price; the
;; registry only records and validates the wiring, so it imports no traits.

(define-constant CONTRACT-OWNER tx-sender)

;; ============================================
;; Fee hard caps (bps). Every fee setter rejects values above these.
;; ============================================
(define-constant MAX-BORROW-FEE u200)              ;; one-time borrow fee <= 2%
(define-constant MAX-BORROW-FEE-LP-SHARE u10000)   ;; LP slice of the fee <= 100%
(define-constant MAX-PROTOCOL-LIQ-SHARE u5000)     ;; protocol cut of penalty <= 50%
(define-constant MAX-EARLY-REPAY u200)             ;; optional early-repay fee <= 2%

;; ============================================
;; Recorded launch decision (acceptance: explicit, recorded pre-deploy).
;; ============================================
;; LP baseline-incentive dial. LAUNCH VALUE = u0: pure liquidation-only model
;; (LPs earn solely from the liquidation discount; the whole borrow fee goes to
;; the protocol). This is the key economic dial and is governance-settable post
;; launch via set-fee-config -- the u0 here only documents the launch decision;
;; the value actually stored per market is whatever register-market is called
;; with. See docs/SSE-Finance-Architecture.md (LP incentive knob).
(define-constant LAUNCH-BORROW-FEE-LP-SHARE-BPS u0)

;; ============================================
;; Error Constants
;; ============================================
(define-constant ERR_UNAUTHORIZED u800)
(define-constant ERR_BOOTSTRAP_LOCKED u801)
(define-constant ERR_MARKET_NOT_FOUND u802)
(define-constant ERR_FEE_TOO_HIGH u803)

;; ============================================
;; Governance (mirrors collateral-registry-v6 / price-oracle-pegged-usd-v1)
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

;; Market wiring. market-id is sequential from u0 and doubles as the
;; enumeration index, so 0..(market-count-1) enumerates every market.
;; NOTE: no reserve-factor / interest field -- interest-free by design.
(define-data-var market-count uint u0)
(define-map markets
  {market-id: uint}
  {
    borrow-token: principal,
    oracle: principal,
    borrow-cap: uint,
    enabled: bool,
    paused: bool
  }
)

;; Fee config lives in its OWN map so fees are updatable independently of market
;; wiring. All four fields are bps and bounded by the MAX-* caps above.
(define-map fee-config
  {market-id: uint}
  {
    borrow-fee-bps: uint,
    borrow-fee-lp-share-bps: uint,
    protocol-liq-share-bps: uint,
    early-repay-fee-bps: uint
  }
)

;; Treasury recipient for swept protocol fees (governance-set).
(define-data-var treasury principal CONTRACT-OWNER)

;; Lazily-accrued, not-yet-swept protocol fees per {market, token}.
(define-map treasury-accrued
  {market-id: uint, token: principal}
  {amount: uint}
)

;; Authorized callers (the vault / pool) allowed to record fee accrual.
(define-map authorized-callers principal bool)

(define-private (is-authorized-caller)
  (default-to false (map-get? authorized-callers contract-caller))
)

;; ============================================
;; Internal validation
;; ============================================

;; True iff every fee field is at/under its hard cap.
(define-private (fees-within-caps
    (borrow-fee uint)
    (lp-share uint)
    (liq-share uint)
    (early uint)
  )
  (and
    (<= borrow-fee MAX-BORROW-FEE)
    (<= lp-share MAX-BORROW-FEE-LP-SHARE)
    (<= liq-share MAX-PROTOCOL-LIQ-SHARE)
    (<= early MAX-EARLY-REPAY)
  )
)

;; ============================================
;; Market CRUD (governance-gated)
;; ============================================

;; Register a new borrowable stablecoin market. The single standard import path.
;; Seeds both the market wiring and its fee-config atomically; returns the new
;; market-id. Fees are validated against the hard caps before anything is stored.
(define-public (register-market
    (borrow-token principal)
    (oracle principal)
    (borrow-cap uint)
    (borrow-fee-bps uint)
    (borrow-fee-lp-share-bps uint)
    (protocol-liq-share-bps uint)
    (early-repay-fee-bps uint)
  )
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (asserts!
      (fees-within-caps borrow-fee-bps borrow-fee-lp-share-bps protocol-liq-share-bps early-repay-fee-bps)
      (err ERR_FEE_TOO_HIGH)
    )
    (let ((market-id (var-get market-count)))
      (map-set markets
        {market-id: market-id}
        {
          borrow-token: borrow-token,
          oracle: oracle,
          borrow-cap: borrow-cap,
          enabled: true,
          paused: false
        }
      )
      (map-set fee-config
        {market-id: market-id}
        {
          borrow-fee-bps: borrow-fee-bps,
          borrow-fee-lp-share-bps: borrow-fee-lp-share-bps,
          protocol-liq-share-bps: protocol-liq-share-bps,
          early-repay-fee-bps: early-repay-fee-bps
        }
      )
      (var-set market-count (+ market-id u1))
      (print {
        event: "market-registered",
        market-id: market-id,
        borrow-token: borrow-token,
        oracle: oracle,
        borrow-cap: borrow-cap
      })
      (ok market-id)
    )
  )
)

;; Update a market's wiring (token, oracle, cap, enabled). Does NOT touch fees
;; (use set-fee-config) or the paused flag (use set-market-paused). Re-pointing
;; the oracle here lets a market move to a different oracle principal -- e.g. a
;; live feed -- with no redeploy.
(define-public (update-market
    (market-id uint)
    (borrow-token principal)
    (oracle principal)
    (borrow-cap uint)
    (enabled bool)
  )
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (match (map-get? markets {market-id: market-id})
      market
        (begin
          (map-set markets
            {market-id: market-id}
            (merge market {
              borrow-token: borrow-token,
              oracle: oracle,
              borrow-cap: borrow-cap,
              enabled: enabled
            })
          )
          (print {event: "market-updated", market-id: market-id, oracle: oracle, enabled: enabled})
          (ok true)
        )
      (err ERR_MARKET_NOT_FOUND)
    )
  )
)

;; Pause / un-pause a market without disturbing its wiring or fees.
(define-public (set-market-paused (market-id uint) (paused bool))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (match (map-get? markets {market-id: market-id})
      market
        (begin
          (map-set markets {market-id: market-id} (merge market {paused: paused}))
          (print {event: "market-paused-changed", market-id: market-id, paused: paused})
          (ok true)
        )
      (err ERR_MARKET_NOT_FOUND)
    )
  )
)

;; ============================================
;; Fee config (governance-gated, independent of market wiring)
;; ============================================

;; Replace a market's whole fee-config. Every field is bounded: this is the fee
;; setter that "rejects values above hard caps". borrow-fee-lp-share-bps (the LP
;; baseline-incentive dial) is settable here. Market must already exist.
(define-public (set-fee-config
    (market-id uint)
    (borrow-fee-bps uint)
    (borrow-fee-lp-share-bps uint)
    (protocol-liq-share-bps uint)
    (early-repay-fee-bps uint)
  )
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (asserts! (is-some (map-get? markets {market-id: market-id})) (err ERR_MARKET_NOT_FOUND))
    (asserts!
      (fees-within-caps borrow-fee-bps borrow-fee-lp-share-bps protocol-liq-share-bps early-repay-fee-bps)
      (err ERR_FEE_TOO_HIGH)
    )
    (map-set fee-config
      {market-id: market-id}
      {
        borrow-fee-bps: borrow-fee-bps,
        borrow-fee-lp-share-bps: borrow-fee-lp-share-bps,
        protocol-liq-share-bps: protocol-liq-share-bps,
        early-repay-fee-bps: early-repay-fee-bps
      }
    )
    (print {event: "fee-config-updated", market-id: market-id, borrow-fee-bps: borrow-fee-bps})
    (ok true)
  )
)

;; ============================================
;; Treasury (governance-gated recipient; authorized-caller accrual)
;; ============================================

(define-public (set-treasury (new-treasury principal))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (var-set treasury new-treasury)
    (print {event: "treasury-changed", treasury: new-treasury})
    (ok true)
  )
)

;; Record protocol fee accrual. Called only by an authorized caller (vault/pool),
;; not governance -- it runs during normal borrow/liquidate flows.
(define-public (accrue-fee (market-id uint) (token principal) (amount uint))
  (begin
    (asserts! (is-authorized-caller) (err ERR_UNAUTHORIZED))
    (let ((new-amount (+ (get-treasury-accrued market-id token) amount)))
      (map-set treasury-accrued {market-id: market-id, token: token} {amount: new-amount})
      (ok new-amount)
    )
  )
)

;; Zero a {market, token} accrual and return the amount cleared (for the sweep
;; contract to move to treasury). Authorized callers only.
(define-public (clear-treasury-accrued (market-id uint) (token principal))
  (begin
    (asserts! (is-authorized-caller) (err ERR_UNAUTHORIZED))
    (let ((amount (get-treasury-accrued market-id token)))
      (map-set treasury-accrued {market-id: market-id, token: token} {amount: u0})
      (ok amount)
    )
  )
)

;; ============================================
;; Authorized callers (governance-gated)
;; ============================================

(define-public (set-authorized-caller (caller principal) (authorized bool))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (map-set authorized-callers caller authorized)
    (print {event: "authorized-caller-changed", caller: caller, authorized: authorized})
    (ok true)
  )
)

;; ============================================
;; Read-Only Functions
;; ============================================

(define-read-only (get-market (market-id uint))
  (map-get? markets {market-id: market-id})
)

(define-read-only (get-fee-config (market-id uint))
  (map-get? fee-config {market-id: market-id})
)

(define-read-only (get-market-count) (var-get market-count))

(define-read-only (get-borrow-token (market-id uint))
  (match (map-get? markets {market-id: market-id}) market (some (get borrow-token market)) none)
)

(define-read-only (get-oracle (market-id uint))
  (match (map-get? markets {market-id: market-id}) market (some (get oracle market)) none)
)

(define-read-only (get-borrow-cap (market-id uint))
  (match (map-get? markets {market-id: market-id}) market (some (get borrow-cap market)) none)
)

(define-read-only (is-market-enabled (market-id uint))
  (match (map-get? markets {market-id: market-id}) market (get enabled market) false)
)

(define-read-only (is-market-paused (market-id uint))
  (match (map-get? markets {market-id: market-id}) market (get paused market) false)
)

;; A market is active for new borrows only when enabled AND not paused.
(define-read-only (is-market-active (market-id uint))
  (match (map-get? markets {market-id: market-id})
    market (and (get enabled market) (not (get paused market)))
    false
  )
)

(define-read-only (get-treasury) (var-get treasury))

(define-read-only (get-treasury-accrued (market-id uint) (token principal))
  (default-to u0 (get amount (map-get? treasury-accrued {market-id: market-id, token: token})))
)

(define-read-only (is-caller-authorized (caller principal))
  (default-to false (map-get? authorized-callers caller))
)

;; The immutable hard caps, exposed so off-chain/UI can pre-validate fee inputs.
(define-read-only (get-fee-caps)
  {
    max-borrow-fee: MAX-BORROW-FEE,
    max-borrow-fee-lp-share: MAX-BORROW-FEE-LP-SHARE,
    max-protocol-liq-share: MAX-PROTOCOL-LIQ-SHARE,
    max-early-repay: MAX-EARLY-REPAY
  }
)
