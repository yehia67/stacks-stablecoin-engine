# Pure DIA Oracle Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix DIA oracle timestamp bug (ms→s), remove all mock oracles, re-version dependent contracts.

**Architecture:** DIA returns timestamps in milliseconds; our oracle wrappers compare against block time in seconds, causing ArithmeticUnderflow. Fix by dividing DIA timestamp by 1000 in new v2 oracle wrappers. Cascade version bumps to vault engine (v5) and liquidation engine (v5). Update bootstrap to patch existing collateral-registry-v4 at runtime.

**Tech Stack:** Clarity smart contracts, Node.js deploy script, Next.js/React frontend

---

### Task 1: Create price-oracle-dia-btc-v2

**Files:**
- Create: `contracts/price-oracle-dia-btc-v2.clar`

- [ ] **Step 1: Create the fixed oracle contract**

```clarity
;; DIA-backed BTC/USD Price Oracle v2
;; ---
;; Implements oracle-trait by reading BTC/USD from the DIA oracle adapter.
;; Includes configurable staleness guard -- rejects prices older than MAX_STALENESS seconds.
;; v2: Fixes DIA timestamp handling (DIA returns milliseconds, block time is seconds).

(impl-trait .oracle-trait.oracle-trait)

(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR_UNAUTHORIZED u600)
(define-constant ERR_STALE_PRICE u601)
(define-constant ERR_NO_PRICE u602)
(define-constant PAIR "BTC/USD")

;; Default max staleness: 3600 seconds (1 hour)
(define-data-var max-staleness uint u3600)

;; Owner-only: tune staleness threshold
(define-public (set-max-staleness (new-max uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (var-set max-staleness new-max)
    (ok true)
  )
)

(define-read-only (get-max-staleness)
  (var-get max-staleness)
)

;; oracle-trait implementation
(define-read-only (get-price)
  (let (
      (dia-data (unwrap! (contract-call? .dia-oracle-adapter get-value PAIR) (err ERR_NO_PRICE)))
      (price-value (get value dia-data))
      (price-ts (/ (get timestamp dia-data) u1000))
      (current-ts (unwrap! (get-stacks-block-info? time (- stacks-block-height u1)) (err ERR_NO_PRICE)))
      (age (- current-ts price-ts))
    )
    (asserts! (<= age (var-get max-staleness)) (err ERR_STALE_PRICE))
    (ok price-value)
  )
)
```

- [ ] **Step 2: Verify file created**

Run: `ls -la contracts/price-oracle-dia-btc-v2.clar`
Expected: File exists

---

### Task 2: Create price-oracle-dia-stx-v2

**Files:**
- Create: `contracts/price-oracle-dia-stx-v2.clar`

- [ ] **Step 1: Create the fixed oracle contract**

```clarity
;; DIA-backed STX/USD Price Oracle v2
;; ---
;; Implements oracle-trait by reading STX/USD from the DIA oracle adapter.
;; Includes configurable staleness guard -- rejects prices older than MAX_STALENESS seconds.
;; v2: Fixes DIA timestamp handling (DIA returns milliseconds, block time is seconds).

(impl-trait .oracle-trait.oracle-trait)

(define-constant CONTRACT-OWNER tx-sender)
(define-constant ERR_UNAUTHORIZED u600)
(define-constant ERR_STALE_PRICE u601)
(define-constant ERR_NO_PRICE u602)
(define-constant PAIR "STX/USD")

;; Default max staleness: 3600 seconds (1 hour)
(define-data-var max-staleness uint u3600)

;; Owner-only: tune staleness threshold
(define-public (set-max-staleness (new-max uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) (err ERR_UNAUTHORIZED))
    (var-set max-staleness new-max)
    (ok true)
  )
)

(define-read-only (get-max-staleness)
  (var-get max-staleness)
)

;; oracle-trait implementation
(define-read-only (get-price)
  (let (
      (dia-data (unwrap! (contract-call? .dia-oracle-adapter get-value PAIR) (err ERR_NO_PRICE)))
      (price-value (get value dia-data))
      (price-ts (/ (get timestamp dia-data) u1000))
      (current-ts (unwrap! (get-stacks-block-info? time (- stacks-block-height u1)) (err ERR_NO_PRICE)))
      (age (- current-ts price-ts))
    )
    (asserts! (<= age (var-get max-staleness)) (err ERR_STALE_PRICE))
    (ok price-value)
  )
)
```

