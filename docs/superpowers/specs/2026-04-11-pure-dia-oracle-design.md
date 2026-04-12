# Pure DIA Oracle Integration

**Date:** 2026-04-11
**Status:** Approved

## Problem

The DIA oracle adapter (`dia-oracle-adapter`) works correctly — it forwards to the real DIA oracle on testnet (`ST1S5ZGRZV5K4S9205RWPRTX9RGS9JV40KQMR4G1J.dia-oracle`) and returns live prices. However, the wrapper contracts `price-oracle-dia-btc` and `price-oracle-dia-stx` crash with `ArithmeticUnderflow` because:

- DIA returns timestamps in **milliseconds** (e.g., `1775946299335`)
- The staleness check computes `(- stacks-block-time timestamp)` where block time is in **seconds** (~`1775946464`)
- Since `timestamp_ms >> block_time_s`, Clarity's unsigned subtraction underflows

Additionally, the collateral registry stores mock oracle principals (`price-oracle-sbtc-v3`, `price-oracle-stx-v3`) as each asset's oracle. The frontend reads these and gets stale/zero prices, showing "Oracle price unavailable".

## Constraints

- Stacks contracts cannot be redeployed. Broken contracts must be replaced with new versions.
- Tightly-coupled contracts that reference changed contracts by name must also be re-versioned.
- `collateral-registry-v4` has admin functions (`update-oracle`, `set-vault-engine-authorized`) that allow runtime reconfiguration without re-versioning.
- `stability-pool-v4` and `stablecoin-factory-v3` have no direct references to the contracts being changed.

## Design

### New Contracts (4)

#### 1. `price-oracle-dia-btc-v2`
Copy of `price-oracle-dia-btc` with one fix in the staleness check:
```clarity
;; Before (broken):
(asserts! (<= (- stacks-block-time (get timestamp dia-data)) (var-get max-staleness)) ...)

;; After (fixed):
(asserts! (<= (- stacks-block-time (/ (get timestamp dia-data) u1000)) (var-get max-staleness)) ...)
```

#### 2. `price-oracle-dia-stx-v2`
Same fix as above, reading "STX/USD" instead of "BTC/USD".

#### 3. `multi-asset-vault-engine-v5`
Copy of `multi-asset-vault-engine-v4` with these changes:
- Oracle dispatch references `price-oracle-dia-btc-v2` and `price-oracle-dia-stx-v2`
- Remove mock oracle IDs (u1, u2) and their dispatch branches
- Only oracle IDs u3 (DIA BTC) and u4 (DIA STX) remain
- Reference `liquidation-engine-v5` instead of `liquidation-engine-v4`
- Reference `stability-pool-v4` (unchanged — no version bump needed)

#### 4. `liquidation-engine-v5`
Copy of `liquidation-engine-v4` with updated reference to `multi-asset-vault-engine-v5`.

### Unchanged Contracts
- **`collateral-registry-v4`** — Reconfigured at runtime via bootstrap
- **`stability-pool-v4`** — No references to changed contracts
- **`stablecoin-factory-v3`** — No references to changed contracts
- **`dia-oracle-adapter`** — Working correctly, no changes
- **`dia-oracle-adapter-simnet`** — Simnet mock, kept for Clarinet tests

### Deleted Contracts
- `price-oracle-mock.clar` — Mock, no longer needed
- `price-oracle-sbtc-v3.clar` — Mock, no longer needed
- `price-oracle-stx-v3.clar` — Mock, no longer needed
- `price-oracle-dia-btc.clar` — Replaced by v2
- `price-oracle-dia-stx.clar` — Replaced by v2

### Bootstrap Changes

The deploy script's bootstrap phase adds these steps:

1. **Update oracle principals in collateral registry:**
   - `collateral-registry-v4.update-oracle(sbtc-token-v3, DEPLOYER.price-oracle-dia-btc-v2)`
   - `collateral-registry-v4.update-oracle(stx-token-v3, DEPLOYER.price-oracle-dia-stx-v2)`

2. **Authorize new vault engine:**
   - `collateral-registry-v4.set-vault-engine-authorized(DEPLOYER.multi-asset-vault-engine-v5, true)`

3. **Remove mock oracle steps:**
   - Delete "Set mock oracle prices" loop (calls to `mockOracleContract.set-price`)
   - Delete "Mint faucet tokens" loop (calls to `collateral.contractName.faucet-mint`)

4. **Register DIA oracle mappings on new vault engine:**
   - `multi-asset-vault-engine-v5.register-asset-oracle(sbtc-token-v3, u3)`
   - `multi-asset-vault-engine-v5.register-asset-oracle(stx-token-v3, u4)`

5. **Authorize vault engine in stablecoin token:**
   - `stablecoin-token-v3.set-vault-engine(DEPLOYER.multi-asset-vault-engine-v5)`

### Config Changes (`sse.config.json`)

- Update contract names:
  - `priceOracleDiaBtc` → `"price-oracle-dia-btc-v2"`
  - `priceOracleDiaStx` → `"price-oracle-dia-stx-v2"`
  - `multiAssetVaultEngine` → `"multi-asset-vault-engine-v5"`
  - `liquidationEngine` → `"liquidation-engine-v5"`
- Update `deployContracts` list accordingly
- Update `contractCosts` for new contract names
- Remove `mockOracleContract` and `mockPrice` from each collateral entry

### Frontend Changes

**`constants.ts`:**
- Remove `PRICE_ORACLE_SBTC`, `PRICE_ORACLE_STX`
- Remove `MOCK_SBTC` and `MOCK_STX` oracle IDs
- Update `MULTI_ASSET_VAULT_ENGINE` → `"multi-asset-vault-engine-v5"`
- Update `LIQUIDATION_ENGINE` → `"liquidation-engine-v5"`
- Update `PRICE_ORACLE_DIA_BTC` → `"price-oracle-dia-btc-v2"`
- Update `PRICE_ORACLE_DIA_STX` → `"price-oracle-dia-stx-v2"`

**`useDiaOraclePrices()`:**
- Update contract names to v2

**`useCollateralTypes()`:**
- No code change needed — it already reads the oracle principal from the registry and calls `get-price()`. Once bootstrap updates the registry, it will automatically call the DIA oracle v2 contracts.

### Clarinet Config Changes

**`Clarinet.toml`:**
- Remove entries for deleted contracts
- Add entries for new contracts (v2 oracles, v5 vault engine, v5 liquidation engine)

**`default.simnet-plan.yaml`:**
- Update to reference new contract names
- Remove deleted contract deployments

### Test Changes

- Update test imports/references to use new contract names
- Simnet tests continue using `dia-oracle-adapter-simnet` to set mock DIA values
- No mock oracle contracts needed for testing

## Verification

After deployment:
1. Call `price-oracle-dia-btc-v2.get-price()` — should return live BTC price without ArithmeticUnderflow
2. Call `price-oracle-dia-stx-v2.get-price()` — should return live STX price
3. Frontend vault creation page should show oracle prices instead of "Oracle price unavailable"
4. Configuring collateral for a stablecoin should work for both sBTC and STX
5. `npm test` passes locally with simnet adapter
