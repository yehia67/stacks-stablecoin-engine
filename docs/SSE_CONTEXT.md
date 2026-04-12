# SSE Context

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

All contract-level TODOs from the grant scope have been completed and deployed as v4:
- **Collateral custody**: `multi-asset-vault-engine-v4` performs real SIP-010 token transfers on deposit/withdraw
- **Pool custody**: `stability-pool-v4` performs real SIP-010 token transfers with stablecoin-scoped balances
- **Liquidation reward accounting**: Creator-configurable reward percentage. Product-based deposit tracking for proportional loss. Reward-per-token pattern for collateral distribution.
- **Liquidation settlement**: Full orchestration in `liquidation-engine-v4`: health check → vault engine `liquidate-position` (seizes collateral, burns stablecoins) → stability pool `distribute-liquidation-reward`
- **Oracle integration**: DIA push-based oracle integration with staleness guard. `price-oracle-dia-btc` / `price-oracle-dia-stx` wrap DIA's `get-value` with configurable max-age check. Mock oracles (IDs 1/2) retained for simnet; DIA oracles (IDs 3/4) for testnet/mainnet.

## Versioning

Unchanged contracts remain at v3 on-chain (`stablecoin-factory-v3`, `stablecoin-token-v3`). The core CDP contracts were upgraded to v4: `collateral-registry-v4`, `multi-asset-vault-engine-v4`, `stability-pool-v4`, `liquidation-engine-v4`. DIA oracle contracts (`dia-oracle-adapter`, `price-oracle-dia-btc`, `price-oracle-dia-stx`) were deployed alongside the v4 upgrade.

## Deployment

All contracts are deployed via a single command:
```bash
npm run deploy
```

This reads `sse.config.json` for contract list and bootstrap steps. No version-specific scripts are needed.
