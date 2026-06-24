// Tests for sse-finance-timelock-v1: the queue/execute/cancel governance gate for
// the SSE Finance admin surface. Verifies that once a contract's governance var
// points at the timelock and bootstrap is locked, admin functions are reachable
// ONLY through the timelock; the full delay applies; pause is a no-delay
// emergency path; the guardian can cancel; and the delay floor cannot be bypassed.
//
// Admin + guardian roles come from sse-governance-v1 (deployer by default).

import { describe, expect, it, beforeEach } from "vitest";
import { Cl, serializeCV } from "@stacks/transactions";

const TL = "sse-finance-timelock-v1";
const REG = "sse-finance-market-registry-v1";
const DELAY = 144;

// targets / fns (must match the contract)
const TARGET_REGISTRY = 1;
const TARGET_SELF = 7;
const FN_REG_SET_PAUSED = 3;
const FN_REG_SET_TREASURY = 5;
const FN_SELF_SET_DELAY = 1;

// timelock errors
const ERR_NOT_ADMIN = 1001;
const ERR_NOT_ADMIN_OR_GUARDIAN = 1002;
const ERR_ETA_TOO_EARLY = 1003;
const ERR_NOT_READY = 1008;
const ERR_HASH_MISMATCH = 1009;
const ERR_DELAY_OUT_OF_RANGE = 1010;
const ERR_ALREADY_CANCELLED = 1007;
const ERR_NOT_EMERGENCY = 1011;
const REG_ERR_UNAUTHORIZED = 800;

function accounts() {
  const a = simnet.getAccounts();
  const deployer = a.get("deployer")!; // admin + guardian by default
  const guardian = a.get("wallet_1")!;
  const treasury = a.get("wallet_2")!;
  const stranger = a.get("wallet_3")!;
  return { deployer, guardian, treasury, stranger };
}
const tlPrincipal = () => `${accounts().deployer}.${TL}`;

// Serialize a Clarity tuple to a consensus buff CV (matches on-chain to-consensus-buff?).
function buffOf(tupleCV: any) {
  const ser = serializeCV(tupleCV) as unknown;
  return typeof ser === "string" ? Cl.bufferFromHex(ser) : Cl.buffer(ser as Uint8Array);
}
// Derive the action hash on-chain so it matches what execute-* recomputes.
function actionHash(target: number, fn: number, tupleCV: any) {
  return simnet.callReadOnlyFn(TL, "compute-hash", [Cl.uint(target), Cl.uint(fn), buffOf(tupleCV)], accounts().deployer).result;
}
const queue = (caller: string, id: number, hash: any, target: number, fn: number, eta: number) =>
  simnet.callPublicFn(TL, "queue", [Cl.uint(id), hash, Cl.uint(target), Cl.uint(fn), Cl.uint(eta)], caller);

// Register market 0, then hand the registry's governance to the timelock and lock.
function setup() {
  const { deployer } = accounts();
  const tl = tlPrincipal();
  simnet.callPublicFn(REG, "register-market",
    [Cl.principal(tl), Cl.principal(tl), Cl.uint(1_000_000), Cl.uint(0), Cl.uint(0), Cl.uint(2000), Cl.uint(0)], deployer);
  simnet.callPublicFn(REG, "bootstrap-set-governance", [Cl.principal(tl)], deployer);
  simnet.callPublicFn(REG, "lock-bootstrap", [], deployer);
  // whitelist the pause emergency path and lock the timelock bootstrap
  simnet.callPublicFn(TL, "bootstrap-set-emergency", [Cl.uint(TARGET_REGISTRY), Cl.uint(FN_REG_SET_PAUSED), Cl.bool(true)], deployer);
  simnet.callPublicFn(TL, "lock-bootstrap", [], deployer);
}

const regTreasury = () =>
  (simnet.callReadOnlyFn(REG, "get-treasury", [], accounts().deployer).result as any);
const regPaused = () =>
  (simnet.callReadOnlyFn(REG, "is-market-paused", [Cl.uint(0)], accounts().deployer).result as any).type === "true";

describe("timelock: governance enforcement", () => {
  beforeEach(setup);

  it("after wiring, direct admin calls to the registry are rejected (only the timelock passes)", () => {
    const { deployer, treasury } = accounts();
    expect(
      simnet.callPublicFn(REG, "set-treasury", [Cl.principal(treasury)], deployer).result
    ).toBeErr(Cl.uint(REG_ERR_UNAUTHORIZED));
  });
});

