;; sse-timelock-v1.clar
;; Compound-style timelock adapted to Clarity 3.
;;
;; Roles:
;; - admin   = Asigna multisig (set in sse-governance-v1). Can queue, execute, cancel, and
;;             trigger emergency fast-paths.
;; - guardian = secondary principal. Can ONLY cancel queued actions during the delay.
;;
;; Flow for a normal action:
;;   1. admin computes hash = sha256( consensus-buff({target, fn}) ++ consensus-buff(args) )
;;   2. admin calls (queue id hash eta) - eta must be >= current-block + delay
;;   3. after eta, admin (or anyone) calls (execute-<fn> id args...)
;;      execute-<fn> recomputes the hash from args, asserts queued+ready, marks executed,
;;      then (as-contract) calls the target admin function.
;;
;; Cancellations:
;;   - admin OR guardian may call (cancel id) before execution.
;;
;; Emergency fast-paths:
;;   - A whitelist of (target, fn) pairs can be invoked by admin via execute-emergency-<fn>
;;     with NO delay. The whitelist itself can only be modified via the timelock (i.e. queued).
;;
;; Self-governance:
;;   - set-delay, set-emergency-whitelist, rotate-admin, rotate-guardian are also routed
;;     through the timelock's queue/execute flow (target = TARGET-SELF).

;; ============================================
;; Constants
;; ============================================

(define-constant CONTRACT-OWNER tx-sender)

;; Default delay: 144 blocks (~24h on Stacks @ ~10 min/block).
(define-constant DEFAULT-DELAY u144)

;; Hard floor on delay so a malicious self-call can't shrink it below this.
(define-constant MIN-DELAY u6)   ;; ~1 hour
(define-constant MAX-DELAY u4320) ;; ~30 days

;; Target enum
(define-constant TARGET-FACTORY u1)
(define-constant TARGET-COLLATERAL u2)
(define-constant TARGET-BRIDGE u3)
(define-constant TARGET-XRESERVE u4)
(define-constant TARGET-VAULT u5)
(define-constant TARGET-SELF u6)

;; Function IDs (per target)
;; Factory
(define-constant FN-FACTORY-SET-FEE u1)
(define-constant FN-FACTORY-SET-TREASURY u2)
;; Collateral registry
(define-constant FN-COLL-ADD u1)
(define-constant FN-COLL-UPDATE u2)
(define-constant FN-COLL-SET-ENABLED u3)
(define-constant FN-COLL-UPDATE-ORACLE u4)
(define-constant FN-COLL-SET-VAULT-AUTH u5)
;; Bridge registry
(define-constant FN-BRIDGE-ADD-CHAIN u1)
(define-constant FN-BRIDGE-DISABLE-CHAIN u2)
(define-constant FN-BRIDGE-REGISTER-TOKEN u3)
(define-constant FN-BRIDGE-UPDATE-ADAPTER u4)
(define-constant FN-BRIDGE-SET-TOKEN-ENABLED u5)
(define-constant FN-BRIDGE-CONFIG-CHAIN u6)
;; xReserve
(define-constant FN-XRES-SET-ATTEST u1)
(define-constant FN-XRES-SET-TOKEN u2)
(define-constant FN-XRES-SET-PAUSED u3)
(define-constant FN-XRES-ADD-CHAIN u4)
(define-constant FN-XRES-REMOVE-CHAIN u5)
;; Vault engine
(define-constant FN-VAULT-REGISTER-ORACLE u1)
;; Self
(define-constant FN-SELF-SET-DELAY u1)
(define-constant FN-SELF-SET-EMERGENCY u2)
(define-constant FN-SELF-ROTATE-ADMIN u3)
(define-constant FN-SELF-ROTATE-GUARDIAN u4)

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

;; Queued actions, keyed by caller-supplied id.
(define-map queued-actions
  {id: uint}
  {
    action-hash: (buff 32),
    target: uint,
    fn: uint,
    eta: uint,
    executed: bool,
    cancelled: bool
  }
)

;; Emergency whitelist: (target, fn) pairs that admin can fast-path without delay.
(define-map emergency-whitelist {target: uint, fn: uint} {enabled: bool})

;; ============================================
;; Read-only
;; ============================================

(define-read-only (get-delay) (var-get delay))

(define-read-only (get-action (id uint))
  (map-get? queued-actions {id: id})
)

(define-read-only (is-emergency (target uint) (fn uint))
  (default-to false (get enabled (map-get? emergency-whitelist {target: target, fn: fn})))
)