- [ ] **Step 2: Verify file created**

Run: `ls -la contracts/price-oracle-dia-stx-v2.clar`
Expected: File exists

---

### Task 3: Create multi-asset-vault-engine-v5

**Files:**
- Create: `contracts/multi-asset-vault-engine-v5.clar` (copy of v4 with targeted changes)

- [ ] **Step 1: Copy v4 as starting point**

Run: `cp contracts/multi-asset-vault-engine-v4.clar contracts/multi-asset-vault-engine-v5.clar`

- [ ] **Step 2: Remove mock oracle IDs and update references**

In `contracts/multi-asset-vault-engine-v5.clar`, make these changes:

**Remove mock oracle constants** (lines 37-38). Replace:
```clarity
;; Known oracle IDs
(define-constant ORACLE-SBTC u1)
(define-constant ORACLE-STX u2)
(define-constant ORACLE-DIA-BTC u3)
(define-constant ORACLE-DIA-STX u4)
```
With:
```clarity
;; Known oracle IDs (DIA only — no mock oracles)
(define-constant ORACLE-DIA-BTC u3)
(define-constant ORACLE-DIA-STX u4)
```

**Update register-asset-oracle validation** (line 84). Replace:
```clarity
    (asserts! (or (is-eq oracle-id ORACLE-SBTC) (is-eq oracle-id ORACLE-STX) (is-eq oracle-id ORACLE-DIA-BTC) (is-eq oracle-id ORACLE-DIA-STX)) (err ERR_UNKNOWN_ORACLE))
```
With:
```clarity
    (asserts! (or (is-eq oracle-id ORACLE-DIA-BTC) (is-eq oracle-id ORACLE-DIA-STX)) (err ERR_UNKNOWN_ORACLE))
```

**Update get-oracle-price-by-id** (lines 101-115). Replace:
```clarity
(define-private (get-oracle-price-by-id (oracle-id uint))
  (if (is-eq oracle-id ORACLE-SBTC)
    (unwrap-panic (contract-call? .price-oracle-sbtc-v3 get-price))
    (if (is-eq oracle-id ORACLE-STX)
      (unwrap-panic (contract-call? .price-oracle-stx-v3 get-price))
      (if (is-eq oracle-id ORACLE-DIA-BTC)
        (unwrap-panic (contract-call? .price-oracle-dia-btc get-price))
        (if (is-eq oracle-id ORACLE-DIA-STX)
          (unwrap-panic (contract-call? .price-oracle-dia-stx get-price))
          u0
        )
      )
    )
  )
)
```
With:
```clarity
(define-private (get-oracle-price-by-id (oracle-id uint))
  (if (is-eq oracle-id ORACLE-DIA-BTC)
    (unwrap-panic (contract-call? .price-oracle-dia-btc-v2 get-price))
    (if (is-eq oracle-id ORACLE-DIA-STX)
      (unwrap-panic (contract-call? .price-oracle-dia-stx-v2 get-price))
      u0
    )
  )
)
```

**Update liquidation engine reference** (line 823). Replace:
```clarity
    (asserts! (is-eq contract-caller .liquidation-engine-v4) (err ERR_NOT_LIQUIDATION_ENGINE))
```
With:
```clarity
    (asserts! (is-eq contract-caller .liquidation-engine-v5) (err ERR_NOT_LIQUIDATION_ENGINE))
```

- [ ] **Step 3: Verify no remaining old references**

