# EGP Bond A (EGPB) Mainnet Collateral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `egpb-token-v1` (EGP Bond A, owner-gated mint/burn, constant $1) as the third mainnet collateral on SSE — two new contracts, zero platform redeploys, one timelock proposal.

**Architecture:** The live v8 vault engine dispatches oracles via trait from `collateral-registry-v6`, so a new collateral needs only: a SIP-010 token, an `oracle-trait` implementation, and a timelock-governed `execute-coll-add`. Spec: `docs/plans/add-egpb-collateral.md`.

**Tech Stack:** Clarity 3 (epoch 3.1), Clarinet + Vitest simnet tests, `@stacks/transactions`, Next.js frontend, `scripts/deploy.cjs` for mainnet publish, Asigna multisig + `sse-timelock-v1` for governance.

**Conventions (override skill defaults):**
- **NO git commits by the agent.** The user commits manually. Wherever this plan says "Checkpoint", stop and let the user review/commit.
- **NO `npm run build` in `frontend/`** while the user's dev server may be running. Use `npx tsc --noEmit` instead.
- All paths relative to repo root: `/Users/yehiatarek/Documents/projects/Stacks/Stacks Stablecoin Engine (SSE)`.

**Key facts (verified 2026-06-10):**
- Mainnet deployer `SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0` = `settings/Mainnet.toml` mnemonic = token owner. Balance 28.04 STX — sufficient, no funding step.
- v8 engine already authorized in registry (vGLD proposal A) → only ONE new timelock proposal.
- Risk params: min-cr 150, liq-r 120, liq-pen 10, fee 200 bps, ceiling u100000000000, floor u10000000 (same as vGLD).
- FT asset name MUST be `EGPBv1` (frontend post-conditions key on it).

---

### Task 1: Constant-$1 oracle contract + registration

**Files:**
- Create: `contracts/price-oracle-egpb-v1.clar`
- Modify: `Clarinet.toml` (after the `[contracts.price-oracle-vgld-v1]` block, ~line 70)
- Test: `tests/egpb-token.test.ts` (created here, extended in Tasks 2-3)

- [ ] **Step 1: Write the failing test**

Create `tests/egpb-token.test.ts`:

```typescript
// Tests for egpb-token-v1 (EGP Bond A — owner-gated mint/burn SIP-010) and
// price-oracle-egpb-v1 (constant $1 oracle), plus the end-to-end EGPB vault
// flow on multi-asset-vault-engine-v8. Mirrors the vGLD coverage in
// tests/vault-engine-v8.test.ts but with owner-gated mint instead of faucet.

import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

function getTestAccounts() {
  const accounts = simnet.getAccounts();
  const deployer = accounts.get("deployer")!;
  const wallet1 = accounts.get("wallet_1")!;
  const wallet2 = accounts.get("wallet_2")!;
  return { deployer, wallet1, wallet2 };
}

describe("price-oracle-egpb-v1: constant $1 oracle", () => {
  it("returns u100000000 (= $1.00 at 8-decimal PRICE-SCALE)", () => {
    const { wallet1 } = getTestAccounts();
    const price = simnet.callReadOnlyFn("price-oracle-egpb-v1", "get-price", [], wallet1);
    expect(price.result).toBeOk(Cl.uint(100_000_000));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/egpb-token.test.ts`
Expected: FAIL — contract `price-oracle-egpb-v1` not found in simnet.

- [ ] **Step 3: Write the oracle contract**

Create `contracts/price-oracle-egpb-v1.clar`:

```clarity
;; price-oracle-egpb-v1.clar
;;
;; Constant $1 USD oracle for EGP Bond A (EGPB).
;; EGPB is an SSE-issued bond token with a fixed $1.00 standard price --
;; mint/burn is owner-gated in egpb-token-v1, so for SSE's collateral math
;; EGPB is treated as a USD-stable asset.
;;
;; Returns u100000000 (= $1.00 at the 8-decimal PRICE-SCALE used throughout
;; the vault engine). No data vars, no admin, no staleness logic.
;;
;; If the bond's pricing model ever changes, the response is to:
;;   1. Asigna calls collateral-registry-v6::set-collateral-enabled(asset, false)
;;      via the timelock emergency whitelist (no delay).
;;   2. Deploy a new oracle wrapper that reflects the new pricing reality.
;;   3. Asigna re-points EGPB's oracle via collateral-registry-v6::update-oracle.

(impl-trait .oracle-trait.oracle-trait)

(define-constant PRICE-USD-1 u100000000)

(define-read-only (get-price)
  (ok PRICE-USD-1)
)
```

