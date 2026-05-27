# SSE Complete Flow Analysis

> See [`getting_started.md`](./getting_started.md) for the combined user + technical reference. This file tracks feature-by-feature coverage between contracts and frontend.

---

## 0. Active Engine Versions (per network)

| Network | Vault Engine | Liquidation Engine | Stability Pool | Notes |
|---|---|---|---|---|
| **Mainnet** | `multi-asset-vault-engine-v8` | `liquidation-engine-v8` | `stability-pool-v7` | Trait-based oracle dispatch (live 2026-05-25). Adds vGLD (`SP183MTM…vgld-token-v4`) via constant-$1 `price-oracle-vgld-v1`. v7 engine still authorized in registry (harmless; token only mints/burns via v8). |
| **Testnet** | `multi-asset-vault-engine-v8` | `liquidation-engine-v8` | `stability-pool-v6` | Trait-based dispatch (no vGLD; mainnet-only). |

The v8 engine reads the canonical oracle for an asset from `collateral-registry-v6` directly and takes the oracle as a trait reference at every pricing call site (`mint-against-asset`, `withdraw-collateral`, `liquidate-position`). Read-only price-aware functions take a `(price uint)` parameter directly (Clarity disallows trait dispatch from read-only context). See `frontend/src/lib/oracles.ts` for the registry-backed lookup helper.

Onboarding a new collateral on v8 requires only a timelocked `add-collateral-type` call with the oracle principal (and, if no existing feed fits, a tiny new oracle wrapper). No engine redeploy is ever needed again.

### Mainnet upgrade — vGLD + v8 + pool-v7 (executed 2026-05-25)

Published `price-oracle-vgld-v1`, `stability-pool-v7`, `multi-asset-vault-engine-v8`, `liquidation-engine-v8`. Deployer key flipped `stablecoin-token-v4` to v8 (owner-gated). Asigna multisig queued + executed two `sse-timelock-v1` proposals:
- `execute-coll-set-vault-auth(v8 engine, true)` — registry now authorizes v8 alongside v7
- `execute-coll-add(vGLD, 150, 120, 10, 200, 100_000_000_000, 10_000_000, …price-oracle-vgld-v1)` — vGLD live as second collateral

Execute txids: `0xfa1643288a538aa4d41eca8337b2d33bc4c161bb10bacc13da8d8d2d98c755da`, `0xc8e15225e60c44ae4a5b6e589899eb1816dcd2eaf2430373a707fa09815955e7`. Full plan + risk doc: `docs/plans/add-vgld-collateral.md`. Operational runbook: `docs/plans/timelock-operations.md`.

---

## 1. Stablecoin Factory (Registration & Token Linking)

### Contract: `stablecoin-factory-v4` (governance-gated)
### Frontend: `/factory`

| Feature | Contract | Frontend | Status |
|---|---|---|---|
| Register stablecoin (name + symbol, pays STX fee) | ✅ | ✅ | **Working** |
| Set token contract (link deployed SIP-010 to registration) | ✅ | ✅ | **Working** |
| Deploy & auto-link token contract | — | ✅ | **Working** (FE-only: deploys via `openContractDeploy`, then calls `set-token-contract`) |
| Name/symbol uniqueness check | ✅ | ✅ | **Working** |
| Admin: set registration fee | ✅ | ✅ | **Multisig-only** — queue via `sse-timelock-v1::execute-factory-set-fee` from Asigna; `/governance` inspector |
| Admin: set treasury address | ✅ | ✅ | **Multisig-only** — queue via `sse-timelock-v1::execute-factory-set-treasury` from Asigna; `/governance` inspector |
| Read: get stablecoin by name/symbol | ✅ | ❌ | Not used in FE |
| Read: get creator's stablecoins | ✅ | ✅ (via iteration) | **Working** |

---

## 2. Collateral Registry (Per-Stablecoin Risk Configuration)

### Contract: `collateral-registry-v6` (governance-gated)
### Frontend: `/factory` (configure collateral section)