describe("timelock: queue + execute", () => {
  beforeEach(setup);

  it("queues, waits the delay, then executes set-treasury via the timelock", () => {
    const { deployer, treasury } = accounts();
    const tuple = Cl.tuple({ "new-treasury": Cl.principal(treasury) });
    const hash = actionHash(TARGET_REGISTRY, FN_REG_SET_TREASURY, tuple);
    const eta = simnet.blockHeight + DELAY + 5;

    expect(queue(deployer, 1, hash, TARGET_REGISTRY, FN_REG_SET_TREASURY, eta).result).toBeOk(Cl.bool(true));
    // not ready yet
    expect(
      simnet.callPublicFn(TL, "execute-reg-set-treasury", [Cl.uint(1), Cl.principal(treasury)], deployer).result
    ).toBeErr(Cl.uint(ERR_NOT_READY));

    simnet.mineEmptyBlocks(DELAY + 5);
    expect(
      simnet.callPublicFn(TL, "execute-reg-set-treasury", [Cl.uint(1), Cl.principal(treasury)], deployer).result
    ).toBeOk(Cl.bool(true));
    expect(regTreasury()).toBePrincipal(treasury); // change landed via the timelock
  });

  it("rejects an eta below the delay floor", () => {
    const { deployer, treasury } = accounts();
    const hash = actionHash(TARGET_REGISTRY, FN_REG_SET_TREASURY, Cl.tuple({ "new-treasury": Cl.principal(treasury) }));
    expect(queue(deployer, 2, hash, TARGET_REGISTRY, FN_REG_SET_TREASURY, simnet.blockHeight + 1).result)
      .toBeErr(Cl.uint(ERR_ETA_TOO_EARLY));
  });

  it("rejects execution with mismatched args (hash mismatch)", () => {
    const { deployer, treasury, stranger } = accounts();
    const hash = actionHash(TARGET_REGISTRY, FN_REG_SET_TREASURY, Cl.tuple({ "new-treasury": Cl.principal(treasury) }));
    queue(deployer, 3, hash, TARGET_REGISTRY, FN_REG_SET_TREASURY, simnet.blockHeight + DELAY + 5);
    simnet.mineEmptyBlocks(DELAY + 5);
    // execute with a different treasury -> recomputed hash differs
    expect(
      simnet.callPublicFn(TL, "execute-reg-set-treasury", [Cl.uint(3), Cl.principal(stranger)], deployer).result
    ).toBeErr(Cl.uint(ERR_HASH_MISMATCH));
  });

  it("only the admin can queue", () => {
    const { stranger, treasury } = accounts();
    const hash = actionHash(TARGET_REGISTRY, FN_REG_SET_TREASURY, Cl.tuple({ "new-treasury": Cl.principal(treasury) }));
    expect(queue(stranger, 4, hash, TARGET_REGISTRY, FN_REG_SET_TREASURY, simnet.blockHeight + DELAY + 5).result)
      .toBeErr(Cl.uint(ERR_NOT_ADMIN));
  });
});

describe("timelock: guardian cancel", () => {
  beforeEach(() => {
    const { deployer, guardian } = accounts();
    setup();
    // hand the guardian role to wallet_1
    simnet.callPublicFn("sse-governance-v1", "bootstrap-set-guardian", [Cl.principal(guardian)], deployer);
  });

  it("guardian cancels a queued action; it can no longer execute", () => {
    const { deployer, guardian, treasury } = accounts();
    const hash = actionHash(TARGET_REGISTRY, FN_REG_SET_TREASURY, Cl.tuple({ "new-treasury": Cl.principal(treasury) }));
    queue(deployer, 5, hash, TARGET_REGISTRY, FN_REG_SET_TREASURY, simnet.blockHeight + DELAY + 5);

    expect(simnet.callPublicFn(TL, "cancel", [Cl.uint(5)], guardian).result).toBeOk(Cl.bool(true));
    simnet.mineEmptyBlocks(DELAY + 5);
    expect(
      simnet.callPublicFn(TL, "execute-reg-set-treasury", [Cl.uint(5), Cl.principal(treasury)], deployer).result
    ).toBeErr(Cl.uint(ERR_ALREADY_CANCELLED));
  });

  it("a stranger cannot cancel", () => {
    const { deployer, stranger, treasury } = accounts();
    const hash = actionHash(TARGET_REGISTRY, FN_REG_SET_TREASURY, Cl.tuple({ "new-treasury": Cl.principal(treasury) }));
    queue(deployer, 6, hash, TARGET_REGISTRY, FN_REG_SET_TREASURY, simnet.blockHeight + DELAY + 5);
    expect(simnet.callPublicFn(TL, "cancel", [Cl.uint(6)], stranger).result).toBeErr(Cl.uint(ERR_NOT_ADMIN_OR_GUARDIAN));
  });
});

describe("timelock: delay floor + emergency pause", () => {
  beforeEach(setup);

  it("set-delay cannot be shrunk below the MIN-DELAY floor", () => {
    const { deployer } = accounts();
    const hash = actionHash(TARGET_SELF, FN_SELF_SET_DELAY, Cl.tuple({ "new-delay": Cl.uint(1) }));
    queue(deployer, 7, hash, TARGET_SELF, FN_SELF_SET_DELAY, simnet.blockHeight + DELAY + 5);
    simnet.mineEmptyBlocks(DELAY + 5);
    expect(simnet.callPublicFn(TL, "execute-self-set-delay", [Cl.uint(7), Cl.uint(1)], deployer).result)
      .toBeErr(Cl.uint(ERR_DELAY_OUT_OF_RANGE));
  });

  it("emergency pause is a no-delay admin fast-path; unpause must go through the delay", () => {
    const { deployer } = accounts();
    // no queue, no wait
    expect(simnet.callPublicFn(TL, "emergency-set-market-paused", [Cl.uint(0)], deployer).result).toBeOk(Cl.bool(true));
    expect(regPaused()).toBe(true);

    // unpause is the queued/delayed path (execute-reg-set-paused with paused=false)
    const hash = actionHash(TARGET_REGISTRY, FN_REG_SET_PAUSED, Cl.tuple({ "market-id": Cl.uint(0), paused: Cl.bool(false) }));
    queue(deployer, 8, hash, TARGET_REGISTRY, FN_REG_SET_PAUSED, simnet.blockHeight + DELAY + 5);
    simnet.mineEmptyBlocks(DELAY + 5);
    expect(simnet.callPublicFn(TL, "execute-reg-set-paused", [Cl.uint(8), Cl.uint(0), Cl.bool(false)], deployer).result).toBeOk(Cl.bool(true));
    expect(regPaused()).toBe(false);
  });

  it("emergency pause rejects a non-admin", () => {
    const { stranger } = accounts();
    expect(simnet.callPublicFn(TL, "emergency-set-market-paused", [Cl.uint(0)], stranger).result).toBeErr(Cl.uint(ERR_NOT_ADMIN));
  });
});