(define-read-only (compute-hash (target uint) (fn uint) (args-buff (buff 1024)))
  (sha256 (concat
    (unwrap-panic (to-consensus-buff? {t: target, f: fn}))
    args-buff
  ))
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
      {action-hash: action-hash, target: target, fn: fn, eta: eta, executed: false, cancelled: false}
    )
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
;; Execute wrappers - Factory
;; ============================================

(define-public (execute-factory-set-fee (id uint) (new-fee uint))
  (begin
    (try! (consume id TARGET-FACTORY FN-FACTORY-SET-FEE
      (compute-hash TARGET-FACTORY FN-FACTORY-SET-FEE
        (unwrap-panic (to-consensus-buff? {new-fee: new-fee})))))
    (as-contract (contract-call? .stablecoin-factory-v4 set-registration-fee new-fee))
  )
)

(define-public (execute-factory-set-treasury (id uint) (new-treasury principal))
  (begin
    (try! (consume id TARGET-FACTORY FN-FACTORY-SET-TREASURY
      (compute-hash TARGET-FACTORY FN-FACTORY-SET-TREASURY
        (unwrap-panic (to-consensus-buff? {new-treasury: new-treasury})))))
    (as-contract (contract-call? .stablecoin-factory-v4 set-treasury-address new-treasury))
  )
)

;; ============================================
;; Execute wrappers - Collateral Registry
;; ============================================

(define-public (execute-coll-add
    (id uint)
    (asset principal)
    (min-cr uint)
    (liq-r uint)
    (liq-pen uint)
    (fee uint)
    (ceiling uint)
    (floor-amt uint)
    (oracle principal))
  (begin
    (try! (consume id TARGET-COLLATERAL FN-COLL-ADD
      (compute-hash TARGET-COLLATERAL FN-COLL-ADD
        (unwrap-panic (to-consensus-buff? {asset: asset, min-cr: min-cr, liq-r: liq-r,
          liq-pen: liq-pen, fee: fee, ceiling: ceiling, floor-amt: floor-amt, oracle: oracle})))))
    (as-contract (contract-call? .collateral-registry-v6 add-collateral-type
      asset min-cr liq-r liq-pen fee ceiling floor-amt oracle))
  )
)

(define-public (execute-coll-update
    (id uint)
    (asset principal)
    (min-cr uint)
    (liq-r uint)
    (liq-pen uint)
    (fee uint)
    (ceiling uint)
    (floor-amt uint))
  (begin
    (try! (consume id TARGET-COLLATERAL FN-COLL-UPDATE
      (compute-hash TARGET-COLLATERAL FN-COLL-UPDATE
        (unwrap-panic (to-consensus-buff? {asset: asset, min-cr: min-cr, liq-r: liq-r,
          liq-pen: liq-pen, fee: fee, ceiling: ceiling, floor-amt: floor-amt})))))
    (as-contract (contract-call? .collateral-registry-v6 update-collateral-params
      asset min-cr liq-r liq-pen fee ceiling floor-amt))
  )
)

(define-public (execute-coll-set-enabled (id uint) (asset principal) (enabled bool))
  (begin
    (try! (consume id TARGET-COLLATERAL FN-COLL-SET-ENABLED
      (compute-hash TARGET-COLLATERAL FN-COLL-SET-ENABLED
        (unwrap-panic (to-consensus-buff? {asset: asset, enabled: enabled})))))
    (as-contract (contract-call? .collateral-registry-v6 set-collateral-enabled asset enabled))
  )
)

(define-public (execute-coll-update-oracle (id uint) (asset principal) (new-oracle principal))
  (begin
    (try! (consume id TARGET-COLLATERAL FN-COLL-UPDATE-ORACLE
      (compute-hash TARGET-COLLATERAL FN-COLL-UPDATE-ORACLE
        (unwrap-panic (to-consensus-buff? {asset: asset, new-oracle: new-oracle})))))
    (as-contract (contract-call? .collateral-registry-v6 update-oracle asset new-oracle))
  )
)

(define-public (execute-coll-set-vault-auth (id uint) (engine principal) (authorized bool))
  (begin
    (try! (consume id TARGET-COLLATERAL FN-COLL-SET-VAULT-AUTH
      (compute-hash TARGET-COLLATERAL FN-COLL-SET-VAULT-AUTH
        (unwrap-panic (to-consensus-buff? {engine: engine, authorized: authorized})))))
    (as-contract (contract-call? .collateral-registry-v6 set-vault-engine-authorized engine authorized))
  )
)