- [ ] **Step 4: Register in Clarinet.toml**

In `Clarinet.toml`, insert directly after the `[contracts.price-oracle-vgld-v1]` block (ends ~line 70):

```toml
# Constant $1 oracle for EGP Bond A (EGPB). Implements oracle-trait,
# returns u100000000 (= $1.00 at 8-decimal PRICE-SCALE) unconditionally.
[contracts.price-oracle-egpb-v1]
path = "contracts/price-oracle-egpb-v1.clar"
epoch = "3.1"
depends_on = ["oracle-trait"]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/egpb-token.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Checkpoint** — user reviews/commits.

---

### Task 2: EGPB token contract (owner-gated mint/burn)

**Files:**
- Create: `contracts/egpb-token-v1.clar`
- Modify: `Clarinet.toml` (after the `[contracts.vgld-token-v4]` block, ~line 87)
- Test: `tests/egpb-token.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `tests/egpb-token.test.ts`:

```typescript
describe("egpb-token-v1: owner-gated mint/burn SIP-010", () => {
  it("exposes correct SIP-010 metadata", () => {
    const { wallet1 } = getTestAccounts();
    expect(simnet.callReadOnlyFn("egpb-token-v1", "get-name", [], wallet1).result)
      .toBeOk(Cl.stringAscii("EGP Bond A"));
    expect(simnet.callReadOnlyFn("egpb-token-v1", "get-symbol", [], wallet1).result)
      .toBeOk(Cl.stringAscii("EGPB"));
    expect(simnet.callReadOnlyFn("egpb-token-v1", "get-decimals", [], wallet1).result)
      .toBeOk(Cl.uint(8));
  });

  it("owner (deployer) can mint; non-owner cannot", () => {
    const { deployer, wallet1 } = getTestAccounts();

    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "mint",
        [Cl.uint(1000_00000000), Cl.principal(wallet1)],
        deployer
      ).result
    ).toBeOk(Cl.bool(true));

    expect(
      simnet.callReadOnlyFn("egpb-token-v1", "get-balance", [Cl.principal(wallet1)], wallet1)
        .result
    ).toBeOk(Cl.uint(1000_00000000));

    // Non-owner mint must fail with ERR_UNAUTHORIZED (u401).
    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "mint",
        [Cl.uint(1_00000000), Cl.principal(wallet1)],
        wallet1
      ).result
    ).toBeErr(Cl.uint(401));
  });

  it("owner can burn own balance; non-owner cannot burn", () => {
    const { deployer, wallet1 } = getTestAccounts();

    simnet.callPublicFn(
      "egpb-token-v1",
      "mint",
      [Cl.uint(500_00000000), Cl.principal(deployer)],
      deployer
    );

    expect(
      simnet.callPublicFn("egpb-token-v1", "burn", [Cl.uint(200_00000000)], deployer).result
    ).toBeOk(Cl.bool(true));

    expect(
      simnet.callReadOnlyFn("egpb-token-v1", "get-balance", [Cl.principal(deployer)], deployer)
        .result
    ).toBeOk(Cl.uint(300_00000000));

    // Non-owner burn must fail even if they hold tokens.
    simnet.callPublicFn(
      "egpb-token-v1",
      "mint",
      [Cl.uint(10_00000000), Cl.principal(wallet1)],
      deployer
    );
    expect(
      simnet.callPublicFn("egpb-token-v1", "burn", [Cl.uint(1_00000000)], wallet1).result
    ).toBeErr(Cl.uint(401));
  });

  it("transfer requires tx-sender to be the sender", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    simnet.callPublicFn(
      "egpb-token-v1",
      "mint",
      [Cl.uint(100_00000000), Cl.principal(wallet1)],
      deployer
    );

    // wallet2 attempting to move wallet1's tokens -> u401.
    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "transfer",
        [Cl.uint(1_00000000), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()],
        wallet2
      ).result
    ).toBeErr(Cl.uint(401));

    // wallet1 moving own tokens -> ok.
    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "transfer",
        [Cl.uint(1_00000000), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()],
        wallet1
      ).result
    ).toBeOk(Cl.bool(true));
  });

  it("set-owner hands off mint authority; old owner locked out", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();

    // Non-owner cannot set-owner.
    expect(
      simnet.callPublicFn("egpb-token-v1", "set-owner", [Cl.principal(wallet1)], wallet1).result
    ).toBeErr(Cl.uint(401));

    // Owner hands off to wallet1.
    expect(
      simnet.callPublicFn("egpb-token-v1", "set-owner", [Cl.principal(wallet1)], deployer).result
    ).toBeOk(Cl.bool(true));

    // New owner mints; old owner rejected.
    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "mint",
        [Cl.uint(1_00000000), Cl.principal(wallet2)],
        wallet1
      ).result
    ).toBeOk(Cl.bool(true));
    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "mint",
        [Cl.uint(1_00000000), Cl.principal(wallet2)],
        deployer
      ).result
    ).toBeErr(Cl.uint(401));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/egpb-token.test.ts`