Run: `grep -n "price-oracle-sbtc-v3\|price-oracle-stx-v3\|price-oracle-dia-btc[^-]\|price-oracle-dia-stx[^-]\|ORACLE-SBTC\|ORACLE-STX\b\|liquidation-engine-v4" contracts/multi-asset-vault-engine-v5.clar`
Expected: No output (no remaining old references). Note: `ORACLE-DIA-STX` and `ORACLE-DIA-BTC` are fine.

---

### Task 4: Create liquidation-engine-v5

**Files:**
- Create: `contracts/liquidation-engine-v5.clar` (copy of v4 with updated vault engine reference)

- [ ] **Step 1: Copy v4 as starting point**

Run: `cp contracts/liquidation-engine-v4.clar contracts/liquidation-engine-v5.clar`

- [ ] **Step 2: Update vault engine references**

In `contracts/liquidation-engine-v5.clar`, replace all occurrences of `.multi-asset-vault-engine-v4` with `.multi-asset-vault-engine-v5`:

Line 39: `(health-factor (contract-call? .multi-asset-vault-engine-v5`
Line 45: `(position (unwrap! (contract-call? .multi-asset-vault-engine-v5`
Line 72: `(try! (contract-call? .multi-asset-vault-engine-v5 liquidate-position`

- [ ] **Step 3: Verify no remaining old references**

Run: `grep -n "multi-asset-vault-engine-v4" contracts/liquidation-engine-v5.clar`
Expected: No output

---

### Task 5: Delete mock oracle contracts

**Files:**
- Delete: `contracts/price-oracle-mock.clar`
- Delete: `contracts/price-oracle-sbtc-v3.clar`
- Delete: `contracts/price-oracle-stx-v3.clar`
- Delete: `contracts/price-oracle-dia-btc.clar`
- Delete: `contracts/price-oracle-dia-stx.clar`

- [ ] **Step 1: Delete the files**

Run:
```bash
rm contracts/price-oracle-mock.clar
rm contracts/price-oracle-sbtc-v3.clar
rm contracts/price-oracle-stx-v3.clar
rm contracts/price-oracle-dia-btc.clar
rm contracts/price-oracle-dia-stx.clar
```

- [ ] **Step 2: Verify deleted**

Run: `ls contracts/price-oracle-*.clar`
Expected: Only `price-oracle-dia-btc-v2.clar` and `price-oracle-dia-stx-v2.clar` remain

---

### Task 6: Update Clarinet.toml

**Files:**
- Modify: `Clarinet.toml`

- [ ] **Step 1: Remove deleted contract entries**

Remove these sections from `Clarinet.toml`:
- `[contracts.price-oracle-mock]` (lines 22-25)
- `[contracts.price-oracle-sbtc-v3]` (lines 73-76)
- `[contracts.price-oracle-stx-v3]` (lines 78-80)
- `[contracts.price-oracle-dia-btc]` (lines 89-92)
- `[contracts.price-oracle-dia-stx]` (lines 94-97)

- [ ] **Step 2: Add new contract entries**

Add after the `[contracts.dia-oracle-adapter]` section:

```toml
[contracts.price-oracle-dia-btc-v2]
path = "contracts/price-oracle-dia-btc-v2.clar"
epoch = "3.1"
depends_on = ["oracle-trait", "dia-oracle-adapter"]

[contracts.price-oracle-dia-stx-v2]
path = "contracts/price-oracle-dia-stx-v2.clar"
epoch = "3.1"
depends_on = ["oracle-trait", "dia-oracle-adapter"]
```

- [ ] **Step 3: Add vault engine v5 and liquidation engine v5 entries**

Add after the existing `[contracts.liquidation-engine-v4]` section:

