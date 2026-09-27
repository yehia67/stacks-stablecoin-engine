# SSE subagents — who owns what, and how they hand off

Five project subagents exist. Each has a narrow, non-overlapping mandate; this
file is the map between them. Dispatch to the right one instead of doing
cross-cutting work ad hoc in the main thread — that's the entire reason they
exist (see each `.claude/agents/*.md` for full detail).

## The five

| Agent | Owns | Does NOT own |
|---|---|---|
| `sbtc-integration` | sBTC oracle correctness, custody assumptions, decimals, upstream dual-stacking drift | Building SSE Finance wholesale; UI; Supabase |
| `devnet-health` | Local Clarinet devnet health-flow, simnet↔devnet distinction, CI test coverage | Real testnet/mainnet broadcasts; screen design; contract-call wiring |
| `ui` | Frontend screens, components, copy, UX flow | Hook internals, Supabase, custodial signing, contract-call shapes |
| `fullstack-integration` | Every seam: contract ↔ hooks ↔ Supabase ↔ custodial signer ↔ RPC infra ↔ deploy infra | Screen design; new Clarity protocol logic from scratch; sBTC-specific judgment calls; real mainnet execution |
| `qa-e2e` | Browser-driven Cypress E2E, video-recorded, proving the frontend works for a real user | Protocol-level health checks (that's `devnet-health`); screen design; wiring fixes beyond reporting them |

None of them commits or pushes — that's a standing rule for every agent in this
repo (root `AGENTS.md` inherits from project memory: user commits manually).

## The layer stack (bottom to top)

```
Clarity contracts (contracts/*.clar)
        │  proven by
        ▼
devnet-health  ──────────────  simnet tests + local devnet health-flow + CI
        │  once proven, wired by
        ▼
fullstack-integration  ───────  hooks, Supabase, custodial signer, RPC proxy
        │  consumed by
        ▼
ui  ───────────────────────────  screens, components, UX copy
        │  proven end-to-end by
        ▼
qa-e2e  ───────────────────────  Cypress, real browser, video-recorded
```

`sbtc-integration` is not a layer — it's a **cross-cutting specialist** consulted
by any of the above whenever sBTC-specific correctness is in question (oracle
principal, custody path, decimal assumption, upstream Stacks/dual-stacking
change). Same relationship the Product Boundaries doc has to the whole repo:
not a phase, a standing constraint-checker.

`qa-e2e` closes the loop back to `devnet-health`: where `devnet-health` proves
the *protocol* works (contracts, no browser), `qa-e2e` proves the *product*
works (real browser, real clicks, on top of whatever chain `devnet-health` and
`fullstack-integration` made available). A `qa-e2e` failure that traces to
wrong on-chain state is a `devnet-health`/`fullstack-integration` bug, not a
`qa-e2e` bug — it just found it first.

## Hand-off protocol for a typical feature

Example: "add a new SSE Finance frontend flow for market X."

1. **Contract layer already exists or changes** — main thread / general build
   work does the Clarity implementation itself (no agent here authors new
   protocol logic from scratch).
2. **`devnet-health`** proves the flow works end-to-end on devnet (or at minimum
   simnet, flagging if devnet coverage is missing) and confirms CI would catch a
   regression. If the flow touches sBTC collateral specifically, it consults
   `sbtc-integration` for the oracle/custody piece rather than guessing.
3. **`fullstack-integration`** wires the proven contract calls into
   `frontend/src/hooks/*`, updates Supabase schema/client if the flow needs
   persisted off-chain state, and confirms the RPC proxy handles the new call
   pattern without adding rate-limit risk.
4. **`ui`** builds the screen against what `fullstack-integration` exposed —
   never invents a contract-call shape itself, never touches hook internals.
5. **`qa-e2e`** writes/runs the Cypress spec proving the flow works end-to-end
   in a real browser, video-recorded. A failure here that traces back to a
   wiring or protocol bug routes back to `fullstack-integration` or
   `devnet-health`, not fixed in the test itself.
6. Anything security-critical surfaced at any step (privileged role, custodial
   signing, governance/timelock path, mint/burn) gets flagged up rather than
   resolved silently — per root `AGENTS.md`'s Product Boundaries guardrails.

Steps aren't always sequential in practice — a UI bug might reveal a hook bug
(`ui` → `fullstack-integration`), or a devnet health-flow failure might turn out
to be an sBTC oracle staleness issue (`devnet-health` → `sbtc-integration`).
The table above is what decides *who* picks it up, not a rigid pipeline order.

## BMad wiring

`bmad-build`'s implementation and review dispatch is overridden (team scope) at
`_bmad/custom/bmad-build.toml` to route to these five subagents instead of
always spawning a generic context-free one:

- **step-03 implement** (`implementation_handoff`): picks the one subagent whose
  ownership matches the spec's touched files (same routing table as the layer
  stack above); falls back to the original generic subagent when scope spans
  multiple owners or touches new Clarity contract logic with no single owner.
- **step-04 / one-shot review** (`review_layers` / `oneshot_review_layers`): adds
  a fourth layer, `domain-specialist-review`, alongside the three stock ones
  (Blind Hunter, Edge Case Hunter, Verification Gap). It launches the owning
  subagent to review the diff against *its own* domain rules — not general code
  quality, which the other three already cover — and explicitly skips itself
  when no single subagent owns the touched files, rather than forcing a review
  through the wrong lens.

Verified via `uv run _bmad/scripts/resolve_customization.py --skill
<bmad-build-install-path> --project-root . --key workflow` — the override
merges correctly with the packaged defaults (append semantics for the review
layer arrays, scalar replace for `implementation_handoff`).

Outside `bmad-build`, these subagents are also directly callable by name
(`subagent_type: "ui"` etc.) any time — the BMad wiring is one entry point among
several, not the only way to reach them.

## Escalation / things no agent here does alone

- **Real testnet/mainnet deploys** — no agent owns this yet by design.
  `devnet-health` proves readiness; execution is main-thread work following
  root `AGENTS.md`'s "Mandatory Deployment Workflow", explicitly requested by
  the user each time (see project memory: deployment steps must run
  end-to-end, never left half-done).
- **New Clarity protocol design** (new contract, new economic mechanism) — goes
  through the normal planning flow (`bmad-spec` / `bmad-architecture`), not
  straight to an agent.
- **Cross-track boundary calls** (does this belong in SSE Core vs SSE Finance vs
  Institutional Platform vs Confidential SDK) — `docs/product/PRODUCT-LINES.md`
  is the authority; any agent that finds itself unsure should stop and check
  that doc rather than guess.
