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
NEXT_PUBLIC_STABLECOIN_FACTORY_CONTRACT=stablecoin-factory-v3
NEXT_PUBLIC_VAULT_ENGINE_CONTRACT=vault-engine-v3
NEXT_PUBLIC_MULTI_ASSET_VAULT_ENGINE_CONTRACT=multi-asset-vault-engine-v3
NEXT_PUBLIC_COLLATERAL_REGISTRY_CONTRACT=collateral-registry-v3
NEXT_PUBLIC_LIQUIDATION_ENGINE_CONTRACT=liquidation-engine-v3
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

**Deployed Contracts (all v3):**
- `stablecoin-factory-v3` - Stablecoin registration with configurable fee
- `vault-engine-v3` - Single-collateral CDP vault management
- `multi-asset-vault-engine-v3` - Stablecoin-scoped multi-asset vault engine
- `stablecoin-token-v3` - SIP-010 stablecoin token
- `stablecoin-engine-token-trait` - Token mint/burn trait used by vault engines
- `collateral-registry-v3` - Collateral configuration with per-asset oracles
- `liquidation-engine-v3` - Liquidation logic
- `stability-pool-v3` - Stability pool deposits
- `price-oracle-sbtc-v3` - sBTC price oracle
- `price-oracle-stx-v3` - STX price oracle
- `bridge-adapter-trait` - Bridge adapter interface trait
- `bridge-registry-v3` - Bridge adapter/token registry
- `xreserve-adapter-v3` - xReserve-style bridge adapter
- `sbtc-token-v3` - Faucet sBTC token (testnet only)
- `stx-token-v3` - Faucet STX token (testnet only)

To deploy your own contracts, from the project root:

```bash
# Step 1: Deploy core v3 contracts to testnet
npm run deploy:v3

# Step 2: Bootstrap (deploys faucet tokens + configures everything)
npm run bootstrap:v3

# Or run locally with devnet
clarinet devnet start
```

## Features

- **Stablecoin Factory**: Register new stablecoins
- **Vault Management**: Open vaults, deposit collateral, mint/burn stablecoins
- **Stability Pool**: Deposit sUSD to earn liquidation rewards
- **Liquidations**: Liquidate undercollateralized vaults

## Tech Stack

- Next.js 14 (App Router)
- React 18
- TypeScript
- Tailwind CSS
- @stacks/connect (wallet integration)
- @stacks/transactions (contract interactions)
