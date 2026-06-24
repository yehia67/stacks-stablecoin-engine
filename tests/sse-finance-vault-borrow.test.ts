// Full-coverage tests for sse-finance-vault-v1 borrow & repay.
//
// Exercises the full wiring: registry market + matrix pair + collateral oracle,
// pool funded by an LP, vault authorized in the pool, pool authorized in the
// registry (for fee accrual). Verifies health/cap/debt-floor reverts, the
// one-time borrow fee charged at draw, flat-debt zero-growth over time, and repay
// reducing principal by exactly the amount.
//
// borrow-token = vgld-token-v4 (the lent stablecoin, faucet-mintable),
// collateral  = sbtc-token-v4, oracle = price-oracle-pegged-usd-v1 ($1 peg).

import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const REG = "sse-finance-market-registry-v1";
const MATRIX = "sse-finance-collateral-matrix-v1";
const POOL = "sse-finance-pool-v1";
const VAULT = "sse-finance-vault-v1";
const ORACLE = "price-oracle-pegged-usd-v1";
const BORROW = "vgld-token-v4"; // the lent token
const COLL = "sbtc-token-v4"; // collateral

const ERR_UNSAFE_HEALTH_FACTOR = 302;
const ERR_INSUFFICIENT_DEBT = 310;
const ERR_BELOW_DEBT_FLOOR = 311;
const ERR_BORROW_CAP = 312;
const POOL_ERR_UNAUTHORIZED = 600;

function accounts() {
  const a = simnet.getAccounts();
  const deployer = a.get("deployer")!;
  const lp = a.get("wallet_1")!;
  const alice = a.get("wallet_2")!; // borrower
  return { deployer, lp, alice };
}
function principals() {
  const { deployer } = accounts();
  return {
    borrow: `${deployer}.${BORROW}`,
    coll: `${deployer}.${COLL}`,
    oracle: `${deployer}.${ORACLE}`,
    pool: `${deployer}.${POOL}`,
  };
}
const borrowCV = () => Cl.contractPrincipal(accounts().deployer, BORROW);
const collCV = () => Cl.contractPrincipal(accounts().deployer, COLL);
const oracleCV = () => Cl.contractPrincipal(accounts().deployer, ORACLE);

const mint = (token: string, to: string, amount: number) =>
  simnet.callPublicFn(token, "faucet-mint", [Cl.uint(amount), Cl.principal(to)], to);

// Wire the whole system. cap + fee configurable per test.
function wire({ cap = 1_000_000, feeBps = 50, authorizeVault = true } = {}) {
  const { deployer, lp } = accounts();
  const { borrow, coll, oracle, pool } = principals();
  simnet.callPublicFn(
    REG, "register-market",
    [Cl.principal(borrow), Cl.principal(oracle), Cl.uint(cap), Cl.uint(feeBps), Cl.uint(0), Cl.uint(2000), Cl.uint(0)],
    deployer
  );
  simnet.callPublicFn(
    MATRIX, "add-collateral-to-market",
    [Cl.uint(0), Cl.principal(coll), Cl.uint(150), Cl.uint(120), Cl.uint(1000), Cl.uint(100), Cl.uint(1_000_000_000)],
    deployer
  );
  simnet.callPublicFn(MATRIX, "set-collateral-oracle", [Cl.principal(coll), Cl.principal(oracle)], deployer);
  if (authorizeVault) {
    simnet.callPublicFn(POOL, "set-authorized-caller", [Cl.principal(`${deployer}.${VAULT}`), Cl.bool(true)], deployer);
  }
  simnet.callPublicFn(REG, "set-authorized-caller", [Cl.principal(pool), Cl.bool(true)], deployer);
  // LP funds the pool with 100k borrow-token
  mint(BORROW, lp, 100_000);
  simnet.callPublicFn(POOL, "supply", [Cl.uint(0), borrowCV(), Cl.uint(100_000)], lp);
}

// alice deposits `coll` collateral
function depositCollateral(amount: number) {
  const { alice } = accounts();
  mint(COLL, alice, amount);
  simnet.callPublicFn(VAULT, "deposit-collateral", [Cl.uint(0), collCV(), collCV(), Cl.uint(amount)], alice);
}

const borrow = (who: string, amount: number) =>
  simnet.callPublicFn(VAULT, "borrow", [Cl.uint(0), collCV(), borrowCV(), oracleCV(), oracleCV(), Cl.uint(amount)], who);
const repay = (who: string, amount: number) =>
  simnet.callPublicFn(VAULT, "repay", [Cl.uint(0), collCV(), borrowCV(), Cl.uint(amount)], who);

const debtShare = (who: string): number => {
  const res = simnet.callReadOnlyFn(VAULT, "get-collateral-position", [Cl.principal(who), Cl.uint(0), collCV()], who).result as any;
  return Number(res.value.value["debt-share"].value as bigint);
};
const poolBorrows = (): number =>
  Number((simnet.callReadOnlyFn(POOL, "get-total-borrows", [Cl.uint(0)], accounts().deployer).result as any).value as bigint);
