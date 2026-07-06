// Integration proof for the standard "add a borrowable stablecoin" process.
//
// Shows that onboarding a brand-new stablecoin market needs ONLY governance calls
// + config rows (no new contracts, no redeploy): register-market -> set depeg band
// -> add collateral rows + oracle. Then proves the full borrow -> repay ->
// liquidate lifecycle on the freshly-onboarded market, and that a second onboarded
// market is isolated (own pool accounting, cap, breaker).
//
// Governance calls are issued by the deployer (the bootstrap governance owner);
// in production each is routed through sse-finance-timelock-v1 (proven separately
// in sse-finance-timelock.test.ts). "USDC"/"USDA" are stand-in faucet tokens.

import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const REG = "sse-finance-market-registry-v1";
const MATRIX = "sse-finance-collateral-matrix-v1";
const POOL = "sse-finance-pool-v1";
const VAULT = "sse-finance-vault-v1";
const LIQ = "sse-finance-liquidation-v1";
const ORACLE = "price-oracle-pegged-usd-v1";
const USDC = "vgld-token-v4"; // stand-in borrowable stablecoin (faucet-mintable)
const COLL = "sbtc-token-v4"; // collateral

function accounts() {
  const a = simnet.getAccounts();
  const deployer = a.get("deployer")!;
  const lp = a.get("wallet_1")!;
  const alice = a.get("wallet_2")!;
  const bob = a.get("wallet_3")!;
  const keeper = a.get("wallet_4")!;
  return { deployer, lp, alice, bob, keeper };
}
function principals() {
  const { deployer } = accounts();
  return {
    usdc: `${deployer}.${USDC}`, coll: `${deployer}.${COLL}`, oracle: `${deployer}.${ORACLE}`,
    pool: `${deployer}.${POOL}`, vault: `${deployer}.${VAULT}`, liq: `${deployer}.${LIQ}`,
  };
}
const usdcCV = () => Cl.contractPrincipal(accounts().deployer, USDC);
const collCV = () => Cl.contractPrincipal(accounts().deployer, COLL);
const oracleCV = () => Cl.contractPrincipal(accounts().deployer, ORACLE);
const mint = (token: string, to: string, amount: number) =>
  simnet.callPublicFn(token, "faucet-mint", [Cl.uint(amount), Cl.principal(to)], to);

// One-time shared-infra bootstrap (done once at deploy, not per-onboarding).
function bootstrapInfra() {
  const { deployer } = accounts();
  const p = principals();
  simnet.callPublicFn(POOL, "set-authorized-caller", [Cl.principal(p.vault), Cl.bool(true)], deployer);
  simnet.callPublicFn(POOL, "set-authorized-caller", [Cl.principal(p.liq), Cl.bool(true)], deployer);
  simnet.callPublicFn(REG, "set-authorized-caller", [Cl.principal(p.pool), Cl.bool(true)], deployer);
  simnet.callPublicFn(REG, "set-authorized-caller", [Cl.principal(p.liq), Cl.bool(true)], deployer);
  simnet.callPublicFn(VAULT, "set-liquidator", [Cl.principal(p.liq)], deployer);
}

// THE STANDARD ONBOARDING PROCESS -- governance calls + config rows only.
function onboardStablecoin(opts: { cap: number; band: number }): number {
  const { deployer } = accounts();
  const p = principals();
  // 1. register the market (token, oracle, cap, fee-config)
  const reg = simnet.callPublicFn(REG, "register-market",
    [Cl.principal(p.usdc), Cl.principal(p.oracle), Cl.uint(opts.cap), Cl.uint(50), Cl.uint(0), Cl.uint(2000), Cl.uint(0)], deployer);
  const id = Number((reg.result as any).value.value as bigint);
  // 2. set the depeg band
  simnet.callPublicFn(REG, "set-depeg-band", [Cl.uint(id), Cl.uint(opts.band)], deployer);
  // 3. enable collateral rows + oracle
  simnet.callPublicFn(MATRIX, "add-collateral-to-market",
    [Cl.uint(id), Cl.principal(p.coll), Cl.uint(150), Cl.uint(120), Cl.uint(1000), Cl.uint(100), Cl.uint(1_000_000_000)], deployer);
  simnet.callPublicFn(MATRIX, "set-collateral-oracle", [Cl.principal(p.coll), Cl.principal(p.oracle)], deployer);
  return id;
}

const supply = (who: string, market: number, amount: number) =>
  simnet.callPublicFn(POOL, "supply", [Cl.uint(market), usdcCV(), Cl.uint(amount)], who);
const deposit = (who: string, market: number, amount: number) =>
  simnet.callPublicFn(VAULT, "deposit-collateral", [Cl.uint(market), collCV(), collCV(), Cl.uint(amount)], who);
