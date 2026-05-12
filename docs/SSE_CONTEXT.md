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

Current on-chain versions (testnet, deployed 2026-05-12):

- **New**: `sse-governance-v1`, `sse-timelock-v1`
- **v4**: `stablecoin-factory-v4`, `bridge-registry-v4`, `stablecoin-token-v4`, `sbtc-token-v4`, `stx-token-v4`
- **v5**: `xreserve-adapter-v5`
- **v6**: `collateral-registry-v6`, `stability-pool-v6`
- **v7**: `multi-asset-vault-engine-v7`, `liquidation-engine-v7`
- **v2**: `price-oracle-dia-btc-v2`, `price-oracle-dia-stx-v2`
- **unchanged**: `dia-oracle-adapter`, `sip-010-trait`, `oracle-trait`, `bridge-adapter-trait`, `stablecoin-engine-token-trait`

Versions get bumped together when cross-references change (Stacks contracts are immutable). All contracts that touch the governance handoff were re-versioned in this round.

## Deployment

All contracts are deployed via a single command:
```bash
npm run deploy
```

This reads `sse.config.json` for contract list and bootstrap steps. No version-specific scripts are needed.
