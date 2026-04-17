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

## Validation Checklist

After changes:
- run contract/tests (`npm test` at repo root)
- ensure stablecoin-scoped vault flows still pass existing tests
- ensure docs and frontend contract names remain aligned

## Delivery Expectations

- Explain user-visible flow impacts, not just code diffs.
- Prefer minimal, backward-compatible changes unless breaking change is explicitly requested.
- If behavior changes, update docs in the same task.
