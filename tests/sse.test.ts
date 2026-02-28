import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

describe("sse minimal flow", () => {
  it("opens a vault, deposits collateral, and mints stablecoin", () => {
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
      [Cl.uint(500)],
      wallet1
    );
    expect(result.result).toBeOk(Cl.uint(500));

    const balance = simnet.callReadOnlyFn(
      "stablecoin-token",
      "get-balance",
      [Cl.principal(wallet1)],
      wallet1
    );
    expect(balance.result).toBeOk(Cl.uint(500));
  });
});