```toml
[contracts.multi-asset-vault-engine-v5]
path = "contracts/multi-asset-vault-engine-v5.clar"
epoch = "3.1"
depends_on = ["sip-010-trait", "stablecoin-token-v3", "price-oracle-dia-btc-v2", "price-oracle-dia-stx-v2", "collateral-registry-v4", "stablecoin-factory-v3", "stablecoin-engine-token-trait", "sbtc-token-v3", "stx-token-v3", "stability-pool-v4", "liquidation-engine-v5"]

[contracts.liquidation-engine-v5]
path = "contracts/liquidation-engine-v5.clar"
epoch = "3.1"
depends_on = ["sip-010-trait", "stablecoin-engine-token-trait", "multi-asset-vault-engine-v5", "stability-pool-v4"]
```

- [ ] **Step 4: Update v4 vault engine depends_on to remove deleted mock oracle refs**

The existing `[contracts.multi-asset-vault-engine-v4]` `depends_on` references `price-oracle-sbtc-v3` and `price-oracle-stx-v3` which no longer exist. Update:

Replace:
```toml
depends_on = ["sip-010-trait", "stablecoin-token-v3", "price-oracle-sbtc-v3", "price-oracle-stx-v3", "price-oracle-dia-btc", "price-oracle-dia-stx", "collateral-registry-v4", "stablecoin-factory-v3", "stablecoin-engine-token-trait", "sbtc-token-v3", "stx-token-v3", "stability-pool-v4", "liquidation-engine-v4"]
```
With:
```toml
depends_on = ["sip-010-trait", "stablecoin-token-v3", "price-oracle-dia-btc-v2", "price-oracle-dia-stx-v2", "collateral-registry-v4", "stablecoin-factory-v3", "stablecoin-engine-token-trait", "sbtc-token-v3", "stx-token-v3", "stability-pool-v4", "liquidation-engine-v4"]
```

Also update `[contracts.multi-asset-vault-engine-v3]` depends_on similarly — replace `"price-oracle-sbtc-v3", "price-oracle-stx-v3", "price-oracle-dia-btc", "price-oracle-dia-stx"` with `"price-oracle-dia-btc-v2", "price-oracle-dia-stx-v2"`.

---

### Task 7: Update simnet deployment plan

**Files:**
- Modify: `deployments/default.simnet-plan.yaml`

- [ ] **Step 1: Replace deleted oracle entries with new v2 entries**

In the `batches[0].transactions` section, replace these entries:

```yaml
        - emulated-contract-publish:
            contract-name: price-oracle-dia-btc
            emulated-sender: ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
            path: contracts/price-oracle-dia-btc.clar
            clarity-version: 3
        - emulated-contract-publish:
            contract-name: price-oracle-dia-stx
            emulated-sender: ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
            path: contracts/price-oracle-dia-stx.clar
            clarity-version: 3
        - emulated-contract-publish:
            contract-name: price-oracle-sbtc-v3
            emulated-sender: ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
            path: contracts/price-oracle-sbtc-v3.clar
            clarity-version: 3
        - emulated-contract-publish:
            contract-name: price-oracle-stx-v3
            emulated-sender: ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
            path: contracts/price-oracle-stx-v3.clar
            clarity-version: 3
```

With:

```yaml
        - emulated-contract-publish:
            contract-name: price-oracle-dia-btc-v2
            emulated-sender: ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
            path: contracts/price-oracle-dia-btc-v2.clar
            clarity-version: 3
        - emulated-contract-publish:
            contract-name: price-oracle-dia-stx-v2
            emulated-sender: ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
            path: contracts/price-oracle-dia-stx-v2.clar
            clarity-version: 3
```

Also remove the `price-oracle-mock` entry:
```yaml
        - emulated-contract-publish:
            contract-name: price-oracle-mock
            emulated-sender: ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
            path: contracts/price-oracle-mock.clar
            clarity-version: 3
```

- [ ] **Step 2: Add v5 contracts to batch 1**

In `batches[1].transactions`, add after the `liquidation-engine-v4` entry:

```yaml
        - emulated-contract-publish:
            contract-name: multi-asset-vault-engine-v5
            emulated-sender: ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
            path: contracts/multi-asset-vault-engine-v5.clar
            clarity-version: 3
        - emulated-contract-publish:
            contract-name: liquidation-engine-v5
            emulated-sender: ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
            path: contracts/liquidation-engine-v5.clar
            clarity-version: 3
```

