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

/** Full setup: register stablecoin, link token, add global collateral, configure per-stablecoin collateral, register oracle, authorize vault engine. */
function fullSetup(deployer: string, creator: string) {
  const sbtcAsset = `${deployer}.sbtc-token-v3`;
  const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;
  const tokenPrincipal = `${deployer}.stablecoin-token-v3`;
  const vaultEnginePrincipal = `${deployer}.multi-asset-vault-engine-v5`;

  // Seed DIA BTC price so oracle lookups work
  simnet.callPublicFn(
    "dia-oracle-adapter",
    "set-value",
    [Cl.stringAscii("BTC/USD"), Cl.uint(6700000000000)],
    deployer
  );

  // Zero-fee registration
  simnet.callPublicFn("stablecoin-factory-v3", "set-registration-fee", [Cl.uint(0)], deployer);

  // Register stablecoin
  const regResult = simnet.callPublicFn(
    "stablecoin-factory-v3",
    "register-stablecoin",
    [Cl.stringAscii("Test Dollar"), Cl.stringAscii("TUSD")],
    creator
  );
  expect(regResult.result).toBeOk(Cl.uint(0));

  // Link token
  simnet.callPublicFn(
    "stablecoin-factory-v3",
    "set-token-contract",
    [Cl.uint(0), Cl.principal(tokenPrincipal)],
    creator
  );

  // Add global collateral
  simnet.callPublicFn(
    "collateral-registry-v4",
    "add-collateral-type",
    [
      Cl.principal(sbtcAsset),
      Cl.uint(150), Cl.uint(120), Cl.uint(10), Cl.uint(200),
      Cl.uint(10000000), Cl.uint(100),
      Cl.principal(oraclePrincipal),
    ],
    deployer
  );

  // Configure per-stablecoin collateral
  simnet.callPublicFn(
    "collateral-registry-v4",
    "configure-collateral-for-stablecoin",
    [
      Cl.uint(0), Cl.principal(sbtcAsset),
      Cl.uint(150), Cl.uint(120), Cl.uint(10), Cl.uint(200),
      Cl.uint(10000000), Cl.uint(100),
    ],
    creator
  );

  // Register oracle
  simnet.callPublicFn(
    "multi-asset-vault-engine-v5",
    "register-asset-oracle",
    [Cl.principal(sbtcAsset), Cl.uint(3)],
    deployer
  );

  // Authorize vault engine on stablecoin token
  simnet.callPublicFn(
    "stablecoin-token-v3",
    "set-vault-engine",
    [Cl.principal(vaultEnginePrincipal)],
    deployer
  );
}

