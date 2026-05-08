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

function authorizeMultiAssetVaultEngine(deployer: string) {
  const vaultEnginePrincipal = `${deployer}.multi-asset-vault-engine-v6`;
  const result = simnet.callPublicFn(
    "stablecoin-token-v4",
    "set-vault-engine",
    [Cl.principal(vaultEnginePrincipal)],
    deployer
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

function seedDiaBtcPrice(deployer: string, value: number = 6700000000000) {
  simnet.callPublicFn(
    "dia-oracle-adapter",
    "set-value",
    [Cl.stringAscii("BTC/USD"), Cl.uint(value)],
    deployer
  );
}

function addCollateralType(deployer: string, asset: string) {
  seedDiaBtcPrice(deployer);
  const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;
  const result = simnet.callPublicFn(
    "collateral-registry-v5",
    "add-collateral-type",
    [
      Cl.principal(asset),
      Cl.uint(150),       // min-collateral-ratio: 150%
      Cl.uint(120),       // liquidation-ratio: 120%
      Cl.uint(10),        // liquidation-penalty: 10%
      Cl.uint(200),       // stability-fee: 2% (200 basis points)
      Cl.uint(10000000),  // debt-ceiling: 10M
      Cl.uint(100),       // debt-floor: 100 (minimum debt)
      Cl.principal(oraclePrincipal),
    ],
    deployer
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

function registerOracleForAsset(deployer: string, asset: string) {
  const result = simnet.callPublicFn(
    "multi-asset-vault-engine-v6",
    "register-asset-oracle",
    [Cl.principal(asset), Cl.uint(3)], // DIA BTC oracle
    deployer
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

function registerLinkedStablecoin(deployer: string, creator: string, name: string, symbol: string) {
  simnet.callPublicFn("stablecoin-factory-v3", "set-registration-fee", [Cl.uint(0)], deployer);

  const registerResult = simnet.callPublicFn(
    "stablecoin-factory-v3",
    "register-stablecoin",
    [Cl.stringAscii(name), Cl.stringAscii(symbol)],
    creator
  );
  expect(registerResult.result).toBeOk(Cl.uint(0));

  const tokenPrincipal = `${deployer}.stablecoin-token-v4`;
  const linkResult = simnet.callPublicFn(
    "stablecoin-factory-v3",
    "set-token-contract",
    [Cl.uint(0), Cl.principal(tokenPrincipal)],
    creator
  );
  expect(linkResult.result).toBeOk(Cl.bool(true));
}

function configureCollateralForStablecoin(deployer: string, creator: string, asset: string) {
  const result = simnet.callPublicFn(
    "collateral-registry-v5",
    "configure-collateral-for-stablecoin",
    [
      Cl.uint(0), Cl.principal(asset),
      Cl.uint(150), Cl.uint(120), Cl.uint(10), Cl.uint(200),
      Cl.uint(10000000), Cl.uint(100),
    ],
    creator
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

// ============================================
// Collateral Registry Tests
// ============================================

describe("collateral-registry-v5 multi-asset", () => {
  describe("add collateral type", () => {
    it("allows owner to add new collateral types with extended parameters", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stablecoin-token-v4`;
      const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;

      const result = simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(assetPrincipal),
          Cl.uint(150),       // min-collateral-ratio
          Cl.uint(120),       // liquidation-ratio
          Cl.uint(10),        // liquidation-penalty
          Cl.uint(200),       // stability-fee
          Cl.uint(10000000),  // debt-ceiling
          Cl.uint(100),       // debt-floor
          Cl.principal(oraclePrincipal),
        ],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify config was stored
      const config = simnet.callReadOnlyFn(
        "collateral-registry-v5",
        "get-collateral-config",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(config.result).toBeSome(
        Cl.tuple({
          "min-collateral-ratio": Cl.uint(150),
          "liquidation-ratio": Cl.uint(120),
          "liquidation-penalty": Cl.uint(10),
          "stability-fee": Cl.uint(200),
          "debt-ceiling": Cl.uint(10000000),
          "debt-floor": Cl.uint(100),
          "enabled": Cl.bool(true),
          "oracle": Cl.principal(oraclePrincipal),
        })
      );
    });

    it("rejects non-owner collateral additions", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const assetPrincipal = `${deployer}.stablecoin-token-v4`;
      const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;

      const result = simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(assetPrincipal),
          Cl.uint(150),
          Cl.uint(120),
          Cl.uint(10),
          Cl.uint(200),
          Cl.uint(10000000),
          Cl.uint(100),
          Cl.principal(oraclePrincipal),
        ],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(100)); // ERR_UNAUTHORIZED
    });

    it("rejects duplicate collateral types", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stablecoin-token-v4`;
      const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;

      // First addition
      let result = simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(assetPrincipal),
          Cl.uint(150),
          Cl.uint(120),
          Cl.uint(10),
          Cl.uint(200),
          Cl.uint(10000000),
          Cl.uint(100),
          Cl.principal(oraclePrincipal),
        ],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Duplicate should fail
      result = simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(assetPrincipal),
          Cl.uint(150),
          Cl.uint(120),
          Cl.uint(10),
          Cl.uint(200),
          Cl.uint(10000000),
          Cl.uint(100),
          Cl.principal(oraclePrincipal),
        ],
        deployer
      );
      expect(result.result).toBeErr(Cl.uint(102)); // ERR_ASSET_ALREADY_EXISTS
    });

    it("rejects invalid ratios", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stability-pool-v5`;
      const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;

      // min-collateral-ratio <= 100 should fail
      let result = simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(assetPrincipal),
          Cl.uint(100),  // Invalid: must be > 100
          Cl.uint(120),
          Cl.uint(10),
          Cl.uint(200),
          Cl.uint(10000000),
          Cl.uint(100),
          Cl.principal(oraclePrincipal),
        ],
        deployer
      );
      expect(result.result).toBeErr(Cl.uint(104)); // ERR_INVALID_RATIO
    });

    it("rejects liquidation ratio > min collateral ratio", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stability-pool-v5`;
      const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;

      // liquidation-ratio > min-collateral-ratio should fail
      const result = simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(assetPrincipal),
          Cl.uint(150),
          Cl.uint(160),  // Invalid: must be <= min-collateral-ratio
          Cl.uint(10),
          Cl.uint(200),
          Cl.uint(10000000),
          Cl.uint(100),
          Cl.principal(oraclePrincipal),
        ],
        deployer
      );
      expect(result.result).toBeErr(Cl.uint(104)); // ERR_INVALID_RATIO
    });
  });

  describe("collateral management", () => {
    it("allows owner to enable/disable collateral types", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stablecoin-token-v4`;
      const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;

      // Add collateral
      simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(assetPrincipal),
          Cl.uint(150),
          Cl.uint(120),
          Cl.uint(10),
          Cl.uint(200),
          Cl.uint(10000000),
          Cl.uint(100),
          Cl.principal(oraclePrincipal),
        ],
        deployer
      );

      // Authorize test caller for debt mutation helpers
      simnet.callPublicFn(
        "collateral-registry-v5",
        "set-vault-engine-authorized",
        [Cl.principal(deployer), Cl.bool(true)],
        deployer
      );

      // Verify enabled by default
      let isEnabled = simnet.callReadOnlyFn(
        "collateral-registry-v5",
        "is-collateral-enabled",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(isEnabled.result).toBeBool(true);

      // Disable
      let result = simnet.callPublicFn(
        "collateral-registry-v5",
        "set-collateral-enabled",
        [Cl.principal(assetPrincipal), Cl.bool(false)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify disabled
      isEnabled = simnet.callReadOnlyFn(
        "collateral-registry-v5",
        "is-collateral-enabled",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(isEnabled.result).toBeBool(false);
    });

    it("allows owner to update collateral parameters", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stablecoin-token-v4`;
      const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;

      // Add collateral
      simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(assetPrincipal),
          Cl.uint(150),
          Cl.uint(120),
          Cl.uint(10),
          Cl.uint(200),
          Cl.uint(10000000),
          Cl.uint(100),
          Cl.principal(oraclePrincipal),
        ],
        deployer
      );

      // Update parameters
      const result = simnet.callPublicFn(
        "collateral-registry-v5",
        "update-collateral-params",
        [
          Cl.principal(assetPrincipal),
          Cl.uint(175),       // New min-collateral-ratio
          Cl.uint(130),       // New liquidation-ratio
          Cl.uint(15),        // New liquidation-penalty
          Cl.uint(300),       // New stability-fee
          Cl.uint(20000000),  // New debt-ceiling
          Cl.uint(200),       // New debt-floor
        ],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify updated
      const minRatio = simnet.callReadOnlyFn(
        "collateral-registry-v5",
        "get-min-collateral-ratio",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(minRatio.result).toBeSome(Cl.uint(175));
    });

    it("tracks collateral count and enumeration", () => {
      const { deployer } = getTestAccounts();
      const asset1 = `${deployer}.stablecoin-token-v4`;
      const asset2 = `${deployer}.stability-pool-v5`;
      const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;

      // Add first collateral
      simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(asset1),
          Cl.uint(150),
          Cl.uint(120),
          Cl.uint(10),
          Cl.uint(200),
          Cl.uint(10000000),
          Cl.uint(100),
          Cl.principal(oraclePrincipal),
        ],
        deployer
      );

      // Add second collateral
      simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(asset2),
          Cl.uint(200),
          Cl.uint(150),
          Cl.uint(15),
          Cl.uint(300),
          Cl.uint(5000000),
          Cl.uint(50),
          Cl.principal(oraclePrincipal),
        ],
        deployer
      );

      // Check count
      const count = simnet.callReadOnlyFn(
        "collateral-registry-v5",
        "get-collateral-count",
        [],
        deployer
      );
      expect(count.result).toBeUint(2);

      // Check enumeration
      const first = simnet.callReadOnlyFn(
        "collateral-registry-v5",
        "get-collateral-at-index",
        [Cl.uint(0)],
        deployer
      );
      expect(first.result).toBeSome(Cl.tuple({ asset: Cl.principal(asset1) }));

      const second = simnet.callReadOnlyFn(
        "collateral-registry-v5",
        "get-collateral-at-index",
        [Cl.uint(1)],
        deployer
      );
      expect(second.result).toBeSome(Cl.tuple({ asset: Cl.principal(asset2) }));
    });
  });

  describe("debt tracking", () => {
    it("tracks total debt per collateral type", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stablecoin-token-v4`;
      const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;

      // Add collateral
      simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(assetPrincipal),
          Cl.uint(150),
          Cl.uint(120),
          Cl.uint(10),
          Cl.uint(200),
          Cl.uint(10000000),
          Cl.uint(100),
          Cl.principal(oraclePrincipal),
        ],
        deployer
      );

      simnet.callPublicFn(
        "collateral-registry-v5",
        "set-vault-engine-authorized",
        [Cl.principal(deployer), Cl.bool(true)],
        deployer
      );

      // Initial debt should be 0
      let totalDebt = simnet.callReadOnlyFn(
        "collateral-registry-v5",
        "get-total-debt",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(totalDebt.result).toBeUint(0);

      // Increase debt
      let result = simnet.callPublicFn(
        "collateral-registry-v5",
        "increase-debt",
        [Cl.principal(assetPrincipal), Cl.uint(1000)],
        deployer
      );
      expect(result.result).toBeOk(Cl.uint(1000));

      // Check updated debt
      totalDebt = simnet.callReadOnlyFn(
        "collateral-registry-v5",
        "get-total-debt",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(totalDebt.result).toBeUint(1000);

      // Decrease debt
      result = simnet.callPublicFn(
        "collateral-registry-v5",
        "decrease-debt",
        [Cl.principal(assetPrincipal), Cl.uint(400)],
        deployer
      );
      expect(result.result).toBeOk(Cl.uint(600));
    });

    it("enforces debt ceiling", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stablecoin-token-v4`;
      const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;

      // Add collateral with low ceiling
      simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(assetPrincipal),
          Cl.uint(150),
          Cl.uint(120),
          Cl.uint(10),
          Cl.uint(200),
          Cl.uint(1000),  // Low debt ceiling
          Cl.uint(100),
          Cl.principal(oraclePrincipal),
        ],
        deployer
      );

      // Authorize test caller for debt mutation helpers
      simnet.callPublicFn(
        "collateral-registry-v5",
        "set-vault-engine-authorized",
        [Cl.principal(deployer), Cl.bool(true)],
        deployer
      );

      // Try to exceed ceiling
      const result = simnet.callPublicFn(
        "collateral-registry-v5",
        "increase-debt",
        [Cl.principal(assetPrincipal), Cl.uint(1500)],
        deployer
      );
      expect(result.result).toBeErr(Cl.uint(105)); // ERR_DEBT_CEILING_EXCEEDED
    });

    it("calculates available debt capacity", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stablecoin-token-v4`;
      const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;

      // Add collateral
      simnet.callPublicFn(
        "collateral-registry-v5",
        "add-collateral-type",
        [
          Cl.principal(assetPrincipal),
          Cl.uint(150),
          Cl.uint(120),
          Cl.uint(10),
          Cl.uint(200),
          Cl.uint(10000),  // Debt ceiling
          Cl.uint(100),
          Cl.principal(oraclePrincipal),
        ],
        deployer
      );

      // Authorize test caller for debt mutation helpers
      simnet.callPublicFn(
        "collateral-registry-v5",
        "set-vault-engine-authorized",
        [Cl.principal(deployer), Cl.bool(true)],
        deployer
      );

      // Initial capacity = ceiling
      let capacity = simnet.callReadOnlyFn(
        "collateral-registry-v5",
        "get-available-debt-capacity",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(capacity.result).toBeSome(Cl.uint(10000));

      // Add some debt
      simnet.callPublicFn(
        "collateral-registry-v5",
        "increase-debt",
        [Cl.principal(assetPrincipal), Cl.uint(3000)],
        deployer
      );

      // Check remaining capacity
      capacity = simnet.callReadOnlyFn(
        "collateral-registry-v5",
        "get-available-debt-capacity",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(capacity.result).toBeSome(Cl.uint(7000));
    });
  });
});

// ============================================
// Multi-Asset Vault Engine Tests
// ============================================

describe("multi-asset-vault-engine-v6", () => {
  describe("vault lifecycle", () => {
    it("allows users to open vaults", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v4`;

      addCollateralType(deployer, sbtcAsset);
      registerOracleForAsset(deployer, sbtcAsset);
      registerLinkedStablecoin(deployer, wallet1, "Vault Dollar", "VUSD");
      configureCollateralForStablecoin(deployer, wallet1, sbtcAsset);

      const result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "open-vault-for-stablecoin",
        [Cl.uint(0)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));
    });

    it("rejects duplicate vault creation", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v4`;

      addCollateralType(deployer, sbtcAsset);
      registerOracleForAsset(deployer, sbtcAsset);
      registerLinkedStablecoin(deployer, wallet1, "Dup Dollar", "DUSD");
      configureCollateralForStablecoin(deployer, wallet1, sbtcAsset);

      // First vault
      let result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "open-vault-for-stablecoin",
        [Cl.uint(0)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Duplicate should fail
      result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "open-vault-for-stablecoin",
        [Cl.uint(0)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(200)); // ERR_VAULT_EXISTS
    });
  });

  describe("multi-asset collateral deposits", () => {
    it("allows depositing collateral", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v4`;

      addCollateralType(deployer, sbtcAsset);
      registerOracleForAsset(deployer, sbtcAsset);
      registerLinkedStablecoin(deployer, wallet1, "Dep Dollar", "DPSD");
      configureCollateralForStablecoin(deployer, wallet1, sbtcAsset);

      // Faucet sBTC
      simnet.callPublicFn("sbtc-token-v4", "faucet-mint", [Cl.uint(5000), Cl.principal(wallet1)], wallet1);

      // Open vault
      simnet.callPublicFn("multi-asset-vault-engine-v6", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);

      // Deposit
      let result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1000)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(1000));

      // Deposit more
      result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(500)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(1500));
    });
  });

  describe("minting against specific assets", () => {
    it("allows minting against deposited collateral", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v4`;
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

      // Setup
      addCollateralType(deployer, sbtcAsset);
      registerOracleForAsset(deployer, sbtcAsset);
      authorizeMultiAssetVaultEngine(deployer);
      registerLinkedStablecoin(deployer, wallet1, "Mint Dollar", "MTSD");
      configureCollateralForStablecoin(deployer, wallet1, sbtcAsset);

      // Faucet sBTC
      simnet.callPublicFn("sbtc-token-v4", "faucet-mint", [Cl.uint(5000), Cl.principal(wallet1)], wallet1);

      // Open vault and deposit
      simnet.callPublicFn("multi-asset-vault-engine-v6", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1500)],
        wallet1
      );

      // Mint
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "mint-against-asset-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(600)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(600));

      // Verify token balance
      const balance = simnet.callReadOnlyFn(
        "stablecoin-token-v4",
        "get-balance",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(balance.result).toBeOk(Cl.uint(600));
    });

    it("rejects minting that would break health factor", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v4`;
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

      // Setup with controlled price
      addCollateralType(deployer, sbtcAsset);
      registerOracleForAsset(deployer, sbtcAsset);
      authorizeMultiAssetVaultEngine(deployer);
      registerLinkedStablecoin(deployer, wallet1, "Fail Dollar", "FLSD");
      configureCollateralForStablecoin(deployer, wallet1, sbtcAsset);

      simnet.callPublicFn(
        "dia-oracle-adapter",
        "set-value",
        [Cl.stringAscii("BTC/USD"), Cl.uint(100000000)], // $1 per unit
        deployer
      );

      // Faucet sBTC
      simnet.callPublicFn("sbtc-token-v4", "faucet-mint", [Cl.uint(1000), Cl.principal(wallet1)], wallet1);

      // Open vault and deposit
      simnet.callPublicFn("multi-asset-vault-engine-v6", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1000)],
        wallet1
      );

      // Try to mint too much (would break 150% ratio)
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "mint-against-asset-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(800)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(204)); // ERR_UNSAFE_HEALTH_FACTOR
    });
  });

  describe("repaying debt", () => {
    it("allows repaying debt against specific assets", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v4`;
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

      // Setup
      addCollateralType(deployer, sbtcAsset);
      registerOracleForAsset(deployer, sbtcAsset);
      authorizeMultiAssetVaultEngine(deployer);
      registerLinkedStablecoin(deployer, wallet1, "Repay Dollar", "RPSD");
      configureCollateralForStablecoin(deployer, wallet1, sbtcAsset);

      // Faucet sBTC
      simnet.callPublicFn("sbtc-token-v4", "faucet-mint", [Cl.uint(5000), Cl.principal(wallet1)], wallet1);

      // Open vault, deposit, and mint
      simnet.callPublicFn("multi-asset-vault-engine-v6", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1500)],
        wallet1
      );
      simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "mint-against-asset-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(600)],
        wallet1
      );

      // Repay partial debt
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "repay-against-asset-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(200)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(400)); // Remaining debt
    });
  });

  describe("withdrawing collateral", () => {
    it("allows withdrawing excess collateral", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v4`;
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

      // Setup
      addCollateralType(deployer, sbtcAsset);
      registerOracleForAsset(deployer, sbtcAsset);
      authorizeMultiAssetVaultEngine(deployer);
      registerLinkedStablecoin(deployer, wallet1, "Wdraw Dollar", "WDSD");
      configureCollateralForStablecoin(deployer, wallet1, sbtcAsset);

      // Faucet sBTC
      simnet.callPublicFn("sbtc-token-v4", "faucet-mint", [Cl.uint(5000), Cl.principal(wallet1)], wallet1);

      // Open vault, deposit, and mint
      simnet.callPublicFn("multi-asset-vault-engine-v6", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(2000)],
        wallet1
      );
      simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "mint-against-asset-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(600)],
        wallet1
      );

      // Withdraw some collateral (keeping healthy ratio)
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "withdraw-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(500)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(1500)); // Remaining collateral
    });

    it("rejects withdrawal that would break health factor", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v4`;
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

      // Setup with controlled price
      addCollateralType(deployer, sbtcAsset);
      registerOracleForAsset(deployer, sbtcAsset);
      authorizeMultiAssetVaultEngine(deployer);
      registerLinkedStablecoin(deployer, wallet1, "Safe Dollar", "SFSD");
      configureCollateralForStablecoin(deployer, wallet1, sbtcAsset);

      simnet.callPublicFn(
        "dia-oracle-adapter",
        "set-value",
        [Cl.stringAscii("BTC/USD"), Cl.uint(100000000)], // $1 per unit
        deployer
      );

      // Faucet sBTC
      simnet.callPublicFn("sbtc-token-v4", "faucet-mint", [Cl.uint(5000), Cl.principal(wallet1)], wallet1);

      // Open vault, deposit, and mint near limit
      simnet.callPublicFn("multi-asset-vault-engine-v6", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1500)],
        wallet1
      );
      simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "mint-against-asset-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(600)],
        wallet1
      );

      // Try to withdraw too much
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "withdraw-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(800)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(204)); // ERR_UNSAFE_HEALTH_FACTOR
    });
  });

  describe("health factor calculations", () => {
    it("calculates per-asset health factors", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v4`;
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

      // Setup with controlled price
      addCollateralType(deployer, sbtcAsset);
      registerOracleForAsset(deployer, sbtcAsset);
      authorizeMultiAssetVaultEngine(deployer);
      registerLinkedStablecoin(deployer, wallet1, "HF Dollar", "HFSD");
      configureCollateralForStablecoin(deployer, wallet1, sbtcAsset);

      simnet.callPublicFn(
        "dia-oracle-adapter",
        "set-value",
        [Cl.stringAscii("BTC/USD"), Cl.uint(100000000)], // $1 per unit
        deployer
      );

      // Faucet sBTC
      simnet.callPublicFn("sbtc-token-v4", "faucet-mint", [Cl.uint(5000), Cl.principal(wallet1)], wallet1);

      // Open vault, deposit, and mint
      simnet.callPublicFn("multi-asset-vault-engine-v6", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1500)],
        wallet1
      );
      simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "mint-against-asset-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(600)],
        wallet1
      );

      // Check health factor
      const healthFactor = simnet.callReadOnlyFn(
        "multi-asset-vault-engine-v6",
        "get-position-health-factor-for-stablecoin",
        [Cl.principal(wallet1), Cl.uint(0), Cl.principal(sbtcAsset)],
        wallet1
      );
      // Health factor should be > 150 (healthy)
      const hfValue = Number((healthFactor.result as any).value);
      expect(hfValue).toBeGreaterThan(150);
    });
  });

  describe("stablecoin-scoped vaults", () => {
    it("opens, deposits, and mints against a specific stablecoin id", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const sbtcAsset = `${deployer}.sbtc-token-v4`;
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

      addCollateralType(deployer, sbtcAsset);
      registerOracleForAsset(deployer, sbtcAsset);
      authorizeMultiAssetVaultEngine(deployer);
      registerLinkedStablecoin(deployer, wallet1, "Acme Dollar", "ACME");
      configureCollateralForStablecoin(deployer, wallet1, sbtcAsset);

      // Faucet sBTC
      simnet.callPublicFn("sbtc-token-v4", "faucet-mint", [Cl.uint(5000), Cl.principal(wallet1)], wallet1);

      let result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "open-vault-for-stablecoin",
        [Cl.uint(0)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1500)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(1500));

      result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "mint-against-asset-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(500)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(500));

      const balance = simnet.callReadOnlyFn(
        "stablecoin-token-v4",
        "get-balance",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(balance.result).toBeOk(Cl.uint(500));
    });

    it("rejects opening stablecoin-scoped vault when token is not linked", () => {
      const { deployer, wallet1 } = getTestAccounts();

      simnet.callPublicFn("stablecoin-factory-v3", "set-registration-fee", [Cl.uint(0)], deployer);
      const registerResult = simnet.callPublicFn(
        "stablecoin-factory-v3",
        "register-stablecoin",
        [Cl.stringAscii("Beta Dollar"), Cl.stringAscii("BETA")],
        wallet1
      );
      expect(registerResult.result).toBeOk(Cl.uint(0));

      const result = simnet.callPublicFn(
        "multi-asset-vault-engine-v6",
        "open-vault-for-stablecoin",
        [Cl.uint(0)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(211)); // ERR_TOKEN_NOT_LINKED
    });
  });
});