| Feature | Contract | Frontend | Status |
|---|---|---|---|
| **Admin**: add global collateral type (asset + oracle + risk params) | ✅ | ❌ | **No FE** — admin-only, done via deployment scripts |
| **Admin**: update global collateral params | ✅ | ❌ | **No FE** |
| **Admin**: enable/disable global collateral | ✅ | ❌ | **No FE** |
| **Admin**: update oracle address | ✅ | ❌ | **No FE** |
| **Admin**: authorize vault engines | ✅ | ❌ | **No FE** |
| **Creator**: configure collateral for their stablecoin | ✅ | ✅ | **Working** |
| **Creator**: update collateral config for their stablecoin | ✅ | ✅ | **Working** — Factory panel now loads existing per-stablecoin config and saves updates on-chain |
| **Creator**: disable collateral for their stablecoin | ✅ | ✅ | **Working** — Factory panel can disable enabled collateral configs on-chain |
| **Creator**: re-enable collateral for their stablecoin | ✅ | ✅ | **Working** — Factory panel can re-enable disabled collateral configs on-chain |
| Global/per-stablecoin debt tracking (increase/decrease) | ✅ | — | Internal, called by vault engine |
| Read: effective config (max of global vs per-stablecoin) | ✅ | ✅ | Used by vault creation page for health factor |

---

## 3. Vault Engine (Legacy Single-Collateral)

### Contract: `vault-engine-v3` — **DELETED**

The legacy single-collateral vault engine has been removed. All vault operations now go through `multi-asset-vault-engine-v7`. Frontend hooks for the legacy engine (`openVault`, `depositCollateral`, `withdrawCollateral`, `mint`, `burn`) have been removed.

---

## 4. Multi-Asset Vault Engine (Production)

### Contract: `multi-asset-vault-engine-v7` (governance-gated `register-asset-oracle`)
### Frontend: `/vaults/new`, `/vaults`

| Feature | Contract | Frontend | Status |
|---|---|---|---|
| Open vault for stablecoin | ✅ | ✅ | **Working** |
| Deposit collateral for stablecoin (real SIP-010 transfer to custody) | ✅ | ✅ | **Working** |
| Withdraw collateral for stablecoin (real SIP-010 transfer from custody) | ✅ | ✅ | **Working** — manage page supports per-position withdrawals |
| Mint against asset for stablecoin (with token trait) | ✅ | ✅ | **Working** |
| Repay against asset for stablecoin (with token trait) | ✅ | ✅ | **Working** — manage page supports per-position debt repayment |
| Backward-compat: open-vault / deposit / withdraw / mint / repay (stablecoin-id=0) | ✅ | — | Legacy paths (require per-stablecoin collateral config) |
| **Admin**: register asset oracle mapping | ✅ | ❌ | **No FE** |
| Read: vault, collateral position, health factor, liquidation status, max-mintable, total vault value | ✅ | ✅ (partial) | Vaults page reads vault + positions + health factor. **`get-max-mintable-for-stablecoin` and `get-position-liquidation-status-for-stablecoin` not used in FE** |

### ✅ Existing vault management now wired:
- **Repay debt** — available on `/vaults/[stablecoinId]` for each collateral position
- **Withdraw collateral** — available on `/vaults/[stablecoinId]` with on-chain confirmation flow
- **Vault management page** (`/vaults/[stablecoinId]`) — now exists and is linked from the vault list

---

## 5. Stability Pool

### Contract: `stability-pool-v6`
### Frontend: `/pool`

| Feature | Contract | Frontend | Status |
|---|---|---|---|
| Deposit stablecoins to pool (stablecoin-scoped, real SIP-010 transfer) | ✅ | ✅ | **Working** — tokens transferred to pool custody, validated against factory-linked token |
| Withdraw from pool (stablecoin-scoped, real SIP-010 transfer) | ✅ | ✅ | **Working** — tokens returned from pool custody to user |
| Set liquidation reward % (creator only) | ✅ | ✅ | **Working** — creator sets basis-points reward pct (max 50%) |
| Distribute liquidation reward (called by liquidation engine) | ✅ | N/A | **Working** — updates product (deposit shrinkage) + reward-per-token |
| Claim collateral reward | ✅ | ✅ | **Working** — depositors claim seized collateral proportionally |
| Read: balance-of-for-stablecoin (effective, post-liquidation) | ✅ | ✅ | **Working** — pool page shows the connected user's effective deposit |
| Read: get-total-deposits | ✅ | ✅ | **Working** — pool page shows total stablecoin deposits |
| Read: get-claimable-collateral-reward | ✅ | ✅ | **Working** — pool page lists claimable rewards per collateral asset |
| Read: get-liquidation-reward-pct | ✅ | ✅ | **Working** — pool page shows the current creator-set reward bonus |

