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

// Helper to create a 32-byte buffer for testing
function createTestBuffer32(value: number): Uint8Array {
  const buffer = new Uint8Array(32);
  buffer[31] = value; // Put value in last byte
  return buffer;
}

// ============================================
// Bridge Registry Tests
// ============================================

describe("bridge-registry-v4", () => {
  describe("chain management", () => {
    it("allows owner to add supported chains", () => {
      const { deployer } = getTestAccounts();

      const result = simnet.callPublicFn(
        "bridge-registry-v4",
        "add-chain",
        [Cl.uint(1), Cl.stringAscii("Ethereum Mainnet")],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      const chainInfo = simnet.callReadOnlyFn(
        "bridge-registry-v4",
        "get-chain-info",
        [Cl.uint(1)],
        deployer
      );
      expect(chainInfo.result).toBeSome(
        Cl.tuple({
          name: Cl.stringAscii("Ethereum Mainnet"),
          enabled: Cl.bool(true),
        })
      );
    });

    it("rejects non-owner chain additions", () => {
      const { wallet1 } = getTestAccounts();

      const result = simnet.callPublicFn(
        "bridge-registry-v4",
        "add-chain",
        [Cl.uint(1), Cl.stringAscii("Ethereum Mainnet")],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(600)); // ERR_UNAUTHORIZED
    });

    it("allows owner to disable chains", () => {
      const { deployer } = getTestAccounts();

      // First add a chain
      let result = simnet.callPublicFn(
        "bridge-registry-v4",
        "add-chain",
        [Cl.uint(11155111), Cl.stringAscii("Ethereum Sepolia")],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify it's supported
      let isSupported = simnet.callReadOnlyFn(
        "bridge-registry-v4",
        "is-chain-supported",
        [Cl.uint(11155111)],
        deployer
      );
      expect(isSupported.result).toBeBool(true);

      // Disable the chain
      result = simnet.callPublicFn(
        "bridge-registry-v4",
        "disable-chain",
        [Cl.uint(11155111)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify it's no longer supported
      isSupported = simnet.callReadOnlyFn(
        "bridge-registry-v4",
        "is-chain-supported",
        [Cl.uint(11155111)],
        deployer
      );
      expect(isSupported.result).toBeBool(false);
    });
  });

  describe("token registration", () => {
    it("allows owner to register tokens for bridging", () => {
      const { deployer } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;
      const adapterPrincipal = `${deployer}.stablecoin-factory-v4`; // Using another contract as mock adapter

      const result = simnet.callPublicFn(
        "bridge-registry-v4",
        "register-token",
        [Cl.principal(tokenPrincipal), Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      const isRegistered = simnet.callReadOnlyFn(
        "bridge-registry-v4",
        "is-token-registered",
        [Cl.principal(tokenPrincipal)],
        deployer
      );
      expect(isRegistered.result).toBeBool(true);
    });

    it("rejects duplicate token registration", () => {
      const { deployer } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;
      const adapterPrincipal = `${deployer}.stablecoin-factory-v4`;

      // First registration
      let result = simnet.callPublicFn(
        "bridge-registry-v4",
        "register-token",
        [Cl.principal(tokenPrincipal), Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Duplicate registration should fail
      result = simnet.callPublicFn(
        "bridge-registry-v4",
        "register-token",
        [Cl.principal(tokenPrincipal), Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeErr(Cl.uint(602)); // ERR_TOKEN_ALREADY_REGISTERED
    });

    it("allows owner to update token adapter", () => {
      const { deployer } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;
      const adapterPrincipal = `${deployer}.stablecoin-factory-v4`;
      const newAdapterPrincipal = `${deployer}.stability-pool-v6`; // Using another contract as mock

      // Register token
      let result = simnet.callPublicFn(
        "bridge-registry-v4",
        "register-token",
        [Cl.principal(tokenPrincipal), Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Update adapter
      result = simnet.callPublicFn(
        "bridge-registry-v4",
        "update-token-adapter",
        [Cl.principal(tokenPrincipal), Cl.principal(newAdapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify adapter was updated
      const adapter = simnet.callReadOnlyFn(
        "bridge-registry-v4",
        "get-token-adapter",
        [Cl.principal(tokenPrincipal)],
        deployer
      );
      expect(adapter.result).toBeSome(Cl.principal(newAdapterPrincipal));
    });

    it("allows owner to enable/disable tokens", () => {
      const { deployer } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;
      const adapterPrincipal = `${deployer}.stablecoin-factory-v4`;

      // Register token
      let result = simnet.callPublicFn(
        "bridge-registry-v4",
        "register-token",
        [Cl.principal(tokenPrincipal), Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify enabled by default
      let isEnabled = simnet.callReadOnlyFn(
        "bridge-registry-v4",
        "is-token-enabled",
        [Cl.principal(tokenPrincipal)],
        deployer
      );
      expect(isEnabled.result).toBeBool(true);

      // Disable token
      result = simnet.callPublicFn(
        "bridge-registry-v4",
        "set-token-enabled",
        [Cl.principal(tokenPrincipal), Cl.bool(false)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify disabled
      isEnabled = simnet.callReadOnlyFn(
        "bridge-registry-v4",
        "is-token-enabled",
        [Cl.principal(tokenPrincipal)],
        deployer
      );
      expect(isEnabled.result).toBeBool(false);
    });
  });

  describe("token chain configuration", () => {
    it("allows configuring token for specific chains", () => {
      const { deployer } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;
      const adapterPrincipal = `${deployer}.stablecoin-factory-v4`;
      const remoteAddress = createTestBuffer32(1);

      // Add chain first
      let result = simnet.callPublicFn(
        "bridge-registry-v4",
        "add-chain",
        [Cl.uint(1), Cl.stringAscii("Ethereum Mainnet")],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Register token
      result = simnet.callPublicFn(
        "bridge-registry-v4",
        "register-token",
        [Cl.principal(tokenPrincipal), Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Configure token for chain
      result = simnet.callPublicFn(
        "bridge-registry-v4",
        "configure-token-chain",
        [
          Cl.principal(tokenPrincipal),
          Cl.uint(1),
          Cl.buffer(remoteAddress),
          Cl.uint(1000000), // min amount
          Cl.uint(1000000000000), // max amount
        ],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify configuration
      const isEnabled = simnet.callReadOnlyFn(
        "bridge-registry-v4",
        "is-token-chain-enabled",
        [Cl.principal(tokenPrincipal), Cl.uint(1)],
        deployer
      );
      expect(isEnabled.result).toBeBool(true);
    });

    it("rejects chain config for unregistered tokens", () => {
      const { deployer } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token-v4`;
      const remoteAddress = createTestBuffer32(1);

      // Add chain
      let result = simnet.callPublicFn(
        "bridge-registry-v4",
        "add-chain",
        [Cl.uint(1), Cl.stringAscii("Ethereum Mainnet")],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Try to configure without registering token first
      result = simnet.callPublicFn(
        "bridge-registry-v4",
        "configure-token-chain",
        [
          Cl.principal(tokenPrincipal),
          Cl.uint(1),
          Cl.buffer(remoteAddress),
          Cl.uint(1000000),
          Cl.uint(1000000000000),
        ],
        deployer
      );
      expect(result.result).toBeErr(Cl.uint(601)); // ERR_TOKEN_NOT_REGISTERED
    });
  });
});

// ============================================
// Stablecoin Token Bridge Functions Tests
// ============================================

describe("stablecoin-token-v4 bridge functions", () => {
  describe("bridge adapter authorization", () => {
    it("allows owner to set bridge adapter", () => {
      const { deployer } = getTestAccounts();
      const adapterPrincipal = `${deployer}.stablecoin-factory-v4`; // Using as mock adapter

      const result = simnet.callPublicFn(
        "stablecoin-token-v4",
        "set-bridge-adapter",
        [Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      const adapter = simnet.callReadOnlyFn(
        "stablecoin-token-v4",
        "get-bridge-adapter",
        [],
        deployer
      );
      expect(adapter.result).toBeSome(Cl.principal(adapterPrincipal));
    });

    it("rejects non-owner bridge adapter changes", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const adapterPrincipal = `${deployer}.stablecoin-factory-v4`;

      const result = simnet.callPublicFn(
        "stablecoin-token-v4",
        "set-bridge-adapter",
        [Cl.principal(adapterPrincipal)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(401)); // ERR_UNAUTHORIZED
    });
  });

  describe("mint-from-bridge", () => {
    it("rejects mint from non-adapter", () => {
      const { deployer, wallet1 } = getTestAccounts();

      // Try to mint without being the adapter
      const result = simnet.callPublicFn(
        "stablecoin-token-v4",
        "mint-from-bridge",
        [Cl.uint(1000000), Cl.principal(wallet1)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(401)); // ERR_UNAUTHORIZED
    });
  });

  describe("burn-to-remote", () => {
    it("rejects burn from non-adapter", () => {
      const { wallet1 } = getTestAccounts();
      const remoteRecipient = createTestBuffer32(1);

      // Try to burn without being the adapter
      const result = simnet.callPublicFn(
        "stablecoin-token-v4",
        "burn-to-remote",
        [
          Cl.uint(1000000),
          Cl.principal(wallet1),
          Cl.buffer(remoteRecipient),
          Cl.uint(1),
        ],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(401)); // ERR_UNAUTHORIZED
    });
  });
});
