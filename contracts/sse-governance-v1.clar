;; sse-governance-v1.clar
;; Governance registry: stores the Asigna multisig (admin), the guardian, and the timelock principals.
;; Read by frontend + tests; not directly enforcement-critical (each governed contract pins its own
;; timelock principal). Setters are gated by the timelock once bootstrap is locked.

(define-constant CONTRACT-OWNER tx-sender)

(define-constant ERR-UNAUTHORIZED u900)
(define-constant ERR-BOOTSTRAP-LOCKED u901)
(define-constant ERR-NOT-GOVERNANCE u902)

;; The Asigna multisig that proposes/executes actions through the timelock.
(define-data-var admin principal CONTRACT-OWNER)

;; Separate (typically smaller) multisig with ONLY cancel authority on the timelock.
(define-data-var guardian principal CONTRACT-OWNER)

;; The deployed sse-timelock-v1 principal.
(define-data-var timelock principal CONTRACT-OWNER)

;; One-shot bootstrap. While false, deployer can set admin/guardian/timelock.
;; After lock-bootstrap, only the timelock can update via its self-call execute fns.
(define-data-var bootstrap-locked bool false)

;; ============================================
;; Read-Only
;; ============================================

(define-read-only (get-admin) (var-get admin))
(define-read-only (get-guardian) (var-get guardian))
(define-read-only (get-timelock) (var-get timelock))
(define-read-only (is-bootstrap-locked) (var-get bootstrap-locked))

(define-read-only (is-admin (who principal))
  (is-eq who (var-get admin))
)

(define-read-only (is-guardian (who principal))
  (is-eq who (var-get guardian))
)

(define-read-only (is-timelock (who principal))
  (is-eq who (var-get timelock))
)

;; ============================================
;; Bootstrap (deployer-only, one-shot)
;; ============================================

(define-public (bootstrap-set-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR-UNAUTHORIZED))
    (asserts! (not (var-get bootstrap-locked)) (err ERR-BOOTSTRAP-LOCKED))
    (var-set admin new-admin)
    (print {event: "admin-set", admin: new-admin, via: "bootstrap"})
    (ok true)
  )
)

(define-public (bootstrap-set-guardian (new-guardian principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR-UNAUTHORIZED))
    (asserts! (not (var-get bootstrap-locked)) (err ERR-BOOTSTRAP-LOCKED))
    (var-set guardian new-guardian)
    (print {event: "guardian-set", guardian: new-guardian, via: "bootstrap"})
    (ok true)
  )
)

(define-public (bootstrap-set-timelock (new-timelock principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR-UNAUTHORIZED))
    (asserts! (not (var-get bootstrap-locked)) (err ERR-BOOTSTRAP-LOCKED))
    (var-set timelock new-timelock)
    (print {event: "timelock-set", timelock: new-timelock, via: "bootstrap"})
    (ok true)
  )
)

(define-public (lock-bootstrap)
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR-UNAUTHORIZED))
    (var-set bootstrap-locked true)
    (print {event: "bootstrap-locked"})
    (ok true)
  )
)

;; ============================================
;; Post-bootstrap rotation (timelock-only)
;; The timelock calls these via its execute-rotate-* wrappers.
;; ============================================

(define-public (rotate-admin (new-admin principal))
  (begin
    (asserts! (is-eq contract-caller (var-get timelock)) (err ERR-NOT-GOVERNANCE))
    (var-set admin new-admin)
    (print {event: "admin-set", admin: new-admin, via: "timelock"})
    (ok true)
  )
)

(define-public (rotate-guardian (new-guardian principal))
  (begin
    (asserts! (is-eq contract-caller (var-get timelock)) (err ERR-NOT-GOVERNANCE))
    (var-set guardian new-guardian)
    (print {event: "guardian-set", guardian: new-guardian, via: "timelock"})
    (ok true)
  )
)
