# SSE Finance — Implementation Task List

Each task is self-contained (suitable as a standalone GitHub issue): a description, what it **depends
on** (by name), and **acceptance criteria**. Derived from
[`SSE-Finance-Architecture.md`](./SSE-Finance-Architecture.md). Tasks marked **[Phase 2/3]** are
deferred.

> **Deployment model:** SSE Finance is a **clean, fresh mainnet deployment.** All SSE Finance
> contracts are deployed new — there is **no integration with currently-deployed mainnet contracts**.
> Where a task says "reuse," it means **reuse the source/patterns** of existing SSE contracts (copy
> and adapt the code), not call or depend on a live deployment.

> **Economic model:** interest-free (Liquity-style). Debt is flat principal, the borrower keeps
> collateral yield, and the LP's return is the **liquidation discount**. No interest-rate model, no
> index, no accrual. Protocol revenue = a **one-time borrow fee** + a **cut of the liquidation
> penalty**.

---

## Foundations

### Confirm reusable traits
Pin the trait definitions the SSE Finance contracts will `use-trait`: the oracle trait (`get-price`)
and the standard SIP-010 trait. Include fresh copies of these traits in the SSE Finance deployment so
nothing points at externally-deployed trait contracts.
**Depends on:** nothing.
**Acceptance criteria:**
- A deployable trait set exists in the SSE Finance package (oracle trait + SIP-010 trait reference).
- Borrow tokens and collateral are typed as **plain SIP-010** (no mint/burn trait — SSE Finance never
  mints).
- A short note records which trait each new contract imports.

### Build a reusable USD-pegged price oracle (one contract, all stablecoins)
Implement `price-oracle-pegged-usd-v1` exposing the oracle trait: a governance-settable ≈ $1 price
with a staleness/deviation guard, reusable by **every** USD stablecoin market (USDC, USDA, USDCX, …).
Allow a per-token live feed oracle to be attached instead, per market.
**Depends on:** Confirm reusable traits.
**Acceptance criteria:**
- `get-price` returns the configured peg price and a freshness/last-update signal.
- The peg value is updatable only by governance.
- A single deployed instance can serve multiple stablecoin markets (no per-token oracle required).
- A market can point at a different oracle principal without redeploying anything.

---

## Registry layer

### Build the market registry with fee config (the stablecoin import mechanism)
Implement `sse-finance-market-registry-v1`: a `markets` map (borrow-token, oracle, borrow-cap,
enabled, paused), a **separate `fee-config` map** (`borrow-fee-bps`, `borrow-fee-lp-share-bps`,
`protocol-liq-share-bps`, optional `early-repay-fee-bps`), plus `treasury` and `treasury-accrued`.
Expose governance-gated `register-market` / `update-market` / `set-market-paused` — the single
standard path by which any SIP-010 stablecoin becomes borrowable. Model the structure on
`collateral-registry-v6` (enumerable list + per-key config + governance gate + authorized-caller map
for the vault), deployed fresh.
**Depends on:** Confirm reusable traits.
**Acceptance criteria:**
- A new market can be registered and read back; an enumerable market list works.
- Fees live in their own map, independently updatable from market wiring.
- Every fee setter rejects values above hard caps (`MAX-BORROW-FEE=200`,
  `MAX-BORROW-FEE-LP-SHARE=10000`, `MAX-PROTOCOL-LIQ-SHARE=5000`, `MAX-EARLY-REPAY=200` bps).
- No reserve-factor field exists (interest-free).
- All mutating functions are governance-gated.
- `borrow-fee-lp-share-bps` (the LP baseline-incentive dial) is settable; its launch value is an
  explicit decision recorded before deployment.

### Build the collateral↔market risk config ("the matrix")
**What this is:** a config table answering, for each `{market, collateral}` pair — *is this collateral
accepted to borrow this stablecoin, and at what risk parameters?* Parameters per pair:
`min-collateral-ratio`, `liquidation-ratio`, `liquidation-penalty`, `debt-floor`, per-market
`debt-ceiling`. The vault reads these to run its health check.

**Concrete example (the value this produces — a populated risk table):**

| Market (borrow) | Collateral | min-ratio | liq-ratio | penalty |
|---|---|---|---|---|
| USDC | sBTC | 150% | 120% | 10% |
| USDC | vGLD | 130% | 115% | 8% |
| USDA | sBTC | 160% | 125% | 10% |

