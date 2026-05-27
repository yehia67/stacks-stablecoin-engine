# Plan — Add VoltFi vGold (vGLD) as Mainnet Collateral

**Status**: **executed 2026-05-25**. All phases complete; vGLD live as second mainnet collateral. Remaining: frontend production deploy + smoke test.
**Last updated**: 2026-05-25.
**Target**: mainnet only. Testnet stays on v7 + stability-pool-v6, no vGLD.

**On-chain receipts**:
- Funding tx: `0xd67f57552155db9914db0def136925638b828603a462f45e7aecb9989927ab1a` (3 STX → vault)
- Queue A (`execute-coll-set-vault-auth(v8, true)`, id 1001): `0x532a011a9341f49e2f857a5f0cd18a537ef24fb9bedd4b3ac6df89ea2a2d1c0c`
- Queue B (`execute-coll-add(vGLD, ...)`, id 1002): `0xdedd33ae4da8f1df380beb0c315442f4ad4bd4fa3f49728482431f1241dd4447`
- Execute A: `0xfa1643288a538aa4d41eca8337b2d33bc4c161bb10bacc13da8d8d2d98c755da`
- Execute B: `0xc8e15225e60c44ae4a5b6e589899eb1816dcd2eaf2430373a707fa09815955e7`

This is the **design + risk** doc for the vGLD rollout. For the **execution mechanics** (deploy, multisig timelock, frontend, docs, smoke), follow `docs/plans/timelock-operations.md` — that file is the canonical step-by-step. This file covers the *what* and *why*; the operations doc covers the *how*.

The shipped v8 reads oracles from `collateral-registry-v6` via trait dispatch — see §3. The original draft describing an engine-internal oracle registry (`register-asset-oracle`, `lock-oracle-registry`) is abandoned.

---

## 1. Goal

Add `SP183MTM6NNBG18YSKCQG7Y5P5HVTAK8WSXJNKYMW.vgld-token-v4` as a second approved collateral on SSE mainnet alongside sBTC. Native FT asset name `vGLDv4`, 8 decimals, symbol `vGLD`, hard $1 USD peg. VoltFi (`https://app.voltfi.xyz/`) is the user-facing on-ramp.

---

## 2. On-chain prerequisites verified (2026-05-23)

Queried mainnet to scope work safely:

| Check | Result | Why it matters |
|---|---|---|
| `stablecoin-factory-v4 get-stablecoin-count` | `u1` | One stablecoin live |
| `stability-pool-v6 get-total-deposits(u0)` | `u0` | Pool empty — re-versioning strands nobody |
| `collateral-registry-v6 get-total-debt(sBTC)` | `u0` | No outstanding v7 debt |
| `stablecoin-token-v4 get-total-supply` | `u0` | Zero stablecoins minted |
| `multi-asset-vault-engine-v8` source | `404` | Not yet published |
| `liquidation-engine-v8` source | `404` | Not yet published |
| `price-oracle-vgld-v1` source | `404` | Not yet published |

Mainnet is effectively empty: switching the token's `vault-engine` var to v8 and re-versioning the stability pool break nothing.

---

## 3. Architecture (shipped v8)

### Trait-based oracle dispatch
- `multi-asset-vault-engine-v8.clar` accepts `(oracle <oracle-trait>)` on every pricing call site (`mint-against-asset-for-stablecoin`, `withdraw-collateral-for-stablecoin`, …). The engine validates `(contract-of oracle)` matches the principal registered in `collateral-registry-v6` for the given asset. Mismatch → price returned as `u0` → mint/withdraw refused.
- `liquidation-engine-v8.clar` does the same validation, fetches the price via `get-price`, then calls into the engine's read-only health-factor function with the resolved uint.
- `price-oracle-vgld-v1.clar` returns `(ok u100000000)` (= $1.00 at 8-decimal `PRICE-SCALE`). No DIA dependency, no admin, no staleness.

