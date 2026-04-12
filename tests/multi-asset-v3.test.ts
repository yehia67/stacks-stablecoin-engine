import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

function getTestAccounts() {
  const accounts = simnet.getAccounts();
  const deployer = accounts.get("deployer");
  const wallet1 = accounts.get("wallet_1");
  const wallet2 = accounts.get("wallet_2");

  if (!deployer || !wallet1 || !wallet2) {
    throw new Error("Missing default simnet accounts");
  }

  return { deployer, wallet1, wallet2 };
}

/** Seed DIA BTC price so oracle lookups work. */
function seedDiaBtcPrice(deployer: string, value: number = 6700000000000) {
  simnet.callPublicFn(
    "dia-oracle-adapter",
    "set-value",
    [Cl.stringAscii("BTC/USD"), Cl.uint(value)],
    deployer
  );
}

/** Register sBTC oracle so the vault engine can price collateral. */
function registerSbtcOracle(deployer: string) {
  const sbtcAsset = `${deployer}.sbtc-token-v3`;
  const result = simnet.callPublicFn(
    "multi-asset-vault-engine-v5",
    "register-asset-oracle",
    [Cl.principal(sbtcAsset), Cl.uint(3)], // ORACLE-DIA-BTC = u3
    deployer
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

/** Add sBTC as a global collateral type in the registry. Also seeds DIA price. */
function addSbtcGlobalCollateral(deployer: string) {
  seedDiaBtcPrice(deployer);
  const sbtcAsset = `${deployer}.sbtc-token-v3`;
  const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;
  const result = simnet.callPublicFn(
    "collateral-registry-v4",
    "add-collateral-type",
    [
      Cl.principal(sbtcAsset),
      Cl.uint(150),       // min-collateral-ratio: 150%
      Cl.uint(120),       // liquidation-ratio: 120%
      Cl.uint(10),        // liquidation-penalty: 10%
      Cl.uint(200),       // stability-fee: 2%
      Cl.uint(10000000),  // debt-ceiling: 10M
      Cl.uint(100),       // debt-floor: 100
      Cl.principal(oraclePrincipal),
    ],
    deployer
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

/** Configure sBTC collateral for a specific stablecoin (creator must call). */
function configureSbtcForStablecoin(deployer: string, creator: string, stablecoinId: number) {
  const sbtcAsset = `${deployer}.sbtc-token-v3`;
  const result = simnet.callPublicFn(
    "collateral-registry-v4",
    "configure-collateral-for-stablecoin",
    [
      Cl.uint(stablecoinId),
      Cl.principal(sbtcAsset),
      Cl.uint(150),       // min-collateral-ratio
      Cl.uint(120),       // liquidation-ratio
      Cl.uint(10),        // liquidation-penalty
      Cl.uint(200),       // stability-fee
      Cl.uint(10000000),  // debt-ceiling
      Cl.uint(100),       // debt-floor
    ],
    creator
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

/** Authorize the multi-asset vault engine on the stablecoin token. */
function authorizeMultiAssetVaultEngine(deployer: string) {
  const vaultEnginePrincipal = `${deployer}.multi-asset-vault-engine-v5`;
  const result = simnet.callPublicFn(
    "stablecoin-token-v3",
    "set-vault-engine",
    [Cl.principal(vaultEnginePrincipal)],
    deployer
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

/** Register a stablecoin, link its token, and configure sBTC collateral. */
function setupStablecoinWithSbtc(deployer: string, creator: string) {
  // Zero-fee registration
  simnet.callPublicFn("stablecoin-factory-v3", "set-registration-fee", [Cl.uint(0)], deployer);

  const regResult = simnet.callPublicFn(
    "stablecoin-factory-v3", "register-stablecoin",
    [Cl.stringAscii("Test Dollar"), Cl.stringAscii("TUSD")],
    creator
  );
  expect(regResult.result).toBeOk(Cl.uint(0));

  const tokenPrincipal = `${deployer}.stablecoin-token-v3`;
  const linkResult = simnet.callPublicFn(
    "stablecoin-factory-v3", "set-token-contract",
    [Cl.uint(0), Cl.principal(tokenPrincipal)],
    creator
  );
  expect(linkResult.result).toBeOk(Cl.bool(true));

  // Configure per-stablecoin collateral (creator must call)
  configureSbtcForStablecoin(deployer, creator, 0);
}

/** Mint sBTC test tokens to a recipient via the faucet. */
function faucetMintSbtc(recipient: string, amount: number) {
  const result = simnet.callPublicFn(
    "sbtc-token-v3",
    "faucet-mint",
    [Cl.uint(amount), Cl.principal(recipient)],
    recipient
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

/** Get sBTC balance for any principal (standard or contract). */
function getSbtcBalance(owner: string): bigint {
  const deployer = simnet.getAccounts().get("deployer")!;
  const result = simnet.callReadOnlyFn(
    "sbtc-token-v3",
    "get-balance",
    [Cl.principal(owner)],
    deployer
  );
  return (result.result as any).value.value;
}

/** Get the vault engine contract principal. */
function getVaultEnginePrincipal(deployer: string): string {
  return `${deployer}.multi-asset-vault-engine-v5`;
}

// ============================================
// Collateral Custody Transfer Tests (v3)
// ============================================

describe("multi-asset-vault-engine-v5 collateral custody", () => {
  describe("deposit transfers tokens to protocol", () => {
    it("transfers sBTC from user to vault engine on deposit", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v3`;
      const vaultEngine = getVaultEnginePrincipal(deployer);

      // Setup: global collateral + oracle + stablecoin + per-stablecoin config
      addSbtcGlobalCollateral(deployer);
      registerSbtcOracle(deployer);
      setupStablecoinWithSbtc(deployer, wallet1);
      faucetMintSbtc(wallet1, 5000);

      // Verify initial balances
      expect(getSbtcBalance(wallet1)).toBe(5000n);
      expect(getSbtcBalance(vaultEngine)).toBe(0n);

      // Open vault for stablecoin and deposit
      simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "open-vault-for-stablecoin",
        [Cl.uint(0)], wallet1
      );
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine-v5",
        "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1500)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(1500));

      // Verify balances changed
      expect(getSbtcBalance(wallet1)).toBe(3500n);   // 5000 - 1500
      expect(getSbtcBalance(vaultEngine)).toBe(1500n);  // 0 + 1500
    });

    it("accumulates deposits correctly", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v3`;
      const vaultEngine = getVaultEnginePrincipal(deployer);

      addSbtcGlobalCollateral(deployer);
      registerSbtcOracle(deployer);
      setupStablecoinWithSbtc(deployer, wallet1);
      faucetMintSbtc(wallet1, 5000);

      simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "open-vault-for-stablecoin",
        [Cl.uint(0)], wallet1
      );

      // First deposit
      let result = simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1000)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(1000));

      // Second deposit
      result = simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(500)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(1500)); // Accumulated

      expect(getSbtcBalance(wallet1)).toBe(3500n);
      expect(getSbtcBalance(vaultEngine)).toBe(1500n);
    });

    it("rejects deposit when user has insufficient token balance", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v3`;

      addSbtcGlobalCollateral(deployer);
      registerSbtcOracle(deployer);
      setupStablecoinWithSbtc(deployer, wallet1);
      faucetMintSbtc(wallet1, 100); // Only 100 tokens

      simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "open-vault-for-stablecoin",
        [Cl.uint(0)], wallet1
      );

      // Try to deposit more than balance
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine-v5",
        "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(500)],
        wallet1
      );
      // Should fail with sBTC's ERR_INSUFFICIENT_BALANCE
      expect(result.result).toBeErr(Cl.uint(402));
    });

    it("rejects deposit with mismatched asset and collateral-token", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v3`;
      const stxAsset = `${deployer}.stx-token-v3`;

      addSbtcGlobalCollateral(deployer);
      registerSbtcOracle(deployer);
      setupStablecoinWithSbtc(deployer, wallet1);
      faucetMintSbtc(wallet1, 1000);

      simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "open-vault-for-stablecoin",
        [Cl.uint(0)], wallet1
      );

      // Pass sBTC as asset but stx-token as trait — should fail
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine-v5",
        "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(stxAsset), Cl.uint(500)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(215)); // ERR_ASSET_MISMATCH
    });
  });

  describe("withdraw transfers tokens back to user", () => {
    it("transfers sBTC from vault engine back to user on withdraw", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v3`;
      const vaultEngine = getVaultEnginePrincipal(deployer);

      addSbtcGlobalCollateral(deployer);
      registerSbtcOracle(deployer);
      setupStablecoinWithSbtc(deployer, wallet1);
      faucetMintSbtc(wallet1, 5000);

      // Open vault, deposit
      simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "open-vault-for-stablecoin",
        [Cl.uint(0)], wallet1
      );
      simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(3000)],
        wallet1
      );

      // Verify after deposit
      expect(getSbtcBalance(wallet1)).toBe(2000n);
      expect(getSbtcBalance(vaultEngine)).toBe(3000n);

      // Withdraw
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine-v5",
        "withdraw-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1000)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(2000)); // remaining collateral

      // Verify balances after withdraw
      expect(getSbtcBalance(wallet1)).toBe(3000n);     // 2000 + 1000
      expect(getSbtcBalance(vaultEngine)).toBe(2000n); // 3000 - 1000
    });

    it("rejects withdrawal that would break health factor", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v3`;
      const tokenPrincipal = `${deployer}.stablecoin-token-v3`;

      addSbtcGlobalCollateral(deployer);
      registerSbtcOracle(deployer);
      authorizeMultiAssetVaultEngine(deployer);
      setupStablecoinWithSbtc(deployer, wallet1);

      // Set oracle price to 100000000 (= $1 per unit at 1e8 scale)
      // so collateral value = amount directly
      simnet.callPublicFn(
        "dia-oracle-adapter", "set-value",
        [Cl.stringAscii("BTC/USD"), Cl.uint(100000000)],
        deployer
      );

      faucetMintSbtc(wallet1, 5000);

      // Open vault, deposit, mint near limit
      simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "open-vault-for-stablecoin",
        [Cl.uint(0)], wallet1
      );
      simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1500)],
        wallet1
      );
      // At $1/unit, 1500 collateral supports max 1000 debt at 150% ratio
      simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "mint-against-asset-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(900)],
        wallet1
      );

      // Withdrawing 200 leaves 1300 collateral with 900 debt → 144% < 150%
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine-v5",
        "withdraw-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(200)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(204)); // ERR_UNSAFE_HEALTH_FACTOR
    });
  });

  describe("full vault lifecycle with real custody", () => {
    it("open → deposit → mint → repay → withdraw full cycle", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v3`;
      const tokenPrincipal = `${deployer}.stablecoin-token-v3`;
      const vaultEngine = getVaultEnginePrincipal(deployer);

      addSbtcGlobalCollateral(deployer);
      registerSbtcOracle(deployer);
      authorizeMultiAssetVaultEngine(deployer);
      setupStablecoinWithSbtc(deployer, wallet1);
      faucetMintSbtc(wallet1, 10000);

      // Open vault for stablecoin
      let result = simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "open-vault-for-stablecoin",
        [Cl.uint(0)], wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Deposit 5000 sBTC
      result = simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(5000)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(5000));
      expect(getSbtcBalance(wallet1)).toBe(5000n);
      expect(getSbtcBalance(vaultEngine)).toBe(5000n);

      // Mint 2000 stablecoin
      result = simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "mint-against-asset-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(2000)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(2000));

      // Verify stablecoin minted
      const stablecoinBalance = simnet.callReadOnlyFn(
        "stablecoin-token-v3", "get-balance", [Cl.principal(wallet1)], wallet1
      );
      expect(stablecoinBalance.result).toBeOk(Cl.uint(2000));

      // Repay all debt
      result = simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "repay-against-asset-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(2000)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(0)); // zero remaining debt

      // Withdraw all collateral
      result = simnet.callPublicFn(
        "multi-asset-vault-engine-v5", "withdraw-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(5000)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(0)); // zero remaining collateral

      // Verify all sBTC returned to user
      expect(getSbtcBalance(wallet1)).toBe(10000n);
      expect(getSbtcBalance(vaultEngine)).toBe(0n);
    });
  });
});
