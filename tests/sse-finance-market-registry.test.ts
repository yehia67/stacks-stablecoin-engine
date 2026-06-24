// Full-coverage tests for sse-finance-market-registry-v1: the standard import
// path by which any SIP-010 stablecoin becomes a borrowable market.
//
// Exercises every public + read-only function and every branch:
//   - register-market / update-market / set-market-paused (happy + not-found),
//   - the separate fee-config map, independently updatable, with hard-cap
//     rejection on every fee field (at cap = ok, one tick over = err),
//   - enumerable market list (sequential ids, get-market-count / get-market),
//   - treasury recipient (governance) + treasury-accrued accrual/clear gated to
//     authorized callers,
//   - all three is-governance-caller branches and the authorized-caller gate,
//   - the no-reserve-factor / interest-free invariant (no such field exists).

import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const REG = "sse-finance-market-registry-v1";

// Error codes (must match the contract).
const ERR_UNAUTHORIZED = 800;
const ERR_BOOTSTRAP_LOCKED = 801;
const ERR_MARKET_NOT_FOUND = 802;
const ERR_FEE_TOO_HIGH = 803;

// Hard caps (must match the contract).
const MAX_BORROW_FEE = 200;
const MAX_BORROW_FEE_LP_SHARE = 10000;
const MAX_PROTOCOL_LIQ_SHARE = 5000;
const MAX_EARLY_REPAY = 200;

function accounts() {
  const a = simnet.getAccounts();
  const deployer = a.get("deployer")!;
  const wallet1 = a.get("wallet_1")!;
  const wallet2 = a.get("wallet_2")!;
  const wallet3 = a.get("wallet_3")!;
  return { deployer, wallet1, wallet2, wallet3 };
}

// Stand-in principals for a borrow token and an oracle. The registry only stores
// these, so any principal serves for registry-level tests.
function fixtures() {
  const { wallet1, wallet2 } = accounts();
  return { token: wallet1, oracle: wallet2 };
}

// Launch fee defaults: borrow fee 0.5% (50 bps), LP share 0 (liq-only launch
// decision), protocol liq share 20% (2000 bps), no early-repay fee.
const FEES = { borrow: 50, lpShare: 0, liqShare: 2000, early: 0 };

const registerMarket = (
  caller: string,
  token: string,
  oracle: string,
  cap: number,
  fees = FEES
) =>
  simnet.callPublicFn(
    REG,
    "register-market",
    [
      Cl.principal(token),
      Cl.principal(oracle),
      Cl.uint(cap),
      Cl.uint(fees.borrow),
      Cl.uint(fees.lpShare),
      Cl.uint(fees.liqShare),
      Cl.uint(fees.early),
    ],
    caller
  );

const setFeeConfig = (caller: string, id: number, fees: typeof FEES) =>
  simnet.callPublicFn(
    REG,
    "set-fee-config",
    [
      Cl.uint(id),
      Cl.uint(fees.borrow),
      Cl.uint(fees.lpShare),
      Cl.uint(fees.liqShare),
      Cl.uint(fees.early),
    ],
    caller
  );

const read = (fn: string, args: any[], caller: string) =>
  simnet.callReadOnlyFn(REG, fn, args, caller);

// Field dict of a plain (response/bare) tuple CV.
const tupleFields = (res: any) => res.value;
// Field dict of an (optional tuple) CV: unwrap the `some`, then the tuple.
const someTupleFields = (res: any) => res.value.value;
const marketFields = (id: number, caller: string) =>
  someTupleFields(read("get-market", [Cl.uint(id)], caller).result);
const feeFields = (id: number, caller: string) =>
  someTupleFields(read("get-fee-config", [Cl.uint(id)], caller).result);