Expected: oracle test PASSES, all `egpb-token-v1` tests FAIL — contract not found.

- [ ] **Step 3: Write the token contract**

Create `contracts/egpb-token-v1.clar`:

```clarity
;; egpb-token-v1.clar
;;
;; EGP Bond A (EGPB) -- SSE-issued bond token, mainnet collateral #3.
;; SIP-010 fungible token with OWNER-GATED mint and burn: SSE is the sole
;; issuer (mint) and redeemer (burn). No faucet, no open mint. Hard $1.00
;; standard price -- priced via the constant price-oracle-egpb-v1.
;;
;; Redemption flow: a holder transfers EGPB back to the owner, who then
;; burns from the owner's own balance.
;;
;; Owner starts as the deployer key. set-owner allows a future handoff
;; (e.g. to the Asigna multisig) but is NOT exercised at launch.
;;
;; Native FT asset name is "EGPBv1" -- the frontend's Pc.ft()
;; post-conditions key on this exact identifier (FT_ASSET_NAMES).

(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-constant TOKEN-NAME "EGP Bond A")
(define-constant TOKEN-SYMBOL "EGPB")
(define-constant TOKEN-DECIMALS u8)

(define-constant ERR_UNAUTHORIZED u401)

(define-fungible-token EGPBv1)

(define-data-var contract-owner principal tx-sender)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR_UNAUTHORIZED))
    (ft-mint? EGPBv1 amount recipient)
  )
)

(define-public (burn (amount uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR_UNAUTHORIZED))
    (ft-burn? EGPBv1 amount tx-sender)
  )
)

(define-public (set-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR_UNAUTHORIZED))
    (ok (var-set contract-owner new-owner))
  )
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR_UNAUTHORIZED))
    (try! (ft-transfer? EGPBv1 amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)
  )
)

(define-read-only (get-name) (ok TOKEN-NAME))
(define-read-only (get-symbol) (ok TOKEN-SYMBOL))
(define-read-only (get-decimals) (ok TOKEN-DECIMALS))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance EGPBv1 who)))
(define-read-only (get-total-supply) (ok (ft-get-supply EGPBv1)))
(define-read-only (get-token-uri) (ok none))
(define-read-only (get-owner) (ok (var-get contract-owner)))
```

- [ ] **Step 4: Register in Clarinet.toml**

In `Clarinet.toml`, insert directly after the `[contracts.vgld-token-v4]` block (ends ~line 87):

```toml
# EGP Bond A (EGPB) -- SSE-issued bond token, owner-gated mint/burn.
# Ships to mainnet as-is (unlike vgld-token-v4, which is a testnet stub).
[contracts.egpb-token-v1]
path = "contracts/egpb-token-v1.clar"
epoch = "3.1"
depends_on = ["sip-010-trait"]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/egpb-token.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Checkpoint** — user reviews/commits.

---

### Task 3: End-to-end EGPB vault flow on engine v8

**Files:**
- Test: `tests/egpb-token.test.ts` (extend)

- [ ] **Step 1: Write the failing e2e test**

Append to `tests/egpb-token.test.ts`. The helpers mirror `tests/vault-engine-v8.test.ts` (kept local to this file so it reads standalone):

```typescript
// ── e2e helpers (mirrors tests/vault-engine-v8.test.ts) ─────────────────────

