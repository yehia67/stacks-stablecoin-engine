---
id: SPEC-sse-finance
companions:
  - ../../../docs/SSE-Finance-Architecture.md
  - ../../../docs/SSE-Finance-Tasks.md
  - ../../../docs/sse-finance-onboarding-runbook.md
  - ../../../docs/sse-finance-trait-imports.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# SSE Finance

## Why

SSE's existing engine (`multi-asset-vault-engine-v8` + `stability-pool-v7` + `liquidation-engine-v8`, live on mainnet) is a mint-based CDP: a borrower locks collateral and the protocol mints a brand-new stablecoin as debt. SSE Finance is an opportunity to capture: invert that one axiom — replace "mint on demand" with "transfer from a finite LP-funded pool" — to become an interest-free, Liquity-style lending market where borrowers unlock liquidity from productive assets by borrowing *pre-existing* third-party stablecoins (USDC, USDA, …), keeping 100% of their collateral yield, while LPs earn the liquidation discount instead of interest. This reuses roughly 80% of SSE Core's proven patterns (health-factor math, multi-collateral vault shape, oracle dispatch, the stability-pool product/reward-per-token engine, governance/timelock) as source material, not as a live dependency — see Constraints. Status: all 8 contracts implemented and simnet-tested (104/104 tests passing across 9 test files, verified 2026-08-22) — **not yet deployed to any network** (see `docs/product/PRODUCT-LINES.md`).

## Capabilities

- **CAP-1**
  - **intent:** Borrower deposits multi-asset collateral (sBTC, vGLD at launch) into a market-scoped vault position.
  - **success:** Collateral tracked per `{owner, market, asset}`; multi-asset positions are enumerable.

- **CAP-2**
  - **intent:** Borrower borrows a registered third-party stablecoin (USDC at launch) against deposited collateral, with no protocol minting involved.
  - **success:** Borrow reverts if it would breach the minimum collateral ratio, the market borrow cap, or the debt floor; the one-time borrow fee is applied exactly once at draw; debt is recorded as flat principal.

- **CAP-3**
  - **intent:** Borrower repays debt and withdraws collateral, keeping 100% of collateral yield throughout.
  - **success:** Repay reduces principal by exactly the repaid amount with zero interest growth over time (provable with a time-advance test); withdraw succeeds only if the remaining position stays at or above the minimum ratio whenever debt > 0.

- **CAP-4**
  - **intent:** LP supplies and withdraws stablecoin liquidity to a market pool.
  - **success:** LP receives shares on supply and burns shares on withdraw; withdrawal is hard-capped at available on-chain `cash` (the bank-run guard), verified by a test.

- **CAP-5**
  - **intent:** LP earns yield solely from the liquidation discount (Mechanism A, pro-rata in-kind via reward-per-token), since the protocol charges no interest.
  - **success:** `cumulative-reward-per-token` collateral claims work for LPs; launch value of `borrow-fee-lp-share-bps` is `0` (pure liquidation-only — recorded launch decision, adjustable later without redeploy).

- **CAP-6**
  - **intent:** Anyone can permissionlessly trigger liquidation of an unhealthy position; the protocol grants no privileged liquidator role.
  - **success:** Liquidation reverts when the position is healthy; an unhealthy position is partially or fully offset using pool funds; the liquidation penalty splits between protocol (`protocol-liq-share-bps`) and LPs; an optional fixed trigger-reward is configurable.

- **CAP-7**
  - **intent:** Governance onboards any new SIP-010 stablecoin as a borrowable market with zero new contract code and zero redeploys.
  - **success:** `register-market` + depeg band + collateral rows via the timelock is sufficient; the full borrow → repay → liquidate lifecycle works post-onboarding in tests; each market stays isolated (own pool, cap, breaker).

- **CAP-8**
  - **intent:** Governance configures per-market fees (borrow fee, LP share of the borrow fee, protocol liquidation share) within hard, immutable caps, swept permissionlessly to treasury.
  - **success:** Every fee setter rejects values above `MAX-BORROW-FEE-BPS=200`, `MAX-BORROW-FEE-LP-SHARE-BPS=10000`, `MAX-PROTOCOL-LIQ-SHARE-BPS=5000`, `MAX-EARLY-REPAY-FEE-BPS=200`; `sweep-fees` is callable by anyone but funds can only ever land at the governance-set `treasury`.

