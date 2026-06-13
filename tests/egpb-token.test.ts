// Tests for egpb-token-v1 (EGP Bond A — owner-gated mint/burn SIP-010) and
// price-oracle-egpb-v1 (constant $1 oracle), plus the end-to-end EGPB vault
// flow on multi-asset-vault-engine-v8. Mirrors the vGLD coverage in
// tests/vault-engine-v8.test.ts but with owner-gated mint instead of faucet.

import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

function getTestAccounts() {
  const accounts = simnet.getAccounts();
  const deployer = accounts.get("deployer")!;
  const wallet1 = accounts.get("wallet_1")!;
  const wallet2 = accounts.get("wallet_2")!;
  return { deployer, wallet1, wallet2 };
}

describe("price-oracle-egpb-v1: constant $1 oracle", () => {
  it("returns u100000000 (= $1.00 at 8-decimal PRICE-SCALE)", () => {
    const { wallet1 } = getTestAccounts();
    const price = simnet.callReadOnlyFn("price-oracle-egpb-v1", "get-price", [], wallet1);
    expect(price.result).toBeOk(Cl.uint(100_000_000));
  });
});

describe("egpb-token-v1: owner-gated mint/burn SIP-010", () => {
  it("exposes correct SIP-010 metadata", () => {
    const { wallet1 } = getTestAccounts();
    expect(simnet.callReadOnlyFn("egpb-token-v1", "get-name", [], wallet1).result)
      .toBeOk(Cl.stringAscii("EGP Bond A"));
    expect(simnet.callReadOnlyFn("egpb-token-v1", "get-symbol", [], wallet1).result)
      .toBeOk(Cl.stringAscii("EGPB"));
    expect(simnet.callReadOnlyFn("egpb-token-v1", "get-decimals", [], wallet1).result)
      .toBeOk(Cl.uint(8));
  });

  it("owner (deployer) can mint; non-owner cannot", () => {
    const { deployer, wallet1 } = getTestAccounts();

    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "mint",
        [Cl.uint(1000_00000000), Cl.principal(wallet1)],
        deployer
      ).result
    ).toBeOk(Cl.bool(true));

    expect(
      simnet.callReadOnlyFn("egpb-token-v1", "get-balance", [Cl.principal(wallet1)], wallet1)
        .result
    ).toBeOk(Cl.uint(1000_00000000));

    // Non-owner mint must fail with ERR_UNAUTHORIZED (u401).
    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "mint",
        [Cl.uint(1_00000000), Cl.principal(wallet1)],
        wallet1
      ).result
    ).toBeErr(Cl.uint(401));
  });

  it("owner can burn own balance; non-owner cannot burn", () => {
    const { deployer, wallet1 } = getTestAccounts();

    simnet.callPublicFn(
      "egpb-token-v1",
      "mint",
      [Cl.uint(500_00000000), Cl.principal(deployer)],
      deployer
    );

    expect(
      simnet.callPublicFn("egpb-token-v1", "burn", [Cl.uint(200_00000000)], deployer).result
    ).toBeOk(Cl.bool(true));

    expect(
      simnet.callReadOnlyFn("egpb-token-v1", "get-balance", [Cl.principal(deployer)], deployer)
        .result
    ).toBeOk(Cl.uint(300_00000000));

    // Non-owner burn must fail even if they hold tokens.
    simnet.callPublicFn(
      "egpb-token-v1",
      "mint",
      [Cl.uint(10_00000000), Cl.principal(wallet1)],
      deployer
    );
    expect(
      simnet.callPublicFn("egpb-token-v1", "burn", [Cl.uint(1_00000000)], wallet1).result
    ).toBeErr(Cl.uint(401));
  });

  it("transfer requires tx-sender to be the sender", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    simnet.callPublicFn(
      "egpb-token-v1",
      "mint",
      [Cl.uint(100_00000000), Cl.principal(wallet1)],
      deployer
    );

    // wallet2 attempting to move wallet1's tokens -> u401.
    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "transfer",
        [Cl.uint(1_00000000), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()],
        wallet2
      ).result
    ).toBeErr(Cl.uint(401));

    // wallet1 moving own tokens -> ok.
    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "transfer",
        [Cl.uint(1_00000000), Cl.principal(wallet1), Cl.principal(wallet2), Cl.none()],
        wallet1
      ).result
    ).toBeOk(Cl.bool(true));
  });

  it("set-owner hands off mint authority; old owner locked out", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();

    // Non-owner cannot set-owner.
    expect(
      simnet.callPublicFn("egpb-token-v1", "set-owner", [Cl.principal(wallet1)], wallet1).result
    ).toBeErr(Cl.uint(401));

    // Owner hands off to wallet1.
    expect(
      simnet.callPublicFn("egpb-token-v1", "set-owner", [Cl.principal(wallet1)], deployer).result
    ).toBeOk(Cl.bool(true));

    // New owner mints; old owner rejected.
    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "mint",
        [Cl.uint(1_00000000), Cl.principal(wallet2)],
        wallet1
      ).result
    ).toBeOk(Cl.bool(true));
    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "mint",
        [Cl.uint(1_00000000), Cl.principal(wallet2)],
        deployer
      ).result
    ).toBeErr(Cl.uint(401));
  });
});

