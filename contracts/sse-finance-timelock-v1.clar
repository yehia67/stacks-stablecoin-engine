;; sse-finance-timelock-v1.clar
;;
;; Fresh, self-contained timelock for the SSE Finance package. Same Compound-style
;; queue/execute/cancel design as sse-timelock-v1, re-targeted at the SSE Finance
;; admin surface. Admin + guardian roles are read from the shared sse-governance-v1
;; (same multisig that governs the rest of SSE).
;;
;; Every governance-gated function across the SSE Finance contracts is wrapped here
;; by an execute-* wrapper. At deploy each SSE Finance contract's `governance` var
;; is pointed at THIS contract, so after bootstrap is locked the only caller that
;; passes their is-governance-caller check is this timelock (via as-contract).
;;
;; Delay model:
;;   - Normal actions: admin queues a hash, waits >= delay, then executes.
;;   - PAUSE is the no-delay emergency path (emergency-set-market-paused, forces
;;     paused=true). UN-pause and every risk-loosening change go through the full
;;     queued delay.
;;   - guardian (or admin) may cancel a queued action before it executes.
;;   - delay is floored at MIN-DELAY and capped at MAX-DELAY; set-delay is itself
;;     queued (TARGET-SELF) and re-asserts the range, so it can't be shrunk below
;;     the floor.

(define-constant CONTRACT-OWNER tx-sender)

(define-constant DEFAULT-DELAY u144)   ;; ~24h @ ~10 min/block
(define-constant MIN-DELAY u6)         ;; ~1 hour floor
(define-constant MAX-DELAY u4320)      ;; ~30 days cap

;; Targets
(define-constant TARGET-REGISTRY u1)
(define-constant TARGET-MATRIX u2)
(define-constant TARGET-POOL u3)
(define-constant TARGET-VAULT u4)
(define-constant TARGET-LIQUIDATION u5)
(define-constant TARGET-ORACLE u6)
(define-constant TARGET-SELF u7)

;; Function IDs (per target)
(define-constant FN-REG-REGISTER-MARKET u1)
(define-constant FN-REG-UPDATE-MARKET u2)
(define-constant FN-REG-SET-PAUSED u3)
(define-constant FN-REG-SET-FEE-CONFIG u4)
(define-constant FN-REG-SET-TREASURY u5)
(define-constant FN-REG-SET-AUTH u6)

(define-constant FN-MTX-ADD u1)
(define-constant FN-MTX-UPDATE u2)
(define-constant FN-MTX-SET-ENABLED u3)
(define-constant FN-MTX-SET-ORACLE u4)

(define-constant FN-POOL-SET-AUTH u1)
(define-constant FN-VAULT-SET-LIQUIDATOR u1)
(define-constant FN-LIQ-SET-TRIGGER u1)

(define-constant FN-ORA-SET-PEG u1)
(define-constant FN-ORA-SET-DEV u2)
(define-constant FN-ORA-SET-STALE u3)

(define-constant FN-SELF-SET-DELAY u1)
(define-constant FN-SELF-SET-EMERGENCY u2)

;; Errors
(define-constant ERR-UNAUTHORIZED u1000)
(define-constant ERR-NOT-ADMIN u1001)
(define-constant ERR-NOT-ADMIN-OR-GUARDIAN u1002)
(define-constant ERR-ETA-TOO-EARLY u1003)
(define-constant ERR-ID-EXISTS u1004)
(define-constant ERR-NOT-FOUND u1005)
(define-constant ERR-ALREADY-EXECUTED u1006)
(define-constant ERR-ALREADY-CANCELLED u1007)
(define-constant ERR-NOT-READY u1008)
(define-constant ERR-HASH-MISMATCH u1009)
(define-constant ERR-DELAY-OUT-OF-RANGE u1010)
(define-constant ERR-NOT-EMERGENCY u1011)
(define-constant ERR-BOOTSTRAP-LOCKED u1012)

;; ============================================
;; Storage
;; ============================================
(define-data-var delay uint DEFAULT-DELAY)
(define-data-var bootstrap-locked bool false)

