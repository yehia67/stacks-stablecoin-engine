import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

// ============================================
// Test Helpers
// ============================================

function getTestAccounts() {
  const accounts = simnet.getAccounts();
  const deployer = accounts.get("deployer");
  const wallet1 = accounts.get("wallet_1");
  const wallet2 = accounts.get("wallet_2");
  const wallet3 = accounts.get("wallet_3");

  if (!deployer || !wallet1 || !wallet2 || !wallet3) {
    throw new Error("Missing default simnet accounts");
  }

  return { deployer, wallet1, wallet2, wallet3 };
}

function seedDiaBtcPrice(deployer: string, value: number = 6700000000000) {
  simnet.callPublicFn(
    "dia-oracle-adapter",
    "set-value",
    [Cl.stringAscii("BTC/USD"), Cl.uint(value)],
    deployer
  );
}

function addSbtcGlobalCollateral(deployer: string) {
  seedDiaBtcPrice(deployer);
  const sbtcAsset = `${deployer}.sbtc-token-v4`;
  const oraclePrincipal = `${deployer}.price-oracle-dia-btc-v2`;
  simnet.callPublicFn(
    "collateral-registry-v6",
    "add-collateral-type",
    [
      Cl.principal(sbtcAsset),
      Cl.uint(150), Cl.uint(120), Cl.uint(10), Cl.uint(200),
      Cl.uint(10000000), Cl.uint(100),
      Cl.principal(oraclePrincipal),
    ],
    deployer
  );
}

function registerAndLinkStablecoin(
  deployer: string,
  creator: string,
  name: string,
  symbol: string,
  expectedId: number
) {
  simnet.callPublicFn("stablecoin-factory-v4", "set-registration-fee", [Cl.uint(0)], deployer);
  const regResult = simnet.callPublicFn(
    "stablecoin-factory-v4",
    "register-stablecoin",
    [Cl.stringAscii(name), Cl.stringAscii(symbol)],
    creator
  );
  expect(regResult.result).toBeOk(Cl.uint(expectedId));

  const tokenPrincipal = `${deployer}.stablecoin-token-v4`;
  const linkResult = simnet.callPublicFn(
    "stablecoin-factory-v4",
    "set-token-contract",
    [Cl.uint(expectedId), Cl.principal(tokenPrincipal)],
    creator
  );
  expect(linkResult.result).toBeOk(Cl.bool(true));
}

