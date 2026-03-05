import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

describe("stablecoin-token hardening", () => {
  it("returns expected SIP-010 metadata responses", () => {
    const accounts = simnet.getAccounts();
    const deployer = accounts.get("deployer");

    if (!deployer) {
      throw new Error("Missing deployer account");
    }

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
    const accounts = simnet.getAccounts();
    const deployer = accounts.get("deployer");
    const wallet1 = accounts.get("wallet_1");

    if (!deployer || !wallet1) {
      throw new Error("Missing default simnet accounts");
    }

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
    const accounts = simnet.getAccounts();
    const deployer = accounts.get("deployer");
    const wallet1 = accounts.get("wallet_1");

    if (!deployer || !wallet1) {
      throw new Error("Missing default simnet accounts");
    }

    const vaultEnginePrincipal = `${deployer}.vault-engine`;

    let result = simnet.callPublicFn(
      "stablecoin-token",
      "set-vault-engine",
      [Cl.principal(vaultEnginePrincipal)],
      deployer
    );
    expect(result.result).toBeOk(Cl.bool(true));

    const directMint = simnet.callPublicFn(
      "stablecoin-token",
      "mint",
      [Cl.uint(100), Cl.principal(wallet1)],
      deployer
    );
    expect(directMint.result).toBeErr(Cl.uint(401));

    result = simnet.callPublicFn("vault-engine", "open-vault", [], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      "vault-engine",
      "deposit-collateral",
      [Cl.uint(1200)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(1200));

    result = simnet.callPublicFn(
      "vault-engine",
      "mint",
      [Cl.uint(600)],
      wallet1
    );
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

    result = simnet.callPublicFn(
      "vault-engine",
      "burn",
      [Cl.uint(200)],
      wallet1
    );
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
    const accounts = simnet.getAccounts();
    const deployer = accounts.get("deployer");
    const wallet1 = accounts.get("wallet_1");

    if (!deployer || !wallet1) {
      throw new Error("Missing default simnet accounts");
    }

    const vaultEnginePrincipal = `${deployer}.vault-engine`;

    let result = simnet.callPublicFn(
      "stablecoin-token",
      "set-vault-engine",
      [Cl.principal(vaultEnginePrincipal)],
      deployer
    );
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn("vault-engine", "open-vault", [], wallet1);
    expect(result.result).toBeOk(Cl.bool(true));

    result = simnet.callPublicFn(
      "vault-engine",
      "deposit-collateral",
      [Cl.uint(1000)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(1000));

    result = simnet.callPublicFn(
      "vault-engine",
      "mint",
      [Cl.uint(700)],
      wallet1
    );
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
