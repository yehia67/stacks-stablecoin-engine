# Plan — Add EGP Bond A (EGPB) as Mainnet Collateral

**Status**: contracts deployed 2026-06-10 (block 8245937); proposal queued 2026-06-11 (id u1003, eta block 8247128). Awaiting execute after eta (§7 step 5).

**On-chain receipts**:
- Publish `egpb-token-v1`: `0x314a7fc2232cef86a061a4e7f343d701aacdc81d4ed821bc4494561c5a6f7f6d`
- Publish `price-oracle-egpb-v1`: `0x8ec801552cec7efcdffa3469a589ecb836d26e8bb932c4d2e1c005956cce67ec`
- Post-deploy sanity (read-only): `get-price` → `(ok u100000000)`, `get-owner` → deployer, `get-symbol` → `"EGPB"`.
- Proposal C action hash `0x7e8c37c18db9115a92fbe74a4f3b5f4c7f4c3d6f352e4f0b634a93115f6c704a` cross-verified against on-chain `sse-timelock-v1::compute-hash` 2026-06-10.
- Queue tx (native multisig, no Asigna UI — id `u1003`, eta `u8247128`): `0xf0dfc88018805e99da48af58042aaa1ca6ede04bcd06d3df3ce068ce0882509c`
- Post-queue verify: `get-action(u1003)` → hash/eta/target/fn match, `cancelled: false`, `executed: false`.
- Multisig mechanics: vault `SM32SVN2…YTDX` = 2-of-2 sequential P2SH, pubkey order B (`0219698b…`), A (`03f9bd02…` = deployer acct 0); tx fee 150000 µSTX (vault had exactly 1 STX — default 500k×2 would zero it).
- Execute tx: _pending — run after block 8247128 (~24h after queue)_

**Execute command (after eta, same flow as queue):**
```
node scripts/timelock-tx.cjs ms-init-execute execute-coll-add \
  --pubkeys <PUB_B>,<PUB_A> --sigs-required 2 --signer-key <PRIV_B> \
  --queue-id 1003 \
  --asset SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0.egpb-token-v1 \
  --min-cr 150 --liq-r 120 --liq-pen 10 --fee 200 \
  --ceiling 100000000000 --floor-amt 10000000 \
  --oracle SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0.price-oracle-egpb-v1 \
  --tx-fee 150000
# then: ms-sign --tx-hex <hex> --signer-key <PRIV_A> --pubkeys <PUB_B>,<PUB_A> --sigs-required 2 --broadcast
```
**Target**: mainnet only. Testnet stays on v7 — no EGPB there.
**Predecessor**: `docs/plans/add-vgld-collateral.md` (vGLD rollout) — this plan reuses that playbook with a strictly smaller scope, since the v8 trait-based engine is already live and authorized.

---

## 1. Goal

Add `SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0.egpb-token-v1` as the third approved collateral on SSE mainnet alongside sBTC and vGLD.

- Token name `EGP Bond A`, symbol `EGPB`, 8 decimals, native FT asset name `EGPBv1`.
- Hard $1.00 USD standard price via a constant oracle (same model as vGLD).
- SSE team is the sole issuer: mint and burn are owner-gated. Owner = deployer key (`SP3QMDAC…`). No faucet, no open mint.

## 2. Pre-flight checks (verified 2026-06-10)

| Check | Result | Why it matters |
|---|---|---|
| `settings/Mainnet.toml` mnemonic derives to | `SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0` | Matches `sse.config.json` mainnet deployer — deploy script's identity assertion passes |
| SP3QMDAC mainnet STX balance | 28.04 STX | Two small publishes ≈ 0.04 STX estimated — **no funding transfer needed** |
| v8 engine authorized in registry | yes (vGLD proposal A, executed 2026-05-25) | Only **one** timelock proposal needed this time |
| Engine/pool/liquidation/registry | unchanged, bootstrap-locked | Nothing redeployed — collateral added purely via registry |

## 3. Contracts to ship (2 new)

1. **`egpb-token-v1.clar`** — SIP-010 fungible token.
   - `(define-fungible-token EGPBv1)` — FT asset name `EGPBv1` (frontend `FT_ASSET_NAMES` depends on this exact identifier).
   - `get-name` → "EGP Bond A", `get-symbol` → "EGPB", `get-decimals` → `u8`.
   - `mint(amount, recipient)` — owner-gated (`contract-owner` data-var, initialized to deployer).
   - `burn(amount)` — owner-gated, burns from the owner's own balance (redemption flow: holder transfers EGPB back to issuer, issuer burns).
   - `set-owner(new-owner)` — owner-gated, for a future handoff (e.g. to the Asigna multisig). Not used at launch; owner stays the deployer key.
   - Standard `transfer` with `tx-sender` check + optional memo print; standard read-onlys.
2. **`price-oracle-egpb-v1.clar`** — constant-$1 oracle implementing `oracle-trait`; returns `(ok u100000000)` (= $1.00 at 8-decimal PRICE-SCALE). Byte-pattern copy of `price-oracle-vgld-v1.clar`.

### Unchanged (everything else)

`multi-asset-vault-engine-v8`, `liquidation-engine-v8`, `stability-pool-v7`, `collateral-registry-v6`, `stablecoin-token-v4`, `stablecoin-factory-v4`, `sse-governance-v1`, `sse-timelock-v1`, all traits, all existing oracles.

