// Full-coverage tests for sse-finance-pool-v1: LP supply/withdraw + share
// accounting, the on-chain bank-run guard (withdraw capped at cash), cash
// management (borrow-out / repay-in), and the stability-pool-style liquidation
// loss + cumulative-reward-per-token collateral-distribution engine.
//
// Uses sbtc-token-v4 as the market's borrow-token and vgld-token-v4 as a seized
// collateral asset (both have an open faucet-mint).

import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const REG = "sse-finance-market-registry-v1";
const POOL = "sse-finance-pool-v1";
const BORROW_TOKEN = "sbtc-token-v4";
const COLLATERAL = "vgld-token-v4";

// Pool error codes (must match the contract).
const ERR_UNAUTHORIZED = 600;
const ERR_MARKET_NOT_FOUND = 602;
const ERR_TOKEN_MISMATCH = 603;
const ERR_INSUFFICIENT_BALANCE = 604;
const ERR_INSUFFICIENT_CASH = 605;
const ERR_NO_REWARD = 607;
const ERR_INVALID_AMOUNT = 608;

function accounts() {
  const a = simnet.getAccounts();
  const deployer = a.get("deployer")!;
  const lp1 = a.get("wallet_1")!;
  const lp2 = a.get("wallet_2")!;
  const vault = a.get("wallet_3")!; // stands in for the vault / liquidation engine
  const borrower = a.get("wallet_4")!;
  return { deployer, lp1, lp2, vault, borrower };
}

function principals() {
  const { deployer } = accounts();
  return {
    borrowToken: `${deployer}.${BORROW_TOKEN}`,
    collateral: `${deployer}.${COLLATERAL}`,
    poolAddr: `${deployer}.${POOL}`,
  };
}

const borrowTokenCV = () => {
  const { deployer } = accounts();
  return Cl.contractPrincipal(deployer, BORROW_TOKEN);
};
const collateralCV = () => {
  const { deployer } = accounts();
  return Cl.contractPrincipal(deployer, COLLATERAL);
};

// faucet-mint(amount, recipient). The caller (sender) must be a standard
// principal, so when minting to the pool contract we pass a wallet as caller.
function mintBorrow(to: string, amount: number, caller = to) {
  return simnet.callPublicFn(BORROW_TOKEN, "faucet-mint", [Cl.uint(amount), Cl.principal(to)], caller);
}
function mintCollateral(to: string, amount: number, caller = accounts().deployer) {
  return simnet.callPublicFn(COLLATERAL, "faucet-mint", [Cl.uint(amount), Cl.principal(to)], caller);
}
// Token get-balance returns (ok uint); unwrap the response then the uint.
function tokenBalance(token: string, who: string): number {
  const res = simnet.callReadOnlyFn(token, "get-balance", [Cl.principal(who)], accounts().deployer)
    .result as any;
  return Number(res.value.value as bigint);
}

// Register market 0 with sbtc as the borrow-token and authorize the "vault".
function setup() {
  const { deployer, vault } = accounts();
  const { borrowToken } = principals();
  simnet.callPublicFn(
    REG,
    "register-market",
    [
      Cl.principal(borrowToken),
      Cl.principal(borrowToken), // oracle (stand-in; pool ignores it)
      Cl.uint(1_000_000_000),
      Cl.uint(0), // borrow-fee-bps: 0 for the pure cash-management tests
      Cl.uint(0),
      Cl.uint(2000),
      Cl.uint(0),
    ],
    deployer
  );
  simnet.callPublicFn(POOL, "set-authorized-caller", [Cl.principal(vault), Cl.bool(true)], deployer);
}

const supply = (lp: string, amount: number, marketId = 0) =>
  simnet.callPublicFn(POOL, "supply", [Cl.uint(marketId), borrowTokenCV(), Cl.uint(amount)], lp);
const withdraw = (lp: string, amount: number, marketId = 0) =>
  simnet.callPublicFn(POOL, "withdraw", [Cl.uint(marketId), borrowTokenCV(), Cl.uint(amount)], lp);
const borrowOut = (caller: string, recipient: string, amount: number, marketId = 0) =>
  simnet.callPublicFn(
    POOL,
    "borrow-out",
    [Cl.uint(marketId), borrowTokenCV(), Cl.principal(recipient), Cl.uint(amount)],
    caller
  );
const repayIn = (caller: string, amount: number, marketId = 0) =>
  simnet.callPublicFn(POOL, "repay-in", [Cl.uint(marketId), borrowTokenCV(), Cl.uint(amount)], caller);
