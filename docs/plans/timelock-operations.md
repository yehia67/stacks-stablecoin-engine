# SSE Governance Operations — Full Deployment Lifecycle

> Canonical guide for any on-chain change that touches a governance-locked SSE contract on Stacks mainnet. Extends `AGENTS.md` *Mandatory Deployment Workflow* with the multisig timelock step required for the locked production contracts (`collateral-registry-v6`, `stablecoin-factory-v4`, `bridge-registry-v4`, `xreserve-adapter-v5`).
>
> **Read first**: `AGENTS.md` §"Deployment Rules" and §"Mandatory Deployment Workflow" — they set the contract-immutability + versioning + frontend-and-docs-in-same-task rules every governance flow inherits.

| Status | Last updated | Active proposals on chain |
|---|---|---|
| Canonical | 2026-05-24 | queue id `1001` (authorize v8), queue id `1002` (add vGLD) — see §11 |

---

## Reference: documents this guide composes with

| Document | What it covers | When to read it |
|---|---|---|
| `AGENTS.md` (root) | Project-level rules, mandatory deployment workflow, validation checklist | Every task |
| `README.md` §"Contracts on-chain (mainnet)" | Source-of-truth list of deployed contracts | When confirming what's live |
| `docs/SSE_CONTEXT.md` §"Current contract versions" | Versioning narrative | When picking new version names |
| `docs/roadmap.md` §"Active Engine Versions" | Per-network engine/pool/liq table | When adding upgrade entries |
| `docs/plans/<change>.md` (e.g. `add-vgld-collateral.md`) | One-off design + risk doc for a specific change | When proposing the change |
| `docs/plans/timelock-operations.md` (this doc) | The execution mechanics that turn the plan into on-chain state | When executing the change |
| `scripts/timelock-tx.cjs` | The CLI for multisig timelock proposals | Every Phase C |
| `scripts/deploy.cjs` | The single-command contract publisher | Every Phase B that publishes contracts |

---

## 1. When to use this guide

Three change shapes, three escalation levels:

| Shape | Example | Phases needed |
|---|---|---|
| **Pure config change inside a locked contract** | Tweak vGLD's min collateral ratio from 150 to 140 | C → D (frontend constants if any reference) → E (docs) |
| **New collateral / new asset onboarding** | Add vGLD as collateral | C → D → E → F (smoke test) |
| **New contract version + governance rewiring** | Bump vault engine v7 → v8 | A (design) → B (deploy) → C (governance authorize) → D → E → F |

This guide assumes you've already produced a plan doc under `docs/plans/<change>.md` covering the design + risk params + cross-references per `AGENTS.md` *Deployment Rules*.

---

## 2. Components and actors

| Thing | Identifier | Purpose |
|---|---|---|
| Mainnet deployer | `SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0` (single-sig) | Runs `npm run deploy`, owner of `stablecoin-token-v4` |
| Asigna admin vault | `SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX` (native 2-of-2 P2SH multisig) | Admin + guardian on `sse-governance-v1`; only principal that can queue/execute timelock proposals |
| Signer A | `SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0` | Vault slot 1 (also = deployer) |
| Signer B | `SP2YTB28Z4DHMMGG54BG89HG6B4YN6CG0TZK10NYY` | Vault slot 0 (initiator) |
| Timelock contract | `…sse-timelock-v1` | Queue + 144-block delay + execute |
| Timelock delay | 144 blocks (~13-14h on Nakamoto) | Public review window before execute |

Each signer's mnemonic stays on that signer's machine only — never in git, never in shared channels, never in this doc.

---

