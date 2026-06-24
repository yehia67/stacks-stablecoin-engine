// Full-coverage tests for sse-finance-collateral-matrix-v1: the collateral<->market
// risk matrix. One row per accepted {market, collateral} pair; absence of a row
// means the pair is not borrowable.
//
// Exercises every public + read-only function and every branch:
//   - add-collateral-to-market (happy, market-not-found, pair-exists, bad ratios),
//   - update-collateral-risk (happy preserving enabled, not-found, bad ratios),
//   - set-pair-enabled (toggle, not-found),
//   - get-collateral-risk / get-pair-status (all five params in one call) /
//     is-pair-enabled (absence => false), per-market enumeration,
//   - governance gating + all three is-governance-caller branches,
//   - the no-stability-fee / interest-free invariant.

import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const REG = "sse-finance-market-registry-v1";
const MATRIX = "sse-finance-collateral-matrix-v1";

// Matrix error codes (must match the contract).
const ERR_UNAUTHORIZED = 900;
const ERR_BOOTSTRAP_LOCKED = 901;
const ERR_MARKET_NOT_FOUND = 902;
const ERR_PAIR_EXISTS = 903;
const ERR_PAIR_NOT_FOUND = 904;
const ERR_INVALID_RATIO = 905;

function accounts() {
  const a = simnet.getAccounts();
  const deployer = a.get("deployer")!;
  const wallet1 = a.get("wallet_1")!;
  const wallet2 = a.get("wallet_2")!;
  const wallet3 = a.get("wallet_3")!;
  return { deployer, wallet1, wallet2, wallet3 };
}

// Stand-in collateral asset principals (the matrix only stores them).
function collats() {
  const { wallet1, wallet2 } = accounts();
  return { sbtc: wallet1, vgld: wallet2 };
}

// Risk params: 150% min / 120% liq / 10% penalty / floor / ceiling.
const RISK = { min: 150, liq: 120, penalty: 1000, floor: 100, ceiling: 1_000_000 };

// Register market 0 so the matrix's market-exists check passes.
function registerMarket0(caller: string) {
  const { wallet3 } = accounts();
  return simnet.callPublicFn(
    REG,
    "register-market",
    [
      Cl.principal(wallet3), // borrow-token (stand-in)
      Cl.principal(wallet3), // oracle (stand-in)
      Cl.uint(1_000_000),
      Cl.uint(50),
      Cl.uint(0),
      Cl.uint(2000),
      Cl.uint(0),
    ],
    caller
  );
}

const addPair = (
  caller: string,
  marketId: number,
  collateral: string,
  risk = RISK
) =>
  simnet.callPublicFn(
    MATRIX,
    "add-collateral-to-market",
    [
      Cl.uint(marketId),
      Cl.principal(collateral),
      Cl.uint(risk.min),
      Cl.uint(risk.liq),
      Cl.uint(risk.penalty),
      Cl.uint(risk.floor),
      Cl.uint(risk.ceiling),
    ],
    caller
  );

const updatePair = (
  caller: string,
  marketId: number,
  collateral: string,
  risk: typeof RISK
) =>
  simnet.callPublicFn(
    MATRIX,
    "update-collateral-risk",
    [
      Cl.uint(marketId),
      Cl.principal(collateral),
      Cl.uint(risk.min),
      Cl.uint(risk.liq),
      Cl.uint(risk.penalty),
      Cl.uint(risk.floor),
      Cl.uint(risk.ceiling),
    ],
    caller
  );

const read = (fn: string, args: any[], caller: string) =>
  simnet.callReadOnlyFn(MATRIX, fn, args, caller);
const someTupleFields = (res: any) => res.value.value; // optional<tuple> -> dict
const riskFields = (id: number, collateral: string, caller: string) =>
  someTupleFields(read("get-collateral-risk", [Cl.uint(id), Cl.principal(collateral)], caller).result);
const statusFields = (id: number, collateral: string, caller: string) =>
  someTupleFields(read("get-pair-status", [Cl.uint(id), Cl.principal(collateral)], caller).result);