(define-map queued-actions
  {id: uint}
  {action-hash: (buff 32), target: uint, fn: uint, eta: uint, executed: bool, cancelled: bool}
)

(define-map emergency-whitelist {target: uint, fn: uint} {enabled: bool})

;; ============================================
;; Read-only
;; ============================================
(define-read-only (get-delay) (var-get delay))
(define-read-only (get-action (id uint)) (map-get? queued-actions {id: id}))
(define-read-only (is-emergency (target uint) (fn uint))
  (default-to false (get enabled (map-get? emergency-whitelist {target: target, fn: fn})))
)
(define-read-only (compute-hash (target uint) (fn uint) (args-buff (buff 1024)))
  (sha256 (concat (unwrap-panic (to-consensus-buff? {t: target, f: fn})) args-buff))
)

;; ============================================
;; Bootstrap (deployer-only, one-shot)
;; ============================================
(define-public (bootstrap-set-emergency (target uint) (fn uint) (enabled bool))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR-UNAUTHORIZED))
    (asserts! (not (var-get bootstrap-locked)) (err ERR-BOOTSTRAP-LOCKED))
    (map-set emergency-whitelist {target: target, fn: fn} {enabled: enabled})
    (ok true)
  )
)

(define-public (lock-bootstrap)
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR-UNAUTHORIZED))
    (var-set bootstrap-locked true)
    (print {event: "timelock-bootstrap-locked"})
    (ok true)
  )
)

;; ============================================
;; Role checks (admin/guardian live in sse-governance-v1)
;; ============================================
(define-private (is-admin-caller)
  (is-eq tx-sender (contract-call? .sse-governance-v1 get-admin))
)
(define-private (is-guardian-caller)
  (is-eq tx-sender (contract-call? .sse-governance-v1 get-guardian))
)

;; ============================================
;; Queue / Cancel / Consume
;; ============================================
(define-public (queue (id uint) (action-hash (buff 32)) (target uint) (fn uint) (eta uint))
  (begin
    (asserts! (is-admin-caller) (err ERR-NOT-ADMIN))
    (asserts! (>= eta (+ stacks-block-height (var-get delay))) (err ERR-ETA-TOO-EARLY))
    (asserts! (is-none (map-get? queued-actions {id: id})) (err ERR-ID-EXISTS))
    (map-set queued-actions {id: id}
      {action-hash: action-hash, target: target, fn: fn, eta: eta, executed: false, cancelled: false})
    (print {event: "queued", id: id, target: target, fn: fn, eta: eta, hash: action-hash})
    (ok true)
  )
)

(define-public (cancel (id uint))
  (let ((action (unwrap! (map-get? queued-actions {id: id}) (err ERR-NOT-FOUND))))
    (asserts! (or (is-admin-caller) (is-guardian-caller)) (err ERR-NOT-ADMIN-OR-GUARDIAN))
    (asserts! (not (get executed action)) (err ERR-ALREADY-EXECUTED))
    (asserts! (not (get cancelled action)) (err ERR-ALREADY-CANCELLED))
    (map-set queued-actions {id: id} (merge action {cancelled: true}))
    (print {event: "cancelled", id: id})
    (ok true)
  )
)

(define-private (consume (id uint) (target uint) (fn uint) (expected-hash (buff 32)))
  (let ((action (unwrap! (map-get? queued-actions {id: id}) (err ERR-NOT-FOUND))))
    (asserts! (not (get executed action)) (err ERR-ALREADY-EXECUTED))
    (asserts! (not (get cancelled action)) (err ERR-ALREADY-CANCELLED))
    (asserts! (>= stacks-block-height (get eta action)) (err ERR-NOT-READY))
    (asserts! (is-eq (get target action) target) (err ERR-HASH-MISMATCH))
    (asserts! (is-eq (get fn action) fn) (err ERR-HASH-MISMATCH))
    (asserts! (is-eq (get action-hash action) expected-hash) (err ERR-HASH-MISMATCH))
    (map-set queued-actions {id: id} (merge action {executed: true}))
    (print {event: "executed", id: id, target: target, fn: fn})
    (ok true)
  )
)