---

### Task 8: Run tests to verify contracts compile

- [ ] **Step 1: Run the test suite**

Run: `cd "/Users/yehiatarek/Documents/projects/Stacks/Stacks Stablecoin Engine (SSE)" && npm test`

Expected: Tests compile and existing tests pass. The DIA oracle tests and vault engine tests will now reference v2 oracle contracts via the simnet plan.

**Note:** Tests that reference deleted mock contracts will fail. Fix those in Task 9.

---

### Task 9: Update tests

**Files:**
- Modify: `tests/dia-oracle.test.ts`
- Modify: `tests/liquidation-rewards.test.ts`
- Modify: `tests/multi-asset-v3.test.ts`
- Modify: `tests/stability-pool-v3.test.ts`

- [ ] **Step 1: Update dia-oracle.test.ts**

Replace all `"price-oracle-dia-btc"` with `"price-oracle-dia-btc-v2"` and `"price-oracle-dia-stx"` with `"price-oracle-dia-stx-v2"`.

In the "vault engine DIA oracle routing" describe block, update contract references from `multi-asset-vault-engine-v3` to `multi-asset-vault-engine-v5` since v3 still references the old oracle contracts. Also update `collateral-registry-v3` to `collateral-registry-v4`.

Replace the `oraclePrincipal` (line 276):
```typescript
const oraclePrincipal = `${deployer}.price-oracle-sbtc-v3`;
```
With:
```typescript
const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;
```

Update the vault engine reference:
```typescript
simnet.callPublicFn("multi-asset-vault-engine-v5", ...)
```

Update the stablecoin-token set-vault-engine:
```typescript
Cl.principal(`${deployer}.multi-asset-vault-engine-v5`)
```

Update collateral-registry reference to v4:
```typescript
simnet.callPublicFn("collateral-registry-v4", "add-collateral-type", ...)
simnet.callPublicFn("collateral-registry-v4", "configure-collateral-for-stablecoin", ...)
```

- [ ] **Step 2: Update liquidation-rewards.test.ts**

This test uses `price-oracle-sbtc-v3` mock oracle to set prices and trigger liquidations. Since mock oracles are deleted, switch to using the DIA adapter to seed prices instead.

Replace the oracle principal:
```typescript
const oraclePrincipal = `${deployer}.price-oracle-sbtc-v3`;
```
With:
```typescript
const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;
```

Replace all `simnet.callPublicFn("price-oracle-sbtc-v3", "set-price", ...)` calls with DIA adapter seeding:
```typescript
simnet.callPublicFn("dia-oracle-adapter", "set-value", [Cl.stringAscii("BTC/USD"), Cl.uint(newPrice)], deployer);
```

Where the existing test calls `set-price` with `Cl.uint(500000000)` (low price for liquidation), replace with:
```typescript
simnet.callPublicFn("dia-oracle-adapter", "set-value", [Cl.stringAscii("BTC/USD"), Cl.uint(500000000)], deployer);
```

Also update the oracle registration from mock ID to DIA ID:
```typescript
// Replace: Cl.uint(1) (ORACLE-SBTC mock)
// With:    Cl.uint(3) (ORACLE-DIA-BTC)
```

Update all vault engine references from v4 to v5 and liquidation engine from v4 to v5.

- [ ] **Step 3: Update multi-asset-v3.test.ts and stability-pool-v3.test.ts**

These reference v3 contracts which still exist (they reference the old oracles). Since v3 contracts still exist in `Clarinet.toml` but now depend on v2 oracles, update the `oraclePrincipal` in both files:

Replace:
```typescript
const oraclePrincipal = `${deployer}.price-oracle-sbtc-v3`;
```
With:
```typescript
const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;
```

And replace any `simnet.callPublicFn("price-oracle-sbtc-v3", "set-price", ...)` calls with DIA adapter seeding:
```typescript
simnet.callPublicFn("dia-oracle-adapter", "set-value", [Cl.stringAscii("BTC/USD"), Cl.uint(price)], deployer);
```