One row = "USDC accepts sBTC at 150%/120%"; no row = not accepted.

Build this fresh by **copying the `collateral-registry-v6` config shape** (its
`stablecoin-collateral-configs` already holds exactly these fields) into the SSE Finance deployment,
keyed `{market-id, collateral-asset}`. Wire the mechanism only; rows are populated per stablecoin
during onboarding.
**Depends on:** Build the market registry (defines `market-id`).
**Acceptance criteria:**
- A `{market, collateral}` row can be written and read with all five risk params.
- The vault can query "is this pair enabled, and its ratios" in one call.
- Absence of a row means the pair is not borrowable.
- The config is governance-gated.

---

## Pool (core engine)

### Pool: LP supply/withdraw + share accounting
Implement `sse-finance-pool-v1` deposit/withdraw with share minting; track `total-supplied`,
`total-borrows`, `cash`. Copy the `product`/snapshot loss accounting and `cumulative-reward-per-token`
collateral-distribution engine from `stability-pool-v7` source (no supply-index — interest-free).
**Depends on:** Build the market registry.
**Acceptance criteria:**
- LP can supply and receive shares; withdraw burns shares for the underlying.
- **Withdrawals are capped at available `cash`** on-chain (the bank-run guard) — verified by a test.
- `cumulative-reward-per-token` collateral claims work for LPs (this is the LP yield path).
- Pool tracks `total-supplied`, `total-borrows`, `cash` consistently across supply/withdraw.

### Pool: borrow/repay cash management + borrow fee
Implement `borrow-out` / `repay-in`, callable **only by the vault contract**: move `cash`, update
`total-borrows`, and on `borrow-out` charge the one-time borrow fee, split between `treasury-accrued`
(protocol) and the LP share per `borrow-fee-lp-share-bps`.
**Depends on:** Pool: LP supply/withdraw.
**Acceptance criteria:**
- `borrow-out` transfers borrow-token to the borrower and reverts if `amount > cash`.
- `repay-in` returns borrow-token to the pool and reduces `total-borrows` by exactly the amount.
- The borrow fee is split correctly between protocol and LPs and recorded in `treasury-accrued`.
- Both functions reject callers other than the vault.
- No interest/index logic exists; `total-borrows` only changes on borrow/repay/liquidate.
- The fee-charging convention (added-to-debt vs netted-from-disbursed) is documented and matches the
  vault.

---

## Vault (borrower-facing)

### Vault: collateral deposit/withdraw
Implement `sse-finance-vault-v1` collateral custody and position state. Copy the multi-collateral
vault shape and `calculate-position-health-factor` from `multi-asset-vault-engine-v8` source, keyed by
`{owner, market-id}`. Support multi-asset positions and a health-checked withdraw.
**Depends on:** Build the market registry, Build the collateral↔market risk config.
**Acceptance criteria:**
- Borrower can deposit a supported collateral; balance tracked per `{owner, market, asset}`.
- Withdraw succeeds only if the remaining position stays at/above the min ratio (when debt > 0).
- Oracle is validated against the registered principal before pricing; mismatch fails closed.
- Multi-asset positions are enumerable.

### Vault: borrow & repay
Wire `borrow` (health + cap + debt-floor checks → apply borrow fee → pool `borrow-out` → increase
flat principal) and `repay` (owed = flat principal → pool `repay-in` → reduce principal).
**Depends on:** Pool: borrow/repay, Vault: collateral deposit/withdraw.
**Acceptance criteria:**
- Borrow reverts if it would push the position below the min ratio, over the borrow cap, or below the
  debt floor.
- Debt recorded is **flat principal** — it never changes except on borrow/repay/liquidate (verified by
  a time-advance test showing zero growth).
- Repay reduces principal by the repaid amount and pulls borrow-token to the pool.
- The one-time borrow fee is applied exactly once, at draw.

---

## Liquidation

### Liquidation engine
Implement `sse-finance-liquidation-v1`: read health vs threshold, compute
`debt-to-offset = min(vaultDebt, poolCapacity)` and `collateral-to-seize = base + penalty`, settle via
the vault's `liquidate-position`, then notify the pool to distribute.
**Depends on:** Vault: borrow & repay, Pool: borrow/repay, Build the reusable USD-pegged oracle.
**Liquidation mechanism — pick per market, don't hardcode one:**
- **(A) Pro-rata in-kind** — seized collateral auto-distributed to LPs via reward-per-token. Mirrors
  `stability-pool-v7`, no keeper, transparent. **Default for launch.** This discount is the LP's whole
  return — get it right first.