const distribute = (caller: string, offset: number, collateralEarned: number, marketId = 0) =>
  simnet.callPublicFn(
    POOL,
    "distribute-liquidation-reward",
    [Cl.uint(marketId), collateralCV(), Cl.uint(offset), Cl.uint(collateralEarned)],
    caller
  );
const claim = (lp: string, marketId = 0) =>
  simnet.callPublicFn(POOL, "claim-collateral-reward", [Cl.uint(marketId), collateralCV(), collateralCV()], lp);

const readUint = (fn: string, args: any[]) =>
  Number((simnet.callReadOnlyFn(POOL, fn, args, accounts().deployer).result as any).value as bigint);
const state = (marketId = 0) => {
  const s = (simnet.callReadOnlyFn(POOL, "get-pool-state", [Cl.uint(marketId)], accounts().deployer)
    .result as any).value;
  return {
    supplied: Number(s["total-supplied"].value),
    borrows: Number(s["total-borrows"].value),
    cash: Number(s["cash"].value),
  };
};

describe("pool: supply + share accounting", () => {
  beforeEach(setup);

  it("supply mints shares and grows total-supplied + cash together", () => {
    const { lp1 } = accounts();
    mintBorrow(lp1, 1000);
    expect(supply(lp1, 1000).result).toBeOk(Cl.uint(1000));

    expect(state()).toEqual({ supplied: 1000, borrows: 0, cash: 1000 });
    expect(readUint("get-shares", [Cl.principal(lp1), Cl.uint(0)])).toBe(1000);
    expect(readUint("balance-of", [Cl.principal(lp1), Cl.uint(0)])).toBe(1000);
    expect(readUint("get-available-liquidity", [Cl.uint(0)])).toBe(1000);
  });

  it("two LPs accumulate independent claims", () => {
    const { lp1, lp2 } = accounts();
    mintBorrow(lp1, 600);
    mintBorrow(lp2, 400);
    supply(lp1, 600);
    supply(lp2, 400);
    expect(state()).toEqual({ supplied: 1000, borrows: 0, cash: 1000 });
    expect(readUint("balance-of", [Cl.principal(lp1), Cl.uint(0)])).toBe(600);
    expect(readUint("balance-of", [Cl.principal(lp2), Cl.uint(0)])).toBe(400);
  });

  it("rejects zero amount, unknown market, and token mismatch", () => {
    const { lp1 } = accounts();
    mintBorrow(lp1, 1000);
    expect(supply(lp1, 0).result).toBeErr(Cl.uint(ERR_INVALID_AMOUNT));
    expect(
      simnet.callPublicFn(POOL, "supply", [Cl.uint(9), borrowTokenCV(), Cl.uint(10)], lp1).result
    ).toBeErr(Cl.uint(ERR_MARKET_NOT_FOUND));
    expect(
      simnet.callPublicFn(POOL, "supply", [Cl.uint(0), collateralCV(), Cl.uint(10)], lp1).result
    ).toBeErr(Cl.uint(ERR_TOKEN_MISMATCH));
  });
});

describe("pool: withdraw + bank-run guard", () => {
  beforeEach(setup);

  it("withdraw burns shares for the underlying", () => {
    const { lp1 } = accounts();
    mintBorrow(lp1, 1000);
    supply(lp1, 1000);
    expect(withdraw(lp1, 400).result).toBeOk(Cl.uint(600));
    expect(state()).toEqual({ supplied: 600, borrows: 0, cash: 600 });
    expect(readUint("balance-of", [Cl.principal(lp1), Cl.uint(0)])).toBe(600);
    // LP got the tokens back
    expect(tokenBalance(BORROW_TOKEN, lp1)).toBe(400);
  });

  it("caps withdrawals at available cash once liquidity is lent out (bank-run guard)", () => {
    const { lp1, vault, borrower } = accounts();
    mintBorrow(lp1, 1000);
    supply(lp1, 1000);

    // vault lends 800 out -> cash 200, borrows 800; LP claim still 1000
    expect(borrowOut(vault, borrower, 800).result).toBeOk(Cl.uint(800));
    expect(state()).toEqual({ supplied: 1000, borrows: 800, cash: 200 });
    expect(readUint("balance-of", [Cl.principal(lp1), Cl.uint(0)])).toBe(1000);

    // LP claim (1000) >= 500, but cash (200) < 500 -> guarded
    expect(withdraw(lp1, 500).result).toBeErr(Cl.uint(ERR_INSUFFICIENT_CASH));
    // exactly cash is fine
    expect(withdraw(lp1, 200).result).toBeOk(Cl.uint(800));
    expect(state()).toEqual({ supplied: 800, borrows: 800, cash: 0 });
  });

  it("rejects withdrawing more than the LP's effective claim", () => {
    const { lp1 } = accounts();
    mintBorrow(lp1, 1000);
    supply(lp1, 1000);
    expect(withdraw(lp1, 1001).result).toBeErr(Cl.uint(ERR_INSUFFICIENT_BALANCE));
  });
});