## 4. Risk parameters (same as vGLD soft launch)

| Parameter | Value |
|---|---|
| Min collateral ratio | `u150` (150%) |
| Liquidation ratio | `u120` (120%) |
| Liquidation penalty | `u10` (10%) |
| Stability fee | `u200` (2% APR) |
| Debt ceiling | `u100000000000` (100k stablecoins) |
| Debt floor | `u10000000` (10 stablecoins) |
| Oracle | `SP3QMDAC….price-oracle-egpb-v1` (constant $1) |

Adjustable later via `execute-coll-update` (target=u2, fn=u2, 24h delay).

## 5. Repo changes

- **`contracts/egpb-token-v1.clar`**, **`contracts/price-oracle-egpb-v1.clar`** — new.
- **`Clarinet.toml`** — register both (oracle `depends_on = ["oracle-trait"]`, token `depends_on = ["sip-010-trait"]`).
- **Tests** — new Vitest file covering: owner can mint/burn; non-owner mint/burn rejected (`ERR_UNAUTHORIZED`); transfer requires `tx-sender = sender`; `set-owner` gating; oracle returns `u100000000`; end-to-end vault flow on engine-v8 with EGPB (mirror the vGLD engine-v8 test).
- **`sse.config.json`** —
  - `contracts`: `"egpbToken": "egpb-token-v1"`, `"priceOracleEgpb": "price-oracle-egpb-v1"`.
  - `contractCosts`: `"egpb-token-v1": 25000`, `"price-oracle-egpb-v1": 15000`.
  - `networks.mainnet.deployContracts`: append `"egpbToken"`, `"priceOracleEgpb"` (existing entries skip as already-on-chain).
  - `networks.mainnet.collaterals`: append EGPB entry (`contractName: "egpb-token-v1"`, `oracleKey: "priceOracleEgpb"`, decimals 8, risk per §4). Bootstrap `add-collateral-type` from the deployer will revert `⊘ skipped` (registry is timelock-governed) — expected, same as vGLD.
- **`scripts/timelock-hashes.cjs`** — add proposal C (`execute-coll-add` for EGPB) alongside the existing vGLD proposals, or print only pending proposals.
- **Frontend `frontend/src/lib/constants.ts`** —
  - `FT_ASSET_NAMES["egpb-token-v1"] = "EGPBv1"`.
  - `COLLATERAL_DECIMALS["egpb-token-v1"] = 8`.
  - `CONSTANT_ORACLE_NAMES` += `"price-oracle-egpb-v1"`.
  - Display name/symbol maps + branding entry (name "EGP Bond A", symbol "EGPB", tagline).
  - No external-principal constant needed (token lives under the same deployer address the frontend already uses), and no faucet entry (mainnet only).
- **Docs** — README mainnet contract/collateral tables, `docs/SSE_CONTEXT.md` versioning + collateral list, `docs/roadmap.md` entry.

## 6. Timelock proposal (one only)

v8 is already authorized in the registry, so only `execute-coll-add` is needed:

| Field | Value |
|---|---|
| `target` / `fn` | `u2` / `u1` |
| Execute fn | `sse-timelock-v1::execute-coll-add` |
| Args tuple | `{asset: 'SP3QMDAC….egpb-token-v1, min-cr: u150, liq-r: u120, liq-pen: u10, fee: u200, ceiling: u100000000000, floor-amt: u10000000, oracle: 'SP3QMDAC….price-oracle-egpb-v1}` |
| Action hash | compute via `node scripts/timelock-hashes.cjs` at queue time; cross-check with on-chain `compute-hash` read-only |

Queued and executed by the Asigna multisig (`SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX`), delay 144 blocks (~24h).

## 7. Rollout sequence

| # | Step | Caller |
|---|---|---|
| 1 | Contracts + tests + config changes merged; `npm test` and `cd frontend && npx tsc --noEmit` green | Engineer |
| 2 | `npm run deploy -- --network mainnet` — publishes `egpb-token-v1` + `price-oracle-egpb-v1`; everything else logs "already on-chain, skipping"; bootstrap registry call reverts `⊘ skipped` (expected) | Deployer (SP3QMDAC, has 28 STX) |
| 3 | Asigna queues `execute-coll-add` (hash from §6) | Multisig |
| 4 | Wait 144 blocks (~24h) | — |
| 5 | Asigna executes; verify `get-collateral-config('SP3QMDAC….egpb-token-v1)` returns the §4 params and `get-oracle` returns the EGPB oracle | Multisig / Engineer |
| 6 | Frontend release | Engineer |
| 7 | Smoke test: deployer mints small EGPB to a test wallet → open vault → deposit → mint stablecoin → repay → withdraw → close | Engineer |

End-to-end ≈ 24–30h, bound by the timelock delay.

## 8. Rollback / contingency

- **After step 2, before step 5**: two unused contracts on-chain, zero platform impact. Do nothing or abandon.
- **After step 5, params wrong**: queue `execute-coll-update` (24h) or `execute-coll-set-enabled(false)` (emergency whitelist, immediate) — same levers as vGLD.
- **Token issuance mistake**: owner can burn own balance; tokens minted to third parties can only be burned after they transfer back.

## 9. Out of scope

- Testnet deployment (testnet frozen on v7).
- Owner handoff to multisig (contract supports `set-owner`; not exercised at launch).
- Any change to engine, pool, liquidation, registry, governance, or existing collaterals.