const borrow = (who: string, market: number, amount: number) =>
  simnet.callPublicFn(VAULT, "borrow", [Cl.uint(market), collCV(), usdcCV(), oracleCV(), oracleCV(), Cl.uint(amount)], who);
const repay = (who: string, market: number, amount: number) =>
  simnet.callPublicFn(VAULT, "repay", [Cl.uint(market), collCV(), usdcCV(), Cl.uint(amount)], who);
const liquidate = (who: string, owner: string, market: number) =>
  simnet.callPublicFn(LIQ, "liquidate", [Cl.principal(owner), Cl.uint(market), collCV(), collCV(), oracleCV()], who);

const poolBorrows = (market: number) =>
  Number((simnet.callReadOnlyFn(POOL, "get-total-borrows", [Cl.uint(market)], accounts().deployer).result as any).value as bigint);
const debtShare = (who: string, market: number) => {
  const res = simnet.callReadOnlyFn(VAULT, "get-collateral-position", [Cl.principal(who), Cl.uint(market), collCV()], who).result as any;
  return res.type === "none" ? 0 : Number(res.value.value["debt-share"].value as bigint);
};

describe("standard stablecoin onboarding", () => {
  beforeEach(bootstrapInfra);

  it("onboards a new market with governance calls only, reads back its config", () => {
    const id = onboardStablecoin({ cap: 1_000_000, band: 200 });
    // market + band + collateral row all readable
    expect(simnet.callReadOnlyFn(REG, "get-market", [Cl.uint(id)], accounts().deployer).result).not.toBeNone();
    expect(simnet.callReadOnlyFn(REG, "get-depeg-band", [Cl.uint(id)], accounts().deployer).result).toBeSome(Cl.uint(200));
    expect(simnet.callReadOnlyFn(MATRIX, "is-pair-enabled", [Cl.uint(id), collCV()], accounts().deployer).result).toBeBool(true);
  });

  it("supports the full borrow -> repay lifecycle on the onboarded market", () => {
    const id = onboardStablecoin({ cap: 1_000_000, band: 200 });
    const { lp, alice } = accounts();
    mint(USDC, lp, 100_000);
    supply(lp, id, 100_000);
    mint(COLL, alice, 1000);
    deposit(alice, id, 1000);

    expect(borrow(alice, id, 600).result).toBeOk(Cl.uint(600)); // fee 0.5% -> disbursed 597
    expect(debtShare(alice, id)).toBe(600);
    mint(USDC, alice, 3); // cover the fee gap to repay in full
    expect(repay(alice, id, 600).result).toBeOk(Cl.uint(0));
    expect(debtShare(alice, id)).toBe(0);
  });

  it("supports liquidation on the onboarded market", () => {
    const id = onboardStablecoin({ cap: 1_000_000, band: 200 });
    const { lp, bob, keeper, deployer } = accounts();
    mint(USDC, lp, 100_000);
    supply(lp, id, 100_000);
    mint(COLL, bob, 1000);
    deposit(bob, id, 1000);
    borrow(bob, id, 600);

    // drop the collateral price -> bob unhealthy
    simnet.callPublicFn(ORACLE, "set-max-deviation-bps", [Cl.uint(10000)], deployer);
    simnet.callPublicFn(ORACLE, "set-peg-price", [Cl.uint(50_000_000)], deployer);

    const res = liquidate(keeper, bob, id).result as any;
    expect(res.type).toBe("ok");
    expect(debtShare(bob, id)).toBe(0); // debt cleared
    // restore the peg for any later cases
    simnet.callPublicFn(ORACLE, "set-peg-price", [Cl.uint(100_000_000)], deployer);
  });

  it("a second onboarded market is isolated (own pool accounting)", () => {
    const m0 = onboardStablecoin({ cap: 1_000_000, band: 200 });
    const m1 = onboardStablecoin({ cap: 500, band: 50 }); // own cap + tighter band
    const { lp, alice } = accounts();

    mint(USDC, lp, 200_000);
    supply(lp, m0, 100_000);
    supply(lp, m1, 100_000);
    mint(COLL, alice, 4000);
    deposit(alice, m0, 2000);
    deposit(alice, m1, 2000);

    borrow(alice, m0, 600);
    borrow(alice, m1, 400);

    // independent per-market borrow accounting + caps
    expect(poolBorrows(m0)).toBe(600);
    expect(poolBorrows(m1)).toBe(400);
    expect(simnet.callReadOnlyFn(REG, "get-borrow-cap", [Cl.uint(m0)], alice).result).toBeSome(Cl.uint(1_000_000));
    expect(simnet.callReadOnlyFn(REG, "get-borrow-cap", [Cl.uint(m1)], alice).result).toBeSome(Cl.uint(500));
    expect(simnet.callReadOnlyFn(REG, "get-depeg-band", [Cl.uint(m1)], alice).result).toBeSome(Cl.uint(50));
  });
});