describe("pool: cash management (borrow-out / repay-in)", () => {
  beforeEach(setup);

  it("borrow-out moves cash to the borrower and tracks total-borrows", () => {
    const { lp1, vault, borrower } = accounts();
    mintBorrow(lp1, 1000);
    supply(lp1, 1000);
    expect(borrowOut(vault, borrower, 700).result).toBeOk(Cl.uint(700));
    expect(state()).toEqual({ supplied: 1000, borrows: 700, cash: 300 });
    expect(tokenBalance(BORROW_TOKEN, borrower)).toBe(700);
  });

  it("borrow-out reverts when amount exceeds cash and rejects non-vault callers", () => {
    const { lp1, vault, borrower } = accounts();
    mintBorrow(lp1, 1000);
    supply(lp1, 1000);
    expect(borrowOut(vault, borrower, 1001).result).toBeErr(Cl.uint(ERR_INSUFFICIENT_CASH));
    expect(borrowOut(borrower, borrower, 100).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });

  it("repay-in returns cash and reduces total-borrows by exactly the amount", () => {
    const { lp1, vault, borrower } = accounts();
    mintBorrow(lp1, 1000);
    supply(lp1, 1000);
    borrowOut(vault, borrower, 800); // borrower now holds 800
    // borrower repays 500 via the vault (tx-sender = borrower)
    expect(repayIn(borrower /* unauthorized */, 500).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));

    // authorize the borrower-as-caller path through the vault: vault is authorized,
    // and repay-in pulls from tx-sender. Simulate by having the vault call while
    // the borrower holds the funds is not expressible here, so authorize borrower.
    simnet.callPublicFn(POOL, "set-authorized-caller", [Cl.principal(borrower), Cl.bool(true)], accounts().deployer);
    expect(repayIn(borrower, 500).result).toBeOk(Cl.uint(500));
    expect(state()).toEqual({ supplied: 1000, borrows: 300, cash: 700 });
  });
});