Update oracle registration to use DIA oracle ID:
```typescript
// Replace: Cl.uint(1) → Cl.uint(3)
```

- [ ] **Step 4: Run tests again**

Run: `cd "/Users/yehiatarek/Documents/projects/Stacks/Stacks Stablecoin Engine (SSE)" && npm test`

Expected: All tests pass.

- [ ] **Step 5: Commit contracts and tests**

```bash
git add contracts/price-oracle-dia-btc-v2.clar contracts/price-oracle-dia-stx-v2.clar contracts/multi-asset-vault-engine-v5.clar contracts/liquidation-engine-v5.clar Clarinet.toml deployments/default.simnet-plan.yaml tests/
git commit -m "feat: fix DIA oracle timestamp (ms→s), remove mock oracles, add v5 vault/liquidation engines"
```

---

### Task 10: Update sse.config.json

**Files:**
- Modify: `sse.config.json`

- [ ] **Step 1: Update contract names**

Replace:
```json
    "priceOracleDiaBtc": "price-oracle-dia-btc",
    "priceOracleDiaStx": "price-oracle-dia-stx"
```
With:
```json
    "priceOracleDiaBtc": "price-oracle-dia-btc-v2",
    "priceOracleDiaStx": "price-oracle-dia-stx-v2"
```

Replace:
```json
    "multiAssetVaultEngine": "multi-asset-vault-engine-v4",
```
With:
```json
    "multiAssetVaultEngine": "multi-asset-vault-engine-v5",
```

Replace:
```json
    "liquidationEngine": "liquidation-engine-v4",
```
With:
```json
    "liquidationEngine": "liquidation-engine-v5",
```

- [ ] **Step 2: Update deployContracts**

Replace the current `deployContracts` array with:
```json
  "deployContracts": [
    "diaOracleAdapter",
    "priceOracleDiaBtc",
    "priceOracleDiaStx",
    "collateralRegistry",
    "stabilityPool",
    "multiAssetVaultEngine",
    "liquidationEngine"
  ],
```
(Same keys, but they now resolve to new contract names.)

- [ ] **Step 3: Update contractCosts**

Remove old contract cost entries and add new ones:
```json
  "contractCosts": {
    "dia-oracle-adapter": 12000,
    "price-oracle-dia-btc-v2": 12000,
    "price-oracle-dia-stx-v2": 12000,
    "collateral-registry-v4": 60000,
    "stability-pool-v4": 60000,
    "multi-asset-vault-engine-v5": 200000,
    "liquidation-engine-v5": 60000
  },
```

- [ ] **Step 4: Remove mockOracleContract and mockPrice from collaterals**

For each collateral entry, remove the `mockOracleContract` and `mockPrice` fields. The collaterals array should become:

```json
  "collaterals": [
    {
      "name": "Test sBTC",
      "symbol": "sBTC",
      "contractName": "sbtc-token-v3",
      "decimals": 8,
      "initialMint": 1000000000000,
      "diaOracleId": 3,
      "risk": {
        "minCollateralRatio": 150,
        "liquidationRatio": 130,
        "liquidationPenalty": 10,
        "stabilityFee": 200,
        "debtCeiling": 1000000000000,
        "debtFloor": 1000000
      }
    },
    {
      "name": "Test STX",
      "symbol": "STX",
      "contractName": "stx-token-v3",
      "decimals": 6,
      "initialMint": 5000000000000,
      "diaOracleId": 4,
      "risk": {
        "minCollateralRatio": 200,
        "liquidationRatio": 170,
        "liquidationPenalty": 12,
        "stabilityFee": 300,
        "debtCeiling": 5000000000000,
        "debtFloor": 1000000
      }
    }
  ],
```

---

### Task 11: Update deploy.cjs bootstrap

**Files:**
- Modify: `scripts/deploy.cjs`