describe("stablecoin-token-v3 hardening", () => {
  it("returns expected SIP-010 metadata responses", () => {
    const { deployer } = getTestAccounts();

    const name = simnet.callReadOnlyFn("stablecoin-token-v3", "get-name", [], deployer);
    expect(name.result).toBeOk(Cl.stringAscii("SSE Stablecoin"));

    const symbol = simnet.callReadOnlyFn("stablecoin-token-v3", "get-symbol", [], deployer);
    expect(symbol.result).toBeOk(Cl.stringAscii("SSEUSD"));

    const decimals = simnet.callReadOnlyFn("stablecoin-token-v3", "get-decimals", [], deployer);
    expect(decimals.result).toBeOk(Cl.uint(6));

    const tokenUri = simnet.callReadOnlyFn("stablecoin-token-v3", "get-token-uri", [], deployer);
    expect(tokenUri.result).toBeOk(Cl.none());
  });

  it("only allows contract owner to set vault-engine", () => {
    const { deployer, wallet1 } = getTestAccounts();
    const vaultEnginePrincipal = `${deployer}.multi-asset-vault-engine-v5`;

    const unauthorized = simnet.callPublicFn(
      "stablecoin-token-v3",
      "set-vault-engine",
      [Cl.principal(vaultEnginePrincipal)],
      wallet1
    );
    expect(unauthorized.result).toBeErr(Cl.uint(401));

    const authorized = simnet.callPublicFn(
      "stablecoin-token-v3",
      "set-vault-engine",
      [Cl.principal(vaultEnginePrincipal)],
      deployer
    );
    expect(authorized.result).toBeOk(Cl.bool(true));
  });

  it("runs vault lifecycle end-to-end and tracks total supply", () => {
    const { deployer, wallet1 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v3`;
    const tokenPrincipal = `${deployer}.stablecoin-token-v3`;

    fullSetup(deployer, wallet1);

    // Direct mint should fail (not vault engine caller)
    const directMint = simnet.callPublicFn(
      "stablecoin-token-v3",
      "mint",
      [Cl.uint(100), Cl.principal(wallet1)],
      deployer
    );
    expect(directMint.result).toBeErr(Cl.uint(401));

    // Faucet sBTC
    simnet.callPublicFn("sbtc-token-v3", "faucet-mint", [Cl.uint(1200), Cl.principal(wallet1)], wallet1);

    // Open vault
    let result = simnet.callPublicFn("multi-asset-vault-engine-v5", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));

    // Deposit collateral
    result = simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "deposit-collateral-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1200)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(1200));

    // Mint stablecoins
    result = simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "mint-against-asset-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(600)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(600));

    // Check total supply
    const totalSupplyAfterMint = simnet.callReadOnlyFn(
      "stablecoin-token-v3",
      "get-total-supply",
      [],
      wallet1
    );
    expect(totalSupplyAfterMint.result).toBeOk(Cl.uint(600));

    // Direct burn should fail
    const directBurn = simnet.callPublicFn(
      "stablecoin-token-v3",
      "burn",
      [Cl.uint(50), Cl.principal(wallet1)],
      deployer
    );
    expect(directBurn.result).toBeErr(Cl.uint(401));

    // Repay (burn) via vault engine
    result = simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "repay-against-asset-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(200)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(400)); // remaining debt

    // Withdraw some collateral
    result = simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "withdraw-collateral-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(300)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(900)); // remaining collateral

    // Check balance
    const balance = simnet.callReadOnlyFn(
      "stablecoin-token-v3",
      "get-balance",
      [Cl.principal(wallet1)],
      wallet1
    );
    expect(balance.result).toBeOk(Cl.uint(400));

    // Check total supply after burn
    const totalSupplyAfterBurn = simnet.callReadOnlyFn(
      "stablecoin-token-v3",
      "get-total-supply",
      [],
      wallet1
    );
    expect(totalSupplyAfterBurn.result).toBeOk(Cl.uint(400));

    // Check health factor
    const health = simnet.callReadOnlyFn(
      "multi-asset-vault-engine-v5",
      "get-position-health-factor-for-stablecoin",
      [Cl.principal(wallet1), Cl.uint(0), Cl.principal(sbtcAsset)],
      wallet1
    );
    // Health factor should be > 150 (healthy)
    const hfValue = Number((health.result as any).value);
    expect(hfValue).toBeGreaterThan(150);
  });

  it("rejects minting that would break minimum health factor", () => {
    const { deployer, wallet1 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v3`;
    const tokenPrincipal = `${deployer}.stablecoin-token-v3`;

    fullSetup(deployer, wallet1);

    // Set a controlled price so health factor math is predictable
    simnet.callPublicFn(
      "dia-oracle-adapter",
      "set-value",
      [Cl.stringAscii("BTC/USD"), Cl.uint(100000000)], // $1 per unit at 1e8 scale
      deployer
    );

    // Faucet sBTC
    simnet.callPublicFn("sbtc-token-v3", "faucet-mint", [Cl.uint(1000), Cl.principal(wallet1)], wallet1);

    // Open vault and deposit
    simnet.callPublicFn("multi-asset-vault-engine-v5", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
    simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "deposit-collateral-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1000)],
      wallet1
    );

    // Try to mint too much (700 would break 150% ratio with 1000 collateral at $1)
    const result = simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "mint-against-asset-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(700)],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(204));

    // Balance should be 0 (mint failed)
    const balance = simnet.callReadOnlyFn(
      "stablecoin-token-v3",
      "get-balance",
      [Cl.principal(wallet1)],
      wallet1
    );
    expect(balance.result).toBeOk(Cl.uint(0));

    // Total supply should be 0
    const totalSupply = simnet.callReadOnlyFn(
      "stablecoin-token-v3",
      "get-total-supply",
      [],
      wallet1
    );
    expect(totalSupply.result).toBeOk(Cl.uint(0));
  });
});

describe("oracle integration", () => {
  it("enforces set-value admin gating and returns updated price", () => {
    const { deployer, wallet1 } = getTestAccounts();

    const unauthorized = simnet.callPublicFn(
      "dia-oracle-adapter",
      "set-value",
      [Cl.stringAscii("BTC/USD"), Cl.uint(90000000)],
      wallet1
    );
    expect(unauthorized.result).toBeErr(Cl.uint(700)); // ERR_UNAUTHORIZED

    const authorized = simnet.callPublicFn(
      "dia-oracle-adapter",
      "set-value",
      [Cl.stringAscii("BTC/USD"), Cl.uint(90000000)],
      deployer
    );
    expect(authorized.result).toBeOk(Cl.bool(true));

    const price = simnet.callReadOnlyFn(
      "dia-oracle-adapter",
      "get-value",
      [Cl.stringAscii("BTC/USD")],
      deployer
    );
    expect(price.result.type).toBe("ok");
  });

  it("updates vault health factor when oracle price changes", () => {
    const { deployer, wallet1 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v3`;
    const tokenPrincipal = `${deployer}.stablecoin-token-v3`;

    fullSetup(deployer, wallet1);

    // Set initial price
    simnet.callPublicFn(
      "dia-oracle-adapter",
      "set-value",
      [Cl.stringAscii("BTC/USD"), Cl.uint(100000000)], // $1 per unit
      deployer
    );

    // Faucet, open vault, deposit, mint
    simnet.callPublicFn("sbtc-token-v3", "faucet-mint", [Cl.uint(1200), Cl.principal(wallet1)], wallet1);
    simnet.callPublicFn("multi-asset-vault-engine-v5", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
    simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "deposit-collateral-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1200)],
      wallet1
    );
    const mintResult = simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "mint-against-asset-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(600)],
      wallet1
    );
    expect(mintResult.result).toBeOk(Cl.uint(600));

    // Health before price change
    const healthBefore = simnet.callReadOnlyFn(
      "multi-asset-vault-engine-v5",
      "get-position-health-factor-for-stablecoin",
      [Cl.principal(wallet1), Cl.uint(0), Cl.principal(sbtcAsset)],
      wallet1
    );
    const hfBefore = Number((healthBefore.result as any).value);
    expect(hfBefore).toBeGreaterThan(100);

    // Crash price to half
    simnet.callPublicFn(
      "dia-oracle-adapter",
      "set-value",
      [Cl.stringAscii("BTC/USD"), Cl.uint(50000000)],
      deployer
    );

    // Health after price drop
    const healthAfter = simnet.callReadOnlyFn(
      "multi-asset-vault-engine-v5",
      "get-position-health-factor-for-stablecoin",
      [Cl.principal(wallet1), Cl.uint(0), Cl.principal(sbtcAsset)],
      wallet1
    );
    const hfAfter = Number((healthAfter.result as any).value);
    expect(hfAfter).toBeLessThan(hfBefore);

    // Should reject further minting
    const unsafeMint = simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "mint-against-asset-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(1)],
      wallet1
    );
    expect(unsafeMint.result).toBeErr(Cl.uint(204));

    // Should reject collateral withdrawal
    const unsafeWithdraw = simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "withdraw-collateral-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1)],
      wallet1
    );
    expect(unsafeWithdraw.result).toBeErr(Cl.uint(204));
  });
});

describe("stability-pool-v4 ledger", () => {
  it("tracks deposit and withdraw balances with insufficient-balance guard", () => {
    const { deployer, wallet1 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v3`;
    const tokenPrincipal = `${deployer}.stablecoin-token-v3`;

    fullSetup(deployer, wallet1);

    // Mint stablecoins to wallet1 via vault
    simnet.callPublicFn("sbtc-token-v3", "faucet-mint", [Cl.uint(10000), Cl.principal(wallet1)], wallet1);
    simnet.callPublicFn("multi-asset-vault-engine-v5", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
    simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "deposit-collateral-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(10000)],
      wallet1
    );
    simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "mint-against-asset-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(1000)],
      wallet1
    );

    // Deposit to stability pool
    let result = simnet.callPublicFn(
      "stability-pool-v4",
      "deposit",
      [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(500)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.bool(true));

    let balance = simnet.callReadOnlyFn(
      "stability-pool-v4",
      "balance-of-for-stablecoin",
      [Cl.principal(wallet1), Cl.uint(0)],
      wallet1
    );
    expect(balance.result).toBeUint(500);

    // Withdraw
    result = simnet.callPublicFn(
      "stability-pool-v4",
      "withdraw",
      [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(200)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.bool(true));

    balance = simnet.callReadOnlyFn(
      "stability-pool-v4",
      "balance-of-for-stablecoin",
      [Cl.principal(wallet1), Cl.uint(0)],
      wallet1
    );
    expect(balance.result).toBeUint(300);

    // Over-withdraw should fail
    result = simnet.callPublicFn(
      "stability-pool-v4",
      "withdraw",
      [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(400)],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(500));
  });
});

describe("liquidation-engine-v5 stub", () => {
  it("returns explicit error for healthy vaults", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v3`;
    const tokenPrincipal = `${deployer}.stablecoin-token-v3`;

    fullSetup(deployer, wallet1);

    // Faucet, open vault, deposit, mint
    simnet.callPublicFn("sbtc-token-v3", "faucet-mint", [Cl.uint(1200), Cl.principal(wallet1)], wallet1);
    simnet.callPublicFn("multi-asset-vault-engine-v5", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
    simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "deposit-collateral-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1200)],
      wallet1
    );
    simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "mint-against-asset-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(600)],
      wallet1
    );

    // Deposit to pool so liquidation doesn't fail with empty pool
    simnet.callPublicFn(
      "stability-pool-v4",
      "deposit",
      [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(600)],
      wallet1
    );

    const liquidation = simnet.callPublicFn(
      "liquidation-engine-v5",
      "liquidate",
      [
        Cl.principal(wallet1),
        Cl.uint(0),
        Cl.principal(sbtcAsset),
        Cl.principal(sbtcAsset),
        Cl.principal(tokenPrincipal),
      ],
      wallet2
    );
    expect(liquidation.result).toBeErr(Cl.uint(300));
  });

  it("returns ok for undercollateralized vaults after price drop", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v3`;
    const tokenPrincipal = `${deployer}.stablecoin-token-v3`;

    fullSetup(deployer, wallet1);

    // Faucet, open vault, deposit, mint
    simnet.callPublicFn("sbtc-token-v3", "faucet-mint", [Cl.uint(10000), Cl.principal(wallet1)], wallet1);
    simnet.callPublicFn("multi-asset-vault-engine-v5", "open-vault-for-stablecoin", [Cl.uint(0)], wallet1);
    simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "deposit-collateral-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(1)],
      wallet1
    );
    simnet.callPublicFn(
      "multi-asset-vault-engine-v5",
      "mint-against-asset-for-stablecoin",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(4000)],
      wallet1
    );

    // Deposit to pool
    simnet.callPublicFn(
      "stability-pool-v4",
      "deposit",
      [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(4000)],
      wallet1
    );

    // Crash price
    simnet.callPublicFn(
      "dia-oracle-adapter",
      "set-value",
      [Cl.stringAscii("BTC/USD"), Cl.uint(500000000)],
      deployer
    );

    const liquidation = simnet.callPublicFn(
      "liquidation-engine-v5",
      "liquidate",
      [
        Cl.principal(wallet1),
        Cl.uint(0),
        Cl.principal(sbtcAsset),
        Cl.principal(sbtcAsset),
        Cl.principal(tokenPrincipal),
      ],
      wallet2
    );
    expect(liquidation.result.type).toBe("ok");
  });
});

