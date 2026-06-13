# SSE Context

> See [`getting_started.md`](./getting_started.md) for the combined user + technical reference (personas, sequence diagrams, function tables). This file documents product intent and consistency rules.

## What SSE Is

Stacks Stablecoin Engine (SSE) is a modular protocol scaffold for launching and operating overcollateralized stablecoins on Stacks.

It is intended as infrastructure-as-a-service, not a single fixed stablecoin product.

## Current Product Intention

- creators register stablecoins through the factory
- each registration can link to a token contract
- users open and manage vaults against specific stablecoin IDs
- vault debt operations mint/burn the linked token contract

## Key Consistency Rules

1. Factory and vault engine must stay connected
   - no isolated registration flow
   - no minting flow that ignores stablecoin linkage

2. Vault state should be stablecoin-scoped
   - same user can have multiple vault namespaces (one per stablecoin)

3. UI terminology should be generic unless symbol is loaded from chain
   - avoid hardcoded `sUSD` labels

4. Health factor should be presented from on-chain reads where possible
   - previews are fine for UX, but canonical value is contract state

## Implementation Status

All contract-level TODOs from the grant scope have been completed and deployed:
- **Governance**: Asigna multisig + 24h timelock owns every global admin function. `sse-governance-v1` stores admin/guardian/timelock principals; `sse-timelock-v1` queues, executes, cancels, and exposes a no-delay emergency whitelist. Every governed contract has `bootstrap-locked = true` so the deployer key is permanently neutered. See [`adl/governance.md`](./adl/governance.md).
- **Collateral custody**: `multi-asset-vault-engine-v7` performs real SIP-010 token transfers on deposit/withdraw
- **Pool custody**: `stability-pool-v6` performs real SIP-010 token transfers with stablecoin-scoped balances
- **Liquidation reward accounting**: Creator-configurable reward percentage. Product-based deposit tracking for proportional loss. Reward-per-token pattern for collateral distribution.
- **Liquidation settlement**: Full orchestration in `liquidation-engine-v7`: health check → vault engine `liquidate-position` (seizes collateral, burns stablecoins) → stability pool `distribute-liquidation-reward`
- **Oracle integration**: DIA push-based oracle integration with staleness guard. `price-oracle-dia-btc-v2` / `price-oracle-dia-stx-v2` wrap DIA's `get-value` with configurable max-age check and ms→s timestamp conversion. Only DIA oracles (IDs 3/4) are supported; mock oracles have been removed.
- **Native fungible tokens**: All token contracts (`sbtc-token-v4`, `stx-token-v4`, `stablecoin-token-v4`) use `define-fungible-token` with `ft-transfer?`/`ft-mint?`/`ft-burn?` for proper Stacks post-condition enforcement.

## Versioning

**Mainnet (live, deployed 2026-05-17)** — deployer `SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0`, governance pinned to Asigna mainnet vault `SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX`, real sBTC (`SM3VDXK….sbtc-token`) registered as collateral, factory fee = `u0`.

**Testnet (frozen, deployed 2026-05-12)** — deployer `ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF`, governance pinned to Asigna testnet vault `SN32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8K3EJAEF`, fake `sbtc-token-v4` / `stx-token-v4` as test collateral. **Testnet uses old 3-arg local `sip-010-trait`** — repo source has since migrated to canonical SIP-010, so testnet is not redeployable from the current source. Use mainnet for new integration work.

Current contract versions (both networks):

- **New**: `sse-governance-v1`, `sse-timelock-v1`
- **v4**: `stablecoin-factory-v4`, `bridge-registry-v4`, `stablecoin-token-v4`, `sbtc-token-v4` (testnet only), `stx-token-v4` (testnet only)
- **v5**: `xreserve-adapter-v5`
- **v6**: `collateral-registry-v6`, `stability-pool-v6` (still used by v7 engine; mainnet active)
- **v7** (live on mainnet, frozen on testnet): `multi-asset-vault-engine-v7`, `liquidation-engine-v7` — hardcoded DIA oracle IDs (3/4)
- **v7 pool** (`stability-pool-v7`, mainnet live 2026-05-25) — cross-reference bump from v6 swapping the hardcoded liquidation-engine principal from `.liquidation-engine-v7` to `.liquidation-engine-v8`. Required to unblock v8 liquidations (v6 pool's `distribute-liquidation-reward` is pinned to v7 with no setter). Mainnet pool was empty at the time of the v8 cut, so no depositor migration.
- **v8** (mainnet live 2026-05-25, testnet live earlier): `multi-asset-vault-engine-v8`, `liquidation-engine-v8` — trait-based oracle dispatch; reads canonical oracle per-asset from `collateral-registry-v6` and accepts the oracle as a trait reference at every pricing call site. Internal `.stability-pool-v7` references at engine `:895-896` and liq-v8 `:66,67,84`. Read-only price-aware fns (`get-position-health-factor`, etc.) take `(price uint)` directly because Clarity disallows trait dispatch from read-only context.
- **v2**: `price-oracle-dia-btc-v2`, `price-oracle-dia-stx-v2`
- **v1**: `price-oracle-vgld-v1` (constant $1 USD, implements `oracle-trait`, used as the canonical oracle for the testnet vGLD collateral and as a stub for stable/pegged assets generally)
- **v1 (EGPB)**: `egpb-token-v1` (EGP Bond A — SSE-issued SIP-010 bond token, owner-gated `mint`/`burn`, owner = deployer key with `set-owner` handoff; FT asset name `EGPBv1`, 8 decimals) and `price-oracle-egpb-v1` (constant $1 USD, implements `oracle-trait`, canonical oracle for EGPB). Mainnet-only third collateral, registered via timelocked `execute-coll-add` — see `docs/plans/add-egpb-collateral.md`.
- **unchanged**: `dia-oracle-adapter`, `oracle-trait`, `bridge-adapter-trait`, `stablecoin-engine-token-trait`
- **canonical SIP-010** (referenced via Clarinet `requirements`): mainnet `SP3FBR2AGK…sip-010-trait-ft-standard` / testnet `ST1NXBK3K5…sip-010-trait-ft-standard`. SSE no longer ships its own SIP-010 trait file for mainnet — local `contracts/sip-010-trait.clar` is retained only for reference to the older testnet deployment.

Versions get bumped together when cross-references change (Stacks contracts are immutable). All contracts that touch the governance handoff were re-versioned in this round.

## Deployment

All contracts are deployed via a single command:
```bash
npm run deploy
```

This reads `sse.config.json` for contract list and bootstrap steps. No version-specific scripts are needed.