;; ============================================
;; Execute wrappers - Market Registry
;; ============================================
(define-public (execute-reg-register-market
    (id uint) (borrow-token principal) (oracle principal) (borrow-cap uint)
    (borrow-fee-bps uint) (borrow-fee-lp-share-bps uint) (protocol-liq-share-bps uint) (early-repay-fee-bps uint))
  (begin
    (try! (consume id TARGET-REGISTRY FN-REG-REGISTER-MARKET
      (compute-hash TARGET-REGISTRY FN-REG-REGISTER-MARKET
        (unwrap-panic (to-consensus-buff? {borrow-token: borrow-token, oracle: oracle, borrow-cap: borrow-cap,
          borrow-fee-bps: borrow-fee-bps, borrow-fee-lp-share-bps: borrow-fee-lp-share-bps,
          protocol-liq-share-bps: protocol-liq-share-bps, early-repay-fee-bps: early-repay-fee-bps})))))
    (as-contract (contract-call? .sse-finance-market-registry-v1 register-market
      borrow-token oracle borrow-cap borrow-fee-bps borrow-fee-lp-share-bps protocol-liq-share-bps early-repay-fee-bps))
  )
)

(define-public (execute-reg-update-market
    (id uint) (market-id uint) (borrow-token principal) (oracle principal) (borrow-cap uint) (enabled bool))
  (begin
    (try! (consume id TARGET-REGISTRY FN-REG-UPDATE-MARKET
      (compute-hash TARGET-REGISTRY FN-REG-UPDATE-MARKET
        (unwrap-panic (to-consensus-buff? {market-id: market-id, borrow-token: borrow-token,
          oracle: oracle, borrow-cap: borrow-cap, enabled: enabled})))))
    (as-contract (contract-call? .sse-finance-market-registry-v1 update-market
      market-id borrow-token oracle borrow-cap enabled))
  )
)

;; Queued (delayed) pause change -- used for UN-pausing (paused=false) and any
;; deliberate pause that wants the audit trail. Emergency pause is below.
(define-public (execute-reg-set-paused (id uint) (market-id uint) (paused bool))
  (begin
    (try! (consume id TARGET-REGISTRY FN-REG-SET-PAUSED
      (compute-hash TARGET-REGISTRY FN-REG-SET-PAUSED
        (unwrap-panic (to-consensus-buff? {market-id: market-id, paused: paused})))))
    (as-contract (contract-call? .sse-finance-market-registry-v1 set-market-paused market-id paused))
  )
)

(define-public (execute-reg-set-fee-config
    (id uint) (market-id uint) (borrow-fee-bps uint) (borrow-fee-lp-share-bps uint)
    (protocol-liq-share-bps uint) (early-repay-fee-bps uint))
  (begin
    (try! (consume id TARGET-REGISTRY FN-REG-SET-FEE-CONFIG
      (compute-hash TARGET-REGISTRY FN-REG-SET-FEE-CONFIG
        (unwrap-panic (to-consensus-buff? {market-id: market-id, borrow-fee-bps: borrow-fee-bps,
          borrow-fee-lp-share-bps: borrow-fee-lp-share-bps, protocol-liq-share-bps: protocol-liq-share-bps,
          early-repay-fee-bps: early-repay-fee-bps})))))
    (as-contract (contract-call? .sse-finance-market-registry-v1 set-fee-config
      market-id borrow-fee-bps borrow-fee-lp-share-bps protocol-liq-share-bps early-repay-fee-bps))
  )
)

(define-public (execute-reg-set-treasury (id uint) (new-treasury principal))
  (begin
    (try! (consume id TARGET-REGISTRY FN-REG-SET-TREASURY
      (compute-hash TARGET-REGISTRY FN-REG-SET-TREASURY
        (unwrap-panic (to-consensus-buff? {new-treasury: new-treasury})))))
    (as-contract (contract-call? .sse-finance-market-registry-v1 set-treasury new-treasury))
  )
)

