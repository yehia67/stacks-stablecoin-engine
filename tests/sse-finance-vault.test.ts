// Full-coverage tests for sse-finance-vault-v1: collateral deposit/withdraw,
// keyed {owner, market-id}. Multi-asset positions, enumeration, oracle validated
// against the matrix-registered principal (fails closed on mismatch), and a
// health-checked withdraw (no-op while debt is 0 -- the debt>0 rejection path is
// exercised in the borrow task that wires debt-share).
//
// Collateral = sbtc-token-v4 / vgld-token-v4 (faucet-mintable); oracle =
// price-oracle-pegged-usd-v1 (implements sse-finance-oracle-trait).

import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const REG = "sse-finance-market-registry-v1";
const MATRIX = "sse-finance-collateral-matrix-v1";
const VAULT = "sse-finance-vault-v1";
const ORACLE = "price-oracle-pegged-usd-v1";
const SBTC = "sbtc-token-v4";
const VGLD = "vgld-token-v4";

// Vault error codes (must match the contract).
const ERR_NO_VAULT = 300;
const ERR_INSUFFICIENT_COLLATERAL = 301;
const ERR_PAIR_NOT_ENABLED = 303;
const ERR_NO_COLLATERAL_POSITION = 304;
const ERR_ASSET_MISMATCH = 305;
const ERR_ORACLE_MISMATCH = 306;
const ERR_INVALID_AMOUNT = 307;

function accounts() {
  const a = simnet.getAccounts();
  const deployer = a.get("deployer")!;
  const alice = a.get("wallet_1")!;
  const bob = a.get("wallet_2")!;
  return { deployer, alice, bob };
}

function principals() {
  const { deployer } = accounts();
  return {
    sbtc: `${deployer}.${SBTC}`,
    vgld: `${deployer}.${VGLD}`,
    oracle: `${deployer}.${ORACLE}`,
  };
}
const sbtcCV = () => Cl.contractPrincipal(accounts().deployer, SBTC);
const vgldCV = () => Cl.contractPrincipal(accounts().deployer, VGLD);
const oracleCV = () => Cl.contractPrincipal(accounts().deployer, ORACLE);

const mint = (token: string, to: string, amount: number) =>
  simnet.callPublicFn(token, "faucet-mint", [Cl.uint(amount), Cl.principal(to)], to);

// Register market 0, add sBTC + vGLD as collateral with the pegged oracle.
function setup() {
  const { deployer } = accounts();
  const { sbtc, vgld, oracle } = principals();
  simnet.callPublicFn(
    REG,
    "register-market",
    [Cl.principal(sbtc), Cl.principal(oracle), Cl.uint(1_000_000_000), Cl.uint(0), Cl.uint(0), Cl.uint(2000), Cl.uint(0)],
    deployer
  );
  const addPair = (asset: string) =>
    simnet.callPublicFn(
      MATRIX,
      "add-collateral-to-market",
      [Cl.uint(0), Cl.principal(asset), Cl.uint(150), Cl.uint(120), Cl.uint(1000), Cl.uint(0), Cl.uint(1_000_000_000)],
      deployer
    );
  addPair(sbtc);
  addPair(vgld);
  simnet.callPublicFn(MATRIX, "set-collateral-oracle", [Cl.principal(sbtc), Cl.principal(oracle)], deployer);
  simnet.callPublicFn(MATRIX, "set-collateral-oracle", [Cl.principal(vgld), Cl.principal(oracle)], deployer);
}

const deposit = (who: string, asset: any, token: string, amount: number, marketId = 0) =>
  simnet.callPublicFn(VAULT, "deposit-collateral", [Cl.uint(marketId), asset, Cl.contractPrincipal(accounts().deployer, token), Cl.uint(amount)], who);
const withdraw = (who: string, asset: any, token: string, oracle: any, amount: number, marketId = 0) =>
  simnet.callPublicFn(VAULT, "withdraw-collateral", [Cl.uint(marketId), asset, Cl.contractPrincipal(accounts().deployer, token), oracle, Cl.uint(amount)], who);