### Liquidation cascade — why pool-v7 is required
`stability-pool-v6.clar:289` hardcodes `(asserts! (is-eq contract-caller .liquidation-engine-v7) ...)` with no setter. `liquidation-engine-v8.clar` calls `.stability-pool-v6 distribute-liquidation-reward`, so that assertion would fail (`contract-caller = liquidation-engine-v8 ≠ .liquidation-engine-v7`) and every v8 liquidation would revert. The fix is a fresh `stability-pool-v7.clar` (line 289 swapped to `.liquidation-engine-v8`), with `vault-engine-v8` and `liquidation-engine-v8` re-pointed to `.stability-pool-v7` before publishing. Mainnet pool deposits = 0, so no depositor migration is needed.

### Governance posture
All risk-sensitive admin (vault-engine authorization in registry, `add-collateral-type`, `update-oracle`, parameter changes) routes through `sse-timelock-v1` from the Asigna multisig (`SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX`). Delay = 144 blocks (~24h). The only deployer-key step is `stablecoin-token-v4::set-vault-engine`, which is owner-gated (not bootstrap-lockable) — safe because mainnet has zero supply and no live v7 vaults.

---

## 4. Contracts to ship

### New (4 contracts)
1. **`price-oracle-vgld-v1.clar`** — 8-line constant-$1 oracle implementing `oracle-trait`.
2. **`stability-pool-v7.clar`** — byte-identical copy of v6 with line 289 swapped to `.liquidation-engine-v8`. Required to unblock v8 liquidations.
3. **`multi-asset-vault-engine-v8.clar`** — trait-based oracle dispatch. Internal `.stability-pool-v7` references at lines 895-896.
4. **`liquidation-engine-v8.clar`** — oracle validation + reward distribution. Internal `.stability-pool-v7` references at lines 66, 67, 84.

### Unchanged
`sse-governance-v1`, `sse-timelock-v1`, `stablecoin-factory-v4`, `stablecoin-token-v4`, `sbtc-token-v4`, `collateral-registry-v6`, `bridge-registry-v4`, `xreserve-adapter-v5`, `dia-oracle-adapter`, `price-oracle-dia-btc-v2`, `price-oracle-dia-stx-v2`, traits.

---

## 5. Risk parameters (final — `sse.config.json` mainnet.collaterals)

| Parameter | Value | Notes |
|---|---|---|
| Min collateral ratio | `150%` | Same as sBTC — conservative for first vGLD launch |
| Liquidation ratio | `120%` | Tighter than sBTC's 130% (vGLD ≈ $1) |
| Liquidation penalty | `10%` | Same as sBTC |
| Stability fee | `200` bps = `2%` APR | Same as sBTC |
| Debt ceiling | `100_000_000_000` (100k stablecoins) | One-tenth of sBTC's ceiling for soft launch; raise via `execute-coll-update` after observation |
| Debt floor | `10_000_000` (10 stablecoins) | Same as sBTC |
| Oracle | `<deployer>.price-oracle-vgld-v1` | Constant $1 |

---

## 6. Migration sequence

| # | Step | Caller | Mechanism | Delay |
|---|---|---|---|---|
| 1 | `npm run deploy -- --network mainnet` (publishes pool-v7, engine-v8, liq-v8, oracle-vgld) | Deployer (`SP3QMDAC…`) | `scripts/deploy.cjs` | — |
| 2 | Bootstrap `stablecoin-token-v4::set-vault-engine(v8)` | Deployer | auto-run by step 1 (owner-gated) | — |
| 3 | Bootstrap registry/governance calls → revert as `⊘ skipped` | Deployer | auto-run by step 1 (locked, expected) | — |
| 4 | Queue: `sse-timelock-v1::queue(id=A, hash, target=u2, fn=u5, eta)` for authorizing v8 in registry | Asigna multisig | timelock queue | — |
| 5 | Queue: `sse-timelock-v1::queue(id=B, hash, target=u2, fn=u1, eta)` for `add-collateral-type(vGLD,…)` | Asigna multisig | timelock queue | — |
| 6 | After 144 blocks (~24h): `sse-timelock-v1::execute-coll-set-vault-auth(id=A, engine, true)` | Asigna multisig | timelock execute | 144 blocks |
| 7 | After 144 blocks (~24h): `sse-timelock-v1::execute-coll-add(id=B, asset, …params, oracle)` | Asigna multisig | timelock execute | 144 blocks |
| 8 | Frontend constants flipped (`IS_MAINNET ? "*-v8" : …`), deploy frontend | Engineer | Netlify | — |
| 9 | Mainnet smoke test — open vault, deposit small vGLD, mint, repay, withdraw, close | Engineer | manual | — |

