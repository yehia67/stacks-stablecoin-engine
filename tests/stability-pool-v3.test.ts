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

/** Register a stablecoin and link its token contract. Returns stablecoin-id. */
function registerAndLinkStablecoin(
  deployer: string,
  creator: string,
  name: string,
  symbol: string,
  expectedId: number
) {
  // Zero-fee registration
  simnet.callPublicFn("stablecoin-factory-v3", "set-registration-fee", [Cl.uint(0)], deployer);

  const regResult = simnet.callPublicFn(
    "stablecoin-factory-v3",
    "register-stablecoin",
    [Cl.stringAscii(name), Cl.stringAscii(symbol)],
    creator
  );
  expect(regResult.result).toBeOk(Cl.uint(expectedId));

  const tokenPrincipal = `${deployer}.stablecoin-token-v3`;
  const linkResult = simnet.callPublicFn(
    "stablecoin-factory-v3",
    "set-token-contract",
    [Cl.uint(expectedId), Cl.principal(tokenPrincipal)],
    creator
  );
  expect(linkResult.result).toBeOk(Cl.bool(true));

  return expectedId;
}

/** Mint stablecoin tokens to a recipient so they have tokens to deposit into the pool. */
function mintStablecoinTokens(deployer: string, recipient: string, amount: number) {
  // Authorize the vault engine (or deployer) to mint
  // We use the vault engine's mint path: authorize vault engine, then call mint via vault engine
  // Simpler: directly set the vault engine to a test principal and mint
  // The stablecoin-token-v3 mint function requires contract-caller == vault-engine
  // So we authorize a helper or use the multi-asset vault engine flow

  // Authorize the multi-asset vault engine as the vault engine for the stablecoin token
  const vaultEnginePrincipal = `${deployer}.multi-asset-vault-engine-v3`;
  simnet.callPublicFn(
    "stablecoin-token-v3",
    "set-vault-engine",
    [Cl.principal(vaultEnginePrincipal)],
    deployer
  );

  // To mint stablecoin tokens, we need to go through the vault engine's mint flow:
  // open vault → deposit collateral → mint
  // This is the canonical way to get stablecoin tokens.
  // We'll use the full vault flow with sBTC collateral.

  const sbtcAsset = `${deployer}.sbtc-token-v3`;
  const oraclePrincipal = `${deployer}.price-oracle-sbtc-v3`;
  const tokenPrincipal = `${deployer}.stablecoin-token-v3`;

  // Add global sBTC collateral (idempotent if already added — will fail silently)
  simnet.callPublicFn(
    "collateral-registry-v3",
    "add-collateral-type",
    [
      Cl.principal(sbtcAsset),
      Cl.uint(150), Cl.uint(120), Cl.uint(10), Cl.uint(200),
      Cl.uint(10000000), Cl.uint(100),
      Cl.principal(oraclePrincipal),
    ],
    deployer
  );

  // Register asset oracle
  simnet.callPublicFn(
    "multi-asset-vault-engine-v3",
    "register-asset-oracle",
    [Cl.principal(sbtcAsset), Cl.uint(1)],
    deployer
  );

  // Faucet mint sBTC to recipient for collateral
  const collateralNeeded = amount * 2; // 200% overcollateralized to be safe
  simnet.callPublicFn(
    "sbtc-token-v3",
    "faucet-mint",
    [Cl.uint(collateralNeeded), Cl.principal(recipient)],
    recipient
  );

  // Open vault and deposit collateral and mint
  simnet.callPublicFn(
    "multi-asset-vault-engine-v3",
    "open-vault-for-stablecoin",
    [Cl.uint(0)],
    recipient
  );
  simnet.callPublicFn(
    "multi-asset-vault-engine-v3",
    "deposit-collateral-for-stablecoin",
    [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(collateralNeeded)],
    recipient
  );
  const mintResult = simnet.callPublicFn(
    "multi-asset-vault-engine-v3",
    "mint-against-asset-for-stablecoin",
    [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(amount)],
    recipient
  );
  expect(mintResult.result).toBeOk(Cl.uint(amount));
}

