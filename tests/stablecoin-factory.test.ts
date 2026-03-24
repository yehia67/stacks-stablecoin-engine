import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

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

// Default registration fee: 10 STX = 10,000,000 microSTX
const DEFAULT_FEE = 10000000;

// ============================================
// Admin Functions Tests
// ============================================

describe("stablecoin-factory admin functions", () => {
  describe("set-registration-fee", () => {
    it("allows owner to set registration fee", () => {
      const { deployer } = getTestAccounts();

      const result = simnet.callPublicFn(
        "stablecoin-factory",
        "set-registration-fee",
        [Cl.uint(5000000)], // 5 STX
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify fee was updated
      const fee = simnet.callReadOnlyFn(
        "stablecoin-factory",
        "get-registration-fee",
        [],
        deployer
      );
      expect(fee.result).toBeUint(5000000);
    });

    it("allows owner to set fee to zero (disable fee)", () => {
      const { deployer } = getTestAccounts();

      const result = simnet.callPublicFn(
        "stablecoin-factory",
        "set-registration-fee",
        [Cl.uint(0)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      const fee = simnet.callReadOnlyFn(
        "stablecoin-factory",
        "get-registration-fee",
        [],
        deployer
      );
      expect(fee.result).toBeUint(0);
    });

    it("rejects non-owner setting fee", () => {
      const { wallet1 } = getTestAccounts();

      const result = simnet.callPublicFn(
        "stablecoin-factory",
        "set-registration-fee",
        [Cl.uint(5000000)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(700)); // ERR_UNAUTHORIZED
    });
  });

  describe("set-treasury-address", () => {
    it("allows owner to set treasury address", () => {
      const { deployer, wallet1 } = getTestAccounts();

      const result = simnet.callPublicFn(
        "stablecoin-factory",
        "set-treasury-address",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify treasury was updated
      const treasury = simnet.callReadOnlyFn(
        "stablecoin-factory",
        "get-treasury-address",
        [],
        deployer
      );
      expect(treasury.result).toBePrincipal(wallet1);
    });

    it("rejects non-owner setting treasury", () => {
      const { wallet1, wallet2 } = getTestAccounts();

      const result = simnet.callPublicFn(
        "stablecoin-factory",
        "set-treasury-address",
        [Cl.principal(wallet2)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(700)); // ERR_UNAUTHORIZED
    });
  });
});

// ============================================
// Registration with Fee Tests
// ============================================

describe("stablecoin-factory registration", () => {
  describe("register-stablecoin with fee", () => {
    it("successfully registers stablecoin and transfers fee to treasury", () => {
      const { deployer, wallet1 } = getTestAccounts();

      // Get initial balances
      const initialWallet1Balance = simnet.getAssetsMap().get("STX")?.get(wallet1) || 0n;
      const initialDeployerBalance = simnet.getAssetsMap().get("STX")?.get(deployer) || 0n;

      // Register stablecoin (deployer is treasury by default)
      const result = simnet.callPublicFn(
        "stablecoin-factory",
        "register-stablecoin",
        [Cl.stringAscii("Test USD"), Cl.stringAscii("TUSD")],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(0)); // First stablecoin ID is 0

      // Verify fee was transferred
      const finalWallet1Balance = simnet.getAssetsMap().get("STX")?.get(wallet1) || 0n;
      const finalDeployerBalance = simnet.getAssetsMap().get("STX")?.get(deployer) || 0n;

      expect(Number(initialWallet1Balance) - Number(finalWallet1Balance)).toBe(DEFAULT_FEE);
      expect(Number(finalDeployerBalance) - Number(initialDeployerBalance)).toBe(DEFAULT_FEE);

      // Verify stablecoin was registered
      const stablecoin = simnet.callReadOnlyFn(
        "stablecoin-factory",
        "get-stablecoin",
        [Cl.uint(0)],
        wallet1
      );
      // Just verify it exists with correct data (block height varies)
      expect(stablecoin.result).not.toBeNone();
    });

    it("fails registration when user has insufficient STX", () => {
      const { deployer } = getTestAccounts();

      // Set a very high fee
      simnet.callPublicFn(
        "stablecoin-factory",
        "set-registration-fee",
        [Cl.uint(100000000000000)], // 100M STX
        deployer
      );

      // Try to register with insufficient balance
      const result = simnet.callPublicFn(
        "stablecoin-factory",
        "register-stablecoin",
        [Cl.stringAscii("Fail Coin"), Cl.stringAscii("FAIL")],
        deployer
      );
      // Should fail with STX transfer error (error code 2 = insufficient balance)
      expect(result.result).toBeErr(Cl.uint(2));
    });

    it("transfers fee to custom treasury address", () => {
      const { deployer, wallet1, wallet2 } = getTestAccounts();

      // Set wallet2 as treasury
      simnet.callPublicFn(
        "stablecoin-factory",
        "set-treasury-address",
        [Cl.principal(wallet2)],
        deployer
      );

      // Get initial balances
      const initialWallet1Balance = simnet.getAssetsMap().get("STX")?.get(wallet1) || 0n;
      const initialWallet2Balance = simnet.getAssetsMap().get("STX")?.get(wallet2) || 0n;

      // Register stablecoin
      const result = simnet.callPublicFn(
        "stablecoin-factory",
        "register-stablecoin",
        [Cl.stringAscii("Custom Treasury"), Cl.stringAscii("CTRS")],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(0));

      // Verify fee went to wallet2 (treasury)
      const finalWallet1Balance = simnet.getAssetsMap().get("STX")?.get(wallet1) || 0n;
      const finalWallet2Balance = simnet.getAssetsMap().get("STX")?.get(wallet2) || 0n;

      expect(Number(initialWallet1Balance) - Number(finalWallet1Balance)).toBe(DEFAULT_FEE);
      expect(Number(finalWallet2Balance) - Number(initialWallet2Balance)).toBe(DEFAULT_FEE);
    });
  });

  describe("register-stablecoin with zero fee", () => {
    it("allows free registration when fee is set to zero", () => {
      const { deployer, wallet1 } = getTestAccounts();

      // Set fee to 0
      simnet.callPublicFn(
        "stablecoin-factory",
        "set-registration-fee",
        [Cl.uint(0)],
        deployer
      );

      // Get initial balance
      const initialBalance = simnet.getAssetsMap().get("STX")?.get(wallet1) || 0n;

      // Register stablecoin
      const result = simnet.callPublicFn(
        "stablecoin-factory",
        "register-stablecoin",
        [Cl.stringAscii("Free Coin"), Cl.stringAscii("FREE")],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(0));

      // Verify no fee was charged
      const finalBalance = simnet.getAssetsMap().get("STX")?.get(wallet1) || 0n;
      expect(initialBalance).toBe(finalBalance);

      // Verify stablecoin was registered
      const stablecoin = simnet.callReadOnlyFn(
        "stablecoin-factory",
        "get-stablecoin",
        [Cl.uint(0)],
        wallet1
      );
      expect(stablecoin.result).not.toBeNone();
    });
  });

  describe("duplicate registration prevention", () => {
    it("rejects duplicate stablecoin name", () => {
      const { deployer, wallet1, wallet2 } = getTestAccounts();

      // Set fee to 0 for simplicity
      simnet.callPublicFn(
        "stablecoin-factory",
        "set-registration-fee",
        [Cl.uint(0)],
        deployer
      );

      // First registration
      let result = simnet.callPublicFn(
        "stablecoin-factory",
        "register-stablecoin",
        [Cl.stringAscii("Unique Name"), Cl.stringAscii("UNQ1")],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(0));

      // Try duplicate name
      result = simnet.callPublicFn(
        "stablecoin-factory",
        "register-stablecoin",
        [Cl.stringAscii("Unique Name"), Cl.stringAscii("UNQ2")],
        wallet2
      );
      expect(result.result).toBeErr(Cl.uint(702)); // ERR_STABLECOIN_ALREADY_REGISTERED
    });

    it("rejects duplicate stablecoin symbol", () => {
      const { deployer, wallet1, wallet2 } = getTestAccounts();

      // Set fee to 0 for simplicity
      simnet.callPublicFn(
        "stablecoin-factory",
        "set-registration-fee",
        [Cl.uint(0)],
        deployer
      );

      // First registration
      let result = simnet.callPublicFn(
        "stablecoin-factory",
        "register-stablecoin",
        [Cl.stringAscii("First Coin"), Cl.stringAscii("SAME")],
        wallet1
      );
      expect(result.result).toBeOk(Cl.uint(0));

      // Try duplicate symbol
      result = simnet.callPublicFn(
        "stablecoin-factory",
        "register-stablecoin",
        [Cl.stringAscii("Second Coin"), Cl.stringAscii("SAME")],
        wallet2
      );
      expect(result.result).toBeErr(Cl.uint(702)); // ERR_STABLECOIN_ALREADY_REGISTERED
    });
  });
});

// ============================================
// Token Contract Linking Tests
// ============================================

describe("stablecoin-factory token linking", () => {
  it("allows creator to link token contract", () => {
    const { deployer, wallet1 } = getTestAccounts();
    const tokenContract = `${deployer}.stablecoin-token`;

    // Set fee to 0
    simnet.callPublicFn(
      "stablecoin-factory",
      "set-registration-fee",
      [Cl.uint(0)],
      deployer
    );

    // Register stablecoin
    simnet.callPublicFn(
      "stablecoin-factory",
      "register-stablecoin",
      [Cl.stringAscii("Linked Coin"), Cl.stringAscii("LINK")],
      wallet1
    );

    // Link token contract
    const result = simnet.callPublicFn(
      "stablecoin-factory",
      "set-token-contract",
      [Cl.uint(0), Cl.principal(tokenContract)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.bool(true));

    // Verify token contract was linked
    const stablecoin = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "get-stablecoin",
      [Cl.uint(0)],
      wallet1
    );
    expect(stablecoin.result).not.toBeNone();
  });

  it("rejects non-creator linking token contract", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    const tokenContract = `${deployer}.stablecoin-token`;

    // Set fee to 0
    simnet.callPublicFn(
      "stablecoin-factory",
      "set-registration-fee",
      [Cl.uint(0)],
      deployer
    );

    // Register stablecoin as wallet1
    simnet.callPublicFn(
      "stablecoin-factory",
      "register-stablecoin",
      [Cl.stringAscii("Creator Only"), Cl.stringAscii("CRTR")],
      wallet1
    );

    // Try to link as wallet2 (not creator)
    const result = simnet.callPublicFn(
      "stablecoin-factory",
      "set-token-contract",
      [Cl.uint(0), Cl.principal(tokenContract)],
      wallet2
    );
    expect(result.result).toBeErr(Cl.uint(700)); // ERR_UNAUTHORIZED
  });

  it("rejects linking to non-existent stablecoin", () => {
    const { deployer, wallet1 } = getTestAccounts();
    const tokenContract = `${deployer}.stablecoin-token`;

    const result = simnet.callPublicFn(
      "stablecoin-factory",
      "set-token-contract",
      [Cl.uint(999), Cl.principal(tokenContract)],
      wallet1
    );
    expect(result.result).toBeErr(Cl.uint(703)); // ERR_STABLECOIN_NOT_FOUND
  });
});

// ============================================
// Read-Only Functions Tests
// ============================================

describe("stablecoin-factory read-only functions", () => {
  it("returns correct stablecoin count", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();

    // Set fee to 0
    simnet.callPublicFn(
      "stablecoin-factory",
      "set-registration-fee",
      [Cl.uint(0)],
      deployer
    );

    // Initial count should be 0
    let count = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "get-stablecoin-count",
      [],
      deployer
    );
    expect(count.result).toBeUint(0);

    // Register two stablecoins
    simnet.callPublicFn(
      "stablecoin-factory",
      "register-stablecoin",
      [Cl.stringAscii("Coin One"), Cl.stringAscii("ONE")],
      wallet1
    );
    simnet.callPublicFn(
      "stablecoin-factory",
      "register-stablecoin",
      [Cl.stringAscii("Coin Two"), Cl.stringAscii("TWO")],
      wallet2
    );

    // Count should be 2
    count = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "get-stablecoin-count",
      [],
      deployer
    );
    expect(count.result).toBeUint(2);
  });

  it("looks up stablecoin by name", () => {
    const { deployer, wallet1 } = getTestAccounts();

    // Set fee to 0
    simnet.callPublicFn(
      "stablecoin-factory",
      "set-registration-fee",
      [Cl.uint(0)],
      deployer
    );

    // Register stablecoin
    simnet.callPublicFn(
      "stablecoin-factory",
      "register-stablecoin",
      [Cl.stringAscii("Lookup Test"), Cl.stringAscii("LOOK")],
      wallet1
    );

    // Lookup by name
    const result = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "get-stablecoin-by-name",
      [Cl.stringAscii("Lookup Test")],
      deployer
    );
    expect(result.result).not.toBeNone();

    // Non-existent name returns none
    const notFound = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "get-stablecoin-by-name",
      [Cl.stringAscii("Does Not Exist")],
      deployer
    );
    expect(notFound.result).toBeNone();
  });

  it("looks up stablecoin by symbol", () => {
    const { deployer, wallet1 } = getTestAccounts();

    // Set fee to 0
    simnet.callPublicFn(
      "stablecoin-factory",
      "set-registration-fee",
      [Cl.uint(0)],
      deployer
    );

    // Register stablecoin
    simnet.callPublicFn(
      "stablecoin-factory",
      "register-stablecoin",
      [Cl.stringAscii("Symbol Test"), Cl.stringAscii("SYM")],
      wallet1
    );

    // Lookup by symbol
    const result = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "get-stablecoin-by-symbol",
      [Cl.stringAscii("SYM")],
      deployer
    );
    expect(result.result).not.toBeNone();
  });

  it("checks if name/symbol is taken", () => {
    const { deployer, wallet1 } = getTestAccounts();

    // Set fee to 0
    simnet.callPublicFn(
      "stablecoin-factory",
      "set-registration-fee",
      [Cl.uint(0)],
      deployer
    );

    // Initially not taken
    let nameTaken = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "is-name-taken",
      [Cl.stringAscii("Check Name")],
      deployer
    );
    expect(nameTaken.result).toBeBool(false);

    let symbolTaken = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "is-symbol-taken",
      [Cl.stringAscii("CHK")],
      deployer
    );
    expect(symbolTaken.result).toBeBool(false);

    // Register stablecoin
    simnet.callPublicFn(
      "stablecoin-factory",
      "register-stablecoin",
      [Cl.stringAscii("Check Name"), Cl.stringAscii("CHK")],
      wallet1
    );

    // Now taken
    nameTaken = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "is-name-taken",
      [Cl.stringAscii("Check Name")],
      deployer
    );
    expect(nameTaken.result).toBeBool(true);

    symbolTaken = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "is-symbol-taken",
      [Cl.stringAscii("CHK")],
      deployer
    );
    expect(symbolTaken.result).toBeBool(true);
  });

  it("tracks creator stablecoins", () => {
    const { deployer, wallet1 } = getTestAccounts();

    // Set fee to 0
    simnet.callPublicFn(
      "stablecoin-factory",
      "set-registration-fee",
      [Cl.uint(0)],
      deployer
    );

    // Initial count for wallet1 should be 0
    let count = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "get-creator-stablecoin-count",
      [Cl.principal(wallet1)],
      deployer
    );
    expect(count.result).toBeUint(0);

    // Register two stablecoins as wallet1
    simnet.callPublicFn(
      "stablecoin-factory",
      "register-stablecoin",
      [Cl.stringAscii("Creator Coin 1"), Cl.stringAscii("CC1")],
      wallet1
    );
    simnet.callPublicFn(
      "stablecoin-factory",
      "register-stablecoin",
      [Cl.stringAscii("Creator Coin 2"), Cl.stringAscii("CC2")],
      wallet1
    );

    // Count should be 2
    count = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "get-creator-stablecoin-count",
      [Cl.principal(wallet1)],
      deployer
    );
    expect(count.result).toBeUint(2);

    // Get first stablecoin by index
    const first = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "get-creator-stablecoin-at-index",
      [Cl.principal(wallet1), Cl.uint(0)],
      deployer
    );
    expect(first.result).not.toBeNone();

    // Get second stablecoin by index
    const second = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "get-creator-stablecoin-at-index",
      [Cl.principal(wallet1), Cl.uint(1)],
      deployer
    );
    expect(second.result).not.toBeNone();
  });
});