Steps 4-5 can be queued in the same wallet session. Steps 6-7 can be executed in either order after the 144-block delay elapses for both. End-to-end ≈ 24-30h from green-light to public roll-out.

---

## 7. Timelock action-hash computation

`sse-timelock-v1::queue` stores an `action-hash : (buff 32)` that each `execute-*` wrapper recomputes from its arguments and compares (fails with `ERR-HASH-MISMATCH = u1009` on any drift). The hashing scheme inside `contracts/sse-timelock-v1.clar:131-136` is:

```
sha256( to-consensus-buff?({t: target, f: fn}) ++ args-buff )
```

…where each execute wrapper passes `(to-consensus-buff? {…literal-args-tuple…})` as `args-buff`. Tuple keys for each execute wrapper:

| Execute fn | target/fn | Args tuple |
|---|---|---|
| `execute-coll-set-vault-auth` | u2 / u5 | `{engine: principal, authorized: bool}` |
| `execute-coll-add` | u2 / u1 | `{asset, min-cr, liq-r, liq-pen, fee, ceiling, floor-amt, oracle}` |

### Compute via the bundled script

```
node scripts/timelock-hashes.cjs
```

Reads the mainnet tip from Hiro, prints the recommended `eta` (tip + 144 + 24-block buffer) and the exact queue/execute payloads for both proposals. Cross-verified against the deployed timelock's `compute-hash` read-only.

### Pinned values (recomputed at execution time — re-run the script)

| Field | Proposal A (authorize v8) | Proposal B (add vGLD) |
|---|---|---|
| `target` | `u2` | `u2` |
| `fn` | `u5` | `u1` |
| Action hash | `0xcf2c071773bef6b79d0efd4232c8a803064e8e0eba76b37b2e0c84d3dd71646e` | `0xae585e03a74f786a27aeb6721d71b53536dde5f99159d83f9bbd289d3c26abab` |
| Execute fn | `execute-coll-set-vault-auth` | `execute-coll-add` |
| Execute args | `engine='SP3QMDAC….multi-asset-vault-engine-v8`, `authorized=true` | `asset='SP183MTM…vgld-token-v4`, `min-cr=u150`, `liq-r=u120`, `liq-pen=u10`, `fee=u200`, `ceiling=u100000000000`, `floor-amt=u10000000`, `oracle='SP3QMDAC….price-oracle-vgld-v1` |

The hashes only depend on the args, not the tip, so they stay valid until any input changes. Re-run the script before each queue submission anyway and paste the live output into the Asigna proposal description for auditability.

**Always cross-check** by calling `sse-timelock-v1::compute-hash(target, fn, args-buff)` as a read-only on mainnet — if it differs from the JS output, the JS helper is wrong, not the contract.

---

## 8. On-chain verification (after each proposal executes)

```bash
API=https://api.hiro.so
D=SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0
ENGINE_V8=$D.multi-asset-vault-engine-v8

# After step 6 — v8 authorized in registry
curl -s "$API/v2/contracts/source/$D/multi-asset-vault-engine-v8?proof=0" | head -c 200
# call-read is-vault-engine-authorized(ENGINE_V8) → expect (ok true)

# After step 7 — vGLD registered
# call-read get-collateral-config(SP183MTM…vgld-token-v4) → expect (some {oracle: …price-oracle-vgld-v1, min-collateral-ratio: u150, …})
# call-read get-oracle(SP183MTM…vgld-token-v4) → expect (some …price-oracle-vgld-v1)
```

