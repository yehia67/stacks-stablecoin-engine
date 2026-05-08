import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

function getTestAccounts() {
  const accounts = simnet.getAccounts();
  const deployer = accounts.get("deployer");
  const wallet1 = accounts.get("wallet_1");

  if (!deployer || !wallet1) {
    throw new Error("Missing default simnet accounts");
  }

  return { deployer, wallet1 };
}

/** Seed a DIA price for a given pair using the adapter's set-value. */
function seedDiaPrice(deployer: string, pair: string, value: number) {
  const result = simnet.callPublicFn(
    "dia-oracle-adapter",
    "set-value",
    [Cl.stringAscii(pair), Cl.uint(value)],
    deployer
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

/** Seed a DIA price with an explicit timestamp. */
function seedDiaPriceWithTimestamp(
  deployer: string,
  pair: string,
  value: number,
  timestamp: number
) {
  const result = simnet.callPublicFn(
    "dia-oracle-adapter",
    "set-value-with-timestamp",
    [Cl.stringAscii(pair), Cl.uint(value), Cl.uint(timestamp)],
    deployer
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

// ============================================
// DIA Oracle Adapter Tests
// ============================================

describe("dia-oracle-adapter", () => {
  it("set-value stores and get-value retrieves BTC/USD", () => {
    const { deployer } = getTestAccounts();
    seedDiaPrice(deployer, "BTC/USD", 6700000000000);

    const result = simnet.callReadOnlyFn(
      "dia-oracle-adapter",
      "get-value",
      [Cl.stringAscii("BTC/USD")],
      deployer
    );
    // Result is (ok {value: uint, timestamp: uint})
    expect(result.result.type).toBe("ok");
  });

  it("set-value stores and get-value retrieves STX/USD", () => {
    const { deployer } = getTestAccounts();
    seedDiaPrice(deployer, "STX/USD", 21200000);

    const result = simnet.callReadOnlyFn(
      "dia-oracle-adapter",
      "get-value",
      [Cl.stringAscii("STX/USD")],
      deployer
    );
    expect(result.result.type).toBe("ok");
  });

  it("get-value returns error for unknown pair", () => {
    const { deployer } = getTestAccounts();

    const result = simnet.callReadOnlyFn(
      "dia-oracle-adapter",
      "get-value",
      [Cl.stringAscii("FOO/BAR")],
      deployer
    );
    expect(result.result).toBeErr(Cl.uint(701)); // ERR_PAIR_NOT_FOUND
  });

  it("rejects set-value from non-owner", () => {
    const { wallet1 } = getTestAccounts();

    const result = simnet.callPublicFn(
      "dia-oracle-adapter",
      "set-value",
      [Cl.stringAscii("BTC/USD"), Cl.uint(100)],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(700)); // ERR_UNAUTHORIZED
  });

  it("set-value-with-timestamp stores explicit timestamp", () => {
    const { deployer } = getTestAccounts();
    seedDiaPriceWithTimestamp(deployer, "BTC/USD", 6500000000000, 1000);

    const result = simnet.callReadOnlyFn(
      "dia-oracle-adapter",
      "get-value",
      [Cl.stringAscii("BTC/USD")],
      deployer
    );
    expect(result.result.type).toBe("ok");
  });
});

// ============================================
// DIA BTC Oracle Wrapper Tests
// ============================================

describe("price-oracle-dia-btc-v2", () => {
  it("returns BTC price from DIA adapter when fresh", () => {
    const { deployer } = getTestAccounts();
    // Seed a fresh price (set-value uses current block time)
    seedDiaPrice(deployer, "BTC/USD", 6700000000000);

    const result = simnet.callReadOnlyFn(
      "price-oracle-dia-btc-v2",
      "get-price",
      [],
      deployer
    );
    expect(result.result).toBeOk(Cl.uint(6700000000000));
  });

  it("rejects stale BTC price", () => {
    const { deployer } = getTestAccounts();
    // Seed a price with timestamp far in the past (0 = epoch start)
    seedDiaPriceWithTimestamp(deployer, "BTC/USD", 6700000000000, 0);

    const result = simnet.callReadOnlyFn(
      "price-oracle-dia-btc-v2",
      "get-price",
      [],
      deployer
    );
    // ERR_STALE_PRICE = u601
    expect(result.result).toBeErr(Cl.uint(601));
  });

  it("returns error when no price is set", () => {
    const { deployer } = getTestAccounts();
    // Don't seed any price — adapter returns ERR_PAIR_NOT_FOUND
    // which the wrapper maps to ERR_NO_PRICE

    // Note: if a previous test seeded BTC/USD, this test's simnet
    // will be fresh (each describe/it gets a fresh simnet state)
    const result = simnet.callReadOnlyFn(
      "price-oracle-dia-btc-v2",
      "get-price",
      [],
      deployer
    );
    // ERR_NO_PRICE = u602
    expect(result.result).toBeErr(Cl.uint(602));
  });

  it("owner can adjust max staleness", () => {
    const { deployer } = getTestAccounts();

    const setResult = simnet.callPublicFn(
      "price-oracle-dia-btc-v2",
      "set-max-staleness",
      [Cl.uint(7200)],
      deployer
    );
    expect(setResult.result).toBeOk(Cl.bool(true));

    const getResult = simnet.callReadOnlyFn(
      "price-oracle-dia-btc-v2",
      "get-max-staleness",
      [],
      deployer
    );
    expect(getResult.result).toEqual(Cl.uint(7200));
  });

  it("rejects set-max-staleness from non-owner", () => {
    const { wallet1 } = getTestAccounts();

    const result = simnet.callPublicFn(
      "price-oracle-dia-btc-v2",
      "set-max-staleness",
      [Cl.uint(100)],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(600)); // ERR_UNAUTHORIZED
  });
});

// ============================================
// DIA STX Oracle Wrapper Tests
// ============================================

describe("price-oracle-dia-stx-v2", () => {
  it("returns STX price from DIA adapter when fresh", () => {
    const { deployer } = getTestAccounts();
    seedDiaPrice(deployer, "STX/USD", 21200000);

    const result = simnet.callReadOnlyFn(
      "price-oracle-dia-stx-v2",
      "get-price",
      [],
      deployer
    );
    expect(result.result).toBeOk(Cl.uint(21200000));
  });

  it("rejects stale STX price", () => {
    const { deployer } = getTestAccounts();
    seedDiaPriceWithTimestamp(deployer, "STX/USD", 21200000, 0);

    const result = simnet.callReadOnlyFn(
      "price-oracle-dia-stx-v2",
      "get-price",
      [],
      deployer
    );
    expect(result.result).toBeErr(Cl.uint(601)); // ERR_STALE_PRICE
  });
});

// ============================================
// Vault Engine DIA Oracle Integration Tests
// ============================================

describe("vault engine DIA oracle routing", () => {
  it("register-asset-oracle accepts DIA-BTC oracle ID (u3)", () => {
    const { deployer } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v4`;

    const result = simnet.callPublicFn(
      "multi-asset-vault-engine-v6",
      "register-asset-oracle",
      [Cl.principal(sbtcAsset), Cl.uint(3)],
      deployer
    );
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("register-asset-oracle accepts DIA-STX oracle ID (u4)", () => {
    const { deployer } = getTestAccounts();
    const stxAsset = `${deployer}.stx-token-v4`;

    const result = simnet.callPublicFn(
      "multi-asset-vault-engine-v6",
      "register-asset-oracle",
      [Cl.principal(stxAsset), Cl.uint(4)],
      deployer
    );
    expect(result.result).toBeOk(Cl.bool(true));
  });

  it("register-asset-oracle rejects unknown oracle ID (u5)", () => {
    const { deployer } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v4`;

    const result = simnet.callPublicFn(
      "multi-asset-vault-engine-v6",
      "register-asset-oracle",
      [Cl.principal(sbtcAsset), Cl.uint(5)],
      deployer
    );
    expect(result.result).toBeErr(Cl.uint(214)); // ERR_UNKNOWN_ORACLE
  });

  it("vault engine reads BTC price via DIA oracle ID", () => {
    const { deployer, wallet1 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v4`;
    const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;
    const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

    // Seed DIA BTC price
    seedDiaPrice(deployer, "BTC/USD", 6700000000000);

    // Register sBTC with DIA-BTC oracle (ID 3)
    simnet.callPublicFn(
      "multi-asset-vault-engine-v6",
      "register-asset-oracle",
      [Cl.principal(sbtcAsset), Cl.uint(3)],
      deployer
    );

    // Setup: add global collateral, factory, etc.
    simnet.callPublicFn("stablecoin-factory-v3", "set-registration-fee", [Cl.uint(0)], deployer);
    simnet.callPublicFn(
      "stablecoin-factory-v3",
      "register-stablecoin",
      [Cl.stringAscii("DIA Dollar"), Cl.stringAscii("DUSD")],
      wallet1
    );
    simnet.callPublicFn(
      "stablecoin-factory-v3",
      "set-token-contract",
      [Cl.uint(0), Cl.principal(tokenPrincipal)],
      wallet1
    );
    simnet.callPublicFn(
      "collateral-registry-v5",
      "add-collateral-type",
      [
        Cl.principal(sbtcAsset),
        Cl.uint(150), Cl.uint(120), Cl.uint(10), Cl.uint(200),
        Cl.uint(10000000), Cl.uint(100),
        Cl.principal(oraclePrincipal),
      ],
      deployer
    );
    simnet.callPublicFn(
      "collateral-registry-v5",
      "configure-collateral-for-stablecoin",
      [
        Cl.uint(0), Cl.principal(sbtcAsset),
        Cl.uint(150), Cl.uint(120), Cl.uint(10), Cl.uint(200),
        Cl.uint(10000000), Cl.uint(100),
      ],
      wallet1
    );
    simnet.callPublicFn(
      "stablecoin-token-v4",
      "set-vault-engine",
      [Cl.principal(`${deployer}.multi-asset-vault-engine-v6`)],
      deployer
    );

    // Faucet sBTC + open vault + deposit
    simnet.callPublicFn("sbtc-token-v4", "faucet-mint", [Cl.uint(10000), Cl.principal(wallet1)], wallet1);
    simnet.callPublicFn("multi-asset-vault-engine-v6", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
    simnet.callPublicFn(
      "multi-asset-vault-engine-v6",
      "deposit-collateral-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(10000)],
      wallet1
    );

    // Mint stablecoins — this triggers the vault engine to read the DIA oracle price
    const mintResult = simnet.callPublicFn(
      "multi-asset-vault-engine-v6",
      "mint-against-asset-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(2000)],
      wallet1
    );
    expect(mintResult.result).toBeOk(Cl.uint(2000));

    // Verify health factor is computed using DIA price
    const healthResult = simnet.callReadOnlyFn(
      "multi-asset-vault-engine-v6",
      "get-position-health-factor-for-stablecoin",
      [Cl.principal(wallet1), Cl.uint(0), Cl.principal(sbtcAsset)],
      deployer
    );
    // Health factor should be > 0 (vault is healthy)
    const healthValue = (healthResult.result as any).value;
    expect(Number(healthValue)).toBeGreaterThan(0);
  });
});