- [ ] **Step 1: Remove mock oracle price-setting step**

Delete the "Set mock oracle prices" section (lines 351-362):
```javascript
  // 4. Set mock oracle prices (fallback for testing)
  console.log("\n  Setting mock oracle prices...");
  for (const collateral of config.collaterals) {
    await callContract(
      apiUrl,
      network,
      collateral.mockOracleContract,
      "set-price",
      [uintCV(collateral.mockPrice)],
      nonce++,
      { skipOnAbort: true }
    );
  }
```

- [ ] **Step 2: Remove faucet-mint step**

Delete the "Mint faucet tokens" section (lines 365-376):
```javascript
  // 5. Mint faucet tokens
  console.log("\n  Minting faucet tokens...");
  for (const collateral of config.collaterals) {
    await callContract(
      apiUrl,
      network,
      collateral.contractName,
      "faucet-mint",
      [uintCV(collateral.initialMint), principalCV(DEPLOYER)],
      nonce++,
      { skipOnAbort: true }
    );
  }
```

- [ ] **Step 3: Add oracle update and vault engine authorization steps**

After the existing "Add collateral types" section, add:

```javascript
  // 5. Update oracle principals in collateral registry to DIA v2 oracles
  console.log("\n  Updating oracle principals to DIA v2...");
  const oracleMap = {
    3: config.contracts.priceOracleDiaBtc,  // DIA BTC oracle
    4: config.contracts.priceOracleDiaStx,  // DIA STX oracle
  };
  for (const collateral of config.collaterals) {
    const oracleContract = oracleMap[collateral.diaOracleId];
    if (oracleContract) {
      await callContract(
        apiUrl,
        network,
        collateralRegistry,
        "update-oracle",
        [
          principalCV(`${DEPLOYER}.${collateral.contractName}`),
          principalCV(`${DEPLOYER}.${oracleContract}`),
        ],
        nonce++,
        { skipOnAbort: true }
      );
    }
  }

  // 6. Authorize new vault engine in collateral registry
  console.log("\n  Authorizing vault engine v5...");
  await callContract(
    apiUrl,
    network,
    collateralRegistry,
    "set-vault-engine-authorized",
    [principalCV(`${DEPLOYER}.${vaultEngine}`), boolCV(true)],
    nonce++,
    { skipOnAbort: true }
  );
```

**Note:** Step 2 of the existing bootstrap already authorizes the vault engine, but uses the config's `vaultEngine` which now resolves to v5. The existing step 2 call will run first and may suffice, but the explicit re-authorization above ensures it works even if the previous step used skipOnAbort. The `skipOnAbort: true` makes this idempotent.

---

### Task 12: Update frontend constants

**Files:**
- Modify: `frontend/src/lib/constants.ts`

- [ ] **Step 1: Update contract name defaults**

Replace:
```typescript
const MULTI_ASSET_VAULT_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_MULTI_ASSET_VAULT_ENGINE_CONTRACT || "multi-asset-vault-engine-v4";
```
With:
```typescript
const MULTI_ASSET_VAULT_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_MULTI_ASSET_VAULT_ENGINE_CONTRACT || "multi-asset-vault-engine-v5";
```

Replace:
```typescript
const LIQUIDATION_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_LIQUIDATION_ENGINE_CONTRACT || "liquidation-engine-v4";
```
With:
```typescript
const LIQUIDATION_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_LIQUIDATION_ENGINE_CONTRACT || "liquidation-engine-v5";
```

- [ ] **Step 2: Remove mock oracle constants and update DIA oracle names**

Replace lines 29-33:
```typescript
  PRICE_ORACLE_SBTC: "price-oracle-sbtc-v3",
  PRICE_ORACLE_STX: "price-oracle-stx-v3",
  PRICE_ORACLE_DIA_BTC: "price-oracle-dia-btc",
  PRICE_ORACLE_DIA_STX: "price-oracle-dia-stx",
```
With:
```typescript
  PRICE_ORACLE_DIA_BTC: "price-oracle-dia-btc-v2",
  PRICE_ORACLE_DIA_STX: "price-oracle-dia-stx-v2",
```

