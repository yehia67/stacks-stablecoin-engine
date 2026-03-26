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

**Deployed Contracts:**
- `stablecoin-factory-v2` - Stablecoin registration with 10 STX fee
- `vault-engine` - CDP vault management
- `stablecoin-token` - SIP-010 stablecoin token
- `collateral-registry` - Collateral configuration
- `liquidation-engine` - Liquidation logic
- `stability-pool` - Stability pool deposits
- `price-oracle-mock` - Mock price oracle

To deploy your own contracts, from the project root:

```bash
# Deploy to testnet
clarinet deployments apply -p deployments/default.testnet-plan.yaml

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
