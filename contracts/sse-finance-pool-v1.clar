;; sse-finance-pool-v1.clar
;;
;; The SSE Finance liquidity pool: LPs supply a market's borrow-token and receive
;; shares; borrowers draw that liquidity (via the vault) and repay it; LP yield is
;; the liquidation discount, distributed in-kind through cumulative-reward-per-token.
;;
;; INTEREST-FREE (Liquity-style): there is NO supply index and NO interest. Debt
;; is flat principal. total-borrows only ever changes on borrow-out / repay-in /
;; liquidation; it never grows on its own.
;;
;; State model (per market-id):
;;   pool-state: { total-supplied, total-borrows, cash }
;;     total-supplied = LP principal claim (cash + lent out)
;;     total-borrows  = principal currently lent out (flat)
;;     cash           = idle balance available for borrows / withdrawals
;;
;; Share + loss accounting reuses stability-pool-v7 verbatim (renamed
;; stablecoin-id -> market-id): a per-market `product` socialises liquidation
;; losses across LPs, and a per-{market,asset} `cumulative-reward-per-token`
;; distributes seized collateral. An LP's effective claim = shares * product /
;; snapshot-product.
;;
;; Withdrawals are capped on-chain at available `cash` (the bank-run guard): an LP
;; can only pull what the pool actually holds idle, never principal that is lent
;; out.
;;
;; BORROW FEE -- convention (b) "netted from disbursed" (matches the architecture
;; flow diagram and the vault): on borrow-out the debt principal is `amount`, the
;; borrower receives `amount - fee`, and the fee stays in the pool. The fee is
;; split by the market's borrow-fee-lp-share-bps:
;;   - protocol-part -> recorded in the registry's treasury-accrued (the pool must
;;     be an authorized caller in sse-finance-market-registry-v1); the tokens stay
;;     in pool cash, earmarked, until sweep-fees moves them to the treasury.
;;   - lp-part -> credited pro-rata to all LP shares by bumping the pool product
;;     (the mirror of the liquidation-loss shrink), so existing LPs' effective
;;     balance grows by their share of the fee.
;; This keeps the invariant cash + total-borrows == total-supplied + treasury-accrued.
;; repay-in charges no fee (the optional early-repay fee is a fixed-term feature).

(use-trait sse-finance-sip-010-trait .sse-finance-sip-010-trait.sse-finance-sip-010-trait)

(define-constant CONTRACT-OWNER tx-sender)
(define-constant SCALE_FACTOR u1000000000000)
(define-constant BPS_DENOM u10000)

;; ============================================
;; Error Constants
;; ============================================
(define-constant ERR_UNAUTHORIZED u600)
(define-constant ERR_BOOTSTRAP_LOCKED u601)
(define-constant ERR_MARKET_NOT_FOUND u602)
(define-constant ERR_TOKEN_MISMATCH u603)
(define-constant ERR_INSUFFICIENT_BALANCE u604)   ;; LP claim < requested withdraw
(define-constant ERR_INSUFFICIENT_CASH u605)      ;; bank-run guard: withdraw/borrow > cash
(define-constant ERR_EMPTY_POOL u606)
(define-constant ERR_NO_REWARD u607)
(define-constant ERR_INVALID_AMOUNT u608)

;; ============================================
;; Governance (mirrors the rest of the SSE Finance package)
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
;; Authorized callers (the vault / liquidation engine)
;; ============================================
(define-map authorized-callers principal bool)

(define-private (is-authorized-caller)
  (default-to false (map-get? authorized-callers contract-caller))
)

(define-read-only (is-caller-authorized (caller principal))
  (default-to false (map-get? authorized-callers caller))
)

(define-public (set-authorized-caller (caller principal) (authorized bool))
  (begin
    (asserts! (is-governance-caller) (err ERR_UNAUTHORIZED))
    (map-set authorized-callers caller authorized)
    (print {event: "authorized-caller-changed", caller: caller, authorized: authorized})
    (ok true)
  )
)

