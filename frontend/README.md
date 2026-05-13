# Stacks Stablecoin Engine (SSE) Frontend

A Next.js frontend for the Stacks Stablecoin Engine - a decentralized stablecoin platform built on the Stacks blockchain.

## Prerequisites

- Node.js 18+
- npm or yarn
- Deployed SSE smart contracts on Stacks testnet/mainnet

## Environment Setup

1. Copy the example environment file:

```bash
cp .env.example .env.local
```

2. Update the environment variables in `.env.local`:

```env
# Network Configuration
# Options: "testnet" or "mainnet"
NEXT_PUBLIC_NETWORK=testnet

# Contract deployer address
# Testnet: ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF
# Mainnet: Update with your mainnet deployer address
NEXT_PUBLIC_DEPLOYER_ADDRESS=ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF

# Optional contract-name overrides (for hotfix releases)
NEXT_PUBLIC_STABLECOIN_FACTORY_CONTRACT=stablecoin-factory-v4
NEXT_PUBLIC_MULTI_ASSET_VAULT_ENGINE_CONTRACT=multi-asset-vault-engine-v7
NEXT_PUBLIC_COLLATERAL_REGISTRY_CONTRACT=collateral-registry-v6
NEXT_PUBLIC_LIQUIDATION_ENGINE_CONTRACT=liquidation-engine-v7
NEXT_PUBLIC_STABILITY_POOL_CONTRACT=stability-pool-v6
NEXT_PUBLIC_BRIDGE_REGISTRY_CONTRACT=bridge-registry-v4
NEXT_PUBLIC_XRESERVE_ADAPTER_CONTRACT=xreserve-adapter-v5
```

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

## Build for Production

```bash
npm run build
npm start
```

## Smart Contract Deployment

The SSE contracts are already deployed on testnet at:

**Deployer:** `ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF`

**Deployed Contracts (current — see [`../sse.config.json`](../sse.config.json) for the canonical list):**
- `sse-governance-v1` - Admin/guardian/timelock principal store (Asigna multisig pinned)
- `sse-timelock-v1` - 24h timelock + emergency whitelist
- `stablecoin-factory-v4` - Stablecoin registration with governance-gated admin
- `multi-asset-vault-engine-v7` - Stablecoin-scoped multi-asset vault engine
- `stablecoin-token-v4` - SIP-010 stablecoin token (native FT)
- `stablecoin-engine-token-trait` - Token mint/burn trait used by vault engines
- `collateral-registry-v6` - Collateral configuration with governance-gated admin
- `liquidation-engine-v7` - Liquidation logic (full orchestration)
- `stability-pool-v6` - Stability pool deposits
- `price-oracle-dia-btc-v2` / `price-oracle-dia-stx-v2` - DIA-backed oracles
- `dia-oracle-adapter` - Forwards to real DIA oracle
- `bridge-adapter-trait` - Bridge adapter interface trait
- `bridge-registry-v4` - Bridge adapter/token registry (governance-gated)
- `xreserve-adapter-v5` - xReserve-style bridge adapter (governance-gated)
- `sbtc-token-v4` / `stx-token-v4` - Faucet collateral tokens (native FT)

To deploy your own contracts, from the project root run a single command:

```bash
npm run deploy
```

This reads [`sse.config.json`](../sse.config.json), runs tests, generates the Clarinet plan, deploys all new contracts, runs bootstrap (vault auth, oracle mappings, collateral types), wires governance to the Asigna multisig, and locks bootstrap.

To run locally with devnet:

```bash
clarinet devnet start
```

## Features

- **Stablecoin Factory**: Register new stablecoins
- **Vault Management**: Open vaults, deposit collateral, mint/burn stablecoins
- **Stability Pool**: Deposit sUSD to earn liquidation rewards
- **Liquidations**: Liquidate undercollateralized vaults
- **Governance** (`/governance`): Read-only inspector for the Asigna multisig + 24h timelock that owns all global admin functions. See [`docs/adl/governance.md`](../docs/adl/governance.md).

## Tech Stack

- Next.js 14 (App Router)
- React 18
- TypeScript
- Tailwind CSS
- @stacks/connect (wallet integration)
- @stacks/transactions (contract interactions)