;; ============================================
;; Execute wrappers - Bridge Registry
;; ============================================

(define-public (execute-bridge-add-chain (id uint) (target-chain-id uint) (name (string-ascii 32)))
  (begin
    (try! (consume id TARGET-BRIDGE FN-BRIDGE-ADD-CHAIN
      (compute-hash TARGET-BRIDGE FN-BRIDGE-ADD-CHAIN
        (unwrap-panic (to-consensus-buff? {chain-id: chain-id, name: name})))))
    (as-contract (contract-call? .bridge-registry-v4 add-chain target-chain-id name))
  )
)

(define-public (execute-bridge-disable-chain (id uint) (target-chain-id uint))
  (begin
    (try! (consume id TARGET-BRIDGE FN-BRIDGE-DISABLE-CHAIN
      (compute-hash TARGET-BRIDGE FN-BRIDGE-DISABLE-CHAIN
        (unwrap-panic (to-consensus-buff? {chain-id: chain-id})))))
    (as-contract (contract-call? .bridge-registry-v4 disable-chain target-chain-id))
  )
)

(define-public (execute-bridge-register-token (id uint) (token principal) (adapter principal))
  (begin
    (try! (consume id TARGET-BRIDGE FN-BRIDGE-REGISTER-TOKEN
      (compute-hash TARGET-BRIDGE FN-BRIDGE-REGISTER-TOKEN
        (unwrap-panic (to-consensus-buff? {token: token, adapter: adapter})))))
    (as-contract (contract-call? .bridge-registry-v4 register-token token adapter))
  )
)

(define-public (execute-bridge-update-adapter (id uint) (token principal) (new-adapter principal))
  (begin
    (try! (consume id TARGET-BRIDGE FN-BRIDGE-UPDATE-ADAPTER
      (compute-hash TARGET-BRIDGE FN-BRIDGE-UPDATE-ADAPTER
        (unwrap-panic (to-consensus-buff? {token: token, new-adapter: new-adapter})))))
    (as-contract (contract-call? .bridge-registry-v4 update-token-adapter token new-adapter))
  )
)

(define-public (execute-bridge-set-token-enabled (id uint) (token principal) (enabled bool))
  (begin
    (try! (consume id TARGET-BRIDGE FN-BRIDGE-SET-TOKEN-ENABLED
      (compute-hash TARGET-BRIDGE FN-BRIDGE-SET-TOKEN-ENABLED
        (unwrap-panic (to-consensus-buff? {token: token, enabled: enabled})))))
    (as-contract (contract-call? .bridge-registry-v4 set-token-enabled token enabled))
  )
)

(define-public (execute-bridge-config-chain
    (id uint)
    (token principal)
    (target-chain-id uint)
    (remote-addr (buff 32))
    (min-amt uint)
    (max-amt uint))
  (begin
    (try! (consume id TARGET-BRIDGE FN-BRIDGE-CONFIG-CHAIN
      (compute-hash TARGET-BRIDGE FN-BRIDGE-CONFIG-CHAIN
        (unwrap-panic (to-consensus-buff? {token: token, chain-id: chain-id,
          remote-addr: remote-addr, min-amt: min-amt, max-amt: max-amt})))))
    (as-contract (contract-call? .bridge-registry-v4 configure-token-chain
      token target-chain-id remote-addr min-amt max-amt))
  )
)

;; ============================================
;; Execute wrappers - xReserve Adapter
;; ============================================

(define-public (execute-xres-set-attest (id uint) (service principal))
  (begin
    (try! (consume id TARGET-XRESERVE FN-XRES-SET-ATTEST
      (compute-hash TARGET-XRESERVE FN-XRES-SET-ATTEST
        (unwrap-panic (to-consensus-buff? {service: service})))))
    (as-contract (contract-call? .xreserve-adapter-v5 set-attestation-service service))
  )
)

(define-public (execute-xres-set-token (id uint) (token principal))
  (begin
    (try! (consume id TARGET-XRESERVE FN-XRES-SET-TOKEN
      (compute-hash TARGET-XRESERVE FN-XRES-SET-TOKEN
        (unwrap-panic (to-consensus-buff? {token: token})))))
    (as-contract (contract-call? .xreserve-adapter-v5 set-bridged-token token))
  )
)

(define-public (execute-xres-set-paused (id uint) (paused bool))
  (begin
    (try! (consume id TARGET-XRESERVE FN-XRES-SET-PAUSED
      (compute-hash TARGET-XRESERVE FN-XRES-SET-PAUSED
        (unwrap-panic (to-consensus-buff? {paused: paused})))))
    (as-contract (contract-call? .xreserve-adapter-v5 set-paused paused))
  )
)