- [ ] **Step 3: Remove mock oracle IDs and network-conditional logic**

Replace lines 49-62:
```typescript
// Oracle IDs matching contract constants in multi-asset-vault-engine-v4
// Mock oracles (simnet/devnet): SBTC=1, STX=2
// DIA oracles (testnet/mainnet): BTC=3, STX=4
export const ORACLE_IDS = {
  MOCK_SBTC: 1,
  MOCK_STX: 2,
  DIA_BTC: 3,
  DIA_STX: 4,
};

// Use DIA oracles on testnet/mainnet, mock oracles on devnet
const USE_DIA = NETWORK === "testnet" || NETWORK === "mainnet";
export const ACTIVE_ORACLE_ID_BTC = USE_DIA ? ORACLE_IDS.DIA_BTC : ORACLE_IDS.MOCK_SBTC;
export const ACTIVE_ORACLE_ID_STX = USE_DIA ? ORACLE_IDS.DIA_STX : ORACLE_IDS.MOCK_STX;
```
With:
```typescript
// Oracle IDs matching contract constants in multi-asset-vault-engine-v5
// DIA oracles only — no mock oracles
export const ORACLE_IDS = {
  DIA_BTC: 3,
  DIA_STX: 4,
};

export const ACTIVE_ORACLE_ID_BTC = ORACLE_IDS.DIA_BTC;
export const ACTIVE_ORACLE_ID_STX = ORACLE_IDS.DIA_STX;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd "/Users/yehiatarek/Documents/projects/Stacks/Stacks Stablecoin Engine (SSE)/frontend" && npx tsc --noEmit`
Expected: No errors. If `PRICE_ORACLE_SBTC` or `PRICE_ORACLE_STX` are referenced elsewhere, those references will error and need cleanup. Check and fix any remaining references.

- [ ] **Step 5: Commit config and frontend changes**

```bash
git add sse.config.json scripts/deploy.cjs frontend/src/lib/constants.ts
git commit -m "feat: update config, deploy script, and frontend for DIA oracle v2"
```

---

### Task 13: Update docs

**Files:**
- Modify: `docs/SSE_CONTEXT.md`
- Modify: `docs/current.md`
- Modify: `README.md`

- [ ] **Step 1: Update contract names in docs**

In all three doc files, replace:
- `multi-asset-vault-engine-v4` → `multi-asset-vault-engine-v5`
- `liquidation-engine-v4` → `liquidation-engine-v5`
- `price-oracle-dia-btc` → `price-oracle-dia-btc-v2`
- `price-oracle-dia-stx` → `price-oracle-dia-stx-v2`
- Remove references to `price-oracle-sbtc-v3`, `price-oracle-stx-v3`, `price-oracle-mock`
- Note the DIA timestamp fix

- [ ] **Step 2: Commit docs**

```bash
git add docs/SSE_CONTEXT.md docs/current.md README.md
git commit -m "docs: update contract versions for DIA oracle v2 migration"
```

---

### Task 14: Final verification

- [ ] **Step 1: Run full test suite**

Run: `cd "/Users/yehiatarek/Documents/projects/Stacks/Stacks Stablecoin Engine (SSE)" && npm test`

Expected: All tests pass

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd "/Users/yehiatarek/Documents/projects/Stacks/Stacks Stablecoin Engine (SSE)/frontend" && npx tsc --noEmit`

Expected: No errors

- [ ] **Step 3: Verify no stale references to deleted contracts**

Run: `grep -r "price-oracle-mock\|price-oracle-sbtc-v3\|price-oracle-stx-v3" --include="*.ts" --include="*.clar" --include="*.toml" --include="*.yaml" --include="*.json" contracts/ frontend/ tests/ scripts/ Clarinet.toml deployments/ sse.config.json`

Expected: No matches (or only in old v2/v3 contracts that still exist but aren't deployed)