- **CAP-9**
  - **intent:** The protocol automatically pauses new borrows on a market when the borrow-token price deviates beyond a governance-set depeg band from $1, while repay/withdraw stay open.
  - **success:** Price outside the band causes new borrows to revert while repay/withdraw still succeed; one market's breaker tripping does not affect another market (isolation verified).

- **CAP-10**
  - **intent:** All admin/governance actions (market CRUD, fee config, treasury, pause, risk params) route through a timelock with multisig propose/execute and guardian cancel, except `pause` which is on the no-delay emergency fast-path.
  - **success:** All admin functions are callable only via the timelock; the guardian can cancel a queued action before execution; the minimum-delay floor cannot be bypassed.

## Constraints

- **Fresh, clean-slate mainnet deployment.** SSE Finance contracts never call or depend on the currently-deployed SSE Core mainnet contracts — reuse means copying source/patterns, not integrating with a live deployment. Ships its own fresh trait copies (`sse-finance-oracle-trait`, `sse-finance-sip-010-trait`).
- **Interest-free by design.** Debt is flat principal — no interest-rate model, index, or time-based accrual, at any phase.
- **No minting or burning anywhere in SSE Finance.** Borrow tokens are plain SIP-010, moved by transfer only; collateral is custodied, never issued.
- **LP withdrawals hard-capped at available on-chain `cash`** (the bank-run guard) — enforced on-chain, no exception path.
- **Every fee parameter is governance-settable but bounded by hard, code-level `MAX-*` constants** that cannot be raised by governance — even a compromised multisig cannot exceed them.
- **Liquidation trigger stays permissionless.** No privileged liquidator role or required bot network; an off-chain health-monitor submitter is an optional convenience only, never protocol-critical.
- **Each market is fully isolated** — own `pool-state`, borrow cap, depeg band, collateral rows. One market's breaker tripping or cap filling must never affect another market.
- **New stablecoin onboarding requires zero new contract code and zero redeploys** — governance calls (`register-market` + config rows) only.

## Non-goals

- No interest-rate or accrual-index model, ever, including Phase 2/3 — any future term pricing is an explicit one-time fee, never accruing interest.
- Phase 1 excludes tokenized bond/treasury collateral + coupon-claim pass-through, the USDA market, institutional/KYC-gated LP pools, Mechanism B (auction) liquidation, and fixed-term products — all explicitly deferred to Phase 2/3.
- No dependency on or integration with the currently-deployed SSE Core mainnet contracts — SSE Finance is a fresh, self-contained deployment.
- No protocol-run liquidator bot network or keeper infrastructure — liquidation stays permissionless-triggered by design.

## Success signal

A real end-to-end borrow → repay and a liquidation are demonstrated on mainnet for the first market (USDC borrowing against sBTC/vGLD collateral), with governance bootstrapped and locked, all admin paths routed through the timelock, and authorized-caller wiring verified before any user funds are accepted. Secondary signal: onboarding a second stablecoin (e.g. USDA) requires zero new code — proven by repeating the onboarding runbook end-to-end.

## Assumptions

- Launch fee defaults from the onboarding runbook are the Phase 1 baseline: borrow fee 0.5% (50bps), LP borrow-fee share 0bps (liquidation-only), protocol liquidation share 20% (2000bps) of penalty, early-repay fee 0. Governance can retune below the hard caps without redeploy.
- The source docs' Phase 1 scope (sBTC + vGLD collateral, USDC borrowing, Mechanism A liquidation) is the actual build target for this spec — Phase 2/3 items are explicitly marked deferred throughout the source.

## Open Questions

- Source docs are silent on KYC/AML/compliance gating for Phase 1 — borrowers and LPs interact permissionlessly with a real third-party stablecoin (USDC). Institutional/KYC-gated pools are explicitly deferred to Phase 3. Is permissionless Phase 1 access acceptable, or does real-stablecoin lending trigger a compliance requirement before mainnet launch?
- No external smart-contract security audit is named as a gate in the deployment task, even though SSE Finance custodies real third-party LP funds (unlike SSE Core, where mint capacity is not itself an asset at risk). Should an audit be a hard prerequisite before mainnet deployment, and if so against which contracts and by whom?