### ⚠️ Remaining gaps:
- No APY calculation
- Pool page does not read wallet token balances yet

---

## 6. Liquidation Engine

### Contract: `liquidation-engine-v7`
### Frontend: `/liquidations`

**Liquidation engine now orchestrates the full flow:**
1. Checks vault health factor < MIN_HEALTH
2. Calculates debt to offset (min of vault debt and pool deposits)
3. Calculates collateral to seize (proportional + creator-set reward bonus)
4. Calls vault engine `liquidate-position` (seizes collateral → pool, burns pool stablecoins)
5. Calls stability pool `distribute-liquidation-reward` (updates product + reward-per-token)

| Feature | Contract | Frontend | Status |
|---|---|---|---|
| Liquidate an undercollateralized vault | ✅ | ✅ (UI) | **Working** — full orchestration: health check → debt offset → collateral seizure with reward bonus → pool accounting |
| Vault engine `liquidate-position` | ✅ | N/A | **Working** — seizes collateral to pool, burns pool stablecoins, reduces vault/registry debt |
| Browse liquidatable vaults | — | ✅ (UI shell) | **FE has `TODO: Fetch from contracts`** — empty array, shows "No Liquidatable Vaults" |

### ⚠️ Remaining gaps:
- FE doesn't scan for liquidatable vaults on-chain

---

## 7. Cross-Chain Bridge

### Contracts: `bridge-registry-v4`, `xreserve-adapter-v5`, `bridge-adapter-trait` (all governance-gated)
### Frontend: `/governance` (read-only inspector); write flows still go through Asigna

| Feature | Contract | Frontend | Status |
|---|---|---|---|
| Register token for bridging | ✅ | ❌ | **No FE** |
| Configure token for remote chain (address, min/max amounts) | ✅ | ❌ | **No FE** |
| Add/disable supported chains | ✅ | ❌ | **No FE** |
| `mint-from-remote` (attestation service mints on Stacks after remote deposit) | ✅ | ❌ | **No FE** — called by off-chain attestation service |
| `burn-to-remote` (user burns on Stacks to withdraw on remote chain) | ✅ | ❌ | **No FE** |
| Replay protection for remote txs | ✅ | — | Internal |
| Emergency pause | ✅ | ❌ | **No FE** |

This is an **xReserve/CCTP-style bridge** for moving stablecoins cross-chain (e.g., Stacks ↔ Ethereum). The entire bridge subsystem has **zero frontend integration**.

---

## 8. Price Oracles

### DIA Oracles: `price-oracle-dia-btc-v2`, `price-oracle-dia-stx-v2`, `dia-oracle-adapter`

| Feature | Contract | Frontend | Status |
|---|---|---|---|
| Get price (DIA) | ✅ | ✅ | **Working** — DIA oracles active on testnet (oracle IDs 3/4) |
| Staleness guard | ✅ | — | **Working** — DIA oracles reject stale prices (configurable max-age) |
| Timestamp conversion | ✅ | — | **Working** — v2 oracles convert DIA ms timestamps to seconds |

DIA oracles (IDs 3/4) are used on all networks, forwarding to `ST1S5ZGRZV5K4S9205RWPRTX9RGS9JV40KQMR4G1J.dia-oracle`. Mock oracles have been removed.

---

## 9. Token Contracts

### Contracts: `stablecoin-token-v4`, `sbtc-token-v4`, `stx-token-v4`

| Feature | Contract | Frontend | Status |
|---|---|---|---|
| SIP-010 transfer | ✅ | — | Standard |
| Vault engine mint/burn | ✅ | — | Called by vault engine |
| Bridge mint/burn (`mint-from-bridge`, `burn-to-remote`) | ✅ (`stablecoin-token-v4`) | ❌ | **No FE** |
| Faucet mint (test tokens) | ✅ (`sbtc-token-v4`, `stx-token-v4`) | ✅ | **Working** — home-page faucet section mints 10 sBTC / 10 STX |
| Token balance display | ✅ | ❌ | **No FE shows user token balances** |

---

## 10. Dashboard

### Frontend: `/dashboard`

All data is **stub** — `TODO: Fetch from contracts` everywhere:
- Protocol stats (TVL, total debt, active vaults, avg collateral ratio) — all "—"
- User position summary — all "—"
- User vaults list — empty

---

# Summary: What Users Can Actually Do End-to-End