function configureSbtcForStablecoin(deployer: string, creator: string, stablecoinId: number) {
  const sbtcAsset = `${deployer}.sbtc-token-v4`;
  const result = simnet.callPublicFn(
    "collateral-registry-v6",
    "configure-collateral-for-stablecoin",
    [
      Cl.uint(stablecoinId),
      Cl.principal(sbtcAsset),
      Cl.uint(150), Cl.uint(120), Cl.uint(10), Cl.uint(200),
      Cl.uint(10000000), Cl.uint(100),
    ],
    creator
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

function setupStablecoinPool(
  deployer: string,
  creator: string,
  name: string,
  symbol: string,
  expectedId: number
) {
  addSbtcGlobalCollateral(deployer);
  registerAndLinkStablecoin(deployer, creator, name, symbol, expectedId);
  configureSbtcForStablecoin(deployer, creator, expectedId);
}

/** Authorize the vault engine on the stablecoin token and register oracle. */
function authorizeVaultEngine(deployer: string) {
  const vaultEnginePrincipal = `${deployer}.multi-asset-vault-engine-v7`;
  const sbtcAsset = `${deployer}.sbtc-token-v4`;
  simnet.callPublicFn(
    "stablecoin-token-v4",
    "set-vault-engine",
    [Cl.principal(vaultEnginePrincipal)],
    deployer
  );
  simnet.callPublicFn(
    "multi-asset-vault-engine-v7",
    "register-asset-oracle",
    [Cl.principal(sbtcAsset), Cl.uint(3)],
    deployer
  );
}

/** Open vault, deposit collateral, mint stablecoins for a user. */
function openVaultAndMint(
  deployer: string,
  user: string,
  collateralAmount: number,
  mintAmount: number
) {
  const sbtcAsset = `${deployer}.sbtc-token-v4`;
  const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

  // Faucet-mint sBTC
  simnet.callPublicFn("sbtc-token-v4", "faucet-mint", [Cl.uint(collateralAmount), Cl.principal(user)], user);

  // Open vault
  simnet.callPublicFn("multi-asset-vault-engine-v7", "open-vault-for-stablecoin", [Cl.uint(0)], user);

  // Deposit collateral
  simnet.callPublicFn(
    "multi-asset-vault-engine-v7",
    "deposit-collateral-for-stablecoin",
    [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(collateralAmount)],
    user
  );

  // Mint stablecoins
  const mintResult = simnet.callPublicFn(
    "multi-asset-vault-engine-v7",
    "mint-against-asset-for-stablecoin",
    [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(mintAmount)],
    user
  );
  expect(mintResult.result).toBeOk(Cl.uint(mintAmount));
}

/** Deposit stablecoins into the stability pool. */
function depositToPool(deployer: string, user: string, amount: number) {
  const tokenPrincipal = `${deployer}.stablecoin-token-v4`;
  const result = simnet.callPublicFn(
    "stability-pool-v6",
    "deposit",
    [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(amount)],
    user
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

function getSbtcBalance(deployer: string, owner: string): bigint {
  const result = simnet.callReadOnlyFn(
    "sbtc-token-v4",
    "get-balance",
    [Cl.principal(owner)],
    deployer
  );
  return (result.result as any).value.value;
}

function getPoolPrincipal(deployer: string): string {
  return `${deployer}.stability-pool-v6`;
}

// ============================================
// Tests
// ============================================

describe("liquidation reward configuration", () => {
  it("creator can set liquidation reward percentage", () => {
    const { deployer, wallet1 } = getTestAccounts();
    setupStablecoinPool(deployer, wallet1, "Rew Dollar", "RUSD", 0);

    const result = simnet.callPublicFn(
      "stability-pool-v6",
      "set-liquidation-reward-pct",
      [Cl.uint(0), Cl.uint(1000)], // 10%
      wallet1
    );
    expect(result.result).toBeOk(Cl.bool(true));

    const pct = simnet.callReadOnlyFn(
      "stability-pool-v6",
      "get-liquidation-reward-pct",
      [Cl.uint(0)],
      deployer
    );
    expect(pct.result).toBeUint(1000);
  });

  it("non-creator cannot set reward percentage", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    setupStablecoinPool(deployer, wallet1, "Auth Dollar", "ADOL", 0);

    const result = simnet.callPublicFn(
      "stability-pool-v6",
      "set-liquidation-reward-pct",
      [Cl.uint(0), Cl.uint(500)],
      wallet2 // not the creator
    );
    expect(result.result).toBeErr(Cl.uint(504)); // ERR_UNAUTHORIZED
  });

  it("rejects reward percentage above maximum", () => {
    const { deployer, wallet1 } = getTestAccounts();
    setupStablecoinPool(deployer, wallet1, "Max Dollar", "MXSD", 0);

    const result = simnet.callPublicFn(
      "stability-pool-v6",
      "set-liquidation-reward-pct",
      [Cl.uint(0), Cl.uint(6000)], // 60% > MAX 50%
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(505)); // ERR_INVALID_REWARD_PCT
  });

  it("defaults to 0% when not configured", () => {
    const { deployer } = getTestAccounts();
    const pct = simnet.callReadOnlyFn(
      "stability-pool-v6",
      "get-liquidation-reward-pct",
      [Cl.uint(99)],
      deployer
    );
    expect(pct.result).toBeUint(0);
  });
});

describe("full liquidation flow", () => {
  it("liquidates unhealthy vault and distributes collateral reward to pool depositors", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v4`;
    const tokenPrincipal = `${deployer}.stablecoin-token-v4`;
    const poolPrincipal = getPoolPrincipal(deployer);

    // Setup stablecoin + authorize vault engine
    setupStablecoinPool(deployer, wallet1, "Liq Dollar", "LQSD", 0);
    authorizeVaultEngine(deployer);

    // Set liquidation reward to 10%
    simnet.callPublicFn(
      "stability-pool-v6",
      "set-liquidation-reward-pct",
      [Cl.uint(0), Cl.uint(1000)],
      wallet1
    );

    // wallet1 opens a vault: deposit 1 sBTC collateral, mint 4000 stablecoins
    // At default sBTC price ~67016.83, health factor = (1 * 67016.83 * 10000) / (4000 * 150) = ~1117
    // That's healthy. We'll later crash the price to make it unhealthy.
    openVaultAndMint(deployer, wallet1, 1, 4000);

    // wallet1 deposits all stablecoins into pool (depositor is also vault owner here for simplicity)
    depositToPool(deployer, wallet1, 4000);

    // Verify pool state
    const poolDeposits = simnet.callReadOnlyFn(
      "stability-pool-v6",
      "get-total-deposits",
      [Cl.uint(0)],
      deployer
    );
    expect(poolDeposits.result).toBeUint(4000);

    // Crash sBTC price to make the vault unhealthy
    // Health factor = (collateral_value * 10000) / (debt * min_ratio)
    // With 1 sBTC at price X: health = (1 * X * 10000) / (4000 * 150) = X / 60
    // For health < 150 (MIN_HEALTH): X < 150 * 60 = 9000
    // Set price to 500000000 (5000 in 1e8 scale) → health = 5000/60 = 83 < 150
    simnet.callPublicFn(
      "dia-oracle-adapter",
      "set-value",
      [Cl.stringAscii("BTC/USD"), Cl.uint(500000000)],
      deployer
    );

    // Verify vault is now unhealthy
    const healthFactor = simnet.callReadOnlyFn(
      "multi-asset-vault-engine-v7",
      "get-position-health-factor-for-stablecoin",
      [Cl.principal(wallet1), Cl.uint(0), Cl.principal(sbtcAsset)],
      deployer
    );
    // Should be < 150
    const hfValue = (healthFactor.result as any).value;
    expect(Number(hfValue)).toBeLessThan(150);

    // Record balances before liquidation
    const poolSbtcBefore = getSbtcBalance(deployer, poolPrincipal);

    // Liquidate!
    const liqResult = simnet.callPublicFn(
      "liquidation-engine-v7",
      "liquidate",
      [
        Cl.principal(wallet1),
        Cl.uint(0),
        Cl.principal(sbtcAsset),
        Cl.principal(sbtcAsset),
        Cl.principal(tokenPrincipal),
      ],
      wallet2 // anyone can call liquidate
    );
    expect(liqResult.result).toBeOk(
      Cl.tuple({
        "debt-offset": Cl.uint(4000),
        "collateral-seized": Cl.uint(1), // full collateral (1 sBTC) capped
        "reward-bonus": Cl.uint(0), // base = 1*4000/4000 = 1, bonus = 1*1000/10000 = 0 (integer math, 1 unit)
      })
    );

    // Pool should now have collateral (sBTC)
    const poolSbtcAfter = getSbtcBalance(deployer, poolPrincipal);
    expect(poolSbtcAfter).toBeGreaterThan(poolSbtcBefore);

    // Pool total deposits should be reduced (stablecoins burned)
    const newPoolDeposits = simnet.callReadOnlyFn(
      "stability-pool-v6",
      "get-total-deposits",
      [Cl.uint(0)],
      deployer
    );
    expect(newPoolDeposits.result).toBeUint(0); // all deposits used to offset debt

    // wallet1 should have claimable collateral reward
    const claimable = simnet.callReadOnlyFn(
      "stability-pool-v6",
      "get-claimable-collateral-reward",
      [Cl.principal(wallet1), Cl.uint(0), Cl.principal(sbtcAsset)],
      deployer
    );
    const claimableValue = Number((claimable.result as any).value);
    expect(claimableValue).toBeGreaterThan(0);
  });

  it("rejects liquidation of healthy vault", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v4`;
    const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

    setupStablecoinPool(deployer, wallet1, "Hlth Dollar", "HLSD", 0);
    authorizeVaultEngine(deployer);
    openVaultAndMint(deployer, wallet1, 10000, 1000);
    depositToPool(deployer, wallet1, 1000);

    // Try to liquidate a healthy vault
    const result = simnet.callPublicFn(
      "liquidation-engine-v7",
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
    expect(result.result).toBeErr(Cl.uint(300)); // ERR_HEALTHY
  });

  it("rejects liquidation when pool is empty", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v4`;
    const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

    setupStablecoinPool(deployer, wallet1, "Emp Dollar", "EMSD", 0);
    authorizeVaultEngine(deployer);
    openVaultAndMint(deployer, wallet1, 1, 4000);

    // Crash price to make unhealthy
    simnet.callPublicFn("dia-oracle-adapter", "set-value", [Cl.stringAscii("BTC/USD"), Cl.uint(500000000)], deployer);

    // No deposits in pool — liquidation should fail
    const result = simnet.callPublicFn(
      "liquidation-engine-v7",
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
    expect(result.result).toBeErr(Cl.uint(303)); // ERR_EMPTY_POOL
  });
});

describe("collateral reward claiming", () => {
  it("depositor claims collateral after liquidation", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v4`;
    const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

    setupStablecoinPool(deployer, wallet1, "Clm Dollar", "CLSD", 0);
    authorizeVaultEngine(deployer);

    // Set 10% reward
    simnet.callPublicFn(
      "stability-pool-v6",
      "set-liquidation-reward-pct",
      [Cl.uint(0), Cl.uint(1000)],
      wallet1
    );

    // wallet2 opens vault (different user from depositor)
    openVaultAndMint(deployer, wallet2, 1, 4000);

    // wallet1 needs stablecoins — mint via own vault
    openVaultAndMint(deployer, wallet1, 50000, 5000);

    // wallet1 deposits 5000 into pool
    depositToPool(deployer, wallet1, 5000);

    // Crash price
    simnet.callPublicFn("dia-oracle-adapter", "set-value", [Cl.stringAscii("BTC/USD"), Cl.uint(500000000)], deployer);

    // Liquidate wallet2's vault
    simnet.callPublicFn(
      "liquidation-engine-v7",
      "liquidate",
      [
        Cl.principal(wallet2),
        Cl.uint(0),
        Cl.principal(sbtcAsset),
        Cl.principal(sbtcAsset),
        Cl.principal(tokenPrincipal),
      ],
      deployer
    );

    // wallet1 should have claimable sBTC rewards
    const claimable = simnet.callReadOnlyFn(
      "stability-pool-v6",
      "get-claimable-collateral-reward",
      [Cl.principal(wallet1), Cl.uint(0), Cl.principal(sbtcAsset)],
      deployer
    );
    const claimableValue = Number((claimable.result as any).value);
    expect(claimableValue).toBeGreaterThan(0);

    // Record sBTC balance before claim
    const sbtcBefore = getSbtcBalance(deployer, wallet1);

    // Claim!
    const claimResult = simnet.callPublicFn(
      "stability-pool-v6",
      "claim-collateral-reward",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset)],
      wallet1
    );
    expect(claimResult.result).toBeOk(Cl.uint(claimableValue));

    // sBTC balance should increase
    const sbtcAfter = getSbtcBalance(deployer, wallet1);
    expect(sbtcAfter).toBe(sbtcBefore + BigInt(claimableValue));

    // After claim, claimable should be 0
    const claimableAfter = simnet.callReadOnlyFn(
      "stability-pool-v6",
      "get-claimable-collateral-reward",
      [Cl.principal(wallet1), Cl.uint(0), Cl.principal(sbtcAsset)],
      deployer
    );
    expect(claimableAfter.result).toBeUint(0);
  });

  it("rejects claim when no reward available", () => {
    const { deployer, wallet1 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v4`;

    setupStablecoinPool(deployer, wallet1, "NoR Dollar", "NRSD", 0);

    const result = simnet.callPublicFn(
      "stability-pool-v6",
      "claim-collateral-reward",
      [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset)],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(507)); // ERR_NO_REWARD
  });
});

describe("deposit loss tracking after liquidation", () => {
  it("effective balance decreases after liquidation offsets debt", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    const sbtcAsset = `${deployer}.sbtc-token-v4`;
    const tokenPrincipal = `${deployer}.stablecoin-token-v4`;

    setupStablecoinPool(deployer, wallet1, "Loss Dollar", "LOSD", 0);
    authorizeVaultEngine(deployer);

    // Set 0% reward (focus on deposit loss)
    simnet.callPublicFn(
      "stability-pool-v6",
      "set-liquidation-reward-pct",
      [Cl.uint(0), Cl.uint(0)],
      wallet1
    );

    // wallet2 opens a small vault
    openVaultAndMint(deployer, wallet2, 1, 2000);

    // wallet1 mints and deposits 10000 into pool
    openVaultAndMint(deployer, wallet1, 50000, 10000);
    depositToPool(deployer, wallet1, 10000);

    // Check effective balance before liquidation
    const balBefore = simnet.callReadOnlyFn(
      "stability-pool-v6",
      "balance-of-for-stablecoin",
      [Cl.principal(wallet1), Cl.uint(0)],
      deployer
    );
    expect(balBefore.result).toBeUint(10000);

    // Crash price and liquidate
    simnet.callPublicFn("dia-oracle-adapter", "set-value", [Cl.stringAscii("BTC/USD"), Cl.uint(500000000)], deployer);
    simnet.callPublicFn(
      "liquidation-engine-v7",
      "liquidate",
      [
        Cl.principal(wallet2),
        Cl.uint(0),
        Cl.principal(sbtcAsset),
        Cl.principal(sbtcAsset),
        Cl.principal(tokenPrincipal),
      ],
      deployer
    );

    // Effective balance should be reduced (2000 stablecoins used to offset debt)
    const balAfter = simnet.callReadOnlyFn(
      "stability-pool-v6",
      "balance-of-for-stablecoin",
      [Cl.principal(wallet1), Cl.uint(0)],
      deployer
    );
    // Pool had 10000, offset 2000 debt → effective balance = 10000 * (10000-2000)/10000 = 8000
    expect(balAfter.result).toBeUint(8000);
  });
});
