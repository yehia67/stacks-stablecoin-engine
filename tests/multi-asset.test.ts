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
  const vaultEnginePrincipal = `${deployer}.multi-asset-vault-engine`;
  const result = simnet.callPublicFn(
    "stablecoin-token",
    "set-vault-engine",
    [Cl.principal(vaultEnginePrincipal)],
    deployer
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

function addCollateralType(deployer: string, asset: string) {
  const oraclePrincipal = `${deployer}.price-oracle-mock`;
  const result = simnet.callPublicFn(
    "collateral-registry",
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

// ============================================
// Collateral Registry Tests
// ============================================

describe("collateral-registry multi-asset", () => {
  describe("add collateral type", () => {
    it("allows owner to add new collateral types with extended parameters", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stablecoin-token`;
      const oraclePrincipal = `${deployer}.price-oracle-mock`;

      const result = simnet.callPublicFn(
        "collateral-registry",
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
        "collateral-registry",
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
      const assetPrincipal = `${deployer}.stablecoin-token`;
      const oraclePrincipal = `${deployer}.price-oracle-mock`;

      const result = simnet.callPublicFn(
        "collateral-registry",
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
      const assetPrincipal = `${deployer}.stablecoin-token`;
      const oraclePrincipal = `${deployer}.price-oracle-mock`;

      // First addition
      let result = simnet.callPublicFn(
        "collateral-registry",
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
        "collateral-registry",
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
      const assetPrincipal = `${deployer}.stability-pool`; // Use different contract
      const oraclePrincipal = `${deployer}.price-oracle-mock`;

      // min-collateral-ratio <= 100 should fail
      let result = simnet.callPublicFn(
        "collateral-registry",
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
      const assetPrincipal = `${deployer}.stability-pool`;
      const oraclePrincipal = `${deployer}.price-oracle-mock`;

      // liquidation-ratio > min-collateral-ratio should fail
      const result = simnet.callPublicFn(
        "collateral-registry",
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
      const assetPrincipal = `${deployer}.stablecoin-token`;
      const oraclePrincipal = `${deployer}.price-oracle-mock`;

      // Add collateral
      simnet.callPublicFn(
        "collateral-registry",
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

      // Verify enabled by default
      let isEnabled = simnet.callReadOnlyFn(
        "collateral-registry",
        "is-collateral-enabled",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(isEnabled.result).toBeBool(true);

      // Disable
      let result = simnet.callPublicFn(
        "collateral-registry",
        "set-collateral-enabled",
        [Cl.principal(assetPrincipal), Cl.bool(false)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify disabled
      isEnabled = simnet.callReadOnlyFn(
        "collateral-registry",
        "is-collateral-enabled",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(isEnabled.result).toBeBool(false);
    });

    it("allows owner to update collateral parameters", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stablecoin-token`;
      const oraclePrincipal = `${deployer}.price-oracle-mock`;

      // Add collateral
      simnet.callPublicFn(
        "collateral-registry",
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
        "collateral-registry",
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
        "collateral-registry",
        "get-min-collateral-ratio",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(minRatio.result).toBeSome(Cl.uint(175));
    });

    it("tracks collateral count and enumeration", () => {
      const { deployer } = getTestAccounts();
      const asset1 = `${deployer}.stablecoin-token`;
      const asset2 = `${deployer}.stability-pool`;
      const oraclePrincipal = `${deployer}.price-oracle-mock`;

      // Add first collateral
      simnet.callPublicFn(
        "collateral-registry",
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
        "collateral-registry",
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
        "collateral-registry",
        "get-collateral-count",
        [],
        deployer
      );
      expect(count.result).toBeUint(2);

      // Check enumeration
      const first = simnet.callReadOnlyFn(
        "collateral-registry",
        "get-collateral-at-index",
        [Cl.uint(0)],
        deployer
      );
      expect(first.result).toBeSome(Cl.tuple({ asset: Cl.principal(asset1) }));

      const second = simnet.callReadOnlyFn(
        "collateral-registry",
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
      const assetPrincipal = `${deployer}.stablecoin-token`;
      const oraclePrincipal = `${deployer}.price-oracle-mock`;

      // Add collateral
      simnet.callPublicFn(
        "collateral-registry",
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

      // Initial debt should be 0
      let totalDebt = simnet.callReadOnlyFn(
        "collateral-registry",
        "get-total-debt",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(totalDebt.result).toBeUint(0);

      // Increase debt
      let result = simnet.callPublicFn(
        "collateral-registry",
        "increase-debt",
        [Cl.principal(assetPrincipal), Cl.uint(1000)],
        deployer
      );
      expect(result.result).toBeOk(Cl.uint(1000));

      // Check updated debt
      totalDebt = simnet.callReadOnlyFn(
        "collateral-registry",
        "get-total-debt",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(totalDebt.result).toBeUint(1000);

      // Decrease debt
      result = simnet.callPublicFn(
        "collateral-registry",
        "decrease-debt",
        [Cl.principal(assetPrincipal), Cl.uint(400)],
        deployer
      );
      expect(result.result).toBeOk(Cl.uint(600));
    });

    it("enforces debt ceiling", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stablecoin-token`;
      const oraclePrincipal = `${deployer}.price-oracle-mock`;

      // Add collateral with low ceiling
      simnet.callPublicFn(
        "collateral-registry",
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

      // Try to exceed ceiling
      const result = simnet.callPublicFn(
        "collateral-registry",
        "increase-debt",
        [Cl.principal(assetPrincipal), Cl.uint(1500)],
        deployer
      );
      expect(result.result).toBeErr(Cl.uint(105)); // ERR_DEBT_CEILING_EXCEEDED
    });

    it("calculates available debt capacity", () => {
      const { deployer } = getTestAccounts();
      const assetPrincipal = `${deployer}.stablecoin-token`;
      const oraclePrincipal = `${deployer}.price-oracle-mock`;

      // Add collateral
      simnet.callPublicFn(
        "collateral-registry",
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

      // Initial capacity = ceiling
      let capacity = simnet.callReadOnlyFn(
        "collateral-registry",
        "get-available-debt-capacity",
        [Cl.principal(assetPrincipal)],
        deployer
      );
      expect(capacity.result).toBeSome(Cl.uint(10000));

      // Add some debt
      simnet.callPublicFn(
        "collateral-registry",
        "increase-debt",
        [Cl.principal(assetPrincipal), Cl.uint(3000)],
        deployer
      );

      // Check remaining capacity
      capacity = simnet.callReadOnlyFn(
        "collateral-registry",
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

describe("multi-asset-vault-engine", () => {
  describe("vault lifecycle", () => {
    it("allows users to open vaults", () => {
      const { wallet1 } = getTestAccounts();

      const result = simnet.callPublicFn(
        "multi-asset-vault-engine",
        "open-vault",
        [],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify vault exists
      const vault = simnet.callReadOnlyFn(
        "multi-asset-vault-engine",
        "get-vault",
        [Cl.principal(wallet1)],
        wallet1
      );
      // Just verify the vault exists with zero debt (block height varies)
      expect(vault.result).not.toBeNone();
    });

    it("rejects duplicate vault creation", () => {
      const { wallet1 } = getTestAccounts();

      // First vault
      let result = simnet.callPublicFn(
        "multi-asset-vault-engine",
        "open-vault",
        [],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Duplicate should fail
      result = simnet.callPublicFn(
        "multi-asset-vault-engine",
        "open-vault",
        [],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(200)); // ERR_VAULT_EXISTS
    });
  });

  describe("multi-asset collateral deposits", () => {
    it("allows depositing multiple collateral types", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const asset1 = `${deployer}.stablecoin-token`;
      const asset2 = `${deployer}.stability-pool`;

      // Setup: add collateral types
      addCollateralType(deployer, asset1);
      addCollateralType(deployer, asset2);

      // Open vault
      simnet.callPublicFn("multi-asset-vault-engine", "open-vault", [], wallet1);

      // Deposit first asset
      let result = simnet.callPublicFn(
        "multi-asset-vault-engine",
        "deposit-collateral",
        [Cl.principal(asset1), Cl.uint(1000)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(1000));

      // Deposit second asset
      result = simnet.callPublicFn(
        "multi-asset-vault-engine",
        "deposit-collateral",
        [Cl.principal(asset2), Cl.uint(500)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(500));

      // Verify positions
      const position1 = simnet.callReadOnlyFn(
        "multi-asset-vault-engine",
        "get-collateral-position",
        [Cl.principal(wallet1), Cl.principal(asset1)],
        wallet1
      );
      expect(position1.result).toBeSome(
        Cl.tuple({
          amount: Cl.uint(1000),
          "debt-share": Cl.uint(0),
        })
      );

      const position2 = simnet.callReadOnlyFn(
        "multi-asset-vault-engine",
        "get-collateral-position",
        [Cl.principal(wallet1), Cl.principal(asset2)],
        wallet1
      );
      expect(position2.result).toBeSome(
        Cl.tuple({
          amount: Cl.uint(500),
          "debt-share": Cl.uint(0),
        })
      );

      // Verify asset count
      const assetCount = simnet.callReadOnlyFn(
        "multi-asset-vault-engine",
        "get-vault-asset-count",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(assetCount.result).toBeUint(2);
    });

    it("rejects deposits for unsupported assets", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const unsupportedAsset = `${deployer}.liquidation-engine`; // Not registered

      // Open vault
      simnet.callPublicFn("multi-asset-vault-engine", "open-vault", [], wallet1);

      // Try to deposit unsupported asset
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine",
        "deposit-collateral",
        [Cl.principal(unsupportedAsset), Cl.uint(1000)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(205)); // ERR_ASSET_NOT_SUPPORTED
    });

    it("rejects deposits for disabled assets", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const asset = `${deployer}.stablecoin-token`;

      // Setup: add and then disable collateral
      addCollateralType(deployer, asset);
      simnet.callPublicFn(
        "collateral-registry",
        "set-collateral-enabled",
        [Cl.principal(asset), Cl.bool(false)],
        deployer
      );

      // Open vault
      simnet.callPublicFn("multi-asset-vault-engine", "open-vault", [], wallet1);

      // Try to deposit disabled asset
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine",
        "deposit-collateral",
        [Cl.principal(asset), Cl.uint(1000)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(206)); // ERR_ASSET_DISABLED
    });
  });

  describe("minting against specific assets", () => {
    it("allows minting against deposited collateral", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const asset = `${deployer}.stablecoin-token`;

      // Setup
      addCollateralType(deployer, asset);
      authorizeMultiAssetVaultEngine(deployer);

      // Open vault and deposit
      simnet.callPublicFn("multi-asset-vault-engine", "open-vault", [], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine",
        "deposit-collateral",
        [Cl.principal(asset), Cl.uint(1500)],
        wallet1
      );

      // Mint (with 150% ratio, 1500 collateral allows ~1000 debt at price 1.0)
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine",
        "mint-against-asset",
        [Cl.principal(asset), Cl.uint(600)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(600));

      // Verify position updated
      const position = simnet.callReadOnlyFn(
        "multi-asset-vault-engine",
        "get-collateral-position",
        [Cl.principal(wallet1), Cl.principal(asset)],
        wallet1
      );
      expect(position.result).toBeSome(
        Cl.tuple({
          amount: Cl.uint(1500),
          "debt-share": Cl.uint(600),
        })
      );

      // Verify token balance
      const balance = simnet.callReadOnlyFn(
        "stablecoin-token",
        "get-balance",
        [Cl.principal(wallet1)],
        wallet1
      );
      expect(balance.result).toBeOk(Cl.uint(600));
    });

    it("rejects minting that would break health factor", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const asset = `${deployer}.stablecoin-token`;

      // Setup
      addCollateralType(deployer, asset);
      authorizeMultiAssetVaultEngine(deployer);

      // Open vault and deposit
      simnet.callPublicFn("multi-asset-vault-engine", "open-vault", [], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine",
        "deposit-collateral",
        [Cl.principal(asset), Cl.uint(1000)],
        wallet1
      );

      // Try to mint too much (would break 150% ratio)
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine",
        "mint-against-asset",
        [Cl.principal(asset), Cl.uint(800)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(204)); // ERR_UNSAFE_HEALTH_FACTOR
    });
  });

  describe("repaying debt", () => {
    it("allows repaying debt against specific assets", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const asset = `${deployer}.stablecoin-token`;

      // Setup
      addCollateralType(deployer, asset);
      authorizeMultiAssetVaultEngine(deployer);

      // Open vault, deposit, and mint
      simnet.callPublicFn("multi-asset-vault-engine", "open-vault", [], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine",
        "deposit-collateral",
        [Cl.principal(asset), Cl.uint(1500)],
        wallet1
      );
      simnet.callPublicFn(
        "multi-asset-vault-engine",
        "mint-against-asset",
        [Cl.principal(asset), Cl.uint(600)],
        wallet1
      );

      // Repay partial debt
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine",
        "repay-against-asset",
        [Cl.principal(asset), Cl.uint(200)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(400)); // Remaining debt

      // Verify position
      const position = simnet.callReadOnlyFn(
        "multi-asset-vault-engine",
        "get-collateral-position",
        [Cl.principal(wallet1), Cl.principal(asset)],
        wallet1
      );
      expect(position.result).toBeSome(
        Cl.tuple({
          amount: Cl.uint(1500),
          "debt-share": Cl.uint(400),
        })
      );
    });
  });

  describe("withdrawing collateral", () => {
    it("allows withdrawing excess collateral", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const asset = `${deployer}.stablecoin-token`;

      // Setup
      addCollateralType(deployer, asset);
      authorizeMultiAssetVaultEngine(deployer);

      // Open vault and deposit
      simnet.callPublicFn("multi-asset-vault-engine", "open-vault", [], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine",
        "deposit-collateral",
        [Cl.principal(asset), Cl.uint(2000)],
        wallet1
      );
      simnet.callPublicFn(
        "multi-asset-vault-engine",
        "mint-against-asset",
        [Cl.principal(asset), Cl.uint(600)],
        wallet1
      );

      // Withdraw some collateral (keeping healthy ratio)
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine",
        "withdraw-collateral",
        [Cl.principal(asset), Cl.uint(500)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(1500)); // Remaining collateral
    });

    it("rejects withdrawal that would break health factor", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const asset = `${deployer}.stablecoin-token`;

      // Setup
      addCollateralType(deployer, asset);
      authorizeMultiAssetVaultEngine(deployer);

      // Open vault, deposit, and mint near limit
      simnet.callPublicFn("multi-asset-vault-engine", "open-vault", [], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine",
        "deposit-collateral",
        [Cl.principal(asset), Cl.uint(1500)],
        wallet1
      );
      simnet.callPublicFn(
        "multi-asset-vault-engine",
        "mint-against-asset",
        [Cl.principal(asset), Cl.uint(600)],
        wallet1
      );

      // Try to withdraw too much
      const result = simnet.callPublicFn(
        "multi-asset-vault-engine",
        "withdraw-collateral",
        [Cl.principal(asset), Cl.uint(800)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(204)); // ERR_UNSAFE_HEALTH_FACTOR
    });
  });

  describe("health factor calculations", () => {
    it("calculates per-asset health factors", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const asset = `${deployer}.stablecoin-token`;

      // Setup
      addCollateralType(deployer, asset);
      authorizeMultiAssetVaultEngine(deployer);

      // Open vault, deposit, and mint
      simnet.callPublicFn("multi-asset-vault-engine", "open-vault", [], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine",
        "deposit-collateral",
        [Cl.principal(asset), Cl.uint(1500)],
        wallet1
      );
      simnet.callPublicFn(
        "multi-asset-vault-engine",
        "mint-against-asset",
        [Cl.principal(asset), Cl.uint(600)],
        wallet1
      );

      // Check health factor (1500 collateral, 600 debt, 150% ratio)
      // Health = (1500 * 100 * 10000) / (600 * 150) = 166
      const healthFactor = simnet.callReadOnlyFn(
        "multi-asset-vault-engine",
        "get-position-health-factor",
        [Cl.principal(wallet1), Cl.principal(asset)],
        wallet1
      );
      expect(healthFactor.result).toBeUint(166);
    });

    it("returns max health factor for zero debt", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const asset = `${deployer}.stablecoin-token`;

      // Setup
      addCollateralType(deployer, asset);

      // Open vault and deposit (no debt)
      simnet.callPublicFn("multi-asset-vault-engine", "open-vault", [], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine",
        "deposit-collateral",
        [Cl.principal(asset), Cl.uint(1000)],
        wallet1
      );

      const healthFactor = simnet.callReadOnlyFn(
        "multi-asset-vault-engine",
        "get-position-health-factor",
        [Cl.principal(wallet1), Cl.principal(asset)],
        wallet1
      );
      expect(healthFactor.result).toBeUint(1000000); // ZERO-DEBT-HEALTH-FACTOR
    });

    it("calculates max mintable amount", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const asset = `${deployer}.stablecoin-token`;

      // Setup
      addCollateralType(deployer, asset);

      // Open vault and deposit
      simnet.callPublicFn("multi-asset-vault-engine", "open-vault", [], wallet1);
      simnet.callPublicFn(
        "multi-asset-vault-engine",
        "deposit-collateral",
        [Cl.principal(asset), Cl.uint(1500)],
        wallet1
      );

      // Max mintable = 1500 * 100 / 150 = 1000
      const maxMintable = simnet.callReadOnlyFn(
        "multi-asset-vault-engine",
        "get-max-mintable",
        [Cl.principal(wallet1), Cl.principal(asset)],
        wallet1
      );
      expect(maxMintable.result).toBeUint(1000);
    });
  });
});
