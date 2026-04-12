Let me systematically analyze the smart contracts and frontend to map out all flows.






Now let me check the [useContract.ts](cci:7://file:///Users/yehiatarek/Documents/projects/Stacks/Stacks%20Stablecoin%20Engine%20%28SSE%29/frontend/stacks-stablecoin-engine/src/hooks/useContract.ts:0:0-0:0) hook to see what contract calls are wired up on the frontend:

Now I have a complete picture. Here's the full analysis:

---

# SSE Complete Flow Analysis

## 1. Stablecoin Factory (Registration & Token Linking)

### Contract: `stablecoin-factory-v3`
### Frontend: [/factory](cci:9://file:///Users/yehiatarek/Documents/projects/Stacks/Stacks%20Stablecoin%20Engine%20%28SSE%29/frontend/src/app/factory:0:0-0:0)

| Feature | Contract | Frontend | Status |
|---|---|---|---|
| Register stablecoin (name + symbol, pays STX fee) | ✅ | ✅ | **Working** |
| Set token contract (link deployed SIP-010 to registration) | ✅ | ✅ | **Working** |
| Deploy & auto-link token contract | — | ✅ | **Working** (FE-only: deploys via `openContractDeploy`, then calls `set-token-contract`) |
| Name/symbol uniqueness check | ✅ | ✅ | **Working** |
| Admin: set registration fee | ✅ | ❌ | **No FE** |
| Admin: set treasury address | ✅ | ❌ | **No FE** |
| Read: get stablecoin by name/symbol | ✅ | ❌ | Not used in FE |
| Read: get creator's stablecoins | ✅ | ✅ (via iteration) | **Working** |

---

## 2. Collateral Registry (Per-Stablecoin Risk Configuration)

### Contract: `collateral-registry-v4`
### Frontend: [/factory](cci:9://file:///Users/yehiatarek/Documents/projects/Stacks/Stacks%20Stablecoin%20Engine%20%28SSE%29/frontend/src/app/factory:0:0-0:0) (configure collateral section)

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

The legacy single-collateral vault engine has been removed. All vault operations now go through `multi-asset-vault-engine-v4`. Frontend hooks for the legacy engine (`openVault`, `depositCollateral`, `withdrawCollateral`, `mint`, `burn`) have been removed.

---

## 4. Multi-Asset Vault Engine (Production)

### Contract: `multi-asset-vault-engine-v4`
### Frontend: `/vaults/new`, [/vaults](cci:9://file:///Users/yehiatarek/Documents/projects/Stacks/Stacks%20Stablecoin%20Engine%20%28SSE%29/frontend/src/app/vaults:0:0-0:0)

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

### Contract: `stability-pool-v4`
### Frontend: [/pool](cci:9://file:///Users/yehiatarek/Documents/projects/Stacks/Stacks%20Stablecoin%20Engine%20%28SSE%29/frontend/src/app/pool:0:0-0:0)

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

### Contract: `liquidation-engine-v4`
### Frontend: [/liquidations](cci:9://file:///Users/yehiatarek/Documents/projects/Stacks/Stacks%20Stablecoin%20Engine%20%28SSE%29/frontend/src/app/liquidations:0:0-0:0)

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

### Contracts: `bridge-registry-v3`, `xreserve-adapter-v3`, `bridge-adapter-trait`
### Frontend: **None**

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

### Mock Oracles: `price-oracle-sbtc-v3`, `price-oracle-stx-v3`
### DIA Oracles: `price-oracle-dia-btc`, `price-oracle-dia-stx`, `dia-oracle-adapter`

| Feature | Contract | Frontend | Status |
|---|---|---|---|
| Get price (mock) | ✅ | ✅ | Used for health factor calculations in vault creation |
| Get price (DIA) | ✅ | ✅ | **Working** — DIA oracles active on testnet (oracle IDs 3/4) |
| Staleness guard | ✅ | — | **Working** — DIA oracles reject stale prices (configurable max-age) |
| **Admin**: set price (mock) | ✅ | ❌ | **No FE** — mock oracle, admin-only |

Mock oracles (IDs 1/2) are used for simnet/devnet. DIA oracles (IDs 3/4) are used on testnet/mainnet, forwarding to `ST1S5ZGRZV5K4S9205RWPRTX9RGS9JV40KQMR4G1J.dia-oracle`.

---

## 9. Token Contracts

### Contracts: `stablecoin-token-v3`, `sbtc-token-v3`, `stx-token-v3`

| Feature | Contract | Frontend | Status |
|---|---|---|---|
| SIP-010 transfer | ✅ | — | Standard |
| Vault engine mint/burn | ✅ | — | Called by vault engine |
| Bridge mint/burn (`mint-from-bridge`, `burn-to-remote`) | ✅ (`stablecoin-token-v3`) | ❌ | **No FE** |
| Faucet mint (test tokens) | ✅ (`sbtc-token-v3`, `stx-token-v3`) | ❌ | **No FE** — useful for testing |
| Token balance display | ✅ | ❌ | **No FE shows user token balances** |

---

## 10. Dashboard

### Frontend: [/dashboard](cci:9://file:///Users/yehiatarek/Documents/projects/Stacks/Stacks%20Stablecoin%20Engine%20%28SSE%29/frontend/src/app/dashboard:0:0-0:0)

All data is **stub** — `TODO: Fetch from contracts` everywhere:
- Protocol stats (TVL, total debt, active vaults, avg collateral ratio) — all "—"
- User position summary — all "—"
- User vaults list — empty

---

# Summary: What Users Can Actually Do End-to-End

### ✅ Fully working flows:
1. **Register a stablecoin** (name, symbol, pay fee) → [/factory](cci:9://file:///Users/yehiatarek/Documents/projects/Stacks/Stacks%20Stablecoin%20Engine%20%28SSE%29/frontend/src/app/factory:0:0-0:0)
2. **Deploy & link a token contract** → [/factory](cci:9://file:///Users/yehiatarek/Documents/projects/Stacks/Stacks%20Stablecoin%20Engine%20%28SSE%29/frontend/src/app/factory:0:0-0:0)
3. **Configure, update, or disable collateral** (STX and/or sBTC) for a stablecoin → [/factory](cci:9://file:///Users/yehiatarek/Documents/projects/Stacks/Stacks%20Stablecoin%20Engine%20%28SSE%29/frontend/src/app/factory:0:0-0:0)
4. **Open vault → deposit collateral → mint stablecoins** → `/vaults/new`
5. **View and manage existing vaults** (positions, health factors, repay, withdraw) → [/vaults](cci:9://file:///Users/yehiatarek/Documents/projects/Stacks/Stacks%20Stablecoin%20Engine%20%28SSE%29/frontend/src/app/vaults:0:0-0:0), `/vaults/[stablecoinId]`
6. **Use the stability pool** (deposit, withdraw, claim rewards, view pool stats) → [/pool](cci:9://file:///Users/yehiatarek/Documents/projects/Stacks/Stacks%20Stablecoin%20Engine%20%28SSE%29/frontend/src/app/pool:0:0-0:0)

### ❌ Contract features with zero FE:
7. **Cross-chain bridge** (burn-to-remote, mint-from-remote) — entire subsystem
8. **Liquidation vault scanning** — contract logic is complete, FE doesn't scan for liquidatable vaults on-chain
9. **Dashboard data** — all stats are placeholders
10. **Faucet mint** for test sBTC/STX tokens
11. **Admin functions** — registration fee, treasury, global collateral management, oracle updates, vault engine authorization
12. **Token balance display** — wallet balances for stablecoin/collateral assets are still not shown

### ✅ Contract-level TODOs (all completed, deployed as v4):
- **Actual collateral custody**: `multi-asset-vault-engine-v4` deposit/withdraw perform real SIP-010 token transfers. Collateral tokens are transferred to contract custody on deposit and returned to user on withdrawal. Asset mismatch validation (`ERR_ASSET_MISMATCH`) ensures the correct token trait is passed.
- **Stability pool custody**: `stability-pool-v4` performs real SIP-010 token transfers with stablecoin-scoped balances. Token validated against factory-linked contract (`ERR_TOKEN_MISMATCH`).
- **Liquidation reward accounting**: Creator-configurable reward percentage (basis points). Product-based deposit tracking for proportional loss. Reward-per-token pattern for collateral distribution. Full liquidation flow: vault engine seizes collateral + burns stablecoins, stability pool updates accounting.
- **Liquidation engine**: `liquidation-engine-v4` — Full orchestration: health check → calculate amounts → vault engine liquidate-position → pool distribute-liquidation-reward
- **Oracles**: DIA push-based oracle integration. `dia-oracle-adapter` provides the DIA interface locally (mock for simnet, forwarding adapter for testnet). `price-oracle-dia-btc` and `price-oracle-dia-stx` implement `oracle-trait` with configurable staleness guard. Vault engine supports oracle IDs 1-4 (1/2 = mock, 3/4 = DIA). DIA testnet: `ST1S5ZGRZV5K4S9205RWPRTX9RGS9JV40KQMR4G1J.dia-oracle`. Prices use 8 decimal places (matches SSE's `PRICE-SCALE`).
