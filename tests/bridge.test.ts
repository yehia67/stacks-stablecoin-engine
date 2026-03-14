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

describe("bridge-registry", () => {
  describe("chain management", () => {
    it("allows owner to add supported chains", () => {
      const { deployer } = getTestAccounts();

      const result = simnet.callPublicFn(
        "bridge-registry",
        "add-chain",
        [Cl.uint(1), Cl.stringAscii("Ethereum Mainnet")],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      const chainInfo = simnet.callReadOnlyFn(
        "bridge-registry",
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
        "bridge-registry",
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
        "bridge-registry",
        "add-chain",
        [Cl.uint(11155111), Cl.stringAscii("Ethereum Sepolia")],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify it's supported
      let isSupported = simnet.callReadOnlyFn(
        "bridge-registry",
        "is-chain-supported",
        [Cl.uint(11155111)],
        deployer
      );
      expect(isSupported.result).toBeBool(true);

      // Disable the chain
      result = simnet.callPublicFn(
        "bridge-registry",
        "disable-chain",
        [Cl.uint(11155111)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify it's no longer supported
      isSupported = simnet.callReadOnlyFn(
        "bridge-registry",
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
      const tokenPrincipal = `${deployer}.stablecoin-token`;
      const adapterPrincipal = `${deployer}.xreserve-adapter`;

      const result = simnet.callPublicFn(
        "bridge-registry",
        "register-token",
        [Cl.principal(tokenPrincipal), Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      const isRegistered = simnet.callReadOnlyFn(
        "bridge-registry",
        "is-token-registered",
        [Cl.principal(tokenPrincipal)],
        deployer
      );
      expect(isRegistered.result).toBeBool(true);
    });

    it("rejects duplicate token registration", () => {
      const { deployer } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token`;
      const adapterPrincipal = `${deployer}.xreserve-adapter`;

      // First registration
      let result = simnet.callPublicFn(
        "bridge-registry",
        "register-token",
        [Cl.principal(tokenPrincipal), Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Duplicate registration should fail
      result = simnet.callPublicFn(
        "bridge-registry",
        "register-token",
        [Cl.principal(tokenPrincipal), Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeErr(Cl.uint(602)); // ERR_TOKEN_ALREADY_REGISTERED
    });

    it("allows owner to update token adapter", () => {
      const { deployer } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token`;
      const adapterPrincipal = `${deployer}.xreserve-adapter`;
      const newAdapterPrincipal = `${deployer}.stability-pool`; // Using another contract as mock

      // Register token
      let result = simnet.callPublicFn(
        "bridge-registry",
        "register-token",
        [Cl.principal(tokenPrincipal), Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Update adapter
      result = simnet.callPublicFn(
        "bridge-registry",
        "update-token-adapter",
        [Cl.principal(tokenPrincipal), Cl.principal(newAdapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify adapter was updated
      const adapter = simnet.callReadOnlyFn(
        "bridge-registry",
        "get-token-adapter",
        [Cl.principal(tokenPrincipal)],
        deployer
      );
      expect(adapter.result).toBeSome(Cl.principal(newAdapterPrincipal));
    });

    it("allows owner to enable/disable tokens", () => {
      const { deployer } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token`;
      const adapterPrincipal = `${deployer}.xreserve-adapter`;

      // Register token
      let result = simnet.callPublicFn(
        "bridge-registry",
        "register-token",
        [Cl.principal(tokenPrincipal), Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify enabled by default
      let isEnabled = simnet.callReadOnlyFn(
        "bridge-registry",
        "is-token-enabled",
        [Cl.principal(tokenPrincipal)],
        deployer
      );
      expect(isEnabled.result).toBeBool(true);

      // Disable token
      result = simnet.callPublicFn(
        "bridge-registry",
        "set-token-enabled",
        [Cl.principal(tokenPrincipal), Cl.bool(false)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Verify disabled
      isEnabled = simnet.callReadOnlyFn(
        "bridge-registry",
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
      const tokenPrincipal = `${deployer}.stablecoin-token`;
      const adapterPrincipal = `${deployer}.xreserve-adapter`;
      const remoteAddress = createTestBuffer32(1);

      // Add chain first
      let result = simnet.callPublicFn(
        "bridge-registry",
        "add-chain",
        [Cl.uint(1), Cl.stringAscii("Ethereum Mainnet")],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Register token
      result = simnet.callPublicFn(
        "bridge-registry",
        "register-token",
        [Cl.principal(tokenPrincipal), Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Configure token for chain
      result = simnet.callPublicFn(
        "bridge-registry",
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
        "bridge-registry",
        "is-token-chain-enabled",
        [Cl.principal(tokenPrincipal), Cl.uint(1)],
        deployer
      );
      expect(isEnabled.result).toBeBool(true);
    });

    it("rejects chain config for unregistered tokens", () => {
      const { deployer } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token`;
      const remoteAddress = createTestBuffer32(1);

      // Add chain
      let result = simnet.callPublicFn(
        "bridge-registry",
        "add-chain",
        [Cl.uint(1), Cl.stringAscii("Ethereum Mainnet")],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      // Try to configure without registering token first
      result = simnet.callPublicFn(
        "bridge-registry",
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
// xReserve Adapter Tests
// ============================================

describe("xreserve-adapter", () => {
  describe("admin functions", () => {
    it("allows owner to set attestation service", () => {
      const { deployer, wallet1 } = getTestAccounts();

      const result = simnet.callPublicFn(
        "xreserve-adapter",
        "set-attestation-service",
        [Cl.principal(wallet1)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      const service = simnet.callReadOnlyFn(
        "xreserve-adapter",
        "get-attestation-service",
        [],
        deployer
      );
      expect(service.result).toBeSome(Cl.principal(wallet1));
    });

    it("rejects non-owner attestation service changes", () => {
      const { wallet1, wallet2 } = getTestAccounts();

      const result = simnet.callPublicFn(
        "xreserve-adapter",
        "set-attestation-service",
        [Cl.principal(wallet2)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(500)); // ERR_UNAUTHORIZED
    });

    it("allows owner to set bridged token", () => {
      const { deployer } = getTestAccounts();
      const tokenPrincipal = `${deployer}.stablecoin-token`;

      const result = simnet.callPublicFn(
        "xreserve-adapter",
        "set-bridged-token",
        [Cl.principal(tokenPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      const token = simnet.callReadOnlyFn(
        "xreserve-adapter",
        "get-bridged-token",
        [],
        deployer
      );
      expect(token.result).toBeSome(Cl.principal(tokenPrincipal));
    });

    it("allows owner to pause/unpause", () => {
      const { deployer } = getTestAccounts();

      // Pause
      let result = simnet.callPublicFn(
        "xreserve-adapter",
        "set-paused",
        [Cl.bool(true)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      let paused = simnet.callReadOnlyFn(
        "xreserve-adapter",
        "get-paused",
        [],
        deployer
      );
      expect(paused.result).toBeBool(true);

      // Unpause
      result = simnet.callPublicFn(
        "xreserve-adapter",
        "set-paused",
        [Cl.bool(false)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      paused = simnet.callReadOnlyFn(
        "xreserve-adapter",
        "get-paused",
        [],
        deployer
      );
      expect(paused.result).toBeBool(false);
    });

    it("allows owner to add supported chains", () => {
      const { deployer } = getTestAccounts();

      const result = simnet.callPublicFn(
        "xreserve-adapter",
        "add-supported-chain",
        [Cl.uint(1), Cl.stringAscii("Ethereum Mainnet")],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      const isSupported = simnet.callReadOnlyFn(
        "xreserve-adapter",
        "is-chain-supported",
        [Cl.uint(1)],
        deployer
      );
      expect(isSupported.result).toBeBool(true);
    });
  });

  describe("burn-to-remote", () => {
    it("rejects burn when paused", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const remoteRecipient = createTestBuffer32(1);

      // Setup: add chain
      simnet.callPublicFn(
        "xreserve-adapter",
        "add-supported-chain",
        [Cl.uint(1), Cl.stringAscii("Ethereum")],
        deployer
      );

      // Pause the adapter
      simnet.callPublicFn(
        "xreserve-adapter",
        "set-paused",
        [Cl.bool(true)],
        deployer
      );

      // Try to burn
      const result = simnet.callPublicFn(
        "xreserve-adapter",
        "burn-to-remote",
        [Cl.uint(1000000), Cl.buffer(remoteRecipient), Cl.uint(1)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(503)); // ERR_PAUSED
    });

    it("rejects burn to unsupported chain", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const remoteRecipient = createTestBuffer32(1);

      // Try to burn to unsupported chain (chain 999 not added)
      const result = simnet.callPublicFn(
        "xreserve-adapter",
        "burn-to-remote",
        [Cl.uint(1000000), Cl.buffer(remoteRecipient), Cl.uint(999)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(501)); // ERR_INVALID_CHAIN
    });

    it("rejects burn with zero amount", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const remoteRecipient = createTestBuffer32(1);

      // Setup: add chain
      simnet.callPublicFn(
        "xreserve-adapter",
        "add-supported-chain",
        [Cl.uint(1), Cl.stringAscii("Ethereum")],
        deployer
      );

      // Try to burn zero amount
      const result = simnet.callPublicFn(
        "xreserve-adapter",
        "burn-to-remote",
        [Cl.uint(0), Cl.buffer(remoteRecipient), Cl.uint(1)],
        wallet1
      );
      expect(result.result).toBeErr(Cl.uint(502)); // ERR_INVALID_AMOUNT
    });
  });
});

// ============================================
// Stablecoin Token Bridge Functions Tests
// ============================================

describe("stablecoin-token bridge functions", () => {
  describe("bridge adapter authorization", () => {
    it("allows owner to set bridge adapter", () => {
      const { deployer } = getTestAccounts();
      const adapterPrincipal = `${deployer}.xreserve-adapter`;

      const result = simnet.callPublicFn(
        "stablecoin-token",
        "set-bridge-adapter",
        [Cl.principal(adapterPrincipal)],
        deployer
      );
      expect(result.result).toBeOk(Cl.bool(true));

      const adapter = simnet.callReadOnlyFn(
        "stablecoin-token",
        "get-bridge-adapter",
        [],
        deployer
      );
      expect(adapter.result).toBeSome(Cl.principal(adapterPrincipal));
    });

    it("rejects non-owner bridge adapter changes", () => {
      const { deployer, wallet1 } = getTestAccounts();
      const adapterPrincipal = `${deployer}.xreserve-adapter`;

      const result = simnet.callPublicFn(
        "stablecoin-token",
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
        "stablecoin-token",
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
        "stablecoin-token",
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
