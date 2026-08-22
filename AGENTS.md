# AGENTS.md

This file defines repository-level instructions for any coding agent working on SSE.

<!-- bmad:context -->
<!-- Verified 2026-08-22 against 1dccf17. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## SSE (Stacks Stablecoin Engine)

Overcollateralized-stablecoin infrastructure on Stacks. Root = Clarity contracts + vitest tests (`npm test`, `npm run deploy`). `frontend/` is a separate Next.js app with its own toolchain and its own `AGENTS.md`.

## Where things are

- Frontend-specific conventions, decimal handling, dev pitfalls: `frontend/AGENTS.md`
- Product-line boundaries (SSE Core / Institutional Platform / SSE Finance / Confidential SDK): `docs/product/PRODUCT-LINES.md`
- sBTC-specific work (oracle, custody, decimals, upstream dual-stacking drift): dispatch to the `sbtc-integration` subagent (`.claude/agents/sbtc-integration.md`) rather than handling ad hoc — SSE Finance's Phase 1 loans depend on sBTC heavily.
- Local devnet health-flow checks, test/CI coverage for deployment readiness: dispatch to the `devnet-health` subagent (`.claude/agents/devnet-health.md`). It does not perform real testnet/mainnet deploys.
- Frontend screens/components/UX: dispatch to the `ui` subagent (`.claude/agents/ui.md`).
- Cross-stack wiring (contract ↔ hooks ↔ Supabase ↔ custodial signer ↔ RPC/infra): dispatch to the `fullstack-integration` subagent (`.claude/agents/fullstack-integration.md`).
- How these subagents hand off to each other: `.claude/agents/README.md`.

## Known pitfalls

- CI (`.github/workflows/ci.yml`) only lints/tests Clarity contracts (`clarinet check` + `npm test`) — it never builds, lints, or tests `frontend/`. Frontend changes are not CI-verified; check locally.

<!-- /bmad:context -->

## Rule System Notes

- This file is the project rule source for OpenCode.
- Additional instruction files are loaded via `opencode.json`.
- If an instruction references another file using `@path`, load it with the Read tool when needed.

## Mission

SSE (Stacks Stablecoin Engine) is an infrastructure layer for **overcollateralized stablecoins as a service** on Stacks.

Core product goal:
- enable stablecoin registration
- support per-stablecoin vault management
- enforce collateralized minting with health-factor checks
- provide reusable contracts and frontend flows for builders

## Product Boundaries (Read First)

SSE is not one product/backlog. Read `docs/product/PRODUCT-LINES.md` before proposing product
requirements or architecture — it defines separate tracks (SSE Core protocol, Institutional
Settlement Platform, SSE Finance, Confidential Transactions SDK) with different status and
different risk profiles. Rules:

1. **This is a brownfield project.** Never redesign existing shipped architecture without
   explicit approval. SSE Core is live on mainnet with real custody — treat it accordingly.
2. **Do not cross tracks.** Do not port a requirement, contract pattern, or design decision from
   one track (e.g. SSE Finance) into another (e.g. SSE Core) without an explicit architecture
   decision saying so. Institutional Settlement Platform work is frontend + Supabase only — no
   contract changes, no protocol branding.
3. **New protocol functionality needs a trace.** Every new piece of contract/protocol scope must
   trace to one of: an approved product requirement, direct customer evidence, a security
   requirement, or an accepted architecture decision. "Might be useful later" or "nice
   abstraction" is not sufficient — do not build speculative extension points without a concrete
   use case.
4. **Privileged roles are security-critical.** Any new privileged role/permission must document:
   what it can do, trust assumptions, blast radius if the key/role is compromised, and how it's
   revoked/recovered.
5. **Evidence has levels.** When product requirements cite user/customer input, distinguish
   hypothesis vs. customer request vs. validated requirement — don't treat "they liked the idea"
   as equivalent to "they asked us to build it."
6. **The AI compliance experiment is retired.** It was removed from the frontend and is not part
   of the active roadmap — do not resurrect it or use it as grounding for current requirements.

## Canonical Product Flow (Must Preserve)

SSE is an infrastructure framework for creating overcollateralized stablecoins. The expected end-user flow is:

1. Creator registers a stablecoin in the factory.
2. Creator configures accepted collateral assets and per-stablecoin risk parameters
   (min collateral ratio, liquidation ratio, liquidation penalty, stability fee, debt ceiling, debt floor).
3. Creator links/deploys token contract for that stablecoin registration.
4. User selects a registered stablecoin and opens a vault in that stablecoin namespace.
5. User can only deposit/mint against collateral configured for that selected stablecoin.

Agents must treat this as the canonical behavior for frontend and contract changes.
Do not introduce logic that bypasses stablecoin-scoped collateral configuration for newly registered stablecoins.

## External File Loading

CRITICAL: load these immediately at task start:
- `@README.md`
- `@frontend/README.md`
- `@docs/SSE_CONTEXT.md`

For task-specific implementation details, load only what is needed (lazy-load, do not pre-read the whole repository).

## Required Context Load (Do This First)

Before proposing or implementing changes, read:
1. `README.md`
2. `frontend/README.md`
3. `docs/SSE_CONTEXT.md`

Do not skip context loading. The codebase contains prototype and production-intent paths; assumptions must be validated from docs.

## Architectural Guardrails