;; ============================================
;; Data Maps
;; ============================================

(define-map pool-state
  {market-id: uint}
  {total-supplied: uint, total-borrows: uint, cash: uint}
)

;; Raw LP shares (scaled by product for loss socialisation).
(define-map lp-shares {lp: principal, market-id: uint} {shares: uint})

;; Liquidation loss + collateral reward (reused from stability-pool-v7).
(define-map pool-product {market-id: uint} {product: uint})
(define-map user-product-snapshot {lp: principal, market-id: uint} {product: uint})
(define-map cumulative-reward-per-token {market-id: uint, asset: principal} {reward-per-token: uint})
(define-map user-reward-snapshot {lp: principal, market-id: uint, asset: principal} {reward-per-token: uint})
(define-map pending-collateral-rewards {lp: principal, market-id: uint, asset: principal} {amount: uint})

;; ============================================
;; Internal helpers
;; ============================================

(define-private (get-state (market-id uint))
  (default-to {total-supplied: u0, total-borrows: u0, cash: u0}
    (map-get? pool-state {market-id: market-id})
  )
)

(define-private (get-current-product (market-id uint))
  (default-to SCALE_FACTOR (get product (map-get? pool-product {market-id: market-id})))
)

(define-private (get-user-snapshot-product (lp principal) (market-id uint))
  (default-to SCALE_FACTOR (get product (map-get? user-product-snapshot {lp: lp, market-id: market-id})))
)

(define-private (get-raw-shares (lp principal) (market-id uint))
  (default-to u0 (get shares (map-get? lp-shares {lp: lp, market-id: market-id})))
)

(define-private (get-current-rpt (market-id uint) (asset principal))
  (default-to u0 (get reward-per-token (map-get? cumulative-reward-per-token {market-id: market-id, asset: asset})))
)

(define-private (get-user-rpt-snapshot (lp principal) (market-id uint) (asset principal))
  (default-to u0 (get reward-per-token (map-get? user-reward-snapshot {lp: lp, market-id: market-id, asset: asset})))
)

(define-private (get-pending-reward (lp principal) (market-id uint) (asset principal))
  (default-to u0 (get amount (map-get? pending-collateral-rewards {lp: lp, market-id: market-id, asset: asset})))
)

;; An LP's effective principal claim = shares * product / snapshot-product.
(define-private (effective-balance (lp principal) (market-id uint))
  (let (
      (raw (get-raw-shares lp market-id))
      (current-product (get-current-product market-id))
      (snapshot-product (get-user-snapshot-product lp market-id))
    )
    (if (is-eq snapshot-product u0) u0 (/ (* raw current-product) snapshot-product))
  )
)

;; Borrow-token principal registered for a market, or none if no such market.
(define-private (market-borrow-token (market-id uint))
  (contract-call? .sse-finance-market-registry-v1 get-borrow-token market-id)
)

;; ============================================
;; Read-only views
;; ============================================

(define-read-only (get-pool-state (market-id uint)) (get-state market-id))
(define-read-only (get-total-supplied (market-id uint)) (get total-supplied (get-state market-id)))
(define-read-only (get-total-borrows (market-id uint)) (get total-borrows (get-state market-id)))
(define-read-only (get-cash (market-id uint)) (get cash (get-state market-id)))
;; Available liquidity an LP could withdraw or a borrower could draw right now.
(define-read-only (get-available-liquidity (market-id uint)) (get cash (get-state market-id)))
(define-read-only (get-pool-product-value (market-id uint)) (get-current-product market-id))
(define-read-only (get-shares (lp principal) (market-id uint)) (get-raw-shares lp market-id))
;; LP's withdrawable principal claim (before the cash cap).
(define-read-only (balance-of (lp principal) (market-id uint)) (effective-balance lp market-id))

