// Full-coverage tests for sse-finance-liquidation-v1 (Mechanism A).
//
// Full wiring + an unhealthy position created by dropping the (pegged) collateral
// oracle below $1 (deviation band widened to allow it). Verifies: healthy ->
// revert; permissionless trigger; debt + collateral drop by the settled amounts;
// penalty split (protocol cut -> treasury-accrued, remainder -> LPs); LP can claim
// the seized collateral; oracle mismatch + no-position reverts.
//
// borrow-token = vgld-token-v4, collateral = sbtc-token-v4, oracle = pegged USD.

import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const REG = "sse-finance-market-registry-v1";
const MATRIX = "sse-finance-collateral-matrix-v1";
const POOL = "sse-finance-pool-v1";
const VAULT = "sse-finance-vault-v1";
const LIQ = "sse-finance-liquidation-v1";
const ORACLE = "price-oracle-pegged-usd-v1";
const BORROW = "vgld-token-v4";
const COLL = "sbtc-token-v4";

const ERR_POSITION_HEALTHY = 402;
const ERR_NO_POSITION = 403;
const ERR_ORACLE_MISMATCH = 404;

function accounts() {
  const a = simnet.getAccounts();
  const deployer = a.get("deployer")!;
  const lp = a.get("wallet_1")!;
  const alice = a.get("wallet_2")!; // borrower
  const keeper = a.get("wallet_3")!; // permissionless liquidation trigger
  return { deployer, lp, alice, keeper };
}
function principals() {
  const { deployer } = accounts();
  return {
    borrow: `${deployer}.${BORROW}`,
    coll: `${deployer}.${COLL}`,
    oracle: `${deployer}.${ORACLE}`,
    pool: `${deployer}.${POOL}`,
    vault: `${deployer}.${VAULT}`,
    liq: `${deployer}.${LIQ}`,
  };
}
const borrowCV = () => Cl.contractPrincipal(accounts().deployer, BORROW);
const collCV = () => Cl.contractPrincipal(accounts().deployer, COLL);
const oracleCV = () => Cl.contractPrincipal(accounts().deployer, ORACLE);
const mint = (token: string, to: string, amount: number) =>
  simnet.callPublicFn(token, "faucet-mint", [Cl.uint(amount), Cl.principal(to)], to);

function wire() {
  const { deployer, lp } = accounts();
  const p = principals();
  simnet.callPublicFn(REG, "register-market",
    [Cl.principal(p.borrow), Cl.principal(p.oracle), Cl.uint(1_000_000_000), Cl.uint(0), Cl.uint(0), Cl.uint(2000), Cl.uint(0)], deployer);
  simnet.callPublicFn(MATRIX, "add-collateral-to-market",
    [Cl.uint(0), Cl.principal(p.coll), Cl.uint(150), Cl.uint(120), Cl.uint(1000), Cl.uint(100), Cl.uint(1_000_000_000)], deployer);
  simnet.callPublicFn(MATRIX, "set-collateral-oracle", [Cl.principal(p.coll), Cl.principal(p.oracle)], deployer);
  // authorize the vault (borrow) and liquidation engine in the pool + registry
  simnet.callPublicFn(POOL, "set-authorized-caller", [Cl.principal(p.vault), Cl.bool(true)], deployer);
  simnet.callPublicFn(POOL, "set-authorized-caller", [Cl.principal(p.liq), Cl.bool(true)], deployer);
  simnet.callPublicFn(REG, "set-authorized-caller", [Cl.principal(p.pool), Cl.bool(true)], deployer);
  simnet.callPublicFn(REG, "set-authorized-caller", [Cl.principal(p.liq), Cl.bool(true)], deployer);
  simnet.callPublicFn(VAULT, "set-liquidator", [Cl.principal(p.liq)], deployer);
  // LP funds the pool
  mint(BORROW, lp, 100_000);
  simnet.callPublicFn(POOL, "supply", [Cl.uint(0), borrowCV(), Cl.uint(100_000)], lp);
}

// alice deposits 1000 sBTC and borrows 600.
function openPosition() {
  const { alice } = accounts();
  mint(COLL, alice, 1000);
  simnet.callPublicFn(VAULT, "deposit-collateral", [Cl.uint(0), collCV(), collCV(), Cl.uint(1000)], alice);
  simnet.callPublicFn(VAULT, "borrow", [Cl.uint(0), collCV(), borrowCV(), oracleCV(), Cl.uint(600)], alice);
}

// Drop the pegged oracle to $0.50 (widen the deviation band first).
function dropPriceToHalf() {
  const { deployer } = accounts();
  simnet.callPublicFn(ORACLE, "set-max-deviation-bps", [Cl.uint(10000)], deployer);
  simnet.callPublicFn(ORACLE, "set-peg-price", [Cl.uint(50_000_000)], deployer);
}