describe("market-registry: initial state", () => {
  it("defaults: zero markets, governance=deployer, unlocked, treasury=deployer", () => {
    const { deployer } = accounts();
    expect(read("get-market-count", [], deployer).result).toBeUint(0);
    expect(read("get-governance", [], deployer).result).toBePrincipal(deployer);
    expect(read("is-bootstrap-locked", [], deployer).result).toBeBool(false);
    expect(read("get-treasury", [], deployer).result).toBePrincipal(deployer);
    expect(read("get-market", [Cl.uint(0)], deployer).result).toBeNone();
    expect(read("get-fee-config", [Cl.uint(0)], deployer).result).toBeNone();
  });

  it("exposes the immutable fee caps", () => {
    const { deployer } = accounts();
    const caps = tupleFields(read("get-fee-caps", [], deployer).result);
    expect(caps["max-borrow-fee"]).toBeUint(MAX_BORROW_FEE);
    expect(caps["max-borrow-fee-lp-share"]).toBeUint(MAX_BORROW_FEE_LP_SHARE);
    expect(caps["max-protocol-liq-share"]).toBeUint(MAX_PROTOCOL_LIQ_SHARE);
    expect(caps["max-early-repay"]).toBeUint(MAX_EARLY_REPAY);
  });
});

describe("market-registry: register + read back + enumeration", () => {
  it("registers a market, returns id 0, and reads it back", () => {
    const { deployer } = accounts();
    const { token, oracle } = fixtures();
    expect(registerMarket(deployer, token, oracle, 1_000_000).result).toBeOk(Cl.uint(0));

    expect(read("get-market-count", [], deployer).result).toBeUint(1);
    const m = marketFields(0, deployer);
    expect(m["borrow-token"]).toBePrincipal(token);
    expect(m["oracle"]).toBePrincipal(oracle);
    expect(m["borrow-cap"]).toBeUint(1_000_000);
    expect(m["enabled"]).toBeBool(true);
    expect(m["paused"]).toBeBool(false);

    // convenience getters
    expect(read("get-borrow-token", [Cl.uint(0)], deployer).result).toBeSome(Cl.principal(token));
    expect(read("get-oracle", [Cl.uint(0)], deployer).result).toBeSome(Cl.principal(oracle));
    expect(read("get-borrow-cap", [Cl.uint(0)], deployer).result).toBeSome(Cl.uint(1_000_000));
    expect(read("is-market-enabled", [Cl.uint(0)], deployer).result).toBeBool(true);
    expect(read("is-market-paused", [Cl.uint(0)], deployer).result).toBeBool(false);
    expect(read("is-market-active", [Cl.uint(0)], deployer).result).toBeBool(true);
  });

  it("assigns sequential ids and the list enumerates every market", () => {
    const { deployer, wallet1, wallet2, wallet3 } = accounts();
    expect(registerMarket(deployer, wallet1, wallet2, 100).result).toBeOk(Cl.uint(0));
    expect(registerMarket(deployer, wallet2, wallet3, 200).result).toBeOk(Cl.uint(1));
    expect(registerMarket(deployer, wallet3, wallet1, 300).result).toBeOk(Cl.uint(2));

    expect(read("get-market-count", [], deployer).result).toBeUint(3);
    for (let id = 0; id < 3; id++) {
      expect(read("get-market", [Cl.uint(id)], deployer).result).not.toBeNone();
    }
  });

  it("seeds the fee-config from register-market (launch LP share = 0)", () => {
    const { deployer } = accounts();
    const { token, oracle } = fixtures();
    registerMarket(deployer, token, oracle, 100);
    const fc = feeFields(0, deployer);
    expect(fc["borrow-fee-bps"]).toBeUint(FEES.borrow);
    expect(fc["borrow-fee-lp-share-bps"]).toBeUint(0);
    expect(fc["protocol-liq-share-bps"]).toBeUint(FEES.liqShare);
    expect(fc["early-repay-fee-bps"]).toBeUint(FEES.early);
    // INTEREST-FREE: no reserve-factor / interest / index field exists.
    expect(fc["reserve-factor-bps"]).toBeUndefined();
    expect(fc["interest-rate-bps"]).toBeUndefined();
  });
});

describe("market-registry: register-market fee caps", () => {
  it("accepts every fee exactly at its cap", () => {
    const { deployer } = accounts();
    const { token, oracle } = fixtures();
    expect(
      registerMarket(deployer, token, oracle, 100, {
        borrow: MAX_BORROW_FEE,
        lpShare: MAX_BORROW_FEE_LP_SHARE,
        liqShare: MAX_PROTOCOL_LIQ_SHARE,
        early: MAX_EARLY_REPAY,
      }).result
    ).toBeOk(Cl.uint(0));
  });

  it("rejects each fee one tick above its cap and stores nothing", () => {
    const { deployer } = accounts();
    const { token, oracle } = fixtures();
    const over = [
      { ...FEES, borrow: MAX_BORROW_FEE + 1 },
      { ...FEES, lpShare: MAX_BORROW_FEE_LP_SHARE + 1 },
      { ...FEES, liqShare: MAX_PROTOCOL_LIQ_SHARE + 1 },
      { ...FEES, early: MAX_EARLY_REPAY + 1 },
    ];
    for (const fees of over) {
      expect(registerMarket(deployer, token, oracle, 100, fees).result).toBeErr(
        Cl.uint(ERR_FEE_TOO_HIGH)
      );
    }
    // nothing was registered
    expect(read("get-market-count", [], deployer).result).toBeUint(0);
  });
});

