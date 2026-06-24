// Tests for the depeg circuit-breaker: a per-market band (registry) that the
// vault's borrow path consults. When the borrow-token price is outside the band,
// NEW borrows revert (ERR_DEPEG) while repay and withdraw still work. The band is
// per-market and governance-set; one market tripping does not affect another.
//
// One pegged oracle serves both the collateral (health) and the borrow-token
// (breaker). The position is over-collateralised so a price drop trips the
// breaker without making the position unhealthy.

import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const REG = "sse-finance-market-registry-v1";
const MATRIX = "sse-finance-collateral-matrix-v1";
const POOL = "sse-finance-pool-v1";
const VAULT = "sse-finance-vault-v1";
const ORACLE = "price-oracle-pegged-usd-v1";
const BORROW = "vgld-token-v4";
const COLL = "sbtc-token-v4";

const ERR_ORACLE_MISMATCH = 306;
const ERR_DEPEG = 314;
const REG_ERR_UNAUTHORIZED = 800;
const REG_ERR_MARKET_NOT_FOUND = 802;
const REG_ERR_INVALID_BAND = 804;

function accounts() {
  const a = simnet.getAccounts();
  const deployer = a.get("deployer")!;
  const lp = a.get("wallet_1")!;
  const alice = a.get("wallet_2")!;
  const stranger = a.get("wallet_3")!;
  return { deployer, lp, alice, stranger };
}
function principals() {
  const { deployer } = accounts();
  return { borrow: `${deployer}.${BORROW}`, coll: `${deployer}.${COLL}`, oracle: `${deployer}.${ORACLE}`, vault: `${deployer}.${VAULT}`, pool: `${deployer}.${POOL}`, liq: `${deployer}.sse-finance-liquidation-v1` };
}
const borrowCV = () => Cl.contractPrincipal(accounts().deployer, BORROW);
const collCV = () => Cl.contractPrincipal(accounts().deployer, COLL);
const oracleCV = () => Cl.contractPrincipal(accounts().deployer, ORACLE);
const mint = (token: string, to: string, amount: number) =>
  simnet.callPublicFn(token, "faucet-mint", [Cl.uint(amount), Cl.principal(to)], to);

// Register a market, add sBTC collateral + oracle, fund the pool, deposit a big
// collateral buffer. Returns the market id. Optional band trips the breaker.
function wireMarket(band?: number): number {
  const { deployer, lp, alice } = accounts();
  const p = principals();
  const reg = simnet.callPublicFn(REG, "register-market",
    [Cl.principal(p.borrow), Cl.principal(p.oracle), Cl.uint(1_000_000_000), Cl.uint(0), Cl.uint(0), Cl.uint(2000), Cl.uint(0)], deployer);
  const id = Number((reg.result as any).value.value as bigint);
  simnet.callPublicFn(MATRIX, "add-collateral-to-market",
    [Cl.uint(id), Cl.principal(p.coll), Cl.uint(150), Cl.uint(120), Cl.uint(1000), Cl.uint(100), Cl.uint(1_000_000_000)], deployer);
  simnet.callPublicFn(MATRIX, "set-collateral-oracle", [Cl.principal(p.coll), Cl.principal(p.oracle)], deployer);
  simnet.callPublicFn(POOL, "set-authorized-caller", [Cl.principal(p.vault), Cl.bool(true)], deployer);
  if (band !== undefined) {
    simnet.callPublicFn(REG, "set-depeg-band", [Cl.uint(id), Cl.uint(band)], deployer);
  }
  // fund pool + over-collateralise the borrower
  mint(BORROW, lp, 100_000);
  simnet.callPublicFn(POOL, "supply", [Cl.uint(id), borrowCV(), Cl.uint(100_000)], lp);
  mint(COLL, alice, 100_000);
  simnet.callPublicFn(VAULT, "deposit-collateral", [Cl.uint(id), collCV(), collCV(), Cl.uint(100_000)], alice);
  return id;
}

const borrow = (who: string, marketId: number, amount: number, oracle = oracleCV()) =>
  simnet.callPublicFn(VAULT, "borrow", [Cl.uint(marketId), collCV(), borrowCV(), oracleCV(), oracle, Cl.uint(amount)], who);
const repay = (who: string, marketId: number, amount: number) =>
  simnet.callPublicFn(VAULT, "repay", [Cl.uint(marketId), collCV(), borrowCV(), Cl.uint(amount)], who);