- **(B) LP-restricted auction** — better capital efficiency for illiquid collateral; needs an auction
  module. **[Phase 3]**, opt-in per market.
- **(C) Claim-based rights** — middle ground; skip unless a concrete need appears.
**Acceptance criteria:**
- Liquidation reverts when the position is healthy.
- An unhealthy position is partially/fully offset using pool funds; borrower debt and collateral drop
  by the settled amounts.
- The liquidation **penalty** is split by `protocol-liq-share-bps` into `treasury-accrued`; the
  remainder is distributed to LPs (Mechanism A).
- Trigger is permissionless; an optional fixed trigger-reward is configurable.

---

## Governance, treasury & safety

### Treasury fee sweep
Implement `sweep-fees(market, token)` moving `treasury-accrued` to the governance-set `treasury`.
**Depends on:** Build the market registry, Pool: borrow/repay.
**Acceptance criteria:**
- Anyone can call `sweep-fees`; funds can only ever land at the `treasury` principal.
- After sweep, `treasury-accrued` for that `{market, token}` is zero.
- `treasury` is set only by governance.

### Timelock + governance wiring
Deploy a **fresh** SSE Finance timelock (copy `sse-timelock-v1` source) covering the admin surface
(`set-fee-config`, `set-treasury`, market CRUD, pause, risk-param changes). Point every SSE Finance
contract's governance var at it.
**Depends on:** Build the market registry, Pool: borrow/repay, Vault: borrow & repay, Liquidation
engine, Treasury fee sweep.
**Acceptance criteria:**
- All admin functions across the SSE Finance contracts are callable only via the timelock.
- **Pause** is on the no-delay emergency path; un-pause and any risk-loosening change use the full
  delay.
- The guardian can cancel a queued action.
- A minimum-delay floor cannot be bypassed.

### Depeg circuit-breaker
Add a per-market guard that pauses **new borrows** (repay/withdraw still allowed) when the borrow
token's price deviates beyond a configured band from $1.
**Depends on:** Build the reusable USD-pegged oracle, Build the market registry, Timelock + governance
wiring.
**Acceptance criteria:**
- When price is outside the band, new borrows revert; repay and withdraw still succeed.
- The band is per-market and governance-set.
- One market's breaker tripping does not affect other markets (isolation verified).

---

## Integration: standard stablecoin onboarding

### Standard "add a borrowable stablecoin" process
The one repeatable, governance-only flow to onboard any SIP-010 stablecoin — no new contracts, no
redeploy: (1) validate the token is a conformant SIP-010; (2) `register-market(token, oracle, cap,
fee-config)`; (3) set the token's depeg band; (4) enable its collateral↔market rows. Ship a single
onboarding **script/runbook**.
**Depends on:** Build the reusable USD-pegged oracle, Build the market registry, Build the
collateral↔market risk config, Pool: borrow/repay, Vault: borrow & repay, Liquidation engine,
Timelock + governance wiring, Depeg circuit-breaker.
**Acceptance criteria:**
- Onboarding a brand-new stablecoin requires **only governance calls + config rows**, zero code
  changes and zero redeploys.
- After onboarding, the new market supports the full borrow → repay → liquidate lifecycle in tests.
- Each market is isolated (own pool, cap, breaker).
- The runbook is followed end-to-end for one example token (USDC) as proof.

---

## Testing & deployment

### Contract test suite
Vitest/clarinet coverage for the full system.
**Depends on:** all core contracts (oracle, registry, matrix, pool, vault, liquidation, treasury,
timelock, breaker).
**Acceptance criteria:**
- Tests cover: health-factor math; flat-debt borrow/repay showing **zero debt growth over time**;
  withdrawal cap under high utilization; liquidation split (LP vs protocol); borrow-fee split; fee
  caps rejecting over-max values; oracle mismatch failing closed; depeg breaker; onboarding flow.
- An invariant/property test confirms `cash + total-borrows` stays consistent with `total-supplied`
  (minus swept fees) across random interaction sequences.
- Suite passes in CI.