describe("market-registry: update-market", () => {
  it("updates wiring (token, oracle, cap, enabled) without touching fees/paused", () => {
    const { deployer, wallet3 } = accounts();
    const { token, oracle } = fixtures();
    registerMarket(deployer, token, oracle, 100);
    // pause first; update-market must leave paused untouched
    simnet.callPublicFn(REG, "set-market-paused", [Cl.uint(0), Cl.bool(true)], deployer);

    expect(
      simnet.callPublicFn(
        REG,
        "update-market",
        [Cl.uint(0), Cl.principal(wallet3), Cl.principal(wallet3), Cl.uint(999), Cl.bool(false)],
        deployer
      ).result
    ).toBeOk(Cl.bool(true));

    const m = marketFields(0, deployer);
    expect(m["oracle"]).toBePrincipal(wallet3); // re-pointed oracle
    expect(m["borrow-cap"]).toBeUint(999);
    expect(m["enabled"]).toBeBool(false);
    expect(m["paused"]).toBeBool(true); // preserved
    // fees untouched
    expect(feeFields(0, deployer)["borrow-fee-bps"]).toBeUint(FEES.borrow);
  });

  it("reverts on a non-existent market", () => {
    const { deployer, wallet3 } = accounts();
    expect(
      simnet.callPublicFn(
        REG,
        "update-market",
        [Cl.uint(7), Cl.principal(wallet3), Cl.principal(wallet3), Cl.uint(1), Cl.bool(true)],
        deployer
      ).result
    ).toBeErr(Cl.uint(ERR_MARKET_NOT_FOUND));
  });
});

describe("market-registry: set-market-paused", () => {
  it("pauses and un-pauses; is-market-active reflects it", () => {
    const { deployer } = accounts();
    const { token, oracle } = fixtures();
    registerMarket(deployer, token, oracle, 100);

    expect(
      simnet.callPublicFn(REG, "set-market-paused", [Cl.uint(0), Cl.bool(true)], deployer).result
    ).toBeOk(Cl.bool(true));
    expect(read("is-market-paused", [Cl.uint(0)], deployer).result).toBeBool(true);
    expect(read("is-market-active", [Cl.uint(0)], deployer).result).toBeBool(false);
    // still enabled -- pause is independent of enabled
    expect(read("is-market-enabled", [Cl.uint(0)], deployer).result).toBeBool(true);

    simnet.callPublicFn(REG, "set-market-paused", [Cl.uint(0), Cl.bool(false)], deployer);
    expect(read("is-market-active", [Cl.uint(0)], deployer).result).toBeBool(true);
  });

  it("reverts on a non-existent market", () => {
    const { deployer } = accounts();
    expect(
      simnet.callPublicFn(REG, "set-market-paused", [Cl.uint(9), Cl.bool(true)], deployer).result
    ).toBeErr(Cl.uint(ERR_MARKET_NOT_FOUND));
  });
});