function authorizeV8VaultEngine(deployer: string) {
  const enginePrincipal = `${deployer}.multi-asset-vault-engine-v8`;
  expect(
    simnet.callPublicFn(
      "stablecoin-token-v4",
      "set-vault-engine",
      [Cl.principal(enginePrincipal)],
      deployer
    ).result
  ).toBeOk(Cl.bool(true));
  expect(
    simnet.callPublicFn(
      "collateral-registry-v6",
      "set-vault-engine-authorized",
      [Cl.principal(enginePrincipal), Cl.bool(true)],
      deployer
    ).result
  ).toBeOk(Cl.bool(true));
}

function registerSid0Stablecoin(deployer: string, creator: string) {
  expect(
    simnet.callPublicFn(
      "stablecoin-factory-v4",
      "set-registration-fee",
      [Cl.uint(0)],
      deployer
    ).result
  ).toBeOk(Cl.bool(true));
  expect(
    simnet.callPublicFn(
      "stablecoin-factory-v4",
      "register-stablecoin",
      [Cl.stringAscii("Test"), Cl.stringAscii("TEST")],
      creator
    ).result
  ).toBeOk(Cl.uint(0));
  expect(
    simnet.callPublicFn(
      "stablecoin-factory-v4",
      "set-token-contract",
      [Cl.uint(0), Cl.principal(`${deployer}.stablecoin-token-v4`)],
      creator
    ).result
  ).toBeOk(Cl.bool(true));
}

function addEgpbCollateral(deployer: string, creator: string) {
  const asset = `${deployer}.egpb-token-v1`;
  const oracle = `${deployer}.price-oracle-egpb-v1`;
  // Mainnet risk profile per docs/plans/add-egpb-collateral.md §4.
  const params = [
    Cl.uint(150),
    Cl.uint(120),
    Cl.uint(10),
    Cl.uint(200),
    Cl.uint(100_000_000_000),
    Cl.uint(10_000_000),
  ];
  expect(
    simnet.callPublicFn(
      "collateral-registry-v6",
      "add-collateral-type",
      [Cl.principal(asset), ...params, Cl.principal(oracle)],
      deployer
    ).result
  ).toBeOk(Cl.bool(true));
  expect(
    simnet.callPublicFn(
      "collateral-registry-v6",
      "configure-collateral-for-stablecoin",
      [Cl.uint(0), Cl.principal(asset), ...params],
      creator
    ).result
  ).toBeOk(Cl.bool(true));
}

