# SSE Finance — Standard stablecoin onboarding runbook

The one repeatable, **governance-only** flow to make any SIP-010 stablecoin
borrowable. **No new contracts, no redeploy** — onboarding is purely
`register-market` + config rows. The shared `pool` / `vault` / `liquidation`
contracts are multi-market (keyed by `market-id`), so each onboarded stablecoin
gets its own isolated pool accounting, borrow cap, and depeg breaker.

Proof: `tests/sse-finance-onboarding.test.ts` runs this flow end-to-end for an
example token and exercises the full borrow → repay → liquidate lifecycle plus
two-market isolation.

---

## One-time prerequisites (deploy bootstrap, NOT per stablecoin)

Done once when the package is deployed (see the deployment task). After this,
every contract's `governance` var points at `sse-finance-timelock-v1`:

1. `pool.set-authorized-caller(vault, true)` and `pool.set-authorized-caller(liquidation, true)`
2. `registry.set-authorized-caller(pool, true)` and `registry.set-authorized-caller(liquidation, true)`
3. `vault.set-liquidator(liquidation)`
4. Point every contract's governance at the timelock (`bootstrap-set-governance`), then `lock-bootstrap`.

These authorize the cash/fee/settlement paths; they are **not** repeated per
stablecoin.

---

## Per-stablecoin steps (all via the timelock)

Generate the exact queue hashes + execute calls with:

```
node scripts/onboard-stablecoin.cjs path/to/onboarding.json
```

### 0. Validate the token is a conformant SIP-010
Off-chain: confirm the token implements `transfer / get-name / get-symbol /
get-decimals / get-balance / get-total-supply / get-token-uri` (the
`sse-finance-sip-010-trait` surface — **plain SIP-010, no mint/burn**). SSE
Finance never mints the borrow token; the pool moves it from LP-supplied balance.

### 1. Register the market
`registry.register-market(borrow-token, oracle, borrow-cap, borrow-fee-bps,
borrow-fee-lp-share-bps, protocol-liq-share-bps, early-repay-fee-bps)`
→ via `execute-reg-register-market`. **The market-id is assigned on execution**
— read it from the `(ok uN)` result before continuing.

Launch fee defaults: borrow fee `50` (0.5%), LP share `0` (liquidation-only —
the recorded launch decision), protocol liq share `2000` (20% of penalty), early
repay `0`.

### 2. Set the depeg band
`registry.set-depeg-band(market-id, band-bps)` → `execute-reg-set-depeg-band`.
Outside this band from $1, **new borrows pause** (repay/withdraw stay open).
Suggested launch: `200` (2%).

### 3. Enable collateral rows + oracles
For each accepted collateral:
- `matrix.add-collateral-to-market(market-id, collateral, min-cr, liq-r, liq-pen, debt-floor, debt-ceiling)` → `execute-mtx-add`
- `matrix.set-collateral-oracle(collateral, oracle)` → `execute-mtx-set-oracle`
  (global per-asset; skip if already set from a previous market).

Absence of a row = that collateral is **not** borrowable for the market.

---

## Timelock mechanics (per action)

1. Admin computes the action hash (`scripts/onboard-stablecoin.cjs` does this;
   scheme = `sha256(consensus-buff({t,f}) ++ consensus-buff(args))`).
2. Admin `queue(id, hash, target, fn, eta)` with `eta >= height + delay` (144 blocks).
3. After `eta`, anyone calls the matching `execute-*` with the concrete args; it
   recomputes the hash, checks queued+ready, and performs the call.
4. The guardian (or admin) may `cancel(id)` any time before execution.

Because step 1's market-id is only known after execution, onboarding is two
phases: queue+execute the registration, read the id, then queue+execute the
phase-2 actions (band + collateral rows) with that id.

---

## Isolation guarantees

Each market is independent: its own `pool-state` (supply/borrows/cash), its own
`borrow-cap`, its own `depeg-bands` entry, and its own collateral rows. A breaker
tripping or a cap filling on one market does not affect another — verified in the
onboarding and breaker test suites.

## Adding a second stablecoin later (e.g. USDA)

Repeat steps 0–3 with the new token. **Zero new code, zero redeploy** — only
governance calls and config rows.
