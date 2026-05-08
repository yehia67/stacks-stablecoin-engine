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

All contract-level TODOs from the grant scope have been completed and deployed as v6:
- **Collateral custody**: `multi-asset-vault-engine-v6` performs real SIP-010 token transfers on deposit/withdraw
- **Pool custody**: `stability-pool-v5` performs real SIP-010 token transfers with stablecoin-scoped balances
- **Liquidation reward accounting**: Creator-configurable reward percentage. Product-based deposit tracking for proportional loss. Reward-per-token pattern for collateral distribution.
- **Liquidation settlement**: Full orchestration in `liquidation-engine-v6`: health check → vault engine `liquidate-position` (seizes collateral, burns stablecoins) → stability pool `distribute-liquidation-reward`
- **Oracle integration**: DIA push-based oracle integration with staleness guard. `price-oracle-dia-btc-v2` / `price-oracle-dia-stx-v2` wrap DIA's `get-value` with configurable max-age check and ms→s timestamp conversion. Only DIA oracles (IDs 3/4) are supported; mock oracles have been removed.
- **Native fungible tokens**: All token contracts (`sbtc-token-v4`, `stx-token-v4`, `stablecoin-token-v4`) use `define-fungible-token` with `ft-transfer?`/`ft-mint?`/`ft-burn?` for proper Stacks post-condition enforcement.

## Versioning

Unchanged contracts remain at v3 on-chain (`stablecoin-factory-v3`). Token contracts were upgraded to v4 with native `define-fungible-token`: `sbtc-token-v4`, `stx-token-v4`, `stablecoin-token-v4`. The collateral registry is at v5: `collateral-registry-v5`. The stability pool is at v5: `stability-pool-v5`. The vault engine and liquidation engine were upgraded to v6: `multi-asset-vault-engine-v6`, `liquidation-engine-v6`. DIA oracle contracts remain at v2: `price-oracle-dia-btc-v2`, `price-oracle-dia-stx-v2`. The `dia-oracle-adapter` remains unchanged.

## Deployment

All contracts are deployed via a single command:
```bash
npm run deploy
```

This reads `sse.config.json` for contract list and bootstrap steps. No version-specific scripts are needed.
