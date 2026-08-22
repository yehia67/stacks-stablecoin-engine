# SSE Product Boundaries

> Read this before touching product requirements, architecture, or scope for any SSE work.
> These are separate product lines with separate hypotheses and separate risk profiles.
> **Do not port a requirement, contract, or design decision across lines without an explicit
> architecture decision saying so.**

## SSE Core (protocol)

**Status:** Shipped / live on Stacks mainnet (deployed 2026-05-17).

Modular overcollateralized-stablecoin protocol scaffold: creators register a stablecoin via
`stablecoin-factory-v4`, link a SIP-010 token, users open vaults (`multi-asset-vault-engine-v8`)
and deposit collateral, mint/repay/withdraw, liquidations flow through
`liquidation-engine-v8` + `stability-pool-v7`, prices come from DIA oracles behind
`oracle-trait`. Governed by Asigna multisig + 24h timelock (`sse-governance-v1` /
`sse-timelock-v1`); deployer key has zero admin power. Also ships an xReserve/CCTP-style
cross-chain bridge (`bridge-registry-v4`, `xreserve-adapter-v5`) — contract-complete, **zero
frontend**.

Full detail: `docs/SSE_CONTEXT.md`, `docs/roadmap.md`.

Rule: changes to SSE Core are security-critical (real custody, real mint/burn). Preserve
compatibility unless a breaking change is explicitly approved. Custodial issuance model
(engine mints to custodial wallet, not directly to end user) is a load-bearing invariant, not
a detail — see `docs/adl/user_flows.md` and CLAUDE.md deployment memory before changing mint
paths.

## Institutional Settlement Platform

**Status:** Active build (frontend + Supabase only).

Dashboard/UX layer for institutional settlement workflows — lives at `/institutions/[slug]`
and `/settlement` in `frontend/`. **Explicitly no smart-contract changes and no protocol
branding** — this is a demo-grade operational layer on top of existing SSE Core reads, backed
by Supabase, not new on-chain logic. 6-module program; building module #4, then #2, per current
plan.

Rule: if a requirement here seems to need a contract change, that's a signal it belongs in
SSE Core or a separate proposal — do not quietly add contract scope to this track.

## SSE Finance (lending market)

**Status:** Contracts implemented and simnet-tested — **not yet deployed to any
network**. All 8 contracts exist (`contracts/sse-finance-*.clar`: vault, pool,
market-registry, collateral-matrix, liquidation, timelock, both traits) with a
matching 9-file test suite, 104/104 tests passing as of 2026-08-22. No entry in
`sse.config.json` or `settings/{Devnet,Testnet,Mainnet}.toml` yet — deployment
hasn't started. (Corrected 2026-08-22 — the architecture doc's own status line
said "no implementation yet," which had gone stale against the actual code.)

Different hypothesis from SSE Core: interest-free, Liquity-style peer-to-pool lending. A
borrower locks collateral and borrows **pre-existing third-party stablecoins** (USDC, USDA)
supplied by liquidity providers — no minting, no burning, debt is a real transfer out of a
finite pool. Borrower pays a one-time fee only (no recurring interest, keeps 100% of collateral
yield); LP return is the liquidation discount. This inverts several SSE Core assumptions (mint
vs. transfer, infinite vs. finite liquidity, fee-based vs. discount-based lender economics) —
treat as a related but distinct protocol, not a mode of SSE Core.

Design docs already exist and are the source of truth: `docs/SSE-Finance-Architecture.md`,
`docs/SSE-Finance-Tasks.md`, `docs/sse-finance-onboarding-runbook.md`,
`docs/sse-finance-trait-imports.md`.

Rule: do not modify SSE Core contracts to accommodate SSE Finance until an architecture
decision explicitly approves shared contract surface.

## Confidential Transactions SDK

**Status:** Experimental / early exploration — **not implemented in this repository**.

Originated from institutional confidentiality needs surfaced during SSE work. A Stacks-native
proposal was explored and not pursued further; current direction under consideration is a
chain-independent institutional confidential-settlement design (Avalanche has been discussed
as one option). No design docs exist in this repo yet.

Rule: treat as fully separate from SSE Core and SSE Finance. Do not introduce
confidential-ledger/commitment assumptions into either unless a dedicated architecture
decision approves it. If/when this gets its own planning artifacts, give it its own
`_bmad-output/` subfolder rather than reusing SSE Core or SSE Finance PRDs.

## AI Compliance (retired)

**Status:** Removed, not on the active roadmap.

Compliance-engine UI/components were built then removed from the frontend
(`chore: remove compliance engine UI screens and components from frontend`). Do not resurrect
or reference when deriving current product requirements — if the code is still visible in
history, it's prior exploration, not a current direction.

---

## Cross-cutting rule

When proposing new protocol functionality, it must trace to one of: an approved product
requirement, direct customer evidence, a security requirement, or an accepted architecture
decision — not "might be useful," "nice abstraction," or "could support future integrations."
Same test applies before adding something to SSE Core vs. keeping it scoped to one track above.