(define-read-only (get-claimable-collateral-reward (lp principal) (market-id uint) (asset principal))
  (let (
      (raw (get-raw-shares lp market-id))
      (current-rpt (get-current-rpt market-id asset))
      (user-rpt (get-user-rpt-snapshot lp market-id asset))
      (pending (get-pending-reward lp market-id asset))
      (new-reward (if (> current-rpt user-rpt) (/ (* raw (- current-rpt user-rpt)) SCALE_FACTOR) u0))
    )
    (+ pending new-reward)
  )
)

;; ============================================
;; LP supply / withdraw
;; ============================================

;; Supply borrow-token to a market; mints shares (denominated in underlying at the
;; current product) and adds the amount to both total-supplied and cash.
(define-public (supply (market-id uint) (token <sse-finance-sip-010-trait>) (amount uint))
  (let (
      (expected (market-borrow-token market-id))
      (eff (effective-balance tx-sender market-id))
      (state (get-state market-id))
      (current-product (get-current-product market-id))
    )
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    (asserts! (is-some expected) (err ERR_MARKET_NOT_FOUND))
    (asserts! (is-eq (contract-of token) (unwrap-panic expected)) (err ERR_TOKEN_MISMATCH))

    (try! (contract-call? token transfer amount tx-sender (as-contract tx-sender) none))

    (map-set lp-shares {lp: tx-sender, market-id: market-id} {shares: (+ eff amount)})
    (map-set user-product-snapshot {lp: tx-sender, market-id: market-id} {product: current-product})
    (map-set pool-state {market-id: market-id}
      (merge state {
        total-supplied: (+ (get total-supplied state) amount),
        cash: (+ (get cash state) amount)
      })
    )
    (print {
      event: "pool-supply",
      lp: tx-sender,
      market-id: market-id,
      amount: amount,
      shares: (+ eff amount),
      total-supplied: (+ (get total-supplied state) amount),
      cash: (+ (get cash state) amount)
    })
    (ok (+ eff amount))
  )
)

;; Withdraw borrow-token. Capped at the LP's effective claim AND at available cash
;; (the bank-run guard): an LP can never pull principal that is currently lent out.
(define-public (withdraw (market-id uint) (token <sse-finance-sip-010-trait>) (amount uint))
  (let (
      (expected (market-borrow-token market-id))
      (eff (effective-balance tx-sender market-id))
      (state (get-state market-id))
      (current-product (get-current-product market-id))
      (lp tx-sender)
    )
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    (asserts! (is-some expected) (err ERR_MARKET_NOT_FOUND))
    (asserts! (is-eq (contract-of token) (unwrap-panic expected)) (err ERR_TOKEN_MISMATCH))
    (asserts! (>= eff amount) (err ERR_INSUFFICIENT_BALANCE))
    (asserts! (>= (get cash state) amount) (err ERR_INSUFFICIENT_CASH))

    (try! (as-contract (contract-call? token transfer amount tx-sender lp none)))

    (map-set lp-shares {lp: lp, market-id: market-id} {shares: (- eff amount)})
    (map-set user-product-snapshot {lp: lp, market-id: market-id} {product: current-product})
    (map-set pool-state {market-id: market-id}
      (merge state {
        total-supplied: (- (get total-supplied state) amount),
        cash: (- (get cash state) amount)
      })
    )
    (print {
      event: "pool-withdrawal",
      lp: lp,
      market-id: market-id,
      amount: amount,
      shares: (- eff amount),
      total-supplied: (- (get total-supplied state) amount),
      cash: (- (get cash state) amount)
    })
    (ok (- eff amount))
  )
)

;; ============================================
;; Cash management (vault-only): borrow-out / repay-in
;; ============================================