const liquidate = (who: string, owner: string) =>
  simnet.callPublicFn(LIQ, "liquidate", [Cl.principal(owner), Cl.uint(0), collCV(), collCV(), oracleCV()], who);

const positionField = (who: string, field: string): number | null => {
  const res = simnet.callReadOnlyFn(VAULT, "get-collateral-position", [Cl.principal(who), Cl.uint(0), collCV()], who).result as any;
  if (res.type === "none") return null;
  return Number(res.value.value[field].value as bigint);
};
const poolUint = (fn: string): number =>
  Number((simnet.callReadOnlyFn(POOL, fn, [Cl.uint(0)], accounts().deployer).result as any).value as bigint);
const treasuryAccruedColl = (): number =>
  Number((simnet.callReadOnlyFn(REG, "get-treasury-accrued", [Cl.uint(0), Cl.principal(principals().coll)], accounts().deployer).result as any).value as bigint);
const tokenBalance = (token: string, who: string): number =>
  Number(((simnet.callReadOnlyFn(token, "get-balance", [Cl.principal(who)], accounts().deployer).result as any).value).value as bigint);

describe("liquidation", () => {
  beforeEach(() => {
    wire();
    openPosition();
  });

  it("reverts on a healthy position", () => {
    const { keeper, alice } = accounts();
    // still $1 -> health at liq-ratio 120 = 1000*10000/(600*120) = 138 > 100
    expect(liquidate(keeper, alice).result).toBeErr(Cl.uint(ERR_POSITION_HEALTHY));
  });

  it("permissionless trigger settles an unhealthy position; penalty split", () => {
    const { keeper, alice } = accounts();
    dropPriceToHalf(); // value 500 -> health 69 < 100

    // base = 600/0.5 = 1200; penalty 10% = 120; want 1320 capped at 1000 collateral.
    // protocol cut = 120 * 20% = 24; lp = 1000 - 24 = 976.
    const res = liquidate(keeper, alice).result as any;
    expect(res.type).toBe("ok");
    const t = res.value.value;
    expect(t["debt-written-off"]).toBeUint(600);
    expect(t["collateral-seized"]).toBeUint(1000);
    expect(t["protocol-cut"]).toBeUint(24);
    expect(t["lp-collateral"]).toBeUint(976);

    // position fully cleared
    expect(positionField(alice, "debt-share")).toBe(0);
    expect(positionField(alice, "amount")).toBe(0);
    // pool: debt written off, supplied reduced by the offset
    expect(poolUint("get-total-borrows")).toBe(0);
    expect(poolUint("get-total-supplied")).toBe(100_000 - 600);
    // protocol penalty cut earmarked in treasury-accrued (collateral token)
    expect(treasuryAccruedColl()).toBe(24);
    // pool now physically holds the seized collateral
    expect(tokenBalance(COLL, principals().pool)).toBe(1000);

    // a liquidation record was written
    expect(
      Number((simnet.callReadOnlyFn(LIQ, "get-liquidation-count", [], keeper).result as any).value as bigint)
    ).toBe(1);
  });

  it("LP can claim the seized collateral after liquidation", () => {
    const { keeper, alice, lp } = accounts();
    dropPriceToHalf();
    liquidate(keeper, alice);

    // sole LP (100k shares) claims the whole lp-collateral (976)
    const claimable = Number(
      (simnet.callReadOnlyFn(POOL, "get-claimable-collateral-reward", [Cl.principal(lp), Cl.uint(0), collCV()], lp).result as any).value as bigint
    );
    expect(claimable).toBe(976);
    expect(simnet.callPublicFn(POOL, "claim-collateral-reward", [Cl.uint(0), collCV(), collCV()], lp).result).toBeOk(Cl.uint(976));
    expect(tokenBalance(COLL, lp)).toBe(976);
    // 24 remains in the pool for the protocol sweep
    expect(tokenBalance(COLL, principals().pool)).toBe(24);
  });

  it("fails closed on oracle mismatch", () => {
    const { keeper, alice, deployer } = accounts();
    dropPriceToHalf();
    // re-point the collateral oracle elsewhere; keeper still passes the pegged one
    simnet.callPublicFn(MATRIX, "set-collateral-oracle", [Cl.principal(principals().coll), Cl.principal(principals().borrow)], deployer);
    expect(liquidate(keeper, alice).result).toBeErr(Cl.uint(ERR_ORACLE_MISMATCH));
  });

  it("reverts when there is no debt position", () => {
    const { keeper, deployer } = accounts();
    dropPriceToHalf();
    // deployer never borrowed
    expect(liquidate(keeper, deployer).result).toBeErr(Cl.uint(ERR_NO_POSITION));
  });
});