describe("EGPB end-to-end on multi-asset-vault-engine-v8", () => {
  it("full lifecycle: owner mints EGPB -> deposit -> mint stablecoin -> repay -> withdraw", () => {
    const { deployer, wallet1 } = getTestAccounts();
    authorizeV8VaultEngine(deployer);
    registerSid0Stablecoin(deployer, wallet1);
    addEgpbCollateral(deployer, wallet1);

    const egpb = `${deployer}.egpb-token-v1`;
    const egpbOracle = `${deployer}.price-oracle-egpb-v1`;

    // Owner issues 1000 EGPB ($1000 collateral, 8 decimals) to wallet1.
    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "mint",
        [Cl.uint(1000_00000000), Cl.principal(wallet1)],
        deployer
      ).result
    ).toBeOk(Cl.bool(true));

    expect(
      simnet.callPublicFn("multi-asset-vault-engine-v8", "open-vault", [], wallet1).result
    ).toBeOk(Cl.bool(true));

    expect(
      simnet.callPublicFn(
        "multi-asset-vault-engine-v8",
        "deposit-collateral",
        [Cl.principal(egpb), Cl.principal(egpb), Cl.uint(1000_00000000)],
        wallet1
      ).result
    ).toBeOk(Cl.uint(1000_00000000));

    // At 150% min-CR, $1000 collateral supports ~$666; floor is 10. Mint 100.
    expect(
      simnet.callPublicFn(
        "multi-asset-vault-engine-v8",
        "mint-against-asset",
        [Cl.principal(egpb), Cl.principal(egpbOracle), Cl.uint(100_000_000)],
        wallet1
      ).result
    ).toBeOk(Cl.uint(100_000_000));

    // Health factor at constant $1 price (same math as the vGLD case):
    // collateral_value = 100_000_000_000 * 100_000_000 / 1e8 = 100_000_000_000
    // hf = (100_000_000_000 * 10000) / (100_000_000 * 150) = 66_666
    expect(
      simnet.callReadOnlyFn(
        "multi-asset-vault-engine-v8",
        "get-position-health-factor",
        [Cl.principal(wallet1), Cl.principal(egpb), Cl.uint(100_000_000)],
        wallet1
      ).result
    ).toBeUint(66666);

    // Repay all debt, withdraw all collateral.
    expect(
      simnet.callPublicFn(
        "multi-asset-vault-engine-v8",
        "repay-against-asset",
        [Cl.principal(egpb), Cl.uint(100_000_000)],
        wallet1
      ).result
    ).toBeOk(Cl.uint(0));
    expect(
      simnet.callPublicFn(
        "multi-asset-vault-engine-v8",
        "withdraw-collateral",
        [Cl.principal(egpb), Cl.principal(egpb), Cl.principal(egpbOracle), Cl.uint(1000_00000000)],
        wallet1
      ).result
    ).toBeOk(Cl.uint(0));
  });

  it("rejects mint with a mismatched oracle (registry validation)", () => {
    const { deployer, wallet1 } = getTestAccounts();
    authorizeV8VaultEngine(deployer);
    registerSid0Stablecoin(deployer, wallet1);
    addEgpbCollateral(deployer, wallet1);

    const egpb = `${deployer}.egpb-token-v1`;
    const wrongOracle = `${deployer}.price-oracle-vgld-v1`; // also $1, but NOT registered for EGPB

    simnet.callPublicFn(
      "egpb-token-v1",
      "mint",
      [Cl.uint(1000_00000000), Cl.principal(wallet1)],
      deployer
    );
    simnet.callPublicFn("multi-asset-vault-engine-v8", "open-vault", [], wallet1);
    simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "deposit-collateral",
      [Cl.principal(egpb), Cl.principal(egpb), Cl.uint(1000_00000000)],
      wallet1
    );

    // Wrong oracle -> registry mismatch -> price u0 -> ERR_UNSAFE_HEALTH_FACTOR (u204).
    expect(
      simnet.callPublicFn(
        "multi-asset-vault-engine-v8",
        "mint-against-asset",
        [Cl.principal(egpb), Cl.principal(wrongOracle), Cl.uint(100_000_000)],
        wallet1
      ).result
    ).toBeErr(Cl.uint(204));
  });
});
```

- [ ] **Step 2: Run the new tests** (no production code should be needed — engine v8 is generic; if these fail, debug before proceeding)

Run: `npm test -- tests/egpb-token.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 3: Run the FULL suite to catch regressions**

Run: `npm test`
Expected: all suites PASS (previous count 138 + 8 new).

- [ ] **Step 4: Checkpoint** — user reviews/commits.

---

### Task 4: sse.config.json — contracts, costs, mainnet deploy list, collateral entry

**Files:**
- Modify: `sse.config.json`

- [ ] **Step 1: Add contract name mappings**

In the `"contracts"` object, after `"priceOracleVgld": "price-oracle-vgld-v1"` add:

```json
    "egpbToken": "egpb-token-v1",
    "priceOracleEgpb": "price-oracle-egpb-v1"
```

(Add a trailing comma to the `priceOracleVgld` line.)

- [ ] **Step 2: Add contract costs**

In `"contractCosts"`, after `"price-oracle-vgld-v1": 15000` add (comma on previous line):

```json
    "egpb-token-v1": 25000,
    "price-oracle-egpb-v1": 15000
```

- [ ] **Step 3: Extend mainnet deployContracts**

In `networks.mainnet.deployContracts`, append two entries:

```json
      "deployContracts": [
        "stabilityPool",
        "multiAssetVaultEngine",
        "liquidationEngine",
        "priceOracleVgld",
        "egpbToken",
        "priceOracleEgpb"
      ],
```

(The first four are already on-chain; `scripts/deploy.cjs` detects this via `/v2/contracts/source` and logs "already on-chain, skipping".)

- [ ] **Step 4: Append the mainnet collateral entry**

In `networks.mainnet.collaterals`, after the vGLD object add:

```json
        {
          "_comment": "EGP Bond A -- SSE-issued bond token, owner-gated mint/burn (owner = deployer key). Hard $1.00 standard price via constant price-oracle-egpb-v1. Registered on-chain via timelock execute-coll-add (see docs/plans/add-egpb-collateral.md); the deploy script's bootstrap add-collateral-type call will revert as skipped -- expected.",
          "name": "EGP Bond A",
          "symbol": "EGPB",
          "contractName": "egpb-token-v1",
          "decimals": 8,
          "oracleKey": "priceOracleEgpb",
          "risk": {
            "minCollateralRatio": 150,
            "liquidationRatio": 120,
            "liquidationPenalty": 10,
            "stabilityFee": 200,
            "debtCeiling": 100000000000,
            "debtFloor": 10000000
          }
        }
```