// ── e2e helpers (mirrors tests/vault-engine-v8.test.ts) ─────────────────────

function authorizeV8VaultEngine(deployer: string) {
  const enginePrincipal = `${deployer}.multi-asset-vault-engine-v8`;
  expect(
    simnet.callPublicFn(
      "stablecoin-token-v4",
      "set-vault-engine",
      [Cl.principal(enginePrincipal)],
      deployer
    ).result
  ).toBeOk(Cl.bool(true));
  expect(
    simnet.callPublicFn(
      "collateral-registry-v6",
      "set-vault-engine-authorized",
      [Cl.principal(enginePrincipal), Cl.bool(true)],
      deployer
    ).result
  ).toBeOk(Cl.bool(true));
}

function registerSid0Stablecoin(deployer: string, creator: string) {
  expect(
    simnet.callPublicFn(
      "stablecoin-factory-v4",
      "set-registration-fee",
      [Cl.uint(0)],
      deployer
    ).result
  ).toBeOk(Cl.bool(true));
  expect(
    simnet.callPublicFn(
      "stablecoin-factory-v4",
      "register-stablecoin",
      [Cl.stringAscii("Test"), Cl.stringAscii("TEST")],
      creator
    ).result
  ).toBeOk(Cl.uint(0));
  expect(
    simnet.callPublicFn(
      "stablecoin-factory-v4",
      "set-token-contract",
      [Cl.uint(0), Cl.principal(`${deployer}.stablecoin-token-v4`)],
      creator
    ).result
  ).toBeOk(Cl.bool(true));
}

function addEgpbCollateral(deployer: string, creator: string) {
  const asset = `${deployer}.egpb-token-v1`;
  const oracle = `${deployer}.price-oracle-egpb-v1`;
  // Mainnet risk profile per docs/plans/add-egpb-collateral.md §4.
  const params = [
    Cl.uint(150),
    Cl.uint(120),
    Cl.uint(10),
    Cl.uint(200),
    Cl.uint(100_000_000_000),
    Cl.uint(10_000_000),
  ];
  expect(
    simnet.callPublicFn(
      "collateral-registry-v6",
      "add-collateral-type",
      [Cl.principal(asset), ...params, Cl.principal(oracle)],
      deployer
    ).result
  ).toBeOk(Cl.bool(true));
  expect(
    simnet.callPublicFn(
      "collateral-registry-v6",
      "configure-collateral-for-stablecoin",
      [Cl.uint(0), Cl.principal(asset), ...params],
      creator
    ).result
  ).toBeOk(Cl.bool(true));
}

