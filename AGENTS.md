# AGENTS.md

This file defines repository-level instructions for any coding agent working on SSE.

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
- `@frontend/stacks-stablecoin-engine/README.md`
- `@docs/SSE_CONTEXT.md`

For task-specific implementation details, load only what is needed (lazy-load, do not pre-read the whole repository).

## Required Context Load (Do This First)

Before proposing or implementing changes, read:
1. `README.md`
2. `frontend/stacks-stablecoin-engine/README.md`
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

## Frontend Standards

- Prefer contract-derived state over hardcoded protocol values.
- Use network/deployer/factory env config from constants.
- If transaction flow requires multiple calls, make the sequence explicit in UI copy.
- Reflect stablecoin symbol/name from on-chain registration data.
- **Never use silent fallback values (e.g. `|| "default"`) on decoded contract data.** If a required field is missing or has the wrong type after decoding, log the error with context (contract name, id, raw hex) and skip the entry. Fallbacks hide bugs and make on-chain data issues invisible to developers. Use `?? null` or `?? 0` only for legitimately optional fields.

### Token Decimal Handling (CRITICAL)

SSE deals with multiple tokens that have different decimal precisions (e.g. sBTC = 8 decimals, stablecoins = 6 decimals). Incorrect decimal handling silently produces catastrophically wrong values (e.g. letting users mint $2.6M stablecoins against $40K collateral). Follow these rules strictly:

1. **Two domains, never mix them.** All token math lives in one of two domains:
   - **Human-readable** — whole tokens as users see them (e.g. `0.5` BTC, `2000` EGPB, `$80,689` per BTC). Used for UI display, input fields, and preview calculations (health factor, max borrow).
   - **On-chain micro-units** — raw integers the smart contracts operate on (e.g. `50000000` satoshis, `2000000000` stablecoin micro-units). Used exclusively for contract call arguments.
   
   **Never multiply a value from one domain by a value from the other.** For example, `collateralUnits * oraclePriceHuman` mixes domains and produces a meaningless number.

2. **Preview/display math uses human-readable values only.**
   - Health factor: `calculateHealthFactor(collateralUsd, borrowHuman)`
   - Max borrow: `collateralUsd * 100 / minRatio`
   - Collateral USD value: `collateralHuman * oraclePricePerWholeToken`
   
   Oracle prices from `useDiaOraclePrices` are already in human-readable USD (raw price ÷ 1e8). Collateral amounts from user input are already human-readable.

3. **Convert to on-chain units only at the contract call boundary.**
   - Use `toSmallestUnits(humanAmount, decimals)` right before passing to contract functions.
   - Use `toHumanReadable(rawUnits, decimals)` or `formatTokenAmount(rawUnits, decimals)` immediately when reading contract data for display.
   - Percentage buttons that fill inputs from on-chain values (e.g. `debtShare`, `userDeposit`) must convert via `toHumanReadable()` before setting the input state.

4. **Never assume all tokens share the same decimal precision.** Always use `getCollateralDecimals(asset)` or `useTokenDecimals(contract)` — never hardcode `6` or `8`.

5. **Verify with a sanity check.** After writing any amount conversion, mentally trace a concrete example (e.g. 0.5 BTC at $80K, 150% ratio → max ~26,666 stablecoins). If the numbers are off by orders of magnitude, you mixed domains.

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