const positionAmount = (who: string, asset: any, marketId = 0): number | null => {
  const res = simnet.callReadOnlyFn(VAULT, "get-collateral-position", [Cl.principal(who), Cl.uint(marketId), asset], accounts().deployer).result as any;
  if (res.type === "none") return null;
  return Number(res.value.value["amount"].value as bigint);
};
const assetCount = (who: string, marketId = 0): number =>
  Number((simnet.callReadOnlyFn(VAULT, "get-vault-asset-count", [Cl.principal(who), Cl.uint(marketId)], accounts().deployer).result as any).value as bigint);
const tokenBalance = (token: string, who: string): number =>
  Number(((simnet.callReadOnlyFn(token, "get-balance", [Cl.principal(who)], accounts().deployer).result as any).value).value as bigint);

describe("vault: deposit", () => {
  beforeEach(setup);

  it("deposits collateral, auto-opens the vault, tracks the position", () => {
    const { alice } = accounts();
    mint(SBTC, alice, 1000);
    expect(deposit(alice, sbtcCV(), SBTC, 1000).result).toBeOk(Cl.uint(1000));

    expect(simnet.callReadOnlyFn(VAULT, "get-vault", [Cl.principal(alice), Cl.uint(0)], alice).result).not.toBeNone();
    expect(positionAmount(alice, sbtcCV())).toBe(1000);
    expect(assetCount(alice)).toBe(1);
    expect(tokenBalance(SBTC, `${accounts().deployer}.${VAULT}`)).toBe(1000);
  });

  it("accumulates on repeat deposits of the same asset without double-enumerating", () => {
    const { alice } = accounts();
    mint(SBTC, alice, 1500);
    deposit(alice, sbtcCV(), SBTC, 1000);
    expect(deposit(alice, sbtcCV(), SBTC, 500).result).toBeOk(Cl.uint(1500));
    expect(positionAmount(alice, sbtcCV())).toBe(1500);
    expect(assetCount(alice)).toBe(1);
  });

  it("supports multi-asset positions, enumerable", () => {
    const { alice } = accounts();
    const { sbtc, vgld } = principals();
    mint(SBTC, alice, 1000);
    mint(VGLD, alice, 2000);
    deposit(alice, sbtcCV(), SBTC, 1000);
    deposit(alice, vgldCV(), VGLD, 2000);
    expect(assetCount(alice)).toBe(2);
    const at0 = simnet.callReadOnlyFn(VAULT, "get-vault-asset-at-index", [Cl.principal(alice), Cl.uint(0), Cl.uint(0)], alice).result as any;
    const at1 = simnet.callReadOnlyFn(VAULT, "get-vault-asset-at-index", [Cl.principal(alice), Cl.uint(0), Cl.uint(1)], alice).result as any;
    expect(at0.value.value["asset"]).toBePrincipal(sbtc);
    expect(at1.value.value["asset"]).toBePrincipal(vgld);
  });

  it("rejects zero amount, asset/token mismatch, and a non-enabled pair", () => {
    const { alice } = accounts();
    mint(SBTC, alice, 1000);
    expect(deposit(alice, sbtcCV(), SBTC, 0).result).toBeErr(Cl.uint(ERR_INVALID_AMOUNT));
    // asset arg = vgld but token = sbtc
    expect(deposit(alice, vgldCV(), SBTC, 100).result).toBeErr(Cl.uint(ERR_ASSET_MISMATCH));
    // disable the sbtc pair -> deposit refused
    simnet.callPublicFn(MATRIX, "set-pair-enabled", [Cl.uint(0), sbtcCV(), Cl.bool(false)], accounts().deployer);
    expect(deposit(alice, sbtcCV(), SBTC, 100).result).toBeErr(Cl.uint(ERR_PAIR_NOT_ENABLED));
  });

  it("rejects a collateral with no matrix row (pair not borrowable)", () => {
    const { alice } = accounts();
    // market 1 has no pairs configured
    simnet.callPublicFn(
      REG, "register-market",
      [Cl.principal(principals().sbtc), Cl.principal(principals().oracle), Cl.uint(1), Cl.uint(0), Cl.uint(0), Cl.uint(0), Cl.uint(0)],
      accounts().deployer
    );
    mint(SBTC, alice, 100);
    expect(deposit(alice, sbtcCV(), SBTC, 100, 1).result).toBeErr(Cl.uint(ERR_PAIR_NOT_ENABLED));
  });
});

