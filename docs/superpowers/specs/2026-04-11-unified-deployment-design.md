# Unified Deployment System

**Date:** 2026-04-11
**Status:** Approved

## Problem

Deployment is fragmented across version-specific scripts and YAML plans:
- `bootstrap-v3.cjs`, `bootstrap-v4.cjs` — 90% duplicated code
- 6 testnet YAML deployment plans accumulated per version
- 5 version-specific npm scripts (`deploy:v3`, `bootstrap:v3`, etc.)
- Config values hardcoded in each script, duplicating `sse.config.json`

Every version bump requires creating new scripts, new YAML files, and new npm scripts.

## Solution

One command (`npm run deploy`) that reads `sse.config.json` and handles everything: test, generate YAML, deploy contracts, bootstrap on-chain state.

## sse.config.json Changes

Add two new fields:

```json
{
  "deployContracts": [
    "diaOracleAdapter",
    "priceOracleDiaBtc",
    "priceOracleDiaStx",
    "collateralRegistry",
    "stabilityPool",
    "multiAssetVaultEngine",
    "liquidationEngine"
  ],

  "contractCosts": {
    "dia-oracle-adapter": 12000,
    "price-oracle-dia-btc": 12000,
    "price-oracle-dia-stx": 12000,
    "collateral-registry-v4": 60000,
    "stability-pool-v4": 60000,
    "multi-asset-vault-engine-v4": 200000,
    "liquidation-engine-v4": 60000
  }
}
```

- `deployContracts` — ordered list of keys from `contracts` map. Only these get deployed. Shared contracts already on-chain (e.g., `stablecoin-factory-v3`) are excluded.
- `contractCosts` — keyed by actual contract name (the value from `contracts` map), used in generated YAML.

Existing fields (`version`, `network`, `deployer`, `contracts`, `collaterals`, `oracles`) unchanged.

## scripts/deploy.cjs

Single script with three phases:

### Phase 1: Pre-flight
1. Read `sse.config.json`
2. Resolve signer (private key via env, or mnemonic from `settings/Testnet.toml`)
3. Run `npm test` — abort on failure
4. For each contract in `deployContracts`, check if already deployed on-chain via Hiro API. Mark as skip/deploy.

### Phase 2: Deploy
1. Resolve contract source paths from `Clarinet.toml` (parse TOML to find `[contracts.<name>].path`)
2. For testnet deployment, use the testnet-specific source when available (e.g., `dia-oracle-adapter` uses `contracts/dia-oracle-adapter.clar` instead of the simnet version in Clarinet.toml)
3. Generate Clarinet deployment YAML from config (deployer, contract names, costs, paths, epoch 3.1, anchor-block-only)
4. Write to `deployments/generated-testnet-plan.yaml`
5. Run `clarinet deployments apply -p deployments/generated-testnet-plan.yaml --no-dashboard`

### Phase 3: Bootstrap
All values read from `sse.config.json`:

1. `stablecoin-token.set-vault-engine` — authorize the vault engine
2. `collateral-registry.set-vault-engine-authorized` — authorize the vault engine
3. For each collateral: `multi-asset-vault-engine.register-asset-oracle` — register DIA oracle ID
4. For each collateral: `<token>.faucet-mint` — mint test tokens to deployer
5. For each collateral: `collateral-registry.add-collateral-type` — register with risk params and oracle

All calls use `skipOnAbort: true` for idempotent re-runs.

### Console Output

Structured, detailed output with:
- Header showing version, timestamp, network, deployer
- Phase markers `[1/3]`, `[2/3]`, `[3/3]`
- Per-contract deploy status with tx hash and explorer link
- Per-bootstrap-call status with tx hash and explorer link
- Summary footer with contract count, tx count, duration

### Contract Path Resolution

Default rule: source path is `contracts/<contract-name>.clar` (e.g., `contracts/collateral-registry-v4.clar`).

Exception: `dia-oracle-adapter` uses `contracts/dia-oracle-adapter.clar` for testnet/mainnet (the real DIA forwarder). Clarinet.toml points this to the simnet mock, but the deploy script ignores Clarinet.toml paths — it always uses `contracts/<contract-name>.clar` directly.

## File Changes

### Delete
- `scripts/bootstrap-v3.cjs`
- `scripts/bootstrap-v4.cjs`
- `scripts/deploy-factory.cjs`
- `scripts/deploy-factory.js`
- `scripts/deploy-direct.cjs`
- `scripts/set-fee.cjs`
- `scripts/get-private-key.cjs`
- `deployments/default.testnet-plan.yaml`
- `deployments/collaterals-v3.testnet-plan.yaml`
- `deployments/new-v3-contracts.testnet-plan.yaml`
- `deployments/stablecoin-factory.testnet-plan.yaml`
- `deployments/dia-oracles.testnet-plan.yaml`
- `deployments/v4-upgrade.testnet-plan.yaml`

### Keep
- `deployments/default.simnet-plan.yaml` — needed for local tests

### Create
- `scripts/deploy.cjs` — the unified deploy script

### Modify
- `sse.config.json` — add `deployContracts`, `contractCosts`
- `package.json` — replace version-specific scripts with `deploy`, `deploy:testnet`, `deploy:mainnet`
- `AGENTS.md` — update Deployment Rules section

## package.json Scripts

```json
{
  "scripts": {
    "lint": "clarinet check -d",
    "ci": "npm run lint && npm test",
    "test": "vitest run",
    "test:report": "vitest run -- --coverage --costs",
    "test:watch": "chokidar \"tests/**/*.ts\" \"contracts/**/*.clar\" -c \"npm run test:report\"",
    "deploy": "node scripts/deploy.cjs",
    "deploy:testnet": "node scripts/deploy.cjs --network testnet",
    "deploy:mainnet": "node scripts/deploy.cjs --network mainnet"
  }
}
```

## AGENTS.md Deployment Rules

Replace current section with:

- Stacks contracts cannot be redeployed. New version required for logic changes.
- Tightly-coupled contracts must be versioned together.
- Unchanged contracts keep their existing version.
- Single-command deployment via `npm run deploy` reading `sse.config.json`.
- `sse.config.json` is the single source of truth. When versioning: update `contracts`, `deployContracts`, `contractCosts`, then run `npm run deploy`.
- Deploy = clean state for new contracts only. Shared contracts retain on-chain state.
- Frontend constants must match deployed contracts. Update `frontend/src/lib/constants.ts` after deploy.
- Update deployment docs (`README.md`, `docs/SSE_CONTEXT.md`, `docs/current.md`) in the same task.

## Shared Utilities in deploy.cjs

Extracted from existing bootstrap scripts (no external dependencies beyond `@stacks/transactions` and `@stacks/wallet-sdk`):
- `getNonce(address)` — fetch current nonce from Hiro API
- `broadcast(tx)` — broadcast and return txid
- `waitForConfirmation(txid)` — poll until success/failure
- `resolveSigner()` — resolve private key from env or mnemonic
- `callContract(name, fn, args, nonce, opts)` — build, sign, broadcast, wait
- `contractExists(address, name)` — check if contract is already on-chain
- `readConfig()` — parse sse.config.json
- `parseClarinet()` — parse Clarinet.toml for contract paths
- `generateYaml(config, contracts)` — generate deployment YAML string