const treasuryAccrued = (): number =>
  Number((simnet.callReadOnlyFn(REG, "get-treasury-accrued", [Cl.uint(0), Cl.principal(principals().borrow)], accounts().deployer).result as any).value as bigint);
const tokenBalance = (token: string, who: string): number =>
  Number(((simnet.callReadOnlyFn(token, "get-balance", [Cl.principal(who)], accounts().deployer).result as any).value).value as bigint);

describe("vault borrow", () => {
  beforeEach(() => wire());

  it("borrows: charges the one-time fee (netted), records full flat principal", () => {
    const { alice } = accounts();
    depositCollateral(1000); // $1000 value at $1 peg
    // borrow 600 (< $1000 * 100/150 = 666 cap) ; fee 0.5% = 3, disbursed 597
    expect(borrow(alice, 600).result).toBeOk(Cl.uint(600));
    expect(debtShare(alice)).toBe(600); // full principal recorded
    expect(poolBorrows()).toBe(600);
    expect(treasuryAccrued()).toBe(3); // protocol fee (lp-share 0)
    expect(tokenBalance(BORROW, alice)).toBe(597); // net disbursed
  });

  it("reverts when the draw pushes the position below the min ratio", () => {
    const { alice } = accounts();
    depositCollateral(1000);
    // 700 -> hf = 1000*10000/(700*150) = 95 < 100
    expect(borrow(alice, 700).result).toBeErr(Cl.uint(ERR_UNSAFE_HEALTH_FACTOR));
  });

  it("reverts below the debt floor", () => {
    const { alice } = accounts();
    depositCollateral(1000);
    expect(borrow(alice, 50).result).toBeErr(Cl.uint(ERR_BELOW_DEBT_FLOOR)); // floor 100
  });

  it("reverts over the market borrow cap", () => {
    const { deployer, alice } = accounts();
    // tighten the cap to 500
    simnet.callPublicFn(REG, "update-market",
      [Cl.uint(0), Cl.principal(principals().borrow), Cl.principal(principals().oracle), Cl.uint(500), Cl.bool(true)], deployer);
    depositCollateral(2000); // health allows 1333
    expect(borrow(alice, 600).result).toBeErr(Cl.uint(ERR_BORROW_CAP));
    expect(borrow(alice, 500).result).toBeOk(Cl.uint(500)); // exactly the cap
  });

  it("reverts when the vault is not an authorized pool caller", () => {
    // re-wire without authorizing the vault
    const { deployer, alice } = accounts();
    simnet.callPublicFn(POOL, "set-authorized-caller", [Cl.principal(`${deployer}.${VAULT}`), Cl.bool(false)], deployer);
    depositCollateral(1000);
    expect(borrow(alice, 600).result).toBeErr(Cl.uint(POOL_ERR_UNAUTHORIZED));
  });

  it("flat debt: principal does not grow over time, fee charged only at draw", () => {
    const { alice } = accounts();
    depositCollateral(1000);
    borrow(alice, 600);
    const before = treasuryAccrued();
    simnet.mineEmptyBlocks(500);
    expect(debtShare(alice)).toBe(600); // zero growth
    expect(poolBorrows()).toBe(600);
    expect(treasuryAccrued()).toBe(before); // no recurring fee
  });

  it("each draw charges the fee once (not recurring)", () => {
    const { alice } = accounts();
    depositCollateral(2000); // allows up to 1333
    borrow(alice, 600); // fee 3
    expect(treasuryAccrued()).toBe(3);
    borrow(alice, 400); // fee 2
    expect(treasuryAccrued()).toBe(5);
    expect(debtShare(alice)).toBe(1000);
  });
});

describe("vault repay", () => {
  beforeEach(() => {
    wire();
    depositCollateral(1000);
    borrow(accounts().alice, 600); // alice now holds 597 borrow-token, owes 600
  });

  it("repays principal, reduces pool total-borrows by exactly the amount", () => {
    const { alice } = accounts();
    expect(repay(alice, 300).result).toBeOk(Cl.uint(300));
    expect(debtShare(alice)).toBe(300);
    expect(poolBorrows()).toBe(300);
    expect(tokenBalance(BORROW, alice)).toBe(297); // 597 - 300
  });

  it("rejects repaying more than owed", () => {
    const { alice } = accounts();
    expect(repay(alice, 601).result).toBeErr(Cl.uint(ERR_INSUFFICIENT_DEBT));
  });

  it("rejects a partial repay that lands between 0 and the debt floor", () => {
    const { alice } = accounts();
    expect(repay(alice, 550).result).toBeErr(Cl.uint(ERR_BELOW_DEBT_FLOOR)); // 50 left < 100
  });

  it("allows full repayment to zero", () => {
    const { alice } = accounts();
    mint(BORROW, alice, 3); // top up to 600 to cover the fee gap
    expect(repay(alice, 600).result).toBeOk(Cl.uint(0));
    expect(debtShare(alice)).toBe(0);
    expect(poolBorrows()).toBe(0);
  });
});
