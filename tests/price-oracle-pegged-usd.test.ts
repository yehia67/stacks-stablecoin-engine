// Full-coverage tests for price-oracle-pegged-usd-v1: the reusable
// governance-pegged ~$1 USD oracle for SSE Finance.
//
// Exercises every public + read-only function and every branch:
//   - governance handoff (bootstrap-set-governance / lock-bootstrap) and all
//     three is-governance-caller branches (governance caller, pre-lock owner,
//     neither),
//   - set-peg-price deviation guard at/inside/outside both band edges,
//     including the bps=0 (exact-$1 only) and bps=10000 (0..$2) extremes,
//     and the bps cap rejection,
//   - set-max-staleness and the get-price staleness guard (disabled / fresh /
//     stale) plus get-price-info freshness reporting.

import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const ORACLE = "price-oracle-pegged-usd-v1";

const USD_1 = 100_000_000; // $1.00 at 8-decimal PRICE-SCALE

// Error codes (must match the contract).
const ERR_UNAUTHORIZED = 700;
const ERR_BOOTSTRAP_LOCKED = 701;
const ERR_DEVIATION_TOO_LARGE = 702;
const ERR_STALE_PRICE = 703;
const ERR_INVALID_PARAM = 704;

function accounts() {
  const a = simnet.getAccounts();
  const deployer = a.get("deployer")!;
  const wallet1 = a.get("wallet_1")!;
  const wallet2 = a.get("wallet_2")!;
  return { deployer, wallet1, wallet2 };
}

const setPeg = (price: number, caller: string) =>
  simnet.callPublicFn(ORACLE, "set-peg-price", [Cl.uint(price)], caller);
const setDeviation = (bps: number, caller: string) =>
  simnet.callPublicFn(ORACLE, "set-max-deviation-bps", [Cl.uint(bps)], caller);
const setStaleness = (secs: number, caller: string) =>
  simnet.callPublicFn(ORACLE, "set-max-staleness", [Cl.uint(secs)], caller);
const read = (fn: string, caller: string) =>
  simnet.callReadOnlyFn(ORACLE, fn, [], caller);

// Pull a field CV out of the get-price-info tuple.
function infoFieldCV(caller: string, field: string): any {
  const info = read("get-price-info", caller).result as any;
  return info.value[field];
}
const infoUint = (caller: string, field: string): bigint =>
  infoFieldCV(caller, field).value as bigint;
// Booleans in @stacks/transactions v7 are { type: "true" | "false" } (no value).
const infoBool = (caller: string, field: string): boolean =>
  infoFieldCV(caller, field).type === "true";

describe("price-oracle-pegged-usd-v1: initial state", () => {
  it("defaults: peg=$1, last-update=0, staleness off, deviation 2%, governance=deployer, unlocked", () => {
    const { deployer } = accounts();
    expect(read("get-peg-price", deployer).result).toBeUint(USD_1);
    expect(read("get-last-update", deployer).result).toBeUint(0);
    expect(read("get-max-staleness", deployer).result).toBeUint(0);
    expect(read("get-max-deviation-bps", deployer).result).toBeUint(200);
    expect(read("get-governance", deployer).result).toBePrincipal(deployer);
    expect(read("is-bootstrap-locked", deployer).result).toBeBool(false);
  });

  it("get-price returns the $1 peg when staleness is disabled", () => {
    const { wallet1 } = accounts();
    expect(read("get-price", wallet1).result).toBeOk(Cl.uint(USD_1));
  });

  it("get-price-info reports fresh=true with staleness disabled", () => {
    const { wallet1 } = accounts();
    expect(infoUint(wallet1, "price")).toBe(BigInt(USD_1));
    expect(infoUint(wallet1, "max-staleness")).toBe(0n);
    expect(infoBool(wallet1, "fresh")).toBe(true);
  });
});

