# Stacks Stablecoin Engine (SSE)

## Project Overview
Stacks Stablecoin Engine (SSE) is a minimal, reusable infrastructure template for experimenting with Bitcoin-backed, overcollateralized stablecoins on Stacks using sBTC. This is an early-stage prototype intended for a grant submission and rapid developer experimentation.

## Problem Statement
Developers who want to explore sBTC-backed CDP systems on Stacks need a clean, modular starting point. SSE provides that foundation with minimal logic, clear interfaces, and TODO markers for production-grade risk and liquidation systems.

## Grant Scope (Prototype Infrastructure Only)
This project is intentionally scoped to an 8–12 week grant timeline and focuses on infrastructure only:
- No governance
- No tokenomics
- No emissions model
- No frontend
- No AI components
- No advanced liquidation math

## Architecture Overview
High-level flow (simplified current state):

```
User → VaultEngine → StablecoinToken
              ↓
        CollateralRegistry
              ↓
            Oracle
```

## Contract Breakdown

### Core Contracts
- `vault-engine.clar`: Core CDP logic. Tracks vaults, collateral, and debt. Includes minimal health checks and TODOs for production math and sBTC transfers.
- `collateral-registry.clar`: Registry for collateral configurations (min ratio, liquidation penalty, debt ceiling).
- `stablecoin-token.clar`: Minimal SIP-010 token with mint/burn restricted to `vault-engine` and cross-chain bridge support.
- `liquidation-engine.clar`: Stub liquidation entry point with placeholder health checks.
- `stability-pool.clar`: Simple deposit/withdraw tracking with TODO for liquidation redistribution.

### Oracle Contracts
- `oracle-trait.clar`: Trait defining `get-price`.
- `price-oracle-mock.clar`: Mock oracle returning a constant price for testing.
- `sip-010-trait.clar`: Local SIP-010 trait definition used by the token.

### Cross-Chain Bridge Contracts
- `bridge-adapter-trait.clar`: Trait defining the interface for cross-chain bridge adapters (`mint-from-remote`, `burn-to-remote`).
- `xreserve-adapter.clar`: Adapter implementing the bridge trait for Circle's xReserve protocol (USDCx-style bridging).
- `bridge-registry.clar`: Registry mapping tokens to their bridge adapters and remote chain configurations.

## Collateral Registry Example Config
```clarity
;; Add one collateral config (example values only)
(contract-call? .collateral-registry add-collateral-type
  'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.stablecoin-token
  u150
  u10
  u1000000
)

;; Read back the stored config
(contract-call? .collateral-registry get-collateral-config
  'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.stablecoin-token
)
```

Note: this is a prototype example. Registry values are available for integration, but not all modules enforce every parameter yet.

## Installation Instructions
1. Install Clarinet (Homebrew):
   ```bash
   brew install clarinet
   ```
2. Install JS dependencies:
   ```bash
   npm install
   ```

## How to Run Tests
```bash
npm test
```

## How to Deploy
This project uses Clarinet deployment plans.

1. Configure your deployer in `settings/Testnet.toml`.
2. Generate a deployment plan:
   ```bash
   clarinet deployments generate --testnet
   ```
3. Apply the deployment plan:
   ```bash
   clarinet deployments apply --testnet
   ```

## Testnet Deployment (March 9, 2026)
Deployer principal:
- `ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF`

Published contract identifiers:
- `ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF.collateral-registry`
- `ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF.oracle-trait`
- `ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF.price-oracle-mock`
- `ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF.sip-010-trait`
- `ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF.stablecoin-token`
- `ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF.vault-engine`
- `ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF.liquidation-engine`
- `ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF.stability-pool`

Deployment summary:
- Total cost: `0.100090 STX`
- Confirmation time: `1 block`

## Post-Deployment Initialization (Required)
Before minting through `vault-engine`, the deployer must authorize it inside `stablecoin-token`:

```clarity
(contract-call? .stablecoin-token set-vault-engine
  'ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF.vault-engine
)
```

If this is skipped, `vault-engine` mint/burn calls will fail with `err u401`.

## How to Test on Testnet

### 1) Vault lifecycle smoke test
Use a testnet wallet account and call in this order:

1. `open-vault`
2. `deposit-collateral u1200`
3. `mint u600`
4. `burn u200`
5. `withdraw-collateral u300`

Then verify:
- `get-health-factor '<YOUR_TESTNET_PRINCIPAL>` is at least `u150`
- `stablecoin-token::get-balance '<YOUR_TESTNET_PRINCIPAL>` returns the expected remaining balance
- `stablecoin-token::get-total-supply` tracks aggregate mint/burn changes

### 2) Oracle sensitivity check
As deployer:
1. Call `price-oracle-mock::set-price u50000000` (drops price from 1.0 to 0.5 in 1e8 scale).
2. Re-check `vault-engine::get-health-factor '<YOUR_TESTNET_PRINCIPAL>`.
3. If health factor is below `u150`, call `liquidation-engine::liquidate '<YOUR_TESTNET_PRINCIPAL>`.

Expected behavior:
- Healthy vault: `liquidate` returns `(err u300)`
- Undercollateralized vault: `liquidate` returns `(ok true)` (stub liquidation path)

### 3) Collateral registry config check
As deployer:

```clarity
(contract-call? .collateral-registry add-collateral-type
  'ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF.stablecoin-token
  u150
  u10
  u1000000
)

(contract-call? .collateral-registry get-collateral-config
  'ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF.stablecoin-token
)
```

## Example Usage Flow
1. `open-vault`
2. `deposit-collateral`
3. `mint`
4. `burn`
5. `withdraw-collateral`

Note: Current collateral transfers and liquidation logic are placeholders with TODOs for production-grade behavior.


## User Flows (Grant Scope)

### Open Vault & Mint Stable Coin

```mermaid
sequenceDiagram
    participant U as User
    participant VE as VaultEngine
    participant OR as Oracle
    participant ST as StablecoinToken

    U->>VE: open-vault()
    U->>VE: deposit-collateral(amount)
    VE->>OR: get-price()
    OR-->>VE: price
    VE->>VE: compute health factor
    U->>VE: mint(amount)
    VE->>ST: mint stablecoin
    ST-->>U: transfer tokens
```


### Repay & Withdraw Collateral

```mermaid
sequenceDiagram
    participant U as User
    participant VE as VaultEngine
    participant ST as StablecoinToken
    participant OR as Oracle

    U->>VE: burn(amount)
    VE->>ST: burn tokens
    U->>VE: withdraw-collateral(amount)
    VE->>OR: get-price()
    OR-->>VE: price
    VE->>VE: validate health factor
    VE-->>U: return collateral
```

### Basic Liquidation Flow (Stub Logic)

```mermaid
sequenceDiagram
    participant L as Liquidator
    participant LE as LiquidationEngine
    participant VE as VaultEngine
    participant OR as Oracle
    participant SP as StabilityPool

    L->>LE: liquidate(owner)
    LE->>VE: get vault state
    VE->>OR: get-price()
    OR-->>VE: updated price
    VE->>VE: check undercollateralization
    LE->>SP: transfer debt (placeholder)
    SP-->>L: receive collateral (stub)
```

> Note: Liquidation math and redistribution logic are intentionally simplified in Phase 1



## User Flows (Out of Scope for Current Grant)

### Multi-Asset & Advanced Risk Model

```mermaid
sequenceDiagram
    participant U as User
    participant VE as VaultEngine
    participant CR as CollateralRegistry
    participant OR as Oracle

    U->>VE: deposit(asset, amount)
    VE->>CR: fetch asset config
    CR-->>VE: MCR, penalty, ceiling
    VE->>OR: get asset price
    OR-->>VE: price
    VE->>VE: calculate asset-specific health
    VE-->>U: updated vault state
```

### Cross-Chain Mint/Burn Architecture

```mermaid
sequenceDiagram
    participant User
    participant VaultEngine
    participant Bridge
    participant ExternalChain


    User->>VaultEngine: burn stablecoin
    VaultEngine->>Bridge: emit cross-chain message
    Bridge->>ExternalChain: verify message
    ExternalChain-->>User: mint wrapped representation
```

### Governance & Parameter Updates