## 3. Lifecycle overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ A. PLAN          docs/plans/<change>.md                             │
│                  → scope, risk params, cross-references, rollback   │
├─────────────────────────────────────────────────────────────────────┤
│ B. DEPLOY        only if new contracts needed                       │
│                  → update sse.config.json                           │
│                  → npm run deploy -- --network mainnet              │
│                  → some bootstrap calls revert on locked contracts  │
│                    (expected; governance handles them in Phase C)   │
├─────────────────────────────────────────────────────────────────────┤
│ C. GOVERNANCE    multisig timelock                                  │
│                  → fund vault                                       │
│                  → queue proposal(s) via scripts/timelock-tx.cjs    │
│                  → wait 144 blocks (~14h)                           │
│                  → execute proposal(s)                              │
│                  → verify on-chain effect                           │
├─────────────────────────────────────────────────────────────────────┤
│ D. FRONTEND      AGENTS.md mandatory step 3                         │
│                  → bump constants.ts (versioned contracts, assets)  │
│                  → cd frontend && npm run build                     │
│                  → deploy to staging → production                   │
├─────────────────────────────────────────────────────────────────────┤
│ E. DOCS          AGENTS.md mandatory step 4                         │
│                  → README.md (deployment section)                   │
│                  → docs/SSE_CONTEXT.md (versioning narrative)       │
│                  → docs/roadmap.md (active versions + upgrade row)  │
│                  → docs/plans/<change>.md (mark executed + txids)   │
├─────────────────────────────────────────────────────────────────────┤
│ F. SMOKE TEST    open vault on mainnet, deposit, mint, repay,       │
│                  withdraw. Pause via emergency path if anything off │
└─────────────────────────────────────────────────────────────────────┘
```

A and B are covered by `AGENTS.md` *Mandatory Deployment Workflow* + the plan doc. D and E are also `AGENTS.md` steps 3 and 4. **This guide's unique content is Phase C** — the multisig timelock dance — plus the explicit handoff back into AGENTS.md steps after execution.

---

## 4. Phase A — Plan (cross-reference: plan docs)

For any change touching production contracts:

- Write `docs/plans/<change>.md` capturing: goal, risk params (per-collateral or per-contract), cross-references, rollback path, contracts that need re-versioning.
- Validate against `AGENTS.md` *Deployment Rules* ("Tightly-coupled contracts must be versioned together"). Map every `.contract-name-vN` reference in the touched contracts; bump them together.
- Get sign-off on risk params before queueing the timelock proposal — they're 24h-locked once queued and irreversible inside that window without a `cancel`.

Example: `docs/plans/add-vgld-collateral.md`.

---

## 5. Phase B — Deploy new contracts (`scripts/deploy.cjs`)

Skip if no new contracts are required (pure parameter change inside an already-deployed locked contract → go straight to Phase C).

Follow `AGENTS.md` *Mandatory Deployment Workflow* steps 1-2:

1. **Update `sse.config.json`** — add new contract names to `contracts`, `contractCosts`, network-specific `deployContracts`, and `networks.<network>.contractOverrides` for any contract whose default is per-network.
2. **`npm run deploy -- --network mainnet`** — publishes new contracts, runs bootstrap.

### What succeeds on locked-contract bootstrap

- `stablecoin-token-v4::set-vault-engine(<new>)` — owner-gated, deployer = owner, so this **succeeds**. Use it to flip the token to a new engine atomically.
- `<any-locked-contract>::lock-bootstrap` — idempotent, **succeeds** on re-run.

### What reverts on locked-contract bootstrap (expected)

| Bootstrap call | Revert | Why | Resolved in |
|---|---|---|---|
| `collateral-registry-v6::set-vault-engine-authorized` | `(err u100)` ERR-NOT-GOVERNANCE | Registry already locked; only timelock can call | Phase C, `queue-coll-set-vault-auth` |
| `collateral-registry-v6::add-collateral-type` | `(err u100)` ERR-NOT-GOVERNANCE | Same | Phase C, `queue-coll-add` |
| `collateral-registry-v6::update-oracle` | `(err u100)` | Same | Phase C, `queue-coll-update-oracle` |
| `stablecoin-factory-v4::set-registration-fee` | `(err u700)` | Already set + locked | Phase C, `execute-factory-set-fee` |
| `<contract>::bootstrap-set-governance` | `(err u707)` / `(err u604)` / `(err u111)` | Already wired + locked | Done at original v1 launch, no action needed |

`deploy.cjs` logs each as `⊘ skipped (already configured)` and proceeds — those reverts are expected and not actionable.

`deploy.cjs` correctly skips `bootstrap-set-governance` and `lock-bootstrap` for v8 engine (which has neither function) via the `hasLockBootstrap` / `hasGovernance` flags in the governed-contracts list.

---

## 6. Phase C — Governance (multisig timelock)

The locked-contract operations from Phase B's revert table go here.

### 6.1 One-time vault setup (every signer's machine, once)

```bash
STACKS_MNEMONIC="<your seed>" \
  node scripts/timelock-tx.cjs ms-derive-key --account-index <N>