Note: no `assetPrincipal` — `deploy.cjs:381` falls back to `${DEPLOYER}.egpb-token-v1`, which is correct here (unlike vGLD, which lives under VoltFi's address).

- [ ] **Step 5: Validate JSON + full suite still green**

Run: `node -e "JSON.parse(require('fs').readFileSync('sse.config.json','utf8')); console.log('valid')"`
Expected: `valid`
Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Checkpoint** — user reviews/commits.

---

### Task 5: Timelock proposal C in scripts/timelock-hashes.cjs

**Files:**
- Modify: `scripts/timelock-hashes.cjs`

- [ ] **Step 1: Add proposal C**

After the `proposalB.hash = …` line (line 94), add:

```javascript
// ──────────────────────────────────────────────────────────────────────────────
// Proposal C — execute-coll-add for EGP Bond A (EGPB). Same wrapper/fn as
// proposal B; v8 engine is already authorized so this is the ONLY proposal
// needed for the EGPB rollout (docs/plans/add-egpb-collateral.md).
// ──────────────────────────────────────────────────────────────────────────────
const EGPB_ASSET = `${DEPLOYER}.egpb-token-v1`;
const oracleEgpb = `${DEPLOYER}.price-oracle-egpb-v1`;
const proposalC = {
  label: "Add EGPB (EGP Bond A) as collateral type in collateral-registry-v6",
  executeFn: "execute-coll-add",
  target: TARGET_COLLATERAL,
  fn: FN_COLL_ADD,
  args: {
    asset: EGPB_ASSET,
    "min-cr": 150n,
    "liq-r": 120n,
    "liq-pen": 10n,
    fee: 200n,
    ceiling: 100_000_000_000n,
    "floor-amt": 10_000_000n,
    oracle: oracleEgpb,
  },
  argsTuple: t.tupleCV({
    asset: t.principalCV(EGPB_ASSET),
    "min-cr": t.uintCV(150),
    "liq-r": t.uintCV(120),
    "liq-pen": t.uintCV(10),
    fee: t.uintCV(200),
    ceiling: t.uintCV(100_000_000_000n),
    "floor-amt": t.uintCV(10_000_000),
    oracle: t.principalCV(oracleEgpb),
  }),
};
proposalC.hash = computeHash(proposalC.target, proposalC.fn, proposalC.argsTuple);
```

- [ ] **Step 2: Print proposal C**

Change the loop on line 127 from:

```javascript
  for (const [name, p] of [["A", proposalA], ["B", proposalB]]) {
```

to:

```javascript
  for (const [name, p] of [["A", proposalA], ["B", proposalB], ["C", proposalC]]) {
```

And update the suggested-id hint line inside the loop from:

```javascript
    console.log(`   id            uint  (choose any unused, e.g. u${name === "A" ? 1001 : 1002})`);
```

to:

```javascript
    console.log(`   id            uint  (choose any unused, e.g. u${{ A: 1001, B: 1002, C: 1003 }[name]})`);
```

Also update the banner on line 117 from `" SSE timelock proposals — vGLD + v8 mainnet rollout"` to `" SSE timelock proposals — vGLD + v8 + EGPB mainnet rollout"`.

- [ ] **Step 3: Run and sanity-check**

Run: `node scripts/timelock-hashes.cjs`
Expected: prints three proposals; Proposal C shows `execute-coll-add` with `asset 'SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0.egpb-token-v1` and `oracle 'SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0.price-oracle-egpb-v1`, a 32-byte hash, and an eta from the live mainnet tip. Proposal A/B hashes must be UNCHANGED: A = `0xcf2c071773bef6b79d0efd4232c8a803064e8e0eba76b37b2e0c84d3dd71646e`, B = `0xae585e03a74f786a27aeb6721d71b53536dde5f99159d83f9bbd289d3c26abab` (regression check against docs/plans/add-vgld-collateral.md §7).

- [ ] **Step 4: Checkpoint** — user reviews/commits.

---

### Task 6: Frontend constants

**Files:**
- Modify: `frontend/src/lib/constants.ts`

- [ ] **Step 1: Add EGPB entries**

Five edits, all following the existing vGLD pattern (EGPB needs no `MAINNET_*_ASSET_PRINCIPAL` constant — it lives under the same deployer address the frontend already resolves via `getContractId`):

1. In `CONTRACTS` (line 68), after `PRICE_ORACLE_VGLD: "price-oracle-vgld-v1",` add:

```typescript
  PRICE_ORACLE_EGPB: "price-oracle-egpb-v1",
```

2. In `FT_ASSET_NAMES` (line 96), after `"vgld-token-v4": "vGLDv4",` add:

```typescript
  // EGPB's on-chain FT asset name is "EGPBv1" — required for Pc.ft()
  // post-conditions. Token is deployer-owned (owner-gated mint/burn).
  "egpb-token-v1": "EGPBv1",
```

3. In `COLLATERAL_DECIMALS` (line 158), after `"vgld-token-v4": 8,` add:

```typescript
  "egpb-token-v1": 8,
```

4. In `CONSTANT_ORACLE_NAMES` (line 186), change:

```typescript
export const CONSTANT_ORACLE_NAMES = new Set<string>(["price-oracle-vgld-v1"]);
```

to:

```typescript
export const CONSTANT_ORACLE_NAMES = new Set<string>([
  "price-oracle-vgld-v1",
  "price-oracle-egpb-v1",
]);
```

5. In `COLLATERAL_SYMBOLS` (line 216), after `"vgld-token-v4": "vGLD",` add:

```typescript
  "egpb-token-v1": "EGPB",
```

Do NOT add a `COLLATERAL_UX` entry — EGPB has no public acquisition URL (issuer-minted); `getCollateralUx` returning `null` is the same handled path as sBTC. No `FAUCET_COLLATERALS` entry — mainnet only, no faucet function exists.

- [ ] **Step 2: Type-check (NOT `npm run build` — dev server may be running)**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Grep for stale-data filters**

Run: `grep -rn "vgld-token-v4\|MAINNET_VGLD" frontend/src --include="*.ts" --include="*.tsx" -l`
Review each hit: any component that special-cases collateral lists (allowlists, sort orders, display filters) must also handle `egpb-token-v1`. Apply the same one-line addition pattern wherever vGLD required one. (The registry is shared/reused on mainnet — frontends filter to known collaterals, so a missing entry hides EGPB.)

- [ ] **Step 4: Re-run type-check after any edits**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Checkpoint** — user reviews/commits.

---

### Task 7: Docs

**Files:**
- Modify: `README.md`, `docs/SSE_CONTEXT.md`, `docs/roadmap.md`, `docs/plans/add-egpb-collateral.md`

- [ ] **Step 1: README** — locate the mainnet section listing deployed contracts and collaterals (rows for sBTC and vGLD). Add, matching the existing row format exactly:
  - Contracts: `egpb-token-v1` and `price-oracle-egpb-v1` under `SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0`.
  - Collateral row: `EGP Bond A (EGPB) — SP3QMDAC….egpb-token-v1 — constant $1 oracle (price-oracle-egpb-v1) — min-CR 150% / liq 120% / ceiling 100k`.

- [ ] **Step 2: docs/SSE_CONTEXT.md** — versioning section: append `egpb-token-v1`, `price-oracle-egpb-v1`. Collateral assets subsection: add EGPB (issuer = SSE deployer key, owner-gated mint/burn, $1 constant price).

- [ ] **Step 3: docs/roadmap.md** — under launched-mainnet add: "EGPB (EGP Bond A) collateral added — owner-gated bond token + constant $1 oracle, registered via timelock (2026-06)".

- [ ] **Step 4: Update spec status** — in `docs/plans/add-egpb-collateral.md` change the Status line to "implementation merged, awaiting mainnet rollout (§7)". After rollout completes (Task 9-10), update again with tx receipts, mirroring the vGLD doc's "On-chain receipts" block.

- [ ] **Step 5: Checkpoint** — user reviews/commits. **STOP HERE for user sign-off before any mainnet transaction.**

---

### Task 8: Mainnet deploy (REQUIRES USER GREEN-LIGHT)

**Files:** none (operational)

- [ ] **Step 1: Pre-flight**

Run: `npm test` → all green.
Run: `curl -s "https://api.hiro.so/extended/v1/address/SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0/stx" | head -c 200` → balance ≥ ~1 STX (was 28.04 STX on 2026-06-10).

- [ ] **Step 2: Publish the two contracts**

Run: `npm run deploy -- --network mainnet`
Expected output:
- `⊘ stability-pool-v7 — already on-chain, skipping` (same for engine-v8, liquidation-v8, oracle-vgld)
- `egpb-token-v1` and `price-oracle-egpb-v1` published with txids
- Bootstrap registry calls log `⊘ skipped (already configured)` or revert — **expected** (registry is timelock-governed); `set-vault-engine` already points at v8.

- [ ] **Step 3: Verify on-chain**

```bash
D=SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0
curl -s "https://api.hiro.so/v2/contracts/source/$D/egpb-token-v1?proof=0" | head -c 200
curl -s "https://api.hiro.so/v2/contracts/source/$D/price-oracle-egpb-v1?proof=0" | head -c 200
```

Expected: both return Clarity source (not 404). Record the two deploy txids in `docs/plans/add-egpb-collateral.md`.

---

### Task 9: Timelock queue + execute (Asigna multisig — USER ACTION)

**Files:** none (operational; agent prepares payloads, user signs in Asigna)

- [ ] **Step 1: Compute the live payload**

Run: `node scripts/timelock-hashes.cjs`
Copy Proposal C's block (hash, target u2, fn u1, recommended eta).

- [ ] **Step 2: Cross-check the hash on-chain** (read-only, free)

Call `SP3QMDAC….sse-timelock-v1::compute-hash(u2, u1, args-buff)` via the Hiro explorer sandbox or API with the consensus-buff of the args tuple (the script prints it). If it differs from the script output, **stop** — the script is wrong, not the contract.

- [ ] **Step 3: USER queues in Asigna** (`SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX`):
`sse-timelock-v1::queue(id=u1003, action-hash=0x<from script>, target=u2, fn=u1, eta=u<from script>)`. Paste the script output into the proposal description for auditability.

- [ ] **Step 4: Wait 144 blocks (~24h).**

- [ ] **Step 5: USER executes in Asigna:**
`sse-timelock-v1::execute-coll-add(id=u1003, asset='SP3QMDAC….egpb-token-v1, min-cr=u150, liq-r=u120, liq-pen=u10, fee=u200, ceiling=u100000000000, floor-amt=u10000000, oracle='SP3QMDAC….price-oracle-egpb-v1)`

- [ ] **Step 6: Verify registration** (read-only calls against `collateral-registry-v6`):
`get-collateral-config('SP3QMDAC….egpb-token-v1)` → `(some {oracle: …price-oracle-egpb-v1, min-collateral-ratio: u150, …})`; `get-oracle(…)` → `(some …price-oracle-egpb-v1)`. Record execute txid in the plan doc.

---

### Task 10: Frontend release + smoke test (USER-PACED)

- [ ] **Step 1:** User deploys frontend to production (Netlify) after Task 9 verification.
- [ ] **Step 2:** Smoke test on mainnet with small amounts:
  1. Deployer mints test EGPB: `egpb-token-v1::mint(u100000000, '<test wallet>)` (1 EGPB).
  2. Test wallet: open vault → deposit 1 EGPB → mint 0.5 stablecoin… **floor is 10 stablecoins**, so deposit ≥ u1600000000 (16 EGPB) and mint u10000000 (10 stablecoins) to clear the floor at 150% CR.
  3. Repay → withdraw → close. All four txs confirm.
  4. UI shows EGPB symbol, $1 price, "constant oracle" freshness (no staleness warning).
- [ ] **Step 3:** Append on-chain receipts (deploy, queue, execute, smoke txids) to `docs/plans/add-egpb-collateral.md` and flip Status to "executed".

---

## Self-review notes

- Spec §3 (2 contracts) → Tasks 1-2. Spec §5 repo changes → Tasks 4-7. Spec §6 proposal → Tasks 5, 9. Spec §7 rollout → Tasks 8-10. Spec §8 rollback unchanged (operational reference). Coverage complete.
- Smoke-test step 2 corrected for the u10000000 debt floor (10 stablecoins) — 1 EGPB cannot clear it; 16 EGPB at 150% CR can (16 ≥ 10 × 1.5).
- Type consistency: `EGPBv1` FT asset name used identically in contract, FT_ASSET_NAMES, and plan prose. Risk param literals identical across test helper, config JSON, timelock script, and runbook.
- Tuple key order in proposal C matches proposal B exactly (serializer sorts keys; values differ only in asset/oracle principals).