/** Add sBTC as a global collateral type in the registry. */
function addSbtcGlobalCollateral(deployer: string) {
  const sbtcAsset = `${deployer}.sbtc-token-v3`;
  const oraclePrincipal = `${deployer}.price-oracle-sbtc-v3`;
  simnet.callPublicFn(
    "collateral-registry-v3",
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

/** Configure sBTC collateral for a specific stablecoin. Global collateral must exist first. */
function configureSbtcForStablecoin(deployer: string, creator: string, stablecoinId: number) {
  const sbtcAsset = `${deployer}.sbtc-token-v3`;
  const result = simnet.callPublicFn(
    "collateral-registry-v3",
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

/** Full setup: global collateral + register stablecoin + link token + configure per-stablecoin collateral. */
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

/** Get stablecoin token balance for any principal. */
function getStablecoinBalance(deployer: string, owner: string): bigint {
  const result = simnet.callReadOnlyFn(
    "stablecoin-token-v3",
    "get-balance",
    [Cl.principal(owner)],
    deployer
  );
  return (result.result as any).value.value;
}

function getPoolPrincipal(deployer: string): string {
  return `${deployer}.stability-pool-v3`;
}

describe("stability-pool-v3 token custody", () => {
  describe("deposit transfers tokens to pool", () => {
    it("transfers stablecoin tokens from user to pool on deposit", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v3`;
      const poolPrincipal = getPoolPrincipal(deployer);

      // Setup: global collateral + register stablecoin + link token + configure + mint tokens
      setupStablecoinPool(deployer, wallet1, "Pool Dollar", "PUSD", 0);
      mintStablecoinTokens(deployer, wallet1, 5000);

      // Verify initial balances
      const initialUserBalance = getStablecoinBalance(deployer, wallet1);
      const initialPoolBalance = getStablecoinBalance(deployer, poolPrincipal);
      expect(initialUserBalance).toBe(5000n);
      expect(initialPoolBalance).toBe(0n);

      // Deposit to pool
      const result = simnet.callPublicFn(
        "stability-pool-v3",
        "deposit",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(2000)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify token balances changed
      expect(getStablecoinBalance(deployer, wallet1)).toBe(3000n);
      expect(getStablecoinBalance(deployer, poolPrincipal)).toBe(2000n);

      // Verify pool ledger balance
      const poolBalance = simnet.callReadOnlyFn(
        "stability-pool-v3",
        "balance-of-for-stablecoin",
        [Cl.principal(wallet1), Cl.uint(0)],
        deployer
      );
      expect(poolBalance.result).toBeUint(2000);

      // Verify total deposits
      const totalDeposits = simnet.callReadOnlyFn(
        "stability-pool-v3",
        "get-total-deposits",
        [Cl.uint(0)],
        deployer
      );
      expect(totalDeposits.result).toBeUint(2000);
    });

    it("accumulates multiple deposits correctly", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v3`;
      const poolPrincipal = getPoolPrincipal(deployer);

      setupStablecoinPool(deployer, wallet1, "Acc Dollar", "AUSD", 0);
      mintStablecoinTokens(deployer, wallet1, 5000);

      // First deposit
      simnet.callPublicFn(
        "stability-pool-v3", "deposit",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(1000)],
        wallet1
      );

      // Second deposit
      simnet.callPublicFn(
        "stability-pool-v3", "deposit",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(1500)],
        wallet1
      );

      // Verify accumulated balances
      expect(getStablecoinBalance(deployer, wallet1)).toBe(2500n);  // 5000 - 1000 - 1500
      expect(getStablecoinBalance(deployer, poolPrincipal)).toBe(2500n);

      const poolBalance = simnet.callReadOnlyFn(
        "stability-pool-v3", "balance-of-for-stablecoin",
        [Cl.principal(wallet1), Cl.uint(0)],
        deployer
      );
      expect(poolBalance.result).toBeUint(2500);
    });

    it("rejects deposit when user has insufficient token balance", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v3`;

      setupStablecoinPool(deployer, wallet1, "Low Dollar", "LUSD", 0);
      mintStablecoinTokens(deployer, wallet1, 100);

      // Try to deposit more than balance
      const result = simnet.callPublicFn(
        "stability-pool-v3", "deposit",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(500)],
        wallet1
      );
      // stablecoin-token-v3 ERR_INSUFFICIENT_BALANCE = u402
      expect(result.result).toBeErr(Cl.uint(402));
    });

    it("rejects deposit with wrong token (token mismatch)", () => {
      const { deployer, wallet1 } = getTestAccounts();
      // Pass sBTC token instead of stablecoin token
      const wrongToken = `${deployer}.sbtc-token-v3`;

      addSbtcGlobalCollateral(deployer);
      registerAndLinkStablecoin(deployer, wallet1, "Mis Dollar", "MUSD", 0);

      const result = simnet.callPublicFn(
        "stability-pool-v3", "deposit",
        [Cl.uint(0), Cl.principal(wrongToken), Cl.uint(100)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(501)); // ERR_TOKEN_MISMATCH
    });

    it("rejects deposit for stablecoin with no linked token", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v3`;

      // Register but do NOT link token
      simnet.callPublicFn("stablecoin-factory-v3", "set-registration-fee", [Cl.uint(0)], deployer);
      simnet.callPublicFn(
        "stablecoin-factory-v3", "register-stablecoin",
        [Cl.stringAscii("Unlinked Dollar"), Cl.stringAscii("XUSD")],
        wallet1
      );

      const result = simnet.callPublicFn(
        "stability-pool-v3", "deposit",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(100)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(503)); // ERR_TOKEN_NOT_LINKED
    });
  });

  describe("withdraw transfers tokens back to user", () => {
    it("transfers stablecoin tokens from pool to user on withdraw", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v3`;
      const poolPrincipal = getPoolPrincipal(deployer);

      setupStablecoinPool(deployer, wallet1, "With Dollar", "WUSD", 0);
      mintStablecoinTokens(deployer, wallet1, 5000);

      // Deposit first
      simnet.callPublicFn(
        "stability-pool-v3", "deposit",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(3000)],
        wallet1
      );
      expect(getStablecoinBalance(deployer, wallet1)).toBe(2000n);
      expect(getStablecoinBalance(deployer, poolPrincipal)).toBe(3000n);

      // Withdraw partial
      const result = simnet.callPublicFn(
        "stability-pool-v3", "withdraw",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(1000)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify balances
      expect(getStablecoinBalance(deployer, wallet1)).toBe(3000n);   // 2000 + 1000
      expect(getStablecoinBalance(deployer, poolPrincipal)).toBe(2000n); // 3000 - 1000

      // Verify pool ledger
      const poolBalance = simnet.callReadOnlyFn(
        "stability-pool-v3", "balance-of-for-stablecoin",
        [Cl.principal(wallet1), Cl.uint(0)],
        deployer
      );
      expect(poolBalance.result).toBeUint(2000);
    });

    it("rejects withdrawal exceeding deposited balance", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v3`;

      setupStablecoinPool(deployer, wallet1, "Over Dollar", "OUSD", 0);
      mintStablecoinTokens(deployer, wallet1, 1000);

      // Deposit 500
      simnet.callPublicFn(
        "stability-pool-v3", "deposit",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(500)],
        wallet1
      );

      // Try to withdraw 600
      const result = simnet.callPublicFn(
        "stability-pool-v3", "withdraw",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(600)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(500)); // ERR_INSUFFICIENT_BALANCE
    });
  });

  describe("full pool lifecycle", () => {
    it("deposit → withdraw full amount returns all tokens", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v3`;
      const poolPrincipal = getPoolPrincipal(deployer);

      setupStablecoinPool(deployer, wallet1, "Full Dollar", "FUSD", 0);
      mintStablecoinTokens(deployer, wallet1, 3000);

      const initialBalance = getStablecoinBalance(deployer, wallet1);

      // Deposit all
      simnet.callPublicFn(
        "stability-pool-v3", "deposit",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(3000)],
        wallet1
      );
      expect(getStablecoinBalance(deployer, wallet1)).toBe(0n);
      expect(getStablecoinBalance(deployer, poolPrincipal)).toBe(3000n);

      // Withdraw all
      const result = simnet.callPublicFn(
        "stability-pool-v3", "withdraw",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(3000)],
        wallet1
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // All tokens returned
      expect(getStablecoinBalance(deployer, wallet1)).toBe(initialBalance);
      expect(getStablecoinBalance(deployer, poolPrincipal)).toBe(0n);

      // Pool ledger is zero
      const poolBalance = simnet.callReadOnlyFn(
        "stability-pool-v3", "balance-of-for-stablecoin",
        [Cl.principal(wallet1), Cl.uint(0)],
        deployer
      );
      expect(poolBalance.result).toBeUint(0);

      // Total deposits is zero
      const totalDeposits = simnet.callReadOnlyFn(
        "stability-pool-v3", "get-total-deposits",
        [Cl.uint(0)],
        deployer
      );
      expect(totalDeposits.result).toBeUint(0);
    });

    it("multiple users deposit and withdraw independently", () => {
      const { deployer, wallet1, wallet2 } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v3`;
      const poolPrincipal = getPoolPrincipal(deployer);

      setupStablecoinPool(deployer, wallet1, "Multi Dollar", "MDSD", 0);

      // Mint tokens to both users
      mintStablecoinTokens(deployer, wallet1, 3000);

      // wallet2 needs its own vault to mint tokens
      // Open a separate vault for wallet2
      const sbtcAsset = `${deployer}.sbtc-token-v3`;
      simnet.callPublicFn("sbtc-token-v3", "faucet-mint", [Cl.uint(4000), Cl.principal(wallet2)], wallet2);
      simnet.callPublicFn("multi-asset-vault-engine-v3", "open-vault-for-stablecoin", [Cl.uint(0)], wallet2);
      simnet.callPublicFn(
        "multi-asset-vault-engine-v3", "deposit-collateral-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(sbtcAsset), Cl.uint(4000)],
        wallet2
      );
      simnet.callPublicFn(
        "multi-asset-vault-engine-v3", "mint-against-asset-for-stablecoin",
        [Cl.uint(0), Cl.principal(sbtcAsset), Cl.principal(tokenPrincipal), Cl.uint(2000)],
        wallet2
      );

      // wallet1 deposits 1500
      simnet.callPublicFn(
        "stability-pool-v3", "deposit",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(1500)],
        wallet1
      );

      // wallet2 deposits 1000
      simnet.callPublicFn(
        "stability-pool-v3", "deposit",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(1000)],
        wallet2
      );

      // Total pool = 2500
      const totalDeposits = simnet.callReadOnlyFn(
        "stability-pool-v3", "get-total-deposits",
        [Cl.uint(0)],
        deployer
      );
      expect(totalDeposits.result).toBeUint(2500);

      // Pool contract holds 2500 tokens
      expect(getStablecoinBalance(deployer, poolPrincipal)).toBe(2500n);

      // wallet1 withdraws 500
      simnet.callPublicFn(
        "stability-pool-v3", "withdraw",
        [Cl.uint(0), Cl.principal(tokenPrincipal), Cl.uint(500)],
        wallet1
      );

      // wallet1 pool balance = 1000, wallet2 pool balance = 1000, total = 2000
      const w1Balance = simnet.callReadOnlyFn(
        "stability-pool-v3", "balance-of-for-stablecoin",
        [Cl.principal(wallet1), Cl.uint(0)],
        deployer
      );
      expect(w1Balance.result).toBeUint(1000);

      const w2Balance = simnet.callReadOnlyFn(
        "stability-pool-v3", "balance-of-for-stablecoin",
        [Cl.principal(wallet2), Cl.uint(0)],
        deployer
      );
      expect(w2Balance.result).toBeUint(1000);

      expect(getStablecoinBalance(deployer, poolPrincipal)).toBe(2000n);
    });
  });
});