describe("collateral-matrix: write + read back all five params", () => {
  beforeEach(() => registerMarket0(accounts().deployer));

  it("absence of a row means the pair is not borrowable", () => {
    const { deployer } = accounts();
    const { sbtc } = collats();
    expect(read("get-collateral-risk", [Cl.uint(0), Cl.principal(sbtc)], deployer).result).toBeNone();
    expect(read("get-pair-status", [Cl.uint(0), Cl.principal(sbtc)], deployer).result).toBeNone();
    expect(read("is-pair-enabled", [Cl.uint(0), Cl.principal(sbtc)], deployer).result).toBeBool(false);
  });

  it("writes a pair and reads back all five risk params + enabled", () => {
    const { deployer } = accounts();
    const { sbtc } = collats();
    expect(addPair(deployer, 0, sbtc).result).toBeOk(Cl.bool(true));

    const r = riskFields(0, sbtc, deployer);
    expect(r["min-collateral-ratio"]).toBeUint(RISK.min);
    expect(r["liquidation-ratio"]).toBeUint(RISK.liq);
    expect(r["liquidation-penalty"]).toBeUint(RISK.penalty);
    expect(r["debt-floor"]).toBeUint(RISK.floor);
    expect(r["debt-ceiling"]).toBeUint(RISK.ceiling);
    expect(r["enabled"]).toBeBool(true);
    // INTEREST-FREE: no stability-fee / interest field exists.
    expect(r["stability-fee"]).toBeUndefined();

    expect(read("is-pair-enabled", [Cl.uint(0), Cl.principal(sbtc)], deployer).result).toBeBool(true);
  });

  it("get-pair-status returns enabled + all five params in one call", () => {
    const { deployer } = accounts();
    const { sbtc } = collats();
    addPair(deployer, 0, sbtc);
    const s = statusFields(0, sbtc, deployer);
    expect(s["enabled"]).toBeBool(true);
    expect(s["min-collateral-ratio"]).toBeUint(RISK.min);
    expect(s["liquidation-ratio"]).toBeUint(RISK.liq);
    expect(s["liquidation-penalty"]).toBeUint(RISK.penalty);
    expect(s["debt-floor"]).toBeUint(RISK.floor);
    expect(s["debt-ceiling"]).toBeUint(RISK.ceiling);
  });
});

describe("collateral-matrix: add-collateral-to-market guards", () => {
  beforeEach(() => registerMarket0(accounts().deployer));

  it("rejects a non-existent market", () => {
    const { deployer } = accounts();
    const { sbtc } = collats();
    expect(addPair(deployer, 7, sbtc).result).toBeErr(Cl.uint(ERR_MARKET_NOT_FOUND));
  });

  it("rejects a duplicate pair", () => {
    const { deployer } = accounts();
    const { sbtc } = collats();
    expect(addPair(deployer, 0, sbtc).result).toBeOk(Cl.bool(true));
    expect(addPair(deployer, 0, sbtc).result).toBeErr(Cl.uint(ERR_PAIR_EXISTS));
  });

  it("rejects invalid ratios (min<=100, liq<=100, liq>min)", () => {
    const { deployer } = accounts();
    const { sbtc } = collats();
    expect(addPair(deployer, 0, sbtc, { ...RISK, min: 100 }).result).toBeErr(Cl.uint(ERR_INVALID_RATIO));
    expect(addPair(deployer, 0, sbtc, { ...RISK, liq: 100 }).result).toBeErr(Cl.uint(ERR_INVALID_RATIO));
    expect(addPair(deployer, 0, sbtc, { ...RISK, min: 120, liq: 130 }).result).toBeErr(
      Cl.uint(ERR_INVALID_RATIO)
    );
    // nothing was written
    expect(read("get-collateral-risk", [Cl.uint(0), Cl.principal(sbtc)], deployer).result).toBeNone();
  });

  it("accepts liq == min (the boundary)", () => {
    const { deployer } = accounts();
    const { sbtc } = collats();
    expect(addPair(deployer, 0, sbtc, { ...RISK, min: 150, liq: 150 }).result).toBeOk(Cl.bool(true));
  });
});

describe("collateral-matrix: per-market enumeration", () => {
  beforeEach(() => registerMarket0(accounts().deployer));

  it("counts and lists every collateral for a market", () => {
    const { deployer } = accounts();
    const { sbtc, vgld } = collats();
    expect(read("get-market-collateral-count", [Cl.uint(0)], deployer).result).toBeUint(0);

    addPair(deployer, 0, sbtc);
    addPair(deployer, 0, vgld);

    expect(read("get-market-collateral-count", [Cl.uint(0)], deployer).result).toBeUint(2);
    expect(
      someTupleFields(read("get-market-collateral-at-index", [Cl.uint(0), Cl.uint(0)], deployer).result)["collateral"]
    ).toBePrincipal(sbtc);
    expect(
      someTupleFields(read("get-market-collateral-at-index", [Cl.uint(0), Cl.uint(1)], deployer).result)["collateral"]
    ).toBePrincipal(vgld);
    // out-of-range index
    expect(read("get-market-collateral-at-index", [Cl.uint(0), Cl.uint(2)], deployer).result).toBeNone();
  });
});