;; Quote the borrow fee for an amount on a market (for the vault / UI to show the
;; net-received amount). borrowed = debt principal; disbursed = what the borrower
;; actually receives = borrowed - fee.
(define-read-only (get-borrow-fee-quote (market-id uint) (amount uint))
  (let (
      (fc (contract-call? .sse-finance-market-registry-v1 get-fee-config market-id))
      (fee-bps (match fc cfg (get borrow-fee-bps cfg) u0))
      (lp-share-bps (match fc cfg (get borrow-fee-lp-share-bps cfg) u0))
    )
    (let (
        (fee (/ (* amount fee-bps) BPS_DENOM))
      )
      (let ((lp-part (/ (* fee lp-share-bps) BPS_DENOM)))
        {
          borrowed: amount,
          fee: fee,
          lp-fee: lp-part,
          protocol-fee: (- fee lp-part),
          disbursed: (- amount fee)
        }
      )
    )
  )
)

;; Lend cash out to a recipient, charging the one-time borrow fee (netted from the
;; disbursed amount). Vault-only. `amount` is the debt principal; the recipient
;; receives `amount - fee`. Reverts if amount > cash.
(define-public (borrow-out (market-id uint) (token <sse-finance-sip-010-trait>) (recipient principal) (amount uint))
  (let (
      (expected (market-borrow-token market-id))
      (fc (contract-call? .sse-finance-market-registry-v1 get-fee-config market-id))
      (state (get-state market-id))
    )
    (asserts! (is-authorized-caller) (err ERR_UNAUTHORIZED))
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    (asserts! (is-some expected) (err ERR_MARKET_NOT_FOUND))
    (asserts! (is-eq (contract-of token) (unwrap-panic expected)) (err ERR_TOKEN_MISMATCH))
    (asserts! (>= (get cash state) amount) (err ERR_INSUFFICIENT_CASH))

    (let (
        (fee-bps (match fc cfg (get borrow-fee-bps cfg) u0))
        (lp-share-bps (match fc cfg (get borrow-fee-lp-share-bps cfg) u0))
        (supplied (get total-supplied state))
        (current-product (get-current-product market-id))
      )
      (let (
          (fee (/ (* amount fee-bps) BPS_DENOM))
        )
        (let (
            (lp-part (/ (* fee lp-share-bps) BPS_DENOM))
          )
          (let (
              (protocol-part (- fee lp-part))
              (disbursed (- amount fee))
            )
            ;; transfer the net amount to the borrower
            (try! (as-contract (contract-call? token transfer disbursed tx-sender recipient none)))

            ;; record the protocol fee in the registry's treasury-accrued
            (if (> protocol-part u0)
              (try! (contract-call? .sse-finance-market-registry-v1 accrue-fee market-id (contract-of token) protocol-part))
              u0
            )

            ;; credit the LP fee share pro-rata via a product bump (gain mirror of
            ;; the liquidation-loss shrink)
            (if (and (> lp-part u0) (> supplied u0))
              (map-set pool-product {market-id: market-id}
                {product: (/ (* current-product (+ supplied lp-part)) supplied)}
              )
              false
            )

            (map-set pool-state {market-id: market-id}
              (merge state {
                total-borrows: (+ (get total-borrows state) amount),
                cash: (- (get cash state) disbursed),
                total-supplied: (+ supplied lp-part)
              })
            )
            (print {
              event: "pool-borrow-out",
              market-id: market-id,
              recipient: recipient,
              borrowed: amount,
              disbursed: disbursed,
              fee: fee,
              protocol-fee: protocol-part,
              lp-fee: lp-part
            })
            (ok disbursed)
          )
        )
      )
    )
  )
)