(define-public (execute-reg-set-auth (id uint) (caller principal) (authorized bool))
  (begin
    (try! (consume id TARGET-REGISTRY FN-REG-SET-AUTH
      (compute-hash TARGET-REGISTRY FN-REG-SET-AUTH
        (unwrap-panic (to-consensus-buff? {caller: caller, authorized: authorized})))))
    (as-contract (contract-call? .sse-finance-market-registry-v1 set-authorized-caller caller authorized))
  )
)

;; ============================================
;; Execute wrappers - Collateral Matrix
;; ============================================
(define-public (execute-mtx-add
    (id uint) (market-id uint) (collateral principal) (min-cr uint) (liq-r uint)
    (liq-pen uint) (debt-floor uint) (debt-ceiling uint))
  (begin
    (try! (consume id TARGET-MATRIX FN-MTX-ADD
      (compute-hash TARGET-MATRIX FN-MTX-ADD
        (unwrap-panic (to-consensus-buff? {market-id: market-id, collateral: collateral, min-cr: min-cr,
          liq-r: liq-r, liq-pen: liq-pen, debt-floor: debt-floor, debt-ceiling: debt-ceiling})))))
    (as-contract (contract-call? .sse-finance-collateral-matrix-v1 add-collateral-to-market
      market-id collateral min-cr liq-r liq-pen debt-floor debt-ceiling))
  )
)

(define-public (execute-mtx-update
    (id uint) (market-id uint) (collateral principal) (min-cr uint) (liq-r uint)
    (liq-pen uint) (debt-floor uint) (debt-ceiling uint))
  (begin
    (try! (consume id TARGET-MATRIX FN-MTX-UPDATE
      (compute-hash TARGET-MATRIX FN-MTX-UPDATE
        (unwrap-panic (to-consensus-buff? {market-id: market-id, collateral: collateral, min-cr: min-cr,
          liq-r: liq-r, liq-pen: liq-pen, debt-floor: debt-floor, debt-ceiling: debt-ceiling})))))
    (as-contract (contract-call? .sse-finance-collateral-matrix-v1 update-collateral-risk
      market-id collateral min-cr liq-r liq-pen debt-floor debt-ceiling))
  )
)

(define-public (execute-mtx-set-enabled (id uint) (market-id uint) (collateral principal) (enabled bool))
  (begin
    (try! (consume id TARGET-MATRIX FN-MTX-SET-ENABLED
      (compute-hash TARGET-MATRIX FN-MTX-SET-ENABLED
        (unwrap-panic (to-consensus-buff? {market-id: market-id, collateral: collateral, enabled: enabled})))))
    (as-contract (contract-call? .sse-finance-collateral-matrix-v1 set-pair-enabled market-id collateral enabled))
  )
)

(define-public (execute-mtx-set-oracle (id uint) (asset principal) (oracle principal))
  (begin
    (try! (consume id TARGET-MATRIX FN-MTX-SET-ORACLE
      (compute-hash TARGET-MATRIX FN-MTX-SET-ORACLE
        (unwrap-panic (to-consensus-buff? {asset: asset, oracle: oracle})))))
    (as-contract (contract-call? .sse-finance-collateral-matrix-v1 set-collateral-oracle asset oracle))
  )
)

;; ============================================
;; Execute wrappers - Pool / Vault / Liquidation
;; ============================================
(define-public (execute-pool-set-auth (id uint) (caller principal) (authorized bool))
  (begin
    (try! (consume id TARGET-POOL FN-POOL-SET-AUTH
      (compute-hash TARGET-POOL FN-POOL-SET-AUTH
        (unwrap-panic (to-consensus-buff? {caller: caller, authorized: authorized})))))
    (as-contract (contract-call? .sse-finance-pool-v1 set-authorized-caller caller authorized))
  )
)

(define-public (execute-vault-set-liquidator (id uint) (engine principal))
  (begin
    (try! (consume id TARGET-VAULT FN-VAULT-SET-LIQUIDATOR
      (compute-hash TARGET-VAULT FN-VAULT-SET-LIQUIDATOR
        (unwrap-panic (to-consensus-buff? {engine: engine})))))
    (as-contract (contract-call? .sse-finance-vault-v1 set-liquidator engine))
  )
)