describe("price-oracle-pegged-usd-v1: set-peg-price deviation guard (default 2% band)", () => {
  // band = USD_1 * 200 / 10000 = 2_000_000 -> [98_000_000, 102_000_000]
  it("accepts the exact peg ($1)", () => {
    const { deployer } = accounts();
    expect(setPeg(USD_1, deployer).result).toBeOk(Cl.bool(true));
    expect(read("get-peg-price", deployer).result).toBeUint(USD_1);
    // last-update is stamped from block time (> 0 after the call)
    expect(Number((read("get-last-update", deployer).result as any).value as bigint)).toBeGreaterThan(0);
  });

  it("accepts the upper band edge (102_000_000)", () => {
    const { deployer } = accounts();
    expect(setPeg(102_000_000, deployer).result).toBeOk(Cl.bool(true));
    expect(read("get-peg-price", deployer).result).toBeUint(102_000_000);
  });

  it("accepts the lower band edge (98_000_000)", () => {
    const { deployer } = accounts();
    expect(setPeg(98_000_000, deployer).result).toBeOk(Cl.bool(true));
    expect(read("get-peg-price", deployer).result).toBeUint(98_000_000);
  });

  it("rejects one tick above the band", () => {
    const { deployer } = accounts();
    expect(setPeg(102_000_001, deployer).result).toBeErr(Cl.uint(ERR_DEVIATION_TOO_LARGE));
  });

  it("rejects one tick below the band", () => {
    const { deployer } = accounts();
    expect(setPeg(97_999_999, deployer).result).toBeErr(Cl.uint(ERR_DEVIATION_TOO_LARGE));
  });
});

describe("price-oracle-pegged-usd-v1: set-max-deviation-bps", () => {
  it("rejects bps above the 10000 cap", () => {
    const { deployer } = accounts();
    expect(setDeviation(10001, deployer).result).toBeErr(Cl.uint(ERR_INVALID_PARAM));
  });

  it("bps=10000 widens the band to [0, $2]", () => {
    const { deployer } = accounts();
    expect(setDeviation(10000, deployer).result).toBeOk(Cl.bool(true));
    expect(read("get-max-deviation-bps", deployer).result).toBeUint(10000);
    expect(setPeg(1, deployer).result).toBeOk(Cl.bool(true)); // lower edge (0..)
    expect(setPeg(200_000_000, deployer).result).toBeOk(Cl.bool(true)); // upper edge $2
    expect(setPeg(200_000_001, deployer).result).toBeErr(Cl.uint(ERR_DEVIATION_TOO_LARGE));
  });

  it("bps=0 pins the peg to exactly $1", () => {
    const { deployer } = accounts();
    expect(setDeviation(0, deployer).result).toBeOk(Cl.bool(true));
    expect(setPeg(USD_1, deployer).result).toBeOk(Cl.bool(true));
    expect(setPeg(USD_1 + 1, deployer).result).toBeErr(Cl.uint(ERR_DEVIATION_TOO_LARGE));
    expect(setPeg(USD_1 - 1, deployer).result).toBeErr(Cl.uint(ERR_DEVIATION_TOO_LARGE));
  });
});

describe("price-oracle-pegged-usd-v1: staleness guard", () => {
  it("get-price stays ok when staleness window is large enough", () => {
    const { deployer, wallet1 } = accounts();
    expect(setPeg(USD_1, deployer).result).toBeOk(Cl.bool(true));
    expect(setStaleness(1_000_000_000_000, deployer).result).toBeOk(Cl.bool(true));
    expect(read("get-price", wallet1).result).toBeOk(Cl.uint(USD_1));
    expect(infoBool(wallet1, "fresh")).toBe(true);
  });

  it("get-price fails ERR_STALE_PRICE once the window elapses", () => {
    const { deployer, wallet1 } = accounts();
    expect(setPeg(USD_1, deployer).result).toBeOk(Cl.bool(true));
    // Advance chain time well past a 1-second window.
    simnet.mineEmptyBlocks(20);
    expect(setStaleness(1, deployer).result).toBeOk(Cl.bool(true));

    const age = Number(infoUint(wallet1, "age"));
    expect(age).toBeGreaterThan(1); // sanity: time actually advanced

    expect(read("get-price", wallet1).result).toBeErr(Cl.uint(ERR_STALE_PRICE));
    expect(infoBool(wallet1, "fresh")).toBe(false);
  });
});

