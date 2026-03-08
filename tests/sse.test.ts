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

function authorizeVaultEngine(deployer: string) {
  const vaultEnginePrincipal = `${deployer}.vault-engine`;
  const result = simnet.callPublicFn(
    "stablecoin-token",
    "set-vault-engine",
    [Cl.principal(vaultEnginePrincipal)],
    deployer
  );
  expect(result.result).toBeOk(Cl.bool(true));
}

describe("stablecoin-token hardening", () => {
  it("returns expected SIP-010 metadata responses", () => {
    const { deployer } = getTestAccounts();

    const name = simnet.callReadOnlyFn("stablecoin-token", "get-name", [], deployer);
    expect(name.result).toBeOk(Cl.stringAscii("SSE Stablecoin"));

    const symbol = simnet.callReadOnlyFn("stablecoin-token", "get-symbol", [], deployer);
    expect(symbol.result).toBeOk(Cl.stringAscii("SSEUSD"));

    const decimals = simnet.callReadOnlyFn("stablecoin-token", "get-decimals", [], deployer);
    expect(decimals.result).toBeOk(Cl.uint(6));

    const tokenUri = simnet.callReadOnlyFn("stablecoin-token", "get-token-uri", [], deployer);
    expect(tokenUri.result).toBeOk(Cl.none());
  });

  it("only allows contract owner to set vault-engine", () => {
    const { deployer, wallet1 } = getTestAccounts();
    const vaultEnginePrincipal = `${deployer}.vault-engine`;

    const unauthorized = simnet.callPublicFn(
      "stablecoin-token",
      "set-vault-engine",
      [Cl.principal(vaultEnginePrincipal)],
      wallet1
    );
    expect(unauthorized.result).toBeErr(Cl.uint(401));

    const authorized = simnet.callPublicFn(
      "stablecoin-token",
      "set-vault-engine",
      [Cl.principal(vaultEnginePrincipal)],
      deployer
    );
    expect(authorized.result).toBeOk(Cl.bool(true));
  });

  it("runs vault lifecycle end-to-end and tracks total supply", () => {
    const { deployer, wallet1 } = getTestAccounts();
    authorizeVaultEngine(deployer);

    const directMint = simnet.callPublicFn(
      "stablecoin-token",
      "mint",
      [Cl.uint(100), Cl.principal(wallet1)],
      deployer
    );
    expect(directMint.result).toBeErr(Cl.uint(401));

    let result = simnet.callPublicFn("vault-engine", "open-vault", [], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      "vault-engine",
      "deposit-collateral",
      [Cl.uint(1200)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(1200));

    result = simnet.callPublicFn("vault-engine", "mint", [Cl.uint(600)], wallet1);
    expect(result.result).toBeOk(Cl.uint(600));

    const totalSupplyAfterMint = simnet.callReadOnlyFn(
      "stablecoin-token",
      "get-total-supply",
      [],
      wallet1
    );
    expect(totalSupplyAfterMint.result).toBeOk(Cl.uint(600));

    const directBurn = simnet.callPublicFn(
      "stablecoin-token",
      "burn",
      [Cl.uint(50), Cl.principal(wallet1)],
      deployer
    );
    expect(directBurn.result).toBeErr(Cl.uint(401));

    result = simnet.callPublicFn("vault-engine", "burn", [Cl.uint(200)], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      "vault-engine",
      "withdraw-collateral",
      [Cl.uint(300)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(900));

    const balance = simnet.callReadOnlyFn(
      "stablecoin-token",
      "get-balance",
      [Cl.principal(wallet1)],
      wallet1
    );
    expect(balance.result).toBeOk(Cl.uint(400));

    const totalSupplyAfterBurn = simnet.callReadOnlyFn(
      "stablecoin-token",
      "get-total-supply",
      [],
      wallet1
    );
    expect(totalSupplyAfterBurn.result).toBeOk(Cl.uint(400));

    const health = simnet.callReadOnlyFn(
      "vault-engine",
      "get-health-factor",
      [Cl.principal(wallet1)],
      wallet1
    );
    expect(health.result).toBeUint(225);
  });

  it("rejects minting that would break minimum health factor", () => {
    const { deployer, wallet1 } = getTestAccounts();
    authorizeVaultEngine(deployer);

    let result = simnet.callPublicFn("vault-engine", "open-vault", [], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      "vault-engine",
      "deposit-collateral",
      [Cl.uint(1000)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(1000));

    result = simnet.callPublicFn("vault-engine", "mint", [Cl.uint(700)], wallet1);
    expect(result.result).toBeErr(Cl.uint(204));

    const balance = simnet.callReadOnlyFn(
      "stablecoin-token",
      "get-balance",
      [Cl.principal(wallet1)],
      wallet1
    );
    expect(balance.result).toBeOk(Cl.uint(0));

    const totalSupply = simnet.callReadOnlyFn(
      "stablecoin-token",
      "get-total-supply",
      [],
      wallet1
    );
    expect(totalSupply.result).toBeOk(Cl.uint(0));
  });
});

describe("oracle integration", () => {
  it("enforces set-price admin gating and returns updated price", () => {
    const { deployer, wallet1 } = getTestAccounts();

    const unauthorized = simnet.callPublicFn(
      "price-oracle-mock",
      "set-price",
      [Cl.uint(90000000)],
      wallet1
    );
    expect(unauthorized.result).toBeErr(Cl.uint(600));

    const authorized = simnet.callPublicFn(
      "price-oracle-mock",
      "set-price",
      [Cl.uint(90000000)],
      deployer
    );
    expect(authorized.result).toBeOk(Cl.bool(true));

    const price = simnet.callReadOnlyFn("price-oracle-mock", "get-price", [], deployer);
    expect(price.result).toBeOk(Cl.uint(90000000));
  });

  it("updates vault health factor when oracle price changes", () => {
    const { deployer, wallet1 } = getTestAccounts();
    authorizeVaultEngine(deployer);

    let result = simnet.callPublicFn("vault-engine", "open-vault", [], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      "vault-engine",
      "deposit-collateral",
      [Cl.uint(1200)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(1200));

    result = simnet.callPublicFn("vault-engine", "mint", [Cl.uint(600)], wallet1);
    expect(result.result).toBeOk(Cl.uint(600));

    const healthBefore = simnet.callReadOnlyFn(
      "vault-engine",
      "get-health-factor",
      [Cl.principal(wallet1)],
      wallet1
    );
    expect(healthBefore.result).toBeUint(200);

    result = simnet.callPublicFn(
      "price-oracle-mock",
      "set-price",
      [Cl.uint(50000000)],
      deployer
    );
    expect(result.result).toBeOk(Cl.bool(true));

    const healthAfter = simnet.callReadOnlyFn(
      "vault-engine",
      "get-health-factor",
      [Cl.principal(wallet1)],
      wallet1
    );
    expect(healthAfter.result).toBeUint(100);

    const unsafeMint = simnet.callPublicFn("vault-engine", "mint", [Cl.uint(1)], wallet1);
    expect(unsafeMint.result).toBeErr(Cl.uint(204));

    const unsafeWithdraw = simnet.callPublicFn(
      "vault-engine",
      "withdraw-collateral",
      [Cl.uint(1)],
      wallet1
    );
    expect(unsafeWithdraw.result).toBeErr(Cl.uint(204));
  });
});

describe("stability-pool ledger", () => {
  it("tracks deposit and withdraw balances with insufficient-balance guard", () => {
    const { wallet1 } = getTestAccounts();

    let result = simnet.callPublicFn("stability-pool", "deposit", [Cl.uint(500)], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));

    let balance = simnet.callReadOnlyFn(
      "stability-pool",
      "balance-of",
      [Cl.principal(wallet1)],
      wallet1
    );
    expect(balance.result).toBeUint(500);

    result = simnet.callPublicFn("stability-pool", "withdraw", [Cl.uint(200)], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));

    balance = simnet.callReadOnlyFn(
      "stability-pool",
      "balance-of",
      [Cl.principal(wallet1)],
      wallet1
    );
    expect(balance.result).toBeUint(300);

    result = simnet.callPublicFn("stability-pool", "withdraw", [Cl.uint(400)], wallet1);
    expect(result.result).toBeErr(Cl.uint(500));
  });
});

describe("liquidation-engine stub", () => {
  it("returns explicit error for healthy vaults", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    authorizeVaultEngine(deployer);

    let result = simnet.callPublicFn("vault-engine", "open-vault", [], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      "vault-engine",
      "deposit-collateral",
      [Cl.uint(1200)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(1200));

    result = simnet.callPublicFn("vault-engine", "mint", [Cl.uint(600)], wallet1);
    expect(result.result).toBeOk(Cl.uint(600));

    const liquidation = simnet.callPublicFn(
      "liquidation-engine",
      "liquidate",
      [Cl.principal(wallet1)],
      wallet2
    );
    expect(liquidation.result).toBeErr(Cl.uint(300));
  });

  it("returns ok for undercollateralized vaults after price drop", () => {
    const { deployer, wallet1, wallet2 } = getTestAccounts();
    authorizeVaultEngine(deployer);

    let result = simnet.callPublicFn("vault-engine", "open-vault", [], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      "vault-engine",
      "deposit-collateral",
      [Cl.uint(1200)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(1200));

    result = simnet.callPublicFn("vault-engine", "mint", [Cl.uint(600)], wallet1);
    expect(result.result).toBeOk(Cl.uint(600));

    result = simnet.callPublicFn(
      "price-oracle-mock",
      "set-price",
      [Cl.uint(50000000)],
      deployer
    );
    expect(result.result).toBeOk(Cl.bool(true));

    const liquidation = simnet.callPublicFn(
      "liquidation-engine",
      "liquidate",
      [Cl.principal(wallet1)],
      wallet2
    );
    expect(liquidation.result).toBeOk(Cl.bool(true));
  });
});

describe("collateral-registry config flow", () => {
  it("supports owner add/get and rejects non-owner writes", () => {
    const { deployer, wallet1 } = getTestAccounts();
    const assetPrincipal = `${deployer}.stablecoin-token`;

    const unauthorized = simnet.callPublicFn(
      "collateral-registry",
      "add-collateral-type",
      [Cl.principal(assetPrincipal), Cl.uint(150), Cl.uint(10), Cl.uint(1000000)],
      wallet1
    );
    expect(unauthorized.result).toBeErr(Cl.uint(100));

    const authorized = simnet.callPublicFn(
      "collateral-registry",
      "add-collateral-type",
      [Cl.principal(assetPrincipal), Cl.uint(150), Cl.uint(10), Cl.uint(1000000)],
      deployer
    );
    expect(authorized.result).toBeOk(Cl.bool(true));

    const config = simnet.callReadOnlyFn(
      "collateral-registry",
      "get-collateral-config",
      [Cl.principal(assetPrincipal)],
      deployer
    );
    expect(config.result).toBeSome(
      Cl.tuple({
        "min-collateral-ratio": Cl.uint(150),
        "liquidation-penalty": Cl.uint(10),
        "debt-ceiling": Cl.uint(1000000),
      })
    );
  });
});
