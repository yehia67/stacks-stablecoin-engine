# SSE Governance — Asigna Multisig + Timelock

> **Status:** Live on testnet as of 2026-05-12.
> **Operator runbook + architecture reference.** Replaces the prior design-only ADR; for the original proposal see git history of this file before commit `multisig-timelock-governance`.

## TL;DR

Every global SSE admin function is gated by an Asigna multisig acting through a 24-hour timelock. The deployer key is permanently locked out (`bootstrap-locked = true` on every governed contract). Three roles:

- **Admin** — Asigna multisig. Can `queue`, `execute`, and trigger emergency fast-paths.
- **Guardian** — Asigna multisig (can be the same as admin or a separate, smaller vault). Can only `cancel` queued actions during the delay window.
- **Deployer** — used only for one-shot bootstrap; permanently neutered after `lock-bootstrap`.

Per-stablecoin creator-gated functions (stability-pool reward pct, configure-collateral-for-stablecoin, etc.) stay creator-controlled and are **out of scope** for governance.

## Asigna Vault URLs

| Network | Vault dashboard |
|---|---|
| **Testnet** | https://stx.asigna.io/vault/SN32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8K3EJAEF/dashboard |
| **Mainnet** | https://stx.asigna.io/vault/SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX/dashboard |

The vault principals (`SN32…3EJAEF` testnet, `SM32…1YTDX` mainnet) are pinned in `sse.config.json` under `governance.admin` and `governance.guardian`.

## Live deployment (testnet)

Deployer: `ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF` · deployed 2026-05-12.

| Role | Contract | Notes |
|---|---|---|
| Governance store | `sse-governance-v1` | Holds admin / guardian / timelock principals. Bootstrap locked. |
| Timelock | `sse-timelock-v1` | 144-block delay (~24h). Bootstrap locked. |
| Factory | `stablecoin-factory-v4` | governance-gated `set-registration-fee`, `set-treasury-address` |
| Collateral registry | `collateral-registry-v6` | governance-gated `add-collateral-type`, `update-collateral-params`, `set-collateral-enabled`, `update-oracle`, `set-vault-engine-authorized` |
| Bridge registry | `bridge-registry-v4` | governance-gated chain + token mgmt |
| xReserve adapter | `xreserve-adapter-v5` | governance-gated; `set-paused` on emergency whitelist |
| Vault engine | `multi-asset-vault-engine-v7` | governance-gated `register-asset-oracle` |

Confirm on-chain at any time:

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"sender":"ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF","arguments":[]}' \
  https://api.testnet.hiro.so/v2/contracts/call-read/ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF/sse-governance-v1/get-admin
```

Frontend inspector: `/governance` route. Shows admin, guardian, timelock, delay, bootstrap-lock status, governed contract list, emergency whitelist seed, and a queued-action lookup.

## Architecture

```
   Asigna multisig (admin)                  Asigna multisig (guardian)
            │                                          │
            │ queue / execute / emergency-*            │ cancel
            ▼                                          ▼
   ┌──────────────────────────────────────────────────────────┐
   │  sse-timelock-v1                                         │
   │  - delay = 144 blocks (~24h)                             │
   │  - emergency whitelist (no-delay, admin-only)            │
   │  - per-(target,fn) execute-* wrappers, hash-checked      │
   └────────────────────────┬─────────────────────────────────┘
                            │ as-contract contract-call?
                            ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Governed contracts (v4-v7)                              │
   │  governance: principal var; bootstrap-locked: bool       │
   │  admin fns: assert tx-sender == governance               │
   └──────────────────────────────────────────────────────────┘