```

Returns `private-key` (keep secret, use as `--signer-key`), `public-key` (share with other signers, used in `--pubkeys`), and `stx-address` (verify it matches the signer slot you expect). `--account-index` typically `0` or `1` depending on which wallet account the signer enrolled with.

Verify the pubkey set produces the vault address — try both orderings:

```bash
node scripts/timelock-tx.cjs ms-derive-address \
  --pubkeys <PUB_B>,<PUB_A> --sigs-required 2
```

For the SSE mainnet vault, canonical order is **B,A** → must print `SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX`. Lock that order in. **Never reorder** — every subsequent command uses the same `$PUBS` string.

### 6.2 Fund the vault (each operation cycle)

Asigna native multisig pays its own tx fees. Each tx ≈ 0.5 STX. Two proposals (queue + execute each) = ~2 STX. Round up: fund 3 STX.

```bash
# check
curl -s https://api.hiro.so/v2/accounts/SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX?proof=0 \
  | python3 -c "import sys,json;d=json.load(sys.stdin); print(int(d['balance'],16))"

# top up from deployer if below 1 STX
DEPLOYER_PRIV="<deployer key, from settings/Mainnet.toml account 0 if you're the deployer>" \
  node -e '
    (async () => {
      const t = require("@stacks/transactions"); const net = require("@stacks/network");
      const tx = await t.makeSTXTokenTransfer({
        recipient: "SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX",
        amount: 3000000n, senderKey: process.env.DEPLOYER_PRIV,
        network: net.STACKS_MAINNET, anchorMode: t.AnchorMode.OnChainOnly,
        fee: 500n, memo: "fund-multisig",
      });
      console.log(await t.broadcastTransaction({ transaction: tx, network: net.STACKS_MAINNET }));
    })();
  '
```

Wait ~1 block for confirmation.

### 6.3 Queue the proposal

Pick the right pair from this table:

| Goal | Queue subcommand | Execute subcommand |
|---|---|---|
| Authorize a new vault engine | `queue-coll-set-vault-auth` | `execute-coll-set-vault-auth` |
| Add new collateral type | `queue-coll-add` | `execute-coll-add` |
| Update collateral risk params | `queue-coll-update` | `execute-coll-update` |
| Enable/disable collateral | `queue-coll-set-enabled` | `execute-coll-set-enabled` |
| Swap collateral oracle | `queue-coll-update-oracle` | `execute-coll-update-oracle` |

**Initiator (signer B)** in their shell:

```bash
export PRIV_B="<from ms-derive-key>"
export PUBS="<PUB_B>,<PUB_A>"

node scripts/timelock-tx.cjs ms-init-queue <queue-subcommand> \
  --pubkeys $PUBS --sigs-required 2 \
  --signer-key $PRIV_B \
  --id <FRESH-ID> \
  <action-specific flags>
```

Output prints `tx-hex: 0x...`. Send hex to signer A via any channel (Slack, Signal). Send the action-hash separately so co-signer can verify.

**Co-signer (signer A)** verifies + signs + broadcasts:

```bash
export PRIV_A="<from ms-derive-key>"
export PUBS="<PUB_B>,<PUB_A>"

# Always inspect before signing
node scripts/timelock-tx.cjs ms-inspect --tx-hex <hex-from-B>