;; Return borrowed cash to the pool. Vault-only. Pulls token from tx-sender (the
;; repaying borrower) and reduces total-borrows (saturating at 0).
(define-public (repay-in (market-id uint) (token <sse-finance-sip-010-trait>) (amount uint))
  (let (
      (expected (market-borrow-token market-id))
      (state (get-state market-id))
    )
    (asserts! (is-authorized-caller) (err ERR_UNAUTHORIZED))
    (asserts! (> amount u0) (err ERR_INVALID_AMOUNT))
    (asserts! (is-some expected) (err ERR_MARKET_NOT_FOUND))
    (asserts! (is-eq (contract-of token) (unwrap-panic expected)) (err ERR_TOKEN_MISMATCH))

    (try! (contract-call? token transfer amount tx-sender (as-contract tx-sender) none))

    (let ((borrows (get total-borrows state)))
      (map-set pool-state {market-id: market-id}
        (merge state {
          total-borrows: (if (>= borrows amount) (- borrows amount) u0),
          cash: (+ (get cash state) amount)
        })
      )
    )
    (print {event: "pool-repay-in", market-id: market-id, amount: amount})
    (ok amount)
  )
)

;; ============================================
;; Liquidation distribution (authorized: the liquidation engine)
;; ============================================
;; Socialise a liquidation: shrink the pool product by the offset, credit seized
;; collateral to LPs via reward-per-token, and reduce total-supplied/total-borrows
;; by the offset. cash is unchanged (the offset is the principal that left on
;; borrow and is now settled in collateral instead of cash).
(define-public (distribute-liquidation-reward
    (market-id uint)
    (asset principal)
    (debt-offset uint)
    (collateral-earned uint)
  )
  (let (
      (state (get-state market-id))
      (supplied (get total-supplied state))
      (current-product (get-current-product market-id))
      (current-rpt (get-current-rpt market-id asset))
    )
    (asserts! (is-authorized-caller) (err ERR_UNAUTHORIZED))
    (asserts! (> supplied u0) (err ERR_EMPTY_POOL))
    (asserts! (>= supplied debt-offset) (err ERR_INSUFFICIENT_BALANCE))

    (map-set pool-product {market-id: market-id}
      {product: (/ (* current-product (- supplied debt-offset)) supplied)}
    )
    (map-set cumulative-reward-per-token {market-id: market-id, asset: asset}
      {reward-per-token: (+ current-rpt (/ (* collateral-earned SCALE_FACTOR) supplied))}
    )
    (let ((borrows (get total-borrows state)))
      (map-set pool-state {market-id: market-id}
        (merge state {
          total-supplied: (- supplied debt-offset),
          total-borrows: (if (>= borrows debt-offset) (- borrows debt-offset) u0)
        })
      )
    )
    (print {
      event: "liquidation-reward-distributed",
      market-id: market-id,
      asset: asset,
      debt-offset: debt-offset,
      collateral-earned: collateral-earned
    })
    (ok true)
  )
)

;; ============================================
;; Claim seized-collateral rewards (LP yield path)
;; ============================================
(define-public (claim-collateral-reward
    (market-id uint)
    (asset principal)
    (collateral-token <sse-finance-sip-010-trait>)
  )
  (let (
      (raw (get-raw-shares tx-sender market-id))
      (current-rpt (get-current-rpt market-id asset))
      (user-rpt (get-user-rpt-snapshot tx-sender market-id asset))
      (existing-pending (get-pending-reward tx-sender market-id asset))
      (new-reward (if (> current-rpt user-rpt) (/ (* raw (- current-rpt user-rpt)) SCALE_FACTOR) u0))
      (total-claimable (+ existing-pending new-reward))
      (lp tx-sender)
    )
    (asserts! (is-eq (contract-of collateral-token) asset) (err ERR_TOKEN_MISMATCH))
    (asserts! (> total-claimable u0) (err ERR_NO_REWARD))

    (try! (as-contract (contract-call? collateral-token transfer total-claimable tx-sender lp none)))

    (map-set pending-collateral-rewards {lp: lp, market-id: market-id, asset: asset} {amount: u0})
    (map-set user-reward-snapshot {lp: lp, market-id: market-id, asset: asset} {reward-per-token: current-rpt})
    (print {
      event: "collateral-reward-claimed",
      lp: lp,
      market-id: market-id,
      asset: asset,
      amount: total-claimable
    })
    (ok total-claimable)
  )
)