describe("collateral-matrix: update-collateral-risk", () => {
  beforeEach(() => {
    const { deployer } = accounts();
    registerMarket0(deployer);
    addPair(deployer, 0, collats().sbtc);
  });

  it("updates params and preserves the enabled flag", () => {
    const { deployer } = accounts();
    const { sbtc } = collats();
    // disable first; update must preserve the disabled state
    simnet.callPublicFn(MATRIX, "set-pair-enabled", [Cl.uint(0), Cl.principal(sbtc), Cl.bool(false)], deployer);

    const next = { min: 160, liq: 125, penalty: 800, floor: 50, ceiling: 2_000_000 };
    expect(updatePair(deployer, 0, sbtc, next).result).toBeOk(Cl.bool(true));

    const r = riskFields(0, sbtc, deployer);
    expect(r["min-collateral-ratio"]).toBeUint(160);
    expect(r["liquidation-ratio"]).toBeUint(125);
    expect(r["liquidation-penalty"]).toBeUint(800);
    expect(r["debt-floor"]).toBeUint(50);
    expect(r["debt-ceiling"]).toBeUint(2_000_000);
    expect(r["enabled"]).toBeBool(false); // preserved
  });

  it("rejects an unconfigured pair", () => {
    const { deployer } = accounts();
    const { vgld } = collats();
    expect(updatePair(deployer, 0, vgld, RISK).result).toBeErr(Cl.uint(ERR_PAIR_NOT_FOUND));
  });

  it("rejects invalid ratios", () => {
    const { deployer } = accounts();
    const { sbtc } = collats();
    expect(updatePair(deployer, 0, sbtc, { ...RISK, min: 120, liq: 130 }).result).toBeErr(
      Cl.uint(ERR_INVALID_RATIO)
    );
  });
});

describe("collateral-matrix: set-pair-enabled", () => {
  beforeEach(() => {
    const { deployer } = accounts();
    registerMarket0(deployer);
    addPair(deployer, 0, collats().sbtc);
  });

  it("toggles enabled without disturbing params", () => {
    const { deployer } = accounts();
    const { sbtc } = collats();
    expect(
      simnet.callPublicFn(MATRIX, "set-pair-enabled", [Cl.uint(0), Cl.principal(sbtc), Cl.bool(false)], deployer).result
    ).toBeOk(Cl.bool(true));
    expect(read("is-pair-enabled", [Cl.uint(0), Cl.principal(sbtc)], deployer).result).toBeBool(false);
    // params intact
    expect(riskFields(0, sbtc, deployer)["min-collateral-ratio"]).toBeUint(RISK.min);

    simnet.callPublicFn(MATRIX, "set-pair-enabled", [Cl.uint(0), Cl.principal(sbtc), Cl.bool(true)], deployer);
    expect(read("is-pair-enabled", [Cl.uint(0), Cl.principal(sbtc)], deployer).result).toBeBool(true);
  });

  it("rejects an unconfigured pair", () => {
    const { deployer } = accounts();
    const { vgld } = collats();
    expect(
      simnet.callPublicFn(MATRIX, "set-pair-enabled", [Cl.uint(0), Cl.principal(vgld), Cl.bool(true)], deployer).result
    ).toBeErr(Cl.uint(ERR_PAIR_NOT_FOUND));
  });
});

describe("collateral-matrix: governance gating", () => {
  beforeEach(() => registerMarket0(accounts().deployer));

  it("non-governance cannot add / update / toggle", () => {
    const { deployer, wallet3 } = accounts();
    const { sbtc } = collats();
    addPair(deployer, 0, sbtc); // exists

    expect(addPair(wallet3, 0, collats().vgld).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(updatePair(wallet3, 0, sbtc, RISK).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(
      simnet.callPublicFn(MATRIX, "set-pair-enabled", [Cl.uint(0), Cl.principal(sbtc), Cl.bool(false)], wallet3).result
    ).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });

  it("after handoff + lock: pre-lock owner loses access, new governance keeps it", () => {
    const { deployer, wallet1, wallet2 } = accounts();
    const { sbtc } = collats();
    expect(
      simnet.callPublicFn(MATRIX, "bootstrap-set-governance", [Cl.principal(wallet1)], deployer).result
    ).toBeOk(Cl.bool(true));
    expect(simnet.callPublicFn(MATRIX, "lock-bootstrap", [], deployer).result).toBeOk(Cl.bool(true));

    // deployer is owner but bootstrap locked + not governance -> rejected
    expect(addPair(deployer, 0, sbtc).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(addPair(wallet2, 0, sbtc).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    // governance wallet1 (contract-caller branch) -> ok
    expect(addPair(wallet1, 0, sbtc).result).toBeOk(Cl.bool(true));
  });

  it("bootstrap setters reject non-owner; set-gov rejects once locked", () => {
    const { deployer, wallet2 } = accounts();
    expect(
      simnet.callPublicFn(MATRIX, "bootstrap-set-governance", [Cl.principal(wallet2)], wallet2).result
    ).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(simnet.callPublicFn(MATRIX, "lock-bootstrap", [], wallet2).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(simnet.callPublicFn(MATRIX, "lock-bootstrap", [], deployer).result).toBeOk(Cl.bool(true));
    expect(
      simnet.callPublicFn(MATRIX, "bootstrap-set-governance", [Cl.principal(wallet2)], deployer).result
    ).toBeErr(Cl.uint(ERR_BOOTSTRAP_LOCKED));
  });
});