node scripts/timelock-tx.cjs ms-sign \
  --tx-hex <hex> --signer-key $PRIV_A \
  --pubkeys $PUBS --sigs-required 2 --broadcast
```

Save the broadcast txid into the change's plan doc.

### 6.4 Confirm queued

```bash
ID=<your id>
ID_HEX=$(node -e "const t=require('@stacks/transactions'); console.log('0x'+t.serializeCV(t.uintCV($ID)))")
curl -s -X POST https://api.hiro.so/v2/contracts/call-read/SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0/sse-timelock-v1/get-action \
  -H "Content-Type: application/json" \
  -d "{\"sender\":\"SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0\",\"arguments\":[\"$ID_HEX\"]}"
```

Decoded tuple must show your `action-hash`, `eta`, `target`, `fn`, `cancelled: false`, `executed: false`.

### 6.5 Wait for eta (~14h)

```bash
watch -n 60 '
TIP=$(curl -s https://api.hiro.so/extended/v1/block | python3 -c "import sys,json;print(json.load(sys.stdin)[\"results\"][0][\"height\"])")
ETA=<your-eta>
echo tip=$TIP eta=$ETA delta=$((ETA - TIP))
'
```

### 6.6 Execute the proposal

Same dance as queue, using the matching execute subcommand. **Pass the exact same action args** as queue — any difference yields `(err u1009)` ERR-HASH-MISMATCH.

**Initiator (signer B)**:
```bash
node scripts/timelock-tx.cjs ms-init-execute <execute-subcommand> \
  --pubkeys $PUBS --sigs-required 2 --signer-key $PRIV_B \
  --queue-id <SAME-ID-AS-QUEUE> \
  <SAME action-specific flags>
```

**Co-signer (signer A)**:
```bash
node scripts/timelock-tx.cjs ms-inspect --tx-hex <hex>
node scripts/timelock-tx.cjs ms-sign \
  --tx-hex <hex> --signer-key $PRIV_A \
  --pubkeys $PUBS --sigs-required 2 --broadcast
```

### 6.7 Verify the on-chain effect

| Action | Read-only call to confirm |
|---|---|
| `execute-coll-set-vault-auth` | `collateral-registry-v6::is-vault-engine-authorized(engine)` |
| `execute-coll-add` | `collateral-registry-v6::get-collateral-config(asset)` and `get-oracle(asset)` |
| `execute-coll-update` | `get-collateral-config(asset)` reflects new params |
| `execute-coll-set-enabled` | `get-collateral-config(asset)` shows new `enabled` |
| `execute-coll-update-oracle` | `get-oracle(asset)` returns new oracle |

Helper:
```bash
encode() { node -e "const t=require('@stacks/transactions'); console.log('0x'+t.serializeCV($1))"; }
ASSET_HEX=$(encode "t.principalCV('<asset>')")
curl -s -X POST https://api.hiro.so/v2/contracts/call-read/SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0/collateral-registry-v6/get-oracle \
  -H "Content-Type: application/json" \
  -d "{\"sender\":\"SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0\",\"arguments\":[\"$ASSET_HEX\"]}"
```

### 6.8 Cancel path (before execute only)

Any queued-but-not-executed proposal can be cancelled by admin OR guardian (both = Asigna vault):

```
(contract-call? '<deployer>.sse-timelock-v1 cancel u<id>)
```

Same multisig dance via a generic contract-call. No dedicated `ms-init-cancel` subcommand yet; build via `makeUnsignedContractCall` ad-hoc.

After execute: forward-roll a new proposal. For collateral disabled via emergency whitelist (`target=u2 fn=u3`), `emergency-coll-set-enabled` runs immediately with no 24h wait (admin still multisigs).

---

## 7. Phase D — Frontend (AGENTS.md step 3)

Triggered after Phase C executes confirm. Per AGENTS.md *Mandatory Deployment Workflow* step 3:

1. **`frontend/src/lib/constants.ts`** — bump `DEFAULT_VAULT_ENGINE`, `DEFAULT_LIQUIDATION_ENGINE`, `DEFAULT_STABILITY_POOL`, etc. if a new versioned contract is active. Add any new asset principals to `MAINNET_*_ASSET_PRINCIPAL`, `FT_ASSET_NAMES`, `COLLATERAL_DECIMALS`. Gate any testnet-only entries with `IS_MAINNET` checks.
2. **Verify build**: `cd frontend && npm run build` — green is the gate. Any TypeScript or build error blocks release.
3. **Staging deploy → smoke check → production deploy**. Netlify path. Use a feature flag if rolling out gradually.

Reference: `AGENTS.md` §"Frontend Standards" and §"Token Decimal Handling" — every new asset must be in `COLLATERAL_DECIMALS` or the UI silently produces wrong math.

---

## 8. Phase E — Documentation (AGENTS.md step 4)

Same task as Phase D. Per AGENTS.md step 4, **all** of these get touched:

1. **`README.md`** — "Contracts on-chain (mainnet)" table: add new contract rows, remove no-longer-active rows, refresh oracle table if oracles changed. "Pending mainnet upgrade" subsection: remove once the upgrade is fully live; or move to a "completed upgrades" history section.
2. **`docs/SSE_CONTEXT.md`** — "Current contract versions" narrative: add the new version with what changed and why. Add any new asset rows under collateral assets.
3. **`docs/roadmap.md`** — "Active Engine Versions" table: refresh the per-network rows. Add a row to "Recent upgrades" with date + txids.
4. **`docs/plans/<change>.md`** — mark Status: executed, log txids for queue + execute, add post-mortem if relevant.

Per AGENTS.md *Delivery Expectations*: "If behavior changes, update docs in the same task."

---

## 9. Phase F — Smoke test

1. Open the live frontend, connect a wallet that holds the new asset (or test asset for non-mainnet).
2. Open vault → deposit small amount → mint a few stablecoins → check health factor matches contract read → repay → withdraw → close.
3. If any step fails: emergency-disable via `emergency-coll-set-enabled(asset, false)` (no 24h wait if asset is on the emergency whitelist for `target=u2 fn=u3`).

For new-contract upgrades: also run a liquidation flow end-to-end (have a low-health position; have a separate keeper or admin call `liquidation-engine-vX::liquidate(...)`; confirm pool seizure + reward distribution).

---

## 10. Failure modes — quick reference (by phase)

| Phase | Symptom | Cause | Fix |
|---|---|---|---|
| B | `NoSuchPublicFunction` mid-bootstrap | `deploy.cjs` calling `lock-bootstrap` / `bootstrap-set-governance` on a contract that doesn't have it | Add `hasLockBootstrap: false` flag in `governedContracts` list |
| B | `⊘ skipped (err u100)` on registry calls | Registry locked — expected | Move to Phase C with appropriate `queue-*` |
| C | `NotEnoughFunds` on broadcast | Vault balance < tx fee | Top up vault (§6.2) |
| C | `FeeTooLow` on broadcast | Stacks fee below mempool floor | Re-init with default 500000 µSTX or `--tx-fee` higher |
| C | `BadNonce` | Multisig nonce already used (someone signed via Asigna UI in parallel) | Re-init; script auto-fetches fresh nonce |
| C | `HASH MISMATCH local=… chain=…` (script side) | JS serializer drifted from contract tuple literal | Stop. Script bug — file issue, do not paste hash |
| C | `slot N already filled` on `ms-sign` | Signing out of pubkey order | Coordinate: signers add sigs in pubkey-list order |
| C | `(err u1001)` ERR-NOT-ADMIN | Derived multisig address ≠ vault principal | Re-run `ms-derive-address`; pubkey order wrong |
| C | `(err u1003)` ERR-ETA-TOO-EARLY | Sig collection delayed; tip caught up to eta | Re-init with larger `--eta-buffer` (e.g. 48) |
| C | `(err u1004)` ERR-ID-EXISTS | Reused queue id | Pick a fresh id; track used ids in plan doc |
| C | `(err u1008)` ERR-NOT-READY on execute | Tip below eta | Wait more blocks |
| C | `(err u1009)` ERR-HASH-MISMATCH on execute | Execute args differ from queue args | Re-run execute with the exact flags used in queue |
| C | `AuthError` on broadcast | Pubkey slots not all filled, or order wrong | `ms-inspect`; if `fields.length < pubkeys.length` run `ms-append-pubkeys` |
| D | Frontend mint preview shows wrong magnitude | Decimal mix-up between human / on-chain units | `AGENTS.md` §"Token Decimal Handling" — check `getCollateralDecimals` is wired for the new asset |
| F | Vault opens but mint reverts with `(err u204)` ERR_UNSAFE_HEALTH_FACTOR at the right amount | Engine v8 oracle dispatch broken — passed wrong oracle trait | Confirm frontend's `useContract.ts` passes the registry-stored oracle for the asset |
| F | Liquidation reverts | `stability-pool` cross-reference stale (e.g. v8 liq calling v6 pool that's pinned to v7 liq) | Phase A planning error — re-version the pool too (see §11 worked example) |

---

## 11. Worked example — vGLD on mainnet (state as of 2026-05-24)

Live operational record of this guide's first run-through.

### Phase A — Plan
- Plan doc: `docs/plans/add-vgld-collateral.md` (canonical, supersedes original draft)
- Cross-reference cascade discovered: `stability-pool-v6:289` pinned `.liquidation-engine-v7` → required new `stability-pool-v7`. Vault engine + liq engine re-pointed to `.stability-pool-v7` before publish.
- Mainnet pre-state verified empty: vault deposits = 0, sBTC debt = 0, supply = 0 → pool re-version stranded nobody.

### Phase B — Deploy (executed 2026-05-24)
- `sse.config.json`: added `stabilityPoolV7`, cost entry, mainnet `contractOverrides.stabilityPool = "stability-pool-v7"`, mainnet `deployContracts` includes `stabilityPool`.
- `npm run deploy -- --network mainnet` published: `price-oracle-vgld-v1`, `stability-pool-v7`, `multi-asset-vault-engine-v8`, `liquidation-engine-v8`.
- `stablecoin-token-v4::set-vault-engine(v8)` succeeded (owner-gated). Token now mints/burns via v8 only; v7 mint/burn dead (acceptable — v7 had zero state).
- Locked-contract bootstrap calls reverted as expected; deferred to Phase C.

### Phase C — Governance (executed 2026-05-25)
- Funded vault with 3 STX (`0xd67f57552155…`).
- **Queue Proposal A** (`id=1001`, `target=u2 fn=u5`, action-hash `0xcf2c07…1646e`): `0x532a011a9341…` ✓ queued, `eta=u8073098`.
- **Queue Proposal B** (`id=1002`, `target=u2 fn=u1`, action-hash `0xae585e…6abab`): `0xdedd33ae4da8…` ✓ queued, `eta=u8073107`.
- **Execute Proposal A** (`0xfa1643288a538a…`): v8 engine authorized in registry. Confirmed via `map_entry/authorized-vault-engines[v8] = (some true)`.
- **Execute Proposal B** (`0xc8e15225e60c44…`): vGLD registered with all expected params (`min-cr=150`, `liq-r=120`, `liq-pen=10`, `fee=200`, `ceiling=100000000000`, `floor-amt=10000000`, oracle = `…price-oracle-vgld-v1`). Confirmed via `get-collateral-config`.

### Phase D — Frontend (pending production deploy)
Frontend constants updated in repo (this PR): `DEFAULT_VAULT_ENGINE`, `DEFAULT_LIQUIDATION_ENGINE`, `DEFAULT_STABILITY_POOL` flipped for mainnet; vGLD principal added to `FT_ASSET_NAMES` + `COLLATERAL_DECIMALS`; `FAUCET_COLLATERALS` testnet-gated. `cd frontend && npm run build` green. **Next**: deploy to staging → production (Netlify).

### Phase E — Docs (this PR)
README, SSE_CONTEXT, roadmap, plan doc all updated to reflect executed state.

### Phase F — Smoke test (pending Phase D production deploy)
Plan: open small vGLD vault, mint, repay, withdraw, close. Verify health factor matches contract read. Optional: liquidation rehearsal on a low-health position.

### Used queue ids (track to avoid collisions)
| id | Action | Status |
|---|---|---|
| 1001 | execute-coll-set-vault-auth (v8) | executed ✓ |
| 1002 | execute-coll-add (vGLD) | executed ✓ |

Next free id: **1003**.

---

## 12. Standardization checklist (every future governance op)

- [ ] Plan doc exists at `docs/plans/<change>.md` per AGENTS.md *Deployment Rules*
- [ ] All cross-referenced contracts re-versioned together (Phase A audit)
- [ ] `sse.config.json` updated (Phase B if new contracts)
- [ ] `npm test` green at repo root
- [ ] `npm run deploy -- --network mainnet` complete; expected reverts logged
- [ ] Vault balance ≥ 1 STX per outstanding proposal (Phase C §6.2)
- [ ] Fresh queue id picked from the used-ids log (§11)
- [ ] Initiator runs `ms-init-queue`; co-signer runs `ms-inspect` → `ms-sign --broadcast` (§6.3)
- [ ] `get-action(u<id>)` confirms tuple matches expected (§6.4)
- [ ] Wait until tip ≥ eta (§6.5)
- [ ] Initiator runs `ms-init-execute` with **same args**; co-signer broadcasts (§6.6)
- [ ] On-chain effect verified per action's read-only check (§6.7)
- [ ] `frontend/src/lib/constants.ts` updated; `cd frontend && npm run build` green (Phase D)
- [ ] `README.md`, `docs/SSE_CONTEXT.md`, `docs/roadmap.md`, `docs/plans/<change>.md` updated (Phase E)
- [ ] Mainnet smoke test (Phase F)
- [ ] Used-ids log updated with the new id + txids in §11

---

## 13. Script command reference

```
node scripts/timelock-tx.cjs <subcommand> [flags]

setup
  ms-derive-key            mnemonic → priv + pub + stx-address
  ms-derive-address        pubkeys + threshold → multisig stx-address

queue family (paired with execute counterpart below)
  queue-coll-add           queue execute-coll-add
  queue-coll-update        queue execute-coll-update
  queue-coll-set-enabled   queue execute-coll-set-enabled
  queue-coll-update-oracle queue execute-coll-update-oracle
  queue-coll-set-vault-auth queue execute-coll-set-vault-auth

execute family (passed positionally to ms-init-execute)
  execute-coll-add
  execute-coll-update
  execute-coll-set-enabled
  execute-coll-update-oracle
  execute-coll-set-vault-auth

multisig orchestration
  ms-init-queue <Q>        build + sign-as-first a queue tx
  ms-init-execute <E>      build + sign-as-first an execute tx
  ms-sign                  append signature to existing hex (+ optional --broadcast)
  ms-broadcast             broadcast finalized hex
  ms-inspect               decode hex → contract / fn / args / nonce / sigs
  ms-append-pubkeys        fill remaining pubkey slots (edge case)
```

Common flags:

```
--pubkeys p1,p2,…          comma-separated compressed pubkeys (66 hex each)
--sigs-required N          threshold M
--signer-key <hex>         signer's private key (33-byte hex with 01 suffix)
--tx-hex <hex>             existing partial-signed tx
--broadcast                after ms-sign, ship the tx when threshold met
--id N                     queue id (ms-init-queue) / --queue-id N for ms-init-execute
--eta-buffer N             blocks past minimum eta when queueing (default 24)
--tx-fee µSTX              Stacks tx fee (default 500000 = 0.5 STX); NOT the contract --fee arg
--network mainnet|testnet  default mainnet
--no-verify                skip cross-check against deployed compute-hash (do not use on mainnet)
```

Full help: `node scripts/timelock-tx.cjs help`.