```

Clarity has no dynamic dispatch, so the timelock has one hand-written `execute-<target>-<fn>` wrapper per admin function. The wrapper recomputes a SHA-256 hash from the args, asserts it matches the `(action-hash)` stored at queue time, and then `as-contract` calls the real admin function on the target contract.

## How to make a governance change

### 1. Pick the target + function

See `frontend/src/lib/constants.ts` (`TIMELOCK_TARGETS`, `TIMELOCK_FNS`) or this table:

| Target | id | Functions |
|---|---|---|
| Factory | 1 | 1=set-fee · 2=set-treasury |
| Collateral registry | 2 | 1=add · 2=update · 3=set-enabled · 4=update-oracle · 5=set-vault-auth |
| Bridge registry | 3 | 1=add-chain · 2=disable-chain · 3=register-token · 4=update-adapter · 5=set-token-enabled · 6=config-chain |
| xReserve | 4 | 1=set-attest · 2=set-token · 3=set-paused · 4=add-chain · 5=remove-chain |
| Vault engine | 5 | 1=register-oracle |
| Self (timelock + governance) | 6 | 1=set-delay · 2=set-emergency · 3=rotate-admin · 4=rotate-guardian |

### 2. Compute the action hash off-chain

The hash is `sha256(consensus-buff?({t: target, f: fn}) ++ consensus-buff?(args-tuple))`.

Reference TS implementation lives in `tests/governance.test.ts` (`computeHash`). It must produce the exact same bytes the on-chain `compute-hash` function does, otherwise `execute-*` will fail with `ERR-HASH-MISMATCH (u1009)`.

### 3. Queue from the Asigna multisig

Open the vault dashboard:
- Testnet: https://stx.asigna.io/vault/SN32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8K3EJAEF/dashboard
- Mainnet: https://stx.asigna.io/vault/SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX/dashboard

**New transaction → Contract call**:
- Contract: `<deployer>.sse-timelock-v1`
- Function: `queue`
- Args: `id` (any unused uint), `action-hash` (32-byte buff from step 2), `target` (uint), `fn` (uint), `eta` (uint, must be `>= current-block-height + delay`)

The first signer creates the tx; remaining signers approve until threshold M is reached. The Mth approval auto-broadcasts. Inspect the queued action at `/governance` on the frontend (paste the id into the lookup form).

### 4. Wait the delay

Default 144 blocks (~24h). The frontend shows status `queued`. During this window the **guardian** may call `cancel(id)` to abort.

### 5. Execute from the Asigna multisig

Same vault dashboard, **New transaction → Contract call**:
- Contract: `<deployer>.sse-timelock-v1`
- Function: `execute-<target>-<fn>` (e.g. `execute-factory-set-fee`)
- Args: `id` (matching the queue), then the same args used to compute the hash, in declaration order.

The wrapper recomputes the hash, checks `eta`, marks the action `executed`, and `as-contract` calls the target. The frontend updates to `executed`.

## Emergency fast-paths

The following (target, fn) pairs are seeded on the timelock's emergency whitelist and can be executed by **admin only** with **no delay**, by calling `emergency-*` directly on the timelock:

| Function | Use when |
|---|---|
| `emergency-coll-set-enabled` | Disable a collateral asset for new mints (e.g. oracle outage) |
| `emergency-bridge-set-token-enabled` | Disable a bridged token immediately |
| `emergency-xres-set-paused` | Pause all xReserve mint/burn-from-remote |

Any other admin function still requires the full queue → 24h → execute flow. The whitelist itself can only be modified through the queue/execute flow (target=SELF, fn=SET_EMERGENCY).

## Rotation

To change the admin multisig (e.g. you spun up a new Asigna vault):

1. Queue `execute-self-rotate-admin(id, new-admin-principal)` from the current admin.
2. Wait 24h.
3. Execute it from the current admin.
4. Now the old multisig has no power. Verify on `/governance`.

Same flow for `rotate-guardian`. Same flow for raising / lowering `set-delay` (within `MIN-DELAY=u6` and `MAX-DELAY=u4320`).

## Configuration sources

- `sse.config.json` — `governance.admin`, `governance.guardian`, `governance.timelockDelayBlocks`, contract names. Single source of truth at deploy time.
- `frontend/src/lib/constants.ts` — `CONTRACTS.SSE_GOVERNANCE`, `CONTRACTS.SSE_TIMELOCK`, `TIMELOCK_TARGETS`, `TIMELOCK_FNS`. Single source of truth for the frontend.
- `scripts/deploy.cjs` Phase 4 — wires the governance pointers and locks bootstrap.

## Known issues / follow-ups

- **`sse-timelock-v1` has a name-shadowing bug.** Five execute wrappers (`execute-bridge-add-chain`, `execute-bridge-disable-chain`, `execute-bridge-config-chain`, `execute-xres-add-chain`, `execute-xres-remove-chain`) include `chain-id` in the consensus buffer used for hashing — `chain-id` is a Clarity 3 built-in keyword that returns the network chain id rather than the function parameter. Effect: those 5 specific timelock paths will fail with `ERR-HASH-MISMATCH` when executed. All other paths work. Workaround: deploy `sse-timelock-v2` with `target-chain-id` substituted, then `rotate` governance pointers via the queue/execute flow on v1.
- **`sse-timelock-v1` is missing a public `is-bootstrap-locked` read-only.** The data var is set correctly (verifiable via `/v2/data_var/<deployer>/sse-timelock-v1/bootstrap-locked`) but the frontend has to special-case this contract. Fix in v2.

## Validation checklist

- `npm test` green (132 tests including `tests/governance.test.ts`).
- `cd frontend && npm run build` green.
- All 5 governed contracts return `is-bootstrap-locked` = `true`.
- `sse-governance-v1.get-admin` returns the Asigna vault principal from `sse.config.json`.
- Smoke test: queue `execute-factory-set-fee` to the same current value, wait 24h, execute. Frontend `/governance` shows the action transition `queued → executed`.