(define-public (execute-liq-set-trigger (id uint) (amount uint))
  (begin
    (try! (consume id TARGET-LIQUIDATION FN-LIQ-SET-TRIGGER
      (compute-hash TARGET-LIQUIDATION FN-LIQ-SET-TRIGGER
        (unwrap-panic (to-consensus-buff? {amount: amount})))))
    (as-contract (contract-call? .sse-finance-liquidation-v1 set-trigger-reward amount))
  )
)

;; ============================================
;; Execute wrappers - Pegged USD oracle
;; ============================================
(define-public (execute-ora-set-peg (id uint) (new-price uint))
  (begin
    (try! (consume id TARGET-ORACLE FN-ORA-SET-PEG
      (compute-hash TARGET-ORACLE FN-ORA-SET-PEG
        (unwrap-panic (to-consensus-buff? {new-price: new-price})))))
    (as-contract (contract-call? .price-oracle-pegged-usd-v1 set-peg-price new-price))
  )
)

(define-public (execute-ora-set-deviation (id uint) (bps uint))
  (begin
    (try! (consume id TARGET-ORACLE FN-ORA-SET-DEV
      (compute-hash TARGET-ORACLE FN-ORA-SET-DEV
        (unwrap-panic (to-consensus-buff? {bps: bps})))))
    (as-contract (contract-call? .price-oracle-pegged-usd-v1 set-max-deviation-bps bps))
  )
)

(define-public (execute-ora-set-staleness (id uint) (secs uint))
  (begin
    (try! (consume id TARGET-ORACLE FN-ORA-SET-STALE
      (compute-hash TARGET-ORACLE FN-ORA-SET-STALE
        (unwrap-panic (to-consensus-buff? {secs: secs})))))
    (as-contract (contract-call? .price-oracle-pegged-usd-v1 set-max-staleness secs))
  )
)

;; ============================================
;; Execute wrappers - Self
;; ============================================
(define-public (execute-self-set-delay (id uint) (new-delay uint))
  (begin
    (try! (consume id TARGET-SELF FN-SELF-SET-DELAY
      (compute-hash TARGET-SELF FN-SELF-SET-DELAY
        (unwrap-panic (to-consensus-buff? {new-delay: new-delay})))))
    (asserts! (and (>= new-delay MIN-DELAY) (<= new-delay MAX-DELAY)) (err ERR-DELAY-OUT-OF-RANGE))
    (var-set delay new-delay)
    (print {event: "delay-updated", new-delay: new-delay})
    (ok true)
  )
)

(define-public (execute-self-set-emergency (id uint) (target uint) (fn uint) (enabled bool))
  (begin
    (try! (consume id TARGET-SELF FN-SELF-SET-EMERGENCY
      (compute-hash TARGET-SELF FN-SELF-SET-EMERGENCY
        (unwrap-panic (to-consensus-buff? {target: target, fn: fn, enabled: enabled})))))
    (map-set emergency-whitelist {target: target, fn: fn} {enabled: enabled})
    (print {event: "emergency-whitelist-updated", target: target, fn: fn, enabled: enabled})
    (ok true)
  )
)

;; ============================================
;; Emergency fast-path (admin-only, NO delay): PAUSE a market.
;; Only ever pauses (forces paused=true); un-pausing must go through the delay.
;; ============================================
(define-public (emergency-set-market-paused (market-id uint))
  (begin
    (asserts! (is-admin-caller) (err ERR-NOT-ADMIN))
    (asserts! (is-emergency TARGET-REGISTRY FN-REG-SET-PAUSED) (err ERR-NOT-EMERGENCY))
    (print {event: "emergency-executed", target: TARGET-REGISTRY, fn: FN-REG-SET-PAUSED, market-id: market-id})
    (as-contract (contract-call? .sse-finance-market-registry-v1 set-market-paused market-id true))
  )
)