describe("vault: withdraw (debt-free)", () => {
  beforeEach(() => {
    setup();
    const { alice } = accounts();
    mint(SBTC, alice, 1000);
    deposit(alice, sbtcCV(), SBTC, 1000);
  });

  it("withdraws within balance and returns the tokens", () => {
    const { alice } = accounts();
    expect(withdraw(alice, sbtcCV(), SBTC, oracleCV(), 400).result).toBeOk(Cl.uint(600));
    expect(positionAmount(alice, sbtcCV())).toBe(600);
    expect(tokenBalance(SBTC, alice)).toBe(400);
  });

  it("rejects withdrawing more than the deposited amount", () => {
    const { alice } = accounts();
    expect(withdraw(alice, sbtcCV(), SBTC, oracleCV(), 1001).result).toBeErr(Cl.uint(ERR_INSUFFICIENT_COLLATERAL));
  });

  it("fails closed when the oracle does not match the registered principal", () => {
    const { alice, deployer } = accounts();
    const { sbtc, vgld } = principals();
    // re-point sbtc's registered oracle to some other principal
    simnet.callPublicFn(MATRIX, "set-collateral-oracle", [Cl.principal(sbtc), Cl.principal(vgld)], deployer);
    // caller still passes the pegged oracle -> mismatch
    expect(withdraw(alice, sbtcCV(), SBTC, oracleCV(), 100).result).toBeErr(Cl.uint(ERR_ORACLE_MISMATCH));
    // restore -> succeeds
    simnet.callPublicFn(MATRIX, "set-collateral-oracle", [Cl.principal(sbtc), Cl.principal(principals().oracle)], deployer);
    expect(withdraw(alice, sbtcCV(), SBTC, oracleCV(), 100).result).toBeOk(Cl.uint(900));
  });

  it("rejects withdraw with no vault / no position", () => {
    const { bob } = accounts();
    // bob never deposited -> no vault
    expect(withdraw(bob, sbtcCV(), SBTC, oracleCV(), 1).result).toBeErr(Cl.uint(ERR_NO_VAULT));
    // alice has a vault but no vGLD position
    const { alice } = accounts();
    expect(withdraw(alice, vgldCV(), VGLD, oracleCV(), 1).result).toBeErr(Cl.uint(ERR_NO_COLLATERAL_POSITION));
  });
});

describe("vault: read-only health views", () => {
  beforeEach(() => {
    setup();
    const { alice } = accounts();
    mint(SBTC, alice, 1000);
    deposit(alice, sbtcCV(), SBTC, 1000);
  });

  it("zero-debt position reports the zero-debt health factor and not liquidatable", () => {
    const { alice } = accounts();
    const USD_1 = 100_000_000;
    expect(
      simnet.callReadOnlyFn(VAULT, "get-position-health-factor", [Cl.principal(alice), Cl.uint(0), sbtcCV(), Cl.uint(USD_1)], alice).result
    ).toBeUint(1_000_000);
    const status = simnet.callReadOnlyFn(VAULT, "get-position-liquidation-status", [Cl.principal(alice), Cl.uint(0), sbtcCV(), Cl.uint(USD_1)], alice).result as any;
    expect(status.value["is-liquidatable"].type).toBe("false");
  });
});
