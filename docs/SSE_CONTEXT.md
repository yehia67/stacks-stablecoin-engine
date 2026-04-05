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

## Prototype Caveats

The repo still contains placeholders/TODOs for:
- ~~custody transfers for collateral~~ — **DONE**: `multi-asset-vault-engine-v3` now performs real SIP-010 token transfers on deposit/withdraw
- ~~custody transfers for pool assets~~ — **DONE**: `stability-pool-v3` now performs real SIP-010 token transfers with stablecoin-scoped balances; liquidation reward accounting still TODO
- advanced liquidation settlement logic
- production-grade oracle validation

These are known prototype boundaries and should be documented when touched.