```mermaid
sequenceDiagram
    participant DAO
    participant GovernanceContract
    participant VaultEngine

    DAO->>GovernanceContract: propose parameter update
    GovernanceContract->>GovernanceContract: vote + timelock
    GovernanceContract->>VaultEngine: update MCR / penalty
```

## Cross-Chain Bridge Infrastructure

SSE includes bridge-ready infrastructure so stablecoins created through the protocol can move cross-chain (Ethereum ↔ Stacks) using a USDCx/xReserve-style pattern.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Ethereum / EVM                           │
│  ┌──────────────┐        ┌─────────────────────────────────┐    │
│  │   USDC/ERC20 │───────▶│  xReserve (depositToRemote)     │    │
│  └──────────────┘        └─────────────────────────────────┘    │
└────────────────────────────────┬────────────────────────────────┘
                                 │ Attestation Service
┌────────────────────────────────▼────────────────────────────────┐
│                           Stacks                                │
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │ bridge-adapter-trait│◀───│ xreserve-adapter                │ │
│  └─────────────────────┘    └───────────┬─────────────────────┘ │
│                                         │                       │
│  ┌──────────────────────────────────────▼─────────────────────┐ │
│  │ stablecoin-token (with bridge hooks)                       │ │
│  │  • mint-from-bridge (adapter-only)                         │ │
│  │  • burn-to-remote (user-callable via adapter)              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ bridge-registry                                            │ │
│  │  • token → remote-chain-id, remote-address, adapter        │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Bridge Setup (Post-Deployment)

1. **Set the bridge adapter on the token:**
```clarity
(contract-call? .stablecoin-token set-bridge-adapter
  '<DEPLOYER>.xreserve-adapter
)
```

2. **Configure the adapter:**
```clarity
;; Set the attestation service (authorized to mint)
(contract-call? .xreserve-adapter set-attestation-service '<ATTESTATION_SERVICE_PRINCIPAL>)

;; Set the bridged token
(contract-call? .xreserve-adapter set-bridged-token '<DEPLOYER>.stablecoin-token)

;; Add supported chains
(contract-call? .xreserve-adapter add-supported-chain u1 "Ethereum Mainnet")
(contract-call? .xreserve-adapter add-supported-chain u11155111 "Ethereum Sepolia")
```

3. **Register token in bridge registry:**
```clarity
(contract-call? .bridge-registry add-chain u1 "Ethereum Mainnet")
(contract-call? .bridge-registry register-token
  '<DEPLOYER>.stablecoin-token
  '<DEPLOYER>.xreserve-adapter
)
```

### Cross-Chain Flow

**Deposit (Ethereum → Stacks):**
1. User approves xReserve on Ethereum to spend USDC
2. User calls `depositToRemote` with encoded Stacks recipient
3. Attestation service picks up the event
4. Attestation service calls `mint-from-remote` on xreserve-adapter
5. Adapter calls `mint-from-bridge` on stablecoin-token
6. User receives tokens on Stacks

**Withdrawal (Stacks → Ethereum):**
1. User calls `burn-to-remote` on xreserve-adapter with encoded EVM recipient
2. Adapter calls `burn-to-remote` on stablecoin-token
3. Token emits burn event with remote recipient data
4. Attestation service picks up the event
5. xReserve releases USDC to user on Ethereum

### TypeScript SDK Helpers

The `scripts/bridge/` directory contains helpers for cross-chain operations:

```typescript
import {
  encodeStacksAddressToBytes32,
  encodeEvmAddressToBytes32,
  depositToStacks,
  withdrawToEvm,
} from './scripts/bridge';

// Encode addresses for cross-chain calls
const stacksBytes32 = encodeStacksAddressToBytes32('ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM');
const evmBytes32 = encodeEvmAddressToBytes32('0x742d35Cc6634C0532925a3b844Bc9e7595f5bE21');
```

## Future Roadmap (Out of Scope for Current Grant)
- Multi-asset collateral
- Non-xReserve bridge providers (LayerZero, Wormhole)
- Governance and parameter updates
- Advanced liquidation auctions
- Frontend UI for bridging


## Disclaimer
This repository is a prototype infrastructure template only. It is not production-ready and should not be used to secure real value. Use at your own risk.