describe("price-oracle-pegged-usd-v1: governance gating", () => {
  it("non-owner cannot set peg / deviation / staleness", () => {
    const { wallet2 } = accounts();
    expect(setPeg(USD_1, wallet2).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(setDeviation(100, wallet2).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    expect(setStaleness(10, wallet2).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });

  it("bootstrap-set-governance rejects non-owner", () => {
    const { wallet1, wallet2 } = accounts();
    expect(
      simnet.callPublicFn(ORACLE, "bootstrap-set-governance", [Cl.principal(wallet1)], wallet2)
        .result
    ).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
  });

  it("lock-bootstrap rejects non-owner", () => {
    const { wallet2 } = accounts();
    expect(simnet.callPublicFn(ORACLE, "lock-bootstrap", [], wallet2).result).toBeErr(
      Cl.uint(ERR_UNAUTHORIZED)
    );
  });

  it("after handoff: new governance can set peg (contract-caller branch)", () => {
    const { deployer, wallet1 } = accounts();
    expect(
      simnet.callPublicFn(ORACLE, "bootstrap-set-governance", [Cl.principal(wallet1)], deployer)
        .result
    ).toBeOk(Cl.bool(true));
    expect(read("get-governance", deployer).result).toBePrincipal(wallet1);
    // wallet1 is now governance -> contract-caller == governance branch
    expect(setPeg(101_000_000, wallet1).result).toBeOk(Cl.bool(true));
  });

  it("pre-lock owner can still set peg even after handoff (owner-fallback branch)", () => {
    const { deployer, wallet1 } = accounts();
    simnet.callPublicFn(ORACLE, "bootstrap-set-governance", [Cl.principal(wallet1)], deployer);
    // governance is wallet1, but bootstrap is unlocked and deployer is owner
    expect(setPeg(99_500_000, deployer).result).toBeOk(Cl.bool(true));
  });

  it("after lock + handoff, the owner loses access (both branches false)", () => {
    const { deployer, wallet1, wallet2 } = accounts();
    simnet.callPublicFn(ORACLE, "bootstrap-set-governance", [Cl.principal(wallet1)], deployer);
    expect(simnet.callPublicFn(ORACLE, "lock-bootstrap", [], deployer).result).toBeOk(
      Cl.bool(true)
    );
    expect(read("is-bootstrap-locked", deployer).result).toBeBool(true);

    // owner no longer governance and bootstrap locked -> rejected
    expect(setPeg(USD_1, deployer).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    // random principal -> rejected
    expect(setPeg(USD_1, wallet2).result).toBeErr(Cl.uint(ERR_UNAUTHORIZED));
    // governance (wallet1) still works
    expect(setPeg(USD_1, wallet1).result).toBeOk(Cl.bool(true));
  });

  it("bootstrap-set-governance rejects once bootstrap is locked", () => {
    const { deployer, wallet2 } = accounts();
    expect(simnet.callPublicFn(ORACLE, "lock-bootstrap", [], deployer).result).toBeOk(
      Cl.bool(true)
    );
    expect(
      simnet.callPublicFn(ORACLE, "bootstrap-set-governance", [Cl.principal(wallet2)], deployer)
        .result
    ).toBeErr(Cl.uint(ERR_BOOTSTRAP_LOCKED));
  });
});

describe("price-oracle-pegged-usd-v1: introspection getters", () => {
  it("getters reflect updated values", () => {
    const { deployer } = accounts();
    setDeviation(500, deployer);
    setStaleness(3600, deployer);
    setPeg(101_000_000, deployer);

    expect(read("get-max-deviation-bps", deployer).result).toBeUint(500);
    expect(read("get-max-staleness", deployer).result).toBeUint(3600);
    expect(read("get-peg-price", deployer).result).toBeUint(101_000_000);
    expect(Number((read("get-last-update", deployer).result as any).value as bigint)).toBeGreaterThan(0);
  });
});
