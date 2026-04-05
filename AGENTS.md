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

## Frontend Standards

- Prefer contract-derived state over hardcoded protocol values.
- Use network/deployer/factory env config from constants.
- If transaction flow requires multiple calls, make the sequence explicit in UI copy.
- Reflect stablecoin symbol/name from on-chain registration data.
- **Never use silent fallback values (e.g. `|| "default"`) on decoded contract data.** If a required field is missing or has the wrong type after decoding, log the error with context (contract name, id, raw hex) and skip the entry. Fallbacks hide bugs and make on-chain data issues invisible to developers. Use `?? null` or `?? 0` only for legitimately optional fields.

## Validation Checklist

After changes:
- run contract/tests (`npm test` at repo root)
- ensure stablecoin-scoped vault flows still pass existing tests
- ensure docs and frontend contract names remain aligned

## Delivery Expectations

- Explain user-visible flow impacts, not just code diffs.
- Prefer minimal, backward-compatible changes unless breaking change is explicitly requested.
- If behavior changes, update docs in the same task.