### Deployment & bootstrap (fresh mainnet)
Deploy all SSE Finance contracts clean, bootstrap governance (point each contract's governance var at
the timelock, then lock bootstrap), authorize the vault as a caller in the registry and pool, then run
the onboarding flow for the first USDC market + sBTC/vGLD collateral + launch fee defaults (borrow fee
0.5%, liq-share 20%, chosen LP borrow-fee share).
**Depends on:** Standard stablecoin onboarding process, Contract test suite.
**Acceptance criteria:**
- All contracts deployed fresh on mainnet with versioned names.
- Governance bootstrapped and locked; all admin paths go through the timelock.
- Authorized-caller wiring verified before any user funds are accepted.
- A real end-to-end borrow → repay and a liquidation are demonstrated on mainnet.

---

## Backend services

### Event indexer / analytics
Read pool/vault/liquidation `print` events into Supabase for dashboards (TVL, utilization, LP claims,
protocol revenue, borrow-fee income).
**Depends on:** core contracts emitting events (pool, vault, liquidation).
**Acceptance criteria:**
- Events are ingested and queryable; dashboards show TVL, utilization, realized LP liquidation yield,
  and protocol revenue.
- No APY math (interest-free) — utilization + realized yield instead.
- Indexer lag does not affect protocol correctness.

### Health monitor / liquidation submitter
Off-chain watcher that submits `liquidate` for unhealthy positions.
**Depends on:** Liquidation engine, Deployment & bootstrap.
**Acceptance criteria:**
- The watcher detects positions below the liquidation threshold and submits liquidations.
- It is a convenience only — liquidation works without it (permissionless trigger).
- An optional fixed trigger-reward makes running it incentive-compatible.

---

## Frontend

### Markets list page
`app/finance/markets`: per-market borrow fee, utilization, caps, paused state, realized LP liquidation
yield (no APY).
**Depends on:** Build the market registry, Deployment & bootstrap.
**Acceptance criteria:**
- All registered markets render with live config and state.
- Paused markets are clearly indicated.
- Reuses the `/api/stacks` proxy, oracle libs, and wallet provider.

### LP supply/withdraw page
`app/finance/supply/[market]`: supply, withdraw (showing the available-liquidity cap), claim
seized-collateral rewards, show any borrow-fee LP share earned.
**Depends on:** Pool: LP supply/withdraw, Deployment & bootstrap.
**Acceptance criteria:**
- LP can supply, withdraw (blocked beyond available cash with a clear message), and claim rewards.
- Utilization and available liquidity are shown prominently.
- Copy makes clear LP yield is liquidation-driven (lumpy), not a steady APY.

### Borrow page
`app/finance/borrow/[market]`: pick collateral, deposit, borrow, repay, withdraw, live health factor,
one-time borrow fee + net-received amount.
**Depends on:** Vault: borrow & repay, Deployment & bootstrap.
**Acceptance criteria:**
- Full borrow lifecycle works from the UI with a live health factor.
- The one-time borrow fee and net amount received are shown before confirming.
- Copy makes clear there is **no recurring interest**.

### Liquidations page
`app/finance/liquidations`: at-risk positions + LP-claimable seized collateral.
**Depends on:** Liquidation engine, Deployment & bootstrap.
**Acceptance criteria:**
- At-risk positions are listed with health factors.
- LPs can view and claim their seized-collateral rewards.

### Admin governance UI
Extend the existing `governance/` UI with market CRUD, fee-config (borrow fee, LP share, liquidation
share), treasury, pause, and the onboarding flow — all routed through the timelock queue/execute flow.
**Depends on:** Timelock + governance wiring, Standard stablecoin onboarding process, Deployment &
bootstrap.
**Acceptance criteria:**
- Admins can queue/execute every governed action through the timelock from the UI.
- Fee values over the hard caps are rejected by the UI before submission.
- The stablecoin onboarding flow is runnable from the UI.

---

## [Phase 2] follow-ups
- Tokenized bond / treasury collateral (add via registry + new oracles).
- **Collateral-yield pass-through** (coupon-claim) so borrowers keep bond yield — never the pool.
- USDA borrowing market (run the onboarding process again — no new code).

## [Phase 3] follow-ups
- Institutional / permissioned LP pools (KYC-gated supply via the institutional layer).
- Liquidation **Mechanism B** (LP-restricted auction) for illiquid collateral, opt-in per market.
- Optional fixed-term products (explicit one-time term fee — still no accruing interest);
  treasury-grade reporting.