describe("EGPB end-to-end on multi-asset-vault-engine-v8", () => {
  it("full lifecycle: owner mints EGPB -> deposit -> mint stablecoin -> repay -> withdraw", () => {
    const { deployer, wallet1 } = getTestAccounts();
    authorizeV8VaultEngine(deployer);
    registerSid0Stablecoin(deployer, wallet1);
    addEgpbCollateral(deployer, wallet1);

    const egpb = `${deployer}.egpb-token-v1`;
    const egpbOracle = `${deployer}.price-oracle-egpb-v1`;

    // Owner issues 1000 EGPB ($1000 collateral, 8 decimals) to wallet1.
    expect(
      simnet.callPublicFn(
        "egpb-token-v1",
        "mint",
        [Cl.uint(1000_00000000), Cl.principal(wallet1)],
        deployer
      ).result
    ).toBeOk(Cl.bool(true));

    expect(
      simnet.callPublicFn("multi-asset-vault-engine-v8", "open-vault", [], wallet1).result
    ).toBeOk(Cl.bool(true));

    expect(
      simnet.callPublicFn(
        "multi-asset-vault-engine-v8",
        "deposit-collateral",
        [Cl.principal(egpb), Cl.principal(egpb), Cl.uint(1000_00000000)],
        wallet1
      ).result
    ).toBeOk(Cl.uint(1000_00000000));

    // At 150% min-CR, $1000 collateral supports ~$666; floor is 10. Mint 100.
    expect(
      simnet.callPublicFn(
        "multi-asset-vault-engine-v8",
        "mint-against-asset",
        [Cl.principal(egpb), Cl.principal(egpbOracle), Cl.uint(100_000_000)],
        wallet1
      ).result
    ).toBeOk(Cl.uint(100_000_000));

    // Health factor at constant $1 price (same math as the vGLD case):
    // collateral_value = 100_000_000_000 * 100_000_000 / 1e8 = 100_000_000_000
    // hf = (100_000_000_000 * 10000) / (100_000_000 * 150) = 66_666
    expect(
      simnet.callReadOnlyFn(
        "multi-asset-vault-engine-v8",
        "get-position-health-factor",
        [Cl.principal(wallet1), Cl.principal(egpb), Cl.uint(100_000_000)],
        wallet1
      ).result
    ).toBeUint(66666);

    // Repay all debt, withdraw all collateral.
    expect(
      simnet.callPublicFn(
        "multi-asset-vault-engine-v8",
        "repay-against-asset",
        [Cl.principal(egpb), Cl.uint(100_000_000)],
        wallet1
      ).result
    ).toBeOk(Cl.uint(0));
    expect(
      simnet.callPublicFn(
        "multi-asset-vault-engine-v8",
        "withdraw-collateral",
        [Cl.principal(egpb), Cl.principal(egpb), Cl.principal(egpbOracle), Cl.uint(1000_00000000)],
        wallet1
      ).result
    ).toBeOk(Cl.uint(0));
  });

  it("rejects mint with a mismatched oracle (registry validation)", () => {
    const { deployer, wallet1 } = getTestAccounts();
    authorizeV8VaultEngine(deployer);
    registerSid0Stablecoin(deployer, wallet1);
    addEgpbCollateral(deployer, wallet1);

    const egpb = `${deployer}.egpb-token-v1`;
    const wrongOracle = `${deployer}.price-oracle-vgld-v1`; // also $1, but NOT registered for EGPB

    simnet.callPublicFn(
      "egpb-token-v1",
      "mint",
      [Cl.uint(1000_00000000), Cl.principal(wallet1)],
      deployer
    );
    simnet.callPublicFn("multi-asset-vault-engine-v8", "open-vault", [], wallet1);
    simnet.callPublicFn(
      "multi-asset-vault-engine-v8",
      "deposit-collateral",
      [Cl.principal(egpb), Cl.principal(egpb), Cl.uint(1000_00000000)],
      wallet1
    );

    // Wrong oracle -> registry mismatch -> price u0 -> ERR_UNSAFE_HEALTH_FACTOR (u204).
    expect(
      simnet.callPublicFn(
        "multi-asset-vault-engine-v8",
        "mint-against-asset",
        [Cl.principal(egpb), Cl.principal(wrongOracle), Cl.uint(100_000_000)],
        wallet1
      ).result
    ).toBeErr(Cl.uint(204));
  });
});