describe("market-registry: set-fee-config (independent of wiring)", () => {
  it("updates fees without touching the market wiring", () => {
    const { deployer } = accounts();
    const { token, oracle } = fixtures();
    registerMarket(deployer, token, oracle, 100);

    // raise the LP baseline-incentive dial post-launch
    expect(setFeeConfig(deployer, 0, { borrow: 100, lpShare: 3000, liqShare: 4000, early: 25 }).result)
      .toBeOk(Cl.bool(true));

    const fc = feeFields(0, deployer);
    expect(fc["borrow-fee-bps"]).toBeUint(100);
    expect(fc["borrow-fee-lp-share-bps"]).toBeUint(3000);
    expect(fc["protocol-liq-share-bps"]).toBeUint(4000);
    expect(fc["early-repay-fee-bps"]).toBeUint(25);

    // market wiring unchanged
    const m = marketFields(0, deployer);
    expect(m["borrow-token"]).toBePrincipal(token);
    expect(m["oracle"]).toBePrincipal(oracle);
    expect(m["borrow-cap"]).toBeUint(100);
  });

  it("accepts every fee at its cap", () => {
    const { deployer } = accounts();
    const { token, oracle } = fixtures();
    registerMarket(deployer, token, oracle, 100);
    expect(
      setFeeConfig(deployer, 0, {
        borrow: MAX_BORROW_FEE,
        lpShare: MAX_BORROW_FEE_LP_SHARE,
        liqShare: MAX_PROTOCOL_LIQ_SHARE,
        early: MAX_EARLY_REPAY,
      }).result
    ).toBeOk(Cl.bool(true));
  });

  it("rejects each fee one tick over its cap", () => {
    const { deployer } = accounts();
    const { token, oracle } = fixtures();
    registerMarket(deployer, token, oracle, 100);
    const over = [
      { ...FEES, borrow: MAX_BORROW_FEE + 1 },
      { ...FEES, lpShare: MAX_BORROW_FEE_LP_SHARE + 1 },
      { ...FEES, liqShare: MAX_PROTOCOL_LIQ_SHARE + 1 },
      { ...FEES, early: MAX_EARLY_REPAY + 1 },
    ];
    for (const fees of over) {
      expect(setFeeConfig(deployer, 0, fees).result).toBeErr(Cl.uint(ERR_FEE_TOO_HIGH));
    }
  });

  it("reverts on a non-existent market", () => {
    const { deployer } = accounts();
    expect(setFeeConfig(deployer, 3, FEES).result).toBeErr(Cl.uint(ERR_MARKET_NOT_FOUND));
  });
});