(define-public (execute-xres-add-chain (id uint) (target-chain-id uint) (name (string-ascii 32)))
  (begin
    (try! (consume id TARGET-XRESERVE FN-XRES-ADD-CHAIN
      (compute-hash TARGET-XRESERVE FN-XRES-ADD-CHAIN
        (unwrap-panic (to-consensus-buff? {chain-id: chain-id, name: name})))))
    (as-contract (contract-call? .xreserve-adapter-v5 add-supported-chain target-chain-id name))
  )
)

(define-public (execute-xres-remove-chain (id uint) (target-chain-id uint))
  (begin
    (try! (consume id TARGET-XRESERVE FN-XRES-REMOVE-CHAIN
      (compute-hash TARGET-XRESERVE FN-XRES-REMOVE-CHAIN
        (unwrap-panic (to-consensus-buff? {chain-id: chain-id})))))
    (as-contract (contract-call? .xreserve-adapter-v5 remove-supported-chain target-chain-id))
  )
)

;; ============================================
;; Execute wrappers - Vault Engine
;; ============================================

(define-public (execute-vault-register-oracle (id uint) (asset principal) (oracle-id uint))
  (begin
    (try! (consume id TARGET-VAULT FN-VAULT-REGISTER-ORACLE
      (compute-hash TARGET-VAULT FN-VAULT-REGISTER-ORACLE
        (unwrap-panic (to-consensus-buff? {asset: asset, oracle-id: oracle-id})))))
    (as-contract (contract-call? .multi-asset-vault-engine-v7 register-asset-oracle asset oracle-id))
  )
)

;; ============================================
;; Execute wrappers - Self (timelock + governance)
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

(define-public (execute-self-rotate-admin (id uint) (new-admin principal))
  (begin
    (try! (consume id TARGET-SELF FN-SELF-ROTATE-ADMIN
      (compute-hash TARGET-SELF FN-SELF-ROTATE-ADMIN
        (unwrap-panic (to-consensus-buff? {new-admin: new-admin})))))
    (as-contract (contract-call? .sse-governance-v1 rotate-admin new-admin))
  )
)

(define-public (execute-self-rotate-guardian (id uint) (new-guardian principal))
  (begin
    (try! (consume id TARGET-SELF FN-SELF-ROTATE-GUARDIAN
      (compute-hash TARGET-SELF FN-SELF-ROTATE-GUARDIAN
        (unwrap-panic (to-consensus-buff? {new-guardian: new-guardian})))))
    (as-contract (contract-call? .sse-governance-v1 rotate-guardian new-guardian))
  )
)

;; ============================================
;; Emergency fast-paths (admin-only, no delay)
;; ============================================

(define-public (emergency-coll-set-enabled (asset principal) (enabled bool))
  (begin
    (asserts! (is-admin-caller) (err ERR-NOT-ADMIN))
    (asserts! (is-emergency TARGET-COLLATERAL FN-COLL-SET-ENABLED) (err ERR-NOT-EMERGENCY))
    (print {event: "emergency-executed", target: TARGET-COLLATERAL, fn: FN-COLL-SET-ENABLED})
    (as-contract (contract-call? .collateral-registry-v6 set-collateral-enabled asset enabled))
  )
)

(define-public (emergency-bridge-set-token-enabled (token principal) (enabled bool))
  (begin
    (asserts! (is-admin-caller) (err ERR-NOT-ADMIN))
    (asserts! (is-emergency TARGET-BRIDGE FN-BRIDGE-SET-TOKEN-ENABLED) (err ERR-NOT-EMERGENCY))
    (print {event: "emergency-executed", target: TARGET-BRIDGE, fn: FN-BRIDGE-SET-TOKEN-ENABLED})
    (as-contract (contract-call? .bridge-registry-v4 set-token-enabled token enabled))
  )
)

(define-public (emergency-xres-set-paused (paused bool))
  (begin
    (asserts! (is-admin-caller) (err ERR-NOT-ADMIN))
    (asserts! (is-emergency TARGET-XRESERVE FN-XRES-SET-PAUSED) (err ERR-NOT-EMERGENCY))
    (print {event: "emergency-executed", target: TARGET-XRESERVE, fn: FN-XRES-SET-PAUSED})
    (as-contract (contract-call? .xreserve-adapter-v5 set-paused paused))
  )
)