describe("pool: liquidation distribution + LP collateral claims", () => {
  beforeEach(setup);

  it("distributes seized collateral pro-rata; LPs claim their share", () => {
    const { lp1, lp2, vault } = accounts();
    const { poolAddr } = principals();
    mintBorrow(lp1, 600);
    mintBorrow(lp2, 400);
    supply(lp1, 600);
    supply(lp2, 400); // supplied 1000

    // fund the pool with the seized collateral it will pay out, then distribute
    mintCollateral(poolAddr, 100);
    expect(distribute(vault, 0, 100).result).toBeOk(Cl.bool(true));

    // pro-rata: lp1 60%, lp2 40%
    expect(
      readUint("get-claimable-collateral-reward", [Cl.principal(lp1), Cl.uint(0), collateralCV()])
    ).toBe(60);
    expect(
      readUint("get-claimable-collateral-reward", [Cl.principal(lp2), Cl.uint(0), collateralCV()])
    ).toBe(40);

    expect(claim(lp1).result).toBeOk(Cl.uint(60));
    expect(claim(lp2).result).toBeOk(Cl.uint(40));
    // claimed once -> nothing left, second claim reverts
    expect(claim(lp1).result).toBeErr(Cl.uint(ERR_NO_REWARD));
    expect(tokenBalance(COLLATERAL, lp1)).toBe(60);
  });

  it("socialises loss: a full offset zeroes LP principal and converts it to collateral", () => {
    const { lp1, vault, borrower } = accounts();
    const { poolAddr } = principals();
    mintBorrow(lp1, 1000);
    supply(lp1, 1000);
    borrowOut(vault, borrower, 1000); // cash 0, borrows 1000, supplied 1000

    // liquidation: full debt offset, 1100 collateral seized (10% penalty)
    mintCollateral(poolAddr, 1100);
    expect(distribute(vault, 1000, 1100).result).toBeOk(Cl.bool(true));

    // principal wiped (product -> 0), borrows cleared
    expect(state()).toEqual({ supplied: 0, borrows: 0, cash: 0 });
    expect(readUint("balance-of", [Cl.principal(lp1), Cl.uint(0)])).toBe(0);
    // but the LP can claim the seized collateral
    expect(claim(lp1).result).toBeOk(Cl.uint(1100));
  });

  it("distribute rejects non-authorized callers", () => {
    const { lp1, borrower } = accounts();
    mintBorrow(lp1, 100);
    supply(lp1, 100);
    expect(distribute(borrower, 0, 10).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });
});

describe("pool: governance gating", () => {
  beforeEach(setup);

  it("only governance can set authorized callers", () => {
    const { borrower } = accounts();
    expect(
      simnet.callPublicFn(POOL, "set-authorized-caller", [Cl.principal(borrower), Cl.bool(true)], borrower)
        .result
    ).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });
});

describe("pool: one-time borrow fee (netted from disbursed)", () => {
  // Registry error: accrue-fee rejects a pool that isn't an authorized caller.
  const REG_ERR_UNAUTHORIZED = 800;

  // Set market 0's fee config and authorize the pool to record fees in the registry.
  function setFeeAndAuthorizePool(borrowBps: number, lpShareBps: number, authorize = true) {
    const { deployer } = accounts();
    const { poolAddr } = principals();
    simnet.callPublicFn(
      REG,
      "set-fee-config",
      [Cl.uint(0), Cl.uint(borrowBps), Cl.uint(lpShareBps), Cl.uint(2000), Cl.uint(0)],
      deployer
    );
    if (authorize) {
      simnet.callPublicFn(REG, "set-authorized-caller", [Cl.principal(poolAddr), Cl.bool(true)], deployer);
    }
  }
  const treasuryAccrued = () => {
    const { deployer } = accounts();
    const { borrowToken } = principals();
    return Number(
      (simnet.callReadOnlyFn(REG, "get-treasury-accrued", [Cl.uint(0), Cl.principal(borrowToken)], deployer)
        .result as any).value as bigint
    );
  };
  const quote = (amount: number) => {
    const { deployer } = accounts();
    const q = (simnet.callReadOnlyFn(POOL, "get-borrow-fee-quote", [Cl.uint(0), Cl.uint(amount)], deployer)
      .result as any).value;
    return {
      borrowed: Number(q["borrowed"].value),
      fee: Number(q["fee"].value),
      lpFee: Number(q["lp-fee"].value),
      protocolFee: Number(q["protocol-fee"].value),
      disbursed: Number(q["disbursed"].value),
    };
  };

  beforeEach(setup);

  it("LP-share 0 (launch): whole fee -> protocol treasury-accrued; borrower nets amount-fee", () => {
    const { lp1, vault, borrower } = accounts();
    setFeeAndAuthorizePool(200, 0); // 2% borrow fee, 0 to LPs
    mintBorrow(lp1, 10_000);
    supply(lp1, 10_000);

    expect(quote(1000)).toEqual({ borrowed: 1000, fee: 20, lpFee: 0, protocolFee: 20, disbursed: 980 });

    // returns the net disbursed amount
    expect(borrowOut(vault, borrower, 1000).result).toBeOk(Cl.uint(980));
    expect(tokenBalance(BORROW_TOKEN, borrower)).toBe(980);
    expect(state()).toEqual({ supplied: 10_000, borrows: 1000, cash: 9020 });
    expect(treasuryAccrued()).toBe(20); // whole fee to protocol
    // LPs unchanged (lp-share 0)
    expect(readUint("balance-of", [Cl.principal(lp1), Cl.uint(0)])).toBe(10_000);
  });

  it("LP-share 50%: fee split protocol/LP; LP claim grows by its share", () => {
    const { lp1, vault, borrower } = accounts();
    setFeeAndAuthorizePool(200, 5000); // 2% fee, 50% of it to LPs
    mintBorrow(lp1, 10_000);
    supply(lp1, 10_000);

    expect(quote(1000)).toEqual({ borrowed: 1000, fee: 20, lpFee: 10, protocolFee: 10, disbursed: 980 });

    expect(borrowOut(vault, borrower, 1000).result).toBeOk(Cl.uint(980));
    expect(treasuryAccrued()).toBe(10); // protocol half
    // LP half (10) credited pro-rata: lone LP's claim grows 10000 -> 10010
    expect(readUint("balance-of", [Cl.principal(lp1), Cl.uint(0)])).toBe(10_010);
    expect(state()).toEqual({ supplied: 10_010, borrows: 1000, cash: 9020 });
    // invariant: cash + borrows == supplied + treasury-accrued
    expect(9020 + 1000).toBe(10_010 + 10);
  });

  it("borrow-out reverts when the pool is not an authorized fee recorder in the registry", () => {
    const { lp1, vault, borrower } = accounts();
    setFeeAndAuthorizePool(200, 0, /* authorize */ false);
    mintBorrow(lp1, 10_000);
    supply(lp1, 10_000);
    // fee>0 triggers registry accrue-fee, which rejects the unauthorized pool
    expect(borrowOut(vault, borrower, 1000).result).toBeErr(Cl.uint(REG_ERR_UNAUTHORIZED));
  });
});