// ============================================
// Fee Update Flow Tests
// ============================================

describe("stablecoin-factory fee update flow", () => {
  it("applies updated fee to new registrations", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();

    // Register first stablecoin with default fee
    const result1 = simnet.callPublicFn(
      "stablecoin-factory",
      "register-stablecoin",
      [Cl.stringAscii("Default Fee"), Cl.stringAscii("DFEE")],
      wallet1
    );
    expect(result1.result).toBeOk(Cl.uint(0));

    // Update fee to 5 STX
    simnet.callPublicFn(
      "stablecoin-factory",
      "set-registration-fee",
      [Cl.uint(5000000)],
      deployer
    );

    // Get wallet2 initial balance
    const initialBalance = simnet.getAssetsMap().get("STX")?.get(wallet2) || 0n;

    // Register second stablecoin with new fee
    const result2 = simnet.callPublicFn(
      "stablecoin-factory",
      "register-stablecoin",
      [Cl.stringAscii("New Fee"), Cl.stringAscii("NFEE")],
      wallet2
    );
    expect(result2.result).toBeOk(Cl.uint(1));

    // Verify new fee was charged
    const finalBalance = simnet.getAssetsMap().get("STX")?.get(wallet2) || 0n;
    expect(Number(initialBalance) - Number(finalBalance)).toBe(5000000);

    // Verify stablecoins were registered
    const stablecoin1 = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "get-stablecoin",
      [Cl.uint(0)],
      deployer
    );
    expect(stablecoin1.result).not.toBeNone();

    const stablecoin2 = simnet.callReadOnlyFn(
      "stablecoin-factory",
      "get-stablecoin",
      [Cl.uint(1)],
      deployer
    );
    expect(stablecoin2.result).not.toBeNone();
  });
});