### ✅ Fully working flows:
1. **Register a stablecoin** (name, symbol, pay fee) → `/factory`
2. **Deploy & link a token contract** → `/factory`
3. **Configure, update, or disable collateral** (STX and/or sBTC) for a stablecoin → `/factory`
4. **Open vault → deposit collateral → mint stablecoins** → `/vaults/new`
5. **View and manage existing vaults** (positions, health factors, repay, withdraw) → `/vaults`, `/vaults/[stablecoinId]`
6. **Use the stability pool** (deposit, withdraw, claim rewards, view pool stats) → `/pool`
7. **Faucet mint** test sBTC/STX → `/` (home page)

### ❌ Contract features with zero FE:
- **Cross-chain bridge** (burn-to-remote, mint-from-remote) — entire subsystem
- **Liquidation vault scanning** — contract logic is complete, FE doesn't scan for liquidatable vaults on-chain
- **Dashboard data** — all stats are placeholders
- **Token balance display** — wallet balances for stablecoin/collateral assets are still not shown

### 🔐 Admin functions (now multisig-gated, write flow on Asigna):
- registration fee, treasury, global collateral management, oracle updates, vault engine authorization, bridge chain/token mgmt, xReserve pause/attestation
- Frontend `/governance` is **read-only**: shows roles, delay, lock status, governed contracts, emergency whitelist, queued-action lookup. Write flows happen on `https://stx.asigna.io/`.

### ✅ Mainnet launched 2026-05-17

- **Deployer**: `SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0`
- **Governance**: pinned to Asigna mainnet vault `SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX` (admin + guardian). 144-block timelock. All five governed contracts bootstrap-locked.
- **Collateral**: real sBTC (`SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token`) registered. CR 150% / liq 120% / penalty 10% / fee 2%.
- **Factory fee**: `u0` (free creation for v1).
- **SIP-010**: canonical mainnet trait referenced directly; 4-arg `transfer` with memo across all contracts. Token template that the frontend deploys for new stablecoins also impl-traits canonical SIP-010.

### ✅ Contract-level TODOs (all completed, originally deployed on testnet 2026-05-12, mainnet 2026-05-17):
- **Governance**: Asigna multisig + 24h timelock (`sse-governance-v1`, `sse-timelock-v1`). All five governed contracts (`stablecoin-factory-v4`, `collateral-registry-v6`, `bridge-registry-v4`, `xreserve-adapter-v5`, `multi-asset-vault-engine-v7`) are bootstrap-locked. Deployer key has zero admin power. See [`adl/governance.md`](./adl/governance.md). Frontend inspector at `/governance`. Asigna vault dashboards: [testnet](https://stx.asigna.io/vault/SN32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8K3EJAEF/dashboard) · [mainnet](https://stx.asigna.io/vault/SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX/dashboard).
- **Actual collateral custody**: `multi-asset-vault-engine-v7` deposit/withdraw perform real SIP-010 token transfers. Collateral tokens are transferred to contract custody on deposit and returned to user on withdrawal. Asset mismatch validation (`ERR_ASSET_MISMATCH`) ensures the correct token trait is passed.
- **Stability pool custody**: `stability-pool-v6` performs real SIP-010 token transfers with stablecoin-scoped balances. Token validated against factory-linked contract (`ERR_TOKEN_MISMATCH`).
- **Native fungible tokens**: All token contracts use `define-fungible-token` with `ft-transfer?`/`ft-mint?`/`ft-burn?` for proper Stacks post-condition enforcement in wallet UIs.
- **Liquidation reward accounting**: Creator-configurable reward percentage (basis points). Product-based deposit tracking for proportional loss. Reward-per-token pattern for collateral distribution. Full liquidation flow: vault engine seizes collateral + burns stablecoins, stability pool updates accounting.
- **Liquidation engine**: `liquidation-engine-v7` — Full orchestration: health check → calculate amounts → vault engine liquidate-position → pool distribute-liquidation-reward
- **Oracles**: DIA push-based oracle integration. `dia-oracle-adapter` forwards to the real DIA oracle on testnet. `price-oracle-dia-btc-v2` and `price-oracle-dia-stx-v2` implement `oracle-trait` with configurable staleness guard and ms→s timestamp conversion. Vault engine supports oracle IDs 3/4 (DIA only). DIA testnet: `ST1S5ZGRZV5K4S9205RWPRTX9RGS9JV40KQMR4G1J.dia-oracle`. Prices use 8 decimal places (matches SSE's `PRICE-SCALE`).