- Keep factory registration and vault minting connected.
- Prefer stablecoin-scoped vault flows over global-token assumptions.
- Avoid hardcoded token symbols in frontend labels.
- Health factor shown in UI should come from contract reads whenever possible.
- Preserve backward compatibility unless a breaking change is explicitly requested.

## Smart Contract Standards

- Keep risk/math logic explicit and auditable.
- Keep error codes stable when possible.
- Add read-only methods that help frontend avoid off-chain guesswork.
- When adding traits or interfaces, update `Clarinet.toml` dependencies.
- **Smart contracts work in raw integer units. Never suggest adding "normalization" or decimal-adjustment logic to contracts.** Clarity has no floating point — all values are unsigned integers. The contracts are correct as-is. Decimal conversion between human-readable values and on-chain units is exclusively the frontend's responsibility. If a preview calculation looks wrong, the bug is in the frontend math, not the contract.

## Production-Ready Rules

- **NO MOCK CONTRACTS.** SSE is production-ready. Never create mock oracles, mock tokens, or mock adapters. Always integrate with real on-chain services.
- **Use real DIA oracles only.** The DIA oracle adapter must forward to the real DIA oracle contracts:
  - Testnet: `ST1S5ZGRZV5K4S9205RWPRTX9RGS9JV40KQMR4G1J.dia-oracle`
  - Mainnet: `SP1G48FZ4Y7JY8G2Z0N51QTCYGBQ6F4J43J77BQC0.dia-oracle`
- **No owner-settable price functions.** Oracle prices must come from external, trusted sources (DIA). Do not add `set-price` or `set-value` functions to production oracle contracts.
- **Simnet testing uses Clarinet mocks only.** For local testing, use Clarinet's built-in mocking capabilities, not deployed mock contracts.

## Deployment Rules

- **Stacks contracts cannot be redeployed.** If a deployed contract's logic changes, create a new version (e.g., `stability-pool-v3` → `stability-pool-v4`). Never assume you can redeploy an existing contract name.
- **Tightly-coupled contracts must be versioned together.** If contract A references contract B by name and B changes, A must also be re-versioned with updated references. Map ALL cross-references before versioning.
- **Unchanged contracts keep their existing version.** Only bump version for contracts with actual logic changes.
- **Single-command deployment.** All deployments use `npm run deploy` which reads `sse.config.json`, runs tests, generates the Clarinet deployment plan, deploys contracts, and runs bootstrap — in one command. Never create version-specific scripts or deployment plans.
- **`sse.config.json` is the single source of truth.** When versioning contracts, update `contracts`, `deployContracts`, and `contractCosts` in this file. Never hardcode contract names in scripts.
- **Deploy = clean state for new contracts only.** A new version (e.g., `multi-asset-vault-engine-v5`) has empty state. Shared contracts that are NOT re-versioned (e.g., `stablecoin-factory-v3`) retain their existing on-chain state including old test data. Account for this in the frontend by filtering stale data.

### Mandatory Deployment Workflow

**When the user asks to deploy, you MUST execute ALL steps below in order. This is not optional — skipping steps leaves the system in an inconsistent state.**

1. **Update `sse.config.json`** — set contract names, `deployContracts`, `contractCosts` for any new/changed contracts.
2. **Run `npm run deploy`** — this runs tests, deploys contracts, and bootstraps on-chain state. Wait for it to complete fully.
3. **Update frontend constants** — update `frontend/src/lib/constants.ts` to match the new contract names from `sse.config.json`. Verify with `cd frontend && npm run build`.
4. **Update documentation** — update ALL of these in the same task:
   - `README.md` (deployment section)
   - `docs/SSE_CONTEXT.md`
   - `docs/roadmap.md`
   with the new contract names, version info, and deployment timestamp.

**Steps 3 and 4 can run in parallel** (frontend update and docs update are independent). But NEVER skip them. A deployment without frontend and docs updates is an incomplete deployment.

## Testing Requirements

- **Every PR ships tests.** All new code must be covered: at minimum every
  happy-path scenario, plus some failure scenarios. Add unit tests **and**
  integration tests at the end of each PR — they are part of the PR, never
  deferred to a later task.
- **Contracts:** vitest + clarinet-sdk (simnet) under `tests/`. Run a single
  file with `./node_modules/.bin/vitest run tests/<file>.test.ts`. Do **not** use
  `npx vitest` — it fetches a wrong global version; root deps come from
  `npm install` at the repo root.
- **Cover every public and read-only function and every branch.** If a branch is
  unreachable by construction (e.g. a monotonic-time underflow guard), remove the
  dead guard with a comment explaining the invariant rather than leaving it
  untestable.
- **Measuring coverage:** `vitest run <file> -- --coverage` writes `lcov.info`.
  With `initBeforeEach`, lcov emits one `SF` block per test init (the first is an
  unexecuted baseline), so aggregate `DA`/`BRDA` across all blocks for a file
  before judging coverage.
- Pure trait files (`define-trait` only) have no executable lines — nothing to test.

## Validation Checklist

After changes:
- run contract/tests (`npm test` at repo root)
- ensure stablecoin-scoped vault flows still pass existing tests
- ensure docs and frontend contract names remain aligned

## Delivery Expectations

- Explain user-visible flow impacts, not just code diffs.
- Prefer minimal, backward-compatible changes unless breaking change is explicitly requested.
- If behavior changes, update docs in the same task.