describe("collateral-registry-v4 config flow", () => {
  it("supports owner add/get and rejects non-owner writes", () => {
    const { deployer, wallet1 } = getTestAccounts();
    const assetPrincipal = `${deployer}.stablecoin-token-v3`;
    const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;

    const unauthorized = simnet.callPublicFn(
      "collateral-registry-v4",
      "add-collateral-type",
      [
        Cl.principal(assetPrincipal),
        Cl.uint(150),       // min-collateral-ratio
        Cl.uint(120),       // liquidation-ratio
        Cl.uint(10),        // liquidation-penalty
        Cl.uint(200),       // stability-fee
        Cl.uint(1000000),   // debt-ceiling
        Cl.uint(100),       // debt-floor
        Cl.principal(oraclePrincipal),
      ],
      wallet1
    );
    expect(unauthorized.result).toBeErr(Cl.uint(100));

    const authorized = simnet.callPublicFn(
      "collateral-registry-v4",
      "add-collateral-type",
      [
        Cl.principal(assetPrincipal),
        Cl.uint(150),
        Cl.uint(120),
        Cl.uint(10),
        Cl.uint(200),
        Cl.uint(1000000),
        Cl.uint(100),
        Cl.principal(oraclePrincipal),
      ],
      deployer
    );
    expect(authorized.result).toBeOk(Cl.bool(true));

    const config = simnet.callReadOnlyFn(
      "collateral-registry-v4",
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
        "debt-ceiling": Cl.uint(1000000),
        "debt-floor": Cl.uint(100),
        "enabled": Cl.bool(true),
        "oracle": Cl.principal(oraclePrincipal),
      })
    );
  });
});