describe("market-registry: governance gating", () => {
  it("non-governance cannot register / update / pause / set fees / set treasury / authorize", () => {
    const { deployer, wallet2, wallet3 } = accounts();
    const { token, oracle } = fixtures();
    registerMarket(deployer, token, oracle, 100); // exists as id 0

    expect(registerMarket(wallet3, token, oracle, 100).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(
      simnet.callPublicFn(
        REG,
        "update-market",
        [Cl.uint(0), Cl.principal(token), Cl.principal(oracle), Cl.uint(1), Cl.bool(true)],
        wallet3
      ).result
    ).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(
      simnet.callPublicFn(REG, "set-market-paused", [Cl.uint(0), Cl.bool(true)], wallet3).result
    ).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(setFeeConfig(wallet3, 0, FEES).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(
      simnet.callPublicFn(REG, "set-treasury", [Cl.principal(wallet2)], wallet3).result
    ).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(
      simnet.callPublicFn(
        REG,
        "set-authorized-caller",
        [Cl.principal(wallet2), Cl.bool(true)],
        wallet3
      ).result
    ).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });

  it("after handoff + lock, the pre-lock owner loses access; new governance keeps it", () => {
    const { deployer, wallet1, wallet2 } = accounts();
    const { token, oracle } = fixtures();
    // hand governance to wallet1, then lock bootstrap
    expect(
      simnet.callPublicFn(REG, "bootstrap-set-governance", [Cl.principal(wallet1)], deployer).result
    ).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(REG, "lock-bootstrap", [], deployer).result).toBeOk(Cl.bool(true));

    // deployer (owner) no longer governance and bootstrap locked -> rejected
    expect(registerMarket(deployer, token, oracle, 100).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    // random principal -> rejected
    expect(registerMarket(wallet2, token, oracle, 100).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    // governance (wallet1, contract-caller branch) -> ok
    expect(registerMarket(wallet1, token, oracle, 100).result).toBeOk(Cl.uint(0));
  });

  it("bootstrap-set-governance / lock-bootstrap reject non-owner; set-gov rejects once locked", () => {
    const { deployer, wallet2 } = accounts();
    expect(
      simnet.callPublicFn(REG, "bootstrap-set-governance", [Cl.principal(wallet2)], wallet2).result
    ).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(simnet.callPublicFn(REG, "lock-bootstrap", [], wallet2).result).toBeErr(
      Cl.uint(ERR_UNAUTHORIZED)
    );
    expect(simnet.callPublicFn(REG, "lock-bootstrap", [], deployer).result).toBeOk(Cl.bool(true));
    expect(
      simnet.callPublicFn(REG, "bootstrap-set-governance", [Cl.principal(wallet2)], deployer).result
    ).toBeErr(Cl.uint(ERR_BOOTSTRAP_LOCKED));
  });
});

describe("market-registry: treasury + accrual", () => {
  it("governance sets the treasury recipient", () => {
    const { deployer, wallet3 } = accounts();
    expect(
      simnet.callPublicFn(REG, "set-treasury", [Cl.principal(wallet3)], deployer).result
    ).toBeOk(Cl.bool(true));
    expect(read("get-treasury", [], deployer).result).toBePrincipal(wallet3);
  });

  it("accrue-fee / clear-treasury-accrued are gated to authorized callers", () => {
    const { deployer, wallet1, wallet3 } = accounts();
    const { token } = fixtures();
    // not authorized yet
    expect(
      simnet.callPublicFn(
        REG,
        "accrue-fee",
        [Cl.uint(0), Cl.principal(token), Cl.uint(500)],
        wallet3
      ).result
    ).toBeErr(Cl.uint(ERR_UNAUTHORIZED));

    // authorize wallet3 as a caller (stands in for the vault/pool)
    expect(
      simnet.callPublicFn(
        REG,
        "set-authorized-caller",
        [Cl.principal(wallet3), Cl.bool(true)],
        deployer
      ).result
    ).toBeOk(Cl.bool(true));
    expect(read("is-caller-authorized", [Cl.principal(wallet3)], deployer).result).toBeBool(true);

    // accrue twice -> accumulates
    expect(
      simnet.callPublicFn(
        REG,
        "accrue-fee",
        [Cl.uint(0), Cl.principal(token), Cl.uint(500)],
        wallet3
      ).result
    ).toBeOk(Cl.uint(500));
    expect(
      simnet.callPublicFn(
        REG,
        "accrue-fee",
        [Cl.uint(0), Cl.principal(token), Cl.uint(250)],
        wallet3
      ).result
    ).toBeOk(Cl.uint(750));
    expect(
      read("get-treasury-accrued", [Cl.uint(0), Cl.principal(token)], deployer).result
    ).toBeUint(750);

    // clear returns the swept amount and zeroes the bucket
    expect(
      simnet.callPublicFn(
        REG,
        "clear-treasury-accrued",
        [Cl.uint(0), Cl.principal(token)],
        wallet3
      ).result
    ).toBeOk(Cl.uint(750));
    expect(
      read("get-treasury-accrued", [Cl.uint(0), Cl.principal(token)], deployer).result
    ).toBeUint(0);

    // de-authorize -> rejected again
    simnet.callPublicFn(
      REG,
      "set-authorized-caller",
      [Cl.principal(wallet3), Cl.bool(false)],
      deployer
    );
    expect(
      simnet.callPublicFn(
        REG,
        "clear-treasury-accrued",
        [Cl.uint(0), Cl.principal(token)],
        wallet3
      ).result
    ).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });

  it("accrual is isolated per {market, token}", () => {
    const { deployer, wallet1, wallet2, wallet3 } = accounts();
    simnet.callPublicFn(
      REG,
      "set-authorized-caller",
      [Cl.principal(wallet3), Cl.bool(true)],
      deployer
    );
    simnet.callPublicFn(REG, "accrue-fee", [Cl.uint(0), Cl.principal(wallet1), Cl.uint(10)], wallet3);
    simnet.callPublicFn(REG, "accrue-fee", [Cl.uint(1), Cl.principal(wallet1), Cl.uint(20)], wallet3);
    simnet.callPublicFn(REG, "accrue-fee", [Cl.uint(0), Cl.principal(wallet2), Cl.uint(30)], wallet3);

    expect(read("get-treasury-accrued", [Cl.uint(0), Cl.principal(wallet1)], deployer).result).toBeUint(10);
    expect(read("get-treasury-accrued", [Cl.uint(1), Cl.principal(wallet1)], deployer).result).toBeUint(20);
    expect(read("get-treasury-accrued", [Cl.uint(0), Cl.principal(wallet2)], deployer).result).toBeUint(30);
    // untouched pair reads zero
    expect(read("get-treasury-accrued", [Cl.uint(2), Cl.principal(wallet1)], deployer).result).toBeUint(0);
  });
});