const withdraw = (who: string, marketId: number, amount: number) =>
  simnet.callPublicFn(VAULT, "withdraw-collateral", [Cl.uint(marketId), collCV(), collCV(), oracleCV(), Cl.uint(amount)], who);

// widen the oracle band then drop the peg to $0.50
function dropPeg() {
  const { deployer } = accounts();
  simnet.callPublicFn(ORACLE, "set-max-deviation-bps", [Cl.uint(10000)], deployer);
  simnet.callPublicFn(ORACLE, "set-peg-price", [Cl.uint(50_000_000)], deployer);
}

describe("depeg breaker: borrow guard", () => {
  beforeEach(() => wireMarket(200)); // 2% band on market 0

  it("allows borrows while the peg holds", () => {
    const { alice } = accounts();
    expect(borrow(alice, 0, 600).result).toBeOk(Cl.uint(600));
  });

  it("blocks NEW borrows when the borrow-token depegs beyond the band", () => {
    const { alice } = accounts();
    dropPeg(); // $0.50, outside 2%
    expect(borrow(alice, 0, 600).result).toBeErr(Cl.uint(ERR_DEPEG));
  });

  it("repay and withdraw still work while the breaker is tripped", () => {
    const { alice } = accounts();
    borrow(alice, 0, 600); // establish debt while healthy
    dropPeg();
    // breaker only gates borrow:
    expect(borrow(alice, 0, 100).result).toBeErr(Cl.uint(ERR_DEPEG));
    expect(repay(alice, 0, 300).result).toBeOk(Cl.uint(300));
    expect(withdraw(alice, 0, 1000).result).toBeOk(Cl.uint(99_000));
  });

  it("fails closed when the borrow-oracle does not match the market oracle", () => {
    const { alice } = accounts();
    // pass the collateral token principal as the borrow-oracle -> mismatch
    expect(borrow(alice, 0, 600, collCV()).result).toBeErr(Cl.uint(ERR_ORACLE_MISMATCH));
  });
});

describe("depeg breaker: per-market isolation", () => {
  it("one market's breaker tripping does not block another market", () => {
    const { alice } = accounts();
    const m0 = wireMarket(200); // banded
    const m1 = wireMarket(); // no band -> breaker disabled
    dropPeg();
    expect(borrow(alice, m0, 600).result).toBeErr(Cl.uint(ERR_DEPEG)); // banded market blocked
    expect(borrow(alice, m1, 600).result).toBeOk(Cl.uint(600)); // other market unaffected
  });
});

describe("depeg breaker: governance + validation", () => {
  beforeEach(() => wireMarket(200));

  it("only governance can set the band", () => {
    const { stranger } = accounts();
    expect(simnet.callPublicFn(REG, "set-depeg-band", [Cl.uint(0), Cl.uint(100)], stranger).result)
      .toBeErr(Cl.uint(REG_ERR_UNAUTHORIZED));
  });

  it("rejects a band over the cap and an unknown market", () => {
    const { deployer } = accounts();
    expect(simnet.callPublicFn(REG, "set-depeg-band", [Cl.uint(0), Cl.uint(10001)], deployer).result)
      .toBeErr(Cl.uint(REG_ERR_INVALID_BAND));
    expect(simnet.callPublicFn(REG, "set-depeg-band", [Cl.uint(9), Cl.uint(100)], deployer).result)
      .toBeErr(Cl.uint(REG_ERR_MARKET_NOT_FOUND));
  });

  it("get-depeg-band / is-within-depeg-band reflect config", () => {
    const { deployer } = accounts();
    expect(simnet.callReadOnlyFn(REG, "get-depeg-band", [Cl.uint(0)], deployer).result).toBeSome(Cl.uint(200));
    // within 2% of $1
    expect(simnet.callReadOnlyFn(REG, "is-within-depeg-band", [Cl.uint(0), Cl.uint(101_000_000)], deployer).result).toBeBool(true);
    expect(simnet.callReadOnlyFn(REG, "is-within-depeg-band", [Cl.uint(0), Cl.uint(103_000_000)], deployer).result).toBeBool(false);
    // a market with no band configured is always within
    expect(simnet.callReadOnlyFn(REG, "is-within-depeg-band", [Cl.uint(5), Cl.uint(1)], deployer).result).toBeBool(true);
  });
});