---

## 9. Frontend changes (same release)

`frontend/src/lib/constants.ts`:
- `MAINNET_VGLD_ASSET_PRINCIPAL` defined (✓).
- `DEFAULT_VAULT_ENGINE`, `DEFAULT_LIQUIDATION_ENGINE`, `DEFAULT_STABILITY_POOL` use `IS_MAINNET` ternaries pointing to v8 / v8 / v7 on mainnet, v7 / v7 / v6 on testnet (✓).
- `FT_ASSET_NAMES["vgld-token-v4"]` = `"vGLDv4"` and `[MAINNET_VGLD_ASSET_PRINCIPAL]` = `"vGLDv4"` (✓).
- `COLLATERAL_DECIMALS[MAINNET_VGLD_ASSET_PRINCIPAL]` = `8` (✓).
- `FAUCET_COLLATERALS` Test vGLD excluded under `IS_MAINNET` (✓).

Build:
```bash
cd frontend && npm run build
```

---

## 10. Rollback / contingency

- **Pre-step-2** (engines deployed, token still on v7): revert frontend, no on-chain change executed beyond the publishes themselves. v8 engine sits unused. Safe.
- **Step 2 succeeded, step 6 not yet executed**: token's `vault-engine` is now v8, but registry has not authorized v8. Calls into the registry from v8 (`increase-stablecoin-debt`) will fail → minting blocked. To revert: call `stablecoin-token-v4::set-vault-engine(v7)` from deployer key. Reverts token back to v7.
- **After step 6 succeeded, step 7 pending**: v8 fully wired but vGLD not yet listed. Frontend can ship; vGLD vault creation gated by registry until step 7 lands. Safe.
- **After step 7 succeeded but params wrong**: queue `execute-coll-update` (FN-COLL-UPDATE = u2) to adjust risk params (24h delay), or `execute-coll-set-enabled(false)` (FN-COLL-SET-ENABLED = u3) for an immediate disable if listed in emergency whitelist (currently it is, target=u2 fn=u3).

---

## 11. Documentation updates (same PR as the contract changes)

- `README.md` — mainnet section: v8 contracts + pool-v7 + vGLD collateral row + oracle principal table.
- `docs/SSE_CONTEXT.md` — versioning section: append `stability-pool-v7`, `multi-asset-vault-engine-v8`, `liquidation-engine-v8`, `price-oracle-vgld-v1`. Add a "Collateral assets" subsection.
- `docs/roadmap.md` — add an entry under launched-mainnet for "vGLD collateral added (v8 engine + pool-v7)" with date.
- `sse.config.json` — `contractCosts` includes `stability-pool-v7`; `networks.mainnet.contractOverrides.stabilityPool = "stability-pool-v7"`; `networks.mainnet.deployContracts` includes `stabilityPool`.

---

## 12. Rollout checklist

- [ ] Risk params signed off (§5)
- [ ] `npm test` green (138 Vitest + Clarinet)
- [ ] `cd frontend && npm run build` green
- [ ] Mainnet `npm run deploy -- --network mainnet` — publishes pool-v7, engine-v8, liq-v8, oracle-vgld
- [ ] Confirm `stablecoin-token-v4::set-vault-engine(v8)` succeeded on-chain
- [ ] Asigna queues proposal A (`execute-coll-set-vault-auth(v8 engine, true)`) — hash precomputed via §7
- [ ] Asigna queues proposal B (`execute-coll-add(vGLD, 150, 120, 10, 200, 100_000_000_000, 10_000_000, oracle-vgld)`) — hash precomputed via §7
- [ ] Wait 144 blocks (~24h)
- [ ] Asigna executes proposal A; verify with §8
- [ ] Asigna executes proposal B; verify with §8
- [ ] Frontend prod release
- [ ] Mainnet smoke test (small vGLD open/mint/repay/close)
- [ ] Cross-promo with VoltFi
