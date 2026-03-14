# Cross-Chain Stablecoin Infrastructure Plan

Add bridge-ready infrastructure to SSE so that every stablecoin created through the protocol can be bridged to/from Ethereum (and other EVM chains) using a pattern similar to USDCx and Circle's xReserve.



## Background

The USDCx model on Stacks works as follows:
1. **Deposit (Ethereum → Stacks):** User approves xReserve on Ethereum, calls `depositToRemote`, and the Stacks attestation service mints the equivalent token on Stacks.
2. **Withdrawal (Stacks → Ethereum):** User calls `burn` on the Stacks token contract with a `native-recipient` (bytes32-encoded Ethereum address). The attestation service verifies the burn and releases USDC on Ethereum.

To replicate this for *any* stablecoin issued by SSE, we need:
- A **bridge-aware token contract** with `burn-to-remote` and `mint-from-remote` entry points.
- A **bridge-adapter trait** so different bridge providers can be plugged in.
- An optional **bridge-registry** to track which stablecoins are bridge-enabled and their remote chain metadata.
- TypeScript/JS helpers for encoding addresses and interacting with the EVM side.



## Deliverables

### 1. New Clarity Contracts

| Contract | Purpose |
|----------|---------|
| `bridge-adapter-trait.clar` | Trait defining `mint-from-remote` and `burn-to-remote` signatures. |
| `xreserve-adapter.clar` | Concrete adapter implementing the trait for Circle's xReserve/attestation flow. |
| `bridgeable-token.clar` | Extended SIP-010 token with bridge hooks (`burn-to-remote`, authorized `mint-from-remote`). Can be used as a template or base for new stablecoins. |
| `bridge-registry.clar` | (Optional) Registry mapping token principals to remote chain IDs, remote token addresses, and adapter principals. |


### 2. Modifications to Existing Contracts

- **`stablecoin-token.clar`**: Add `burn-to-remote` public function and allow an authorized bridge adapter to call `mint`.
- **`vault-engine.clar`**: No changes required initially; bridging is a token-layer concern.

### 3. TypeScript/JS SDK Helpers (`scripts/bridge/`)

- `encodeStacksAddress.ts` – Convert Stacks address to bytes32 for Ethereum contracts.
- `encodeEvmAddress.ts` – Convert Ethereum address to 32-byte buffer for Clarity.
- `depositToStacks.ts` – Viem-based script to approve and call `depositToRemote` on xReserve.
- `withdrawToEvm.ts` – Stacks.js script to call `burn-to-remote` on the bridgeable token.

### 4. Documentation & Tests

- Update `README.md` with cross-chain architecture diagram and usage examples.
- Add Clarinet unit tests for bridge adapter authorization and burn/mint flows.
- Add integration test scripts for testnet deposit/withdrawal.



## High-Level Architecture

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
│  │ bridgeable-token (or stablecoin-token w/ bridge hooks)     │ │
│  │  • mint-from-remote (adapter-only)                         │ │
│  │  • burn-to-remote (user-callable)                          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ bridge-registry (optional)                                 │ │
│  │  • token → remote-chain-id, remote-address, adapter        │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```



## Implementation Steps

1. **Create `bridge-adapter-trait.clar`** – Define the interface.
2. **Create `xreserve-adapter.clar`** – Implement xReserve-specific logic (mostly authorization checks; actual minting delegated to token).
3. **Extend `stablecoin-token.clar`** – Add `burn-to-remote` and allow adapter to mint.
4. **Create `bridge-registry.clar`** (optional) – Store per-token bridge metadata.
5. **Add TypeScript helpers** – Address encoding and transaction scripts.
6. **Write Clarinet tests** – Cover authorization, burn, mint, and registry lookups.
7. **Update README** – Document architecture and usage.



## Open Questions / Decisions

| Question | Default Assumption |
|-|-|
| Should every new stablecoin auto-register in the bridge registry? | Yes, via a factory pattern or manual registration. |
| Which EVM chains to support first? | Ethereum Sepolia (testnet), Ethereum Mainnet. |
| Who can authorize the bridge adapter to mint? | Contract owner sets adapter principal once; adapter is trusted. |



## Out of Scope (for now)

- Multi-signature or DAO-controlled adapter authorization.
- Non-xReserve bridge providers (e.g., LayerZero, Wormhole).
- Frontend UI for bridging.

