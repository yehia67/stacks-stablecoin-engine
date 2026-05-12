import { describe, expect, it, beforeEach } from "vitest";
import { Cl, cvToValue } from "@stacks/transactions";
import { createHash } from "node:crypto";

// to-consensus-buff? for {t: uint, f: uint}
function serializeTF(target: number, fn: number): string {
  // tuple type=0x0c, len=2 keys; keys sorted lexicographically: 'f' < 't'
  const fKey = "01" + Buffer.from("f").toString("hex");
  const tKey = "01" + Buffer.from("t").toString("hex");
  const fVal = "01" + BigInt(fn).toString(16).padStart(32, "0");
  const tVal = "01" + BigInt(target).toString(16).padStart(32, "0");
  return "0c" + "00000002" + fKey + fVal + tKey + tVal;
}
function sha256Hex(hex: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(Buffer.from(hex, "hex")).digest());
}
function computeHash(target: number, fn: number, argsHex: string): Uint8Array {
  return sha256Hex(serializeTF(target, fn) + argsHex);
}

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const admin = accounts.get("wallet_1")!;     // Asigna multisig stand-in
const guardian = accounts.get("wallet_2")!;
const attacker = accounts.get("wallet_3")!;

const GOV = "sse-governance-v1";
const TL = "sse-timelock-v1";
const FACTORY = "stablecoin-factory-v4";

// Target / fn enum (must match contracts/sse-timelock-v1.clar)
const TARGET_FACTORY = 1;
const FN_FACTORY_SET_FEE = 1;
const TARGET_SELF = 6;
const FN_SELF_SET_DELAY = 1;

function bootstrap() {
  // governance: set roles, lock
  simnet.callPublicFn(GOV, "bootstrap-set-admin", [Cl.principal(admin)], deployer);
  simnet.callPublicFn(GOV, "bootstrap-set-guardian", [Cl.principal(guardian)], deployer);
  simnet.callPublicFn(GOV, "bootstrap-set-timelock", [Cl.principal(`${deployer}.${TL}`)], deployer);
  simnet.callPublicFn(GOV, "lock-bootstrap", [], deployer);
  // factory: set governance to timelock, lock
  simnet.callPublicFn(FACTORY, "bootstrap-set-governance", [Cl.principal(`${deployer}.${TL}`)], deployer);
  simnet.callPublicFn(FACTORY, "lock-bootstrap", [], deployer);
  // timelock: lock
  simnet.callPublicFn(TL, "lock-bootstrap", [], deployer);
}

describe("sse-governance-v1", () => {
  beforeEach(() => {
    simnet.callPublicFn(GOV, "bootstrap-set-admin", [Cl.principal(admin)], deployer);
  });

  it("stores admin and reads it back", () => {
    const r = simnet.callReadOnlyFn(GOV, "get-admin", [], deployer);
    expect(cvToValue(r.result)).toBe(admin);
  });

  it("rejects bootstrap setters from non-deployer", () => {
    const r = simnet.callPublicFn(GOV, "bootstrap-set-admin", [Cl.principal(attacker)], attacker);
    expect(r.result).toBeErr(Cl.uint(900));
  });

  it("rejects bootstrap setters after lock", () => {
    simnet.callPublicFn(GOV, "lock-bootstrap", [], deployer);
    const r = simnet.callPublicFn(GOV, "bootstrap-set-admin", [Cl.principal(attacker)], deployer);
    expect(r.result).toBeErr(Cl.uint(901));
  });
});

describe("sse-timelock-v1 — queue / execute / cancel", () => {
  beforeEach(() => {
    bootstrap();
  });

  it("non-admin cannot queue", () => {
    const r = simnet.callPublicFn(
      TL, "queue",
      [Cl.uint(1), Cl.bufferFromHex("00".repeat(32)), Cl.uint(TARGET_FACTORY), Cl.uint(FN_FACTORY_SET_FEE), Cl.uint(1000)],
      attacker
    );
    expect(r.result).toBeErr(Cl.uint(1001)); // ERR-NOT-ADMIN
  });

  it("queue requires eta >= current + delay", () => {
    const r = simnet.callPublicFn(
      TL, "queue",
      [Cl.uint(1), Cl.bufferFromHex("00".repeat(32)), Cl.uint(TARGET_FACTORY), Cl.uint(FN_FACTORY_SET_FEE), Cl.uint(1)],
      admin
    );
    expect(r.result).toBeErr(Cl.uint(1003)); // ERR-ETA-TOO-EARLY
  });

  it("execute fails before eta", () => {
    const newFee = 12345n;
    const block = simnet.blockHeight;
    const queueRes = simnet.callPublicFn(
      TL, "queue",
      [Cl.uint(42), Cl.bufferFromHex("aa".repeat(32)), Cl.uint(TARGET_FACTORY), Cl.uint(FN_FACTORY_SET_FEE), Cl.uint(block + 200)],
      admin
    );
    expect(queueRes.result).toBeOk(Cl.bool(true));

    const execRes = simnet.callPublicFn(
      TL, "execute-factory-set-fee",
      [Cl.uint(42), Cl.uint(newFee)],
      admin
    );
    expect(execRes.result).toBeErr(Cl.uint(1008)); // ERR-NOT-READY
  });

  it("guardian can cancel a queued action", () => {
    simnet.callPublicFn(
      TL, "queue",
      [Cl.uint(7), Cl.bufferFromHex("bb".repeat(32)), Cl.uint(TARGET_FACTORY), Cl.uint(FN_FACTORY_SET_FEE), Cl.uint(simnet.blockHeight + 250)],
      admin
    );
    const r = simnet.callPublicFn(TL, "cancel", [Cl.uint(7)], guardian);
    expect(r.result).toBeOk(Cl.bool(true));

    // Cannot cancel twice
    const r2 = simnet.callPublicFn(TL, "cancel", [Cl.uint(7)], guardian);
    expect(r2.result).toBeErr(Cl.uint(1007));
  });

  it("attacker cannot cancel", () => {
    simnet.callPublicFn(
      TL, "queue",
      [Cl.uint(8), Cl.bufferFromHex("cc".repeat(32)), Cl.uint(TARGET_FACTORY), Cl.uint(FN_FACTORY_SET_FEE), Cl.uint(simnet.blockHeight + 250)],
      admin
    );
    const r = simnet.callPublicFn(TL, "cancel", [Cl.uint(8)], attacker);
    expect(r.result).toBeErr(Cl.uint(1002));
  });

  it("full happy path: queue -> mine blocks -> execute changes factory fee", () => {
    const newFee = 7n * 1000000n; // 7 STX

    // Args tuple {new-fee: uint} serialized per to-consensus-buff?:
    //   0x0c (tuple) 0x00000001 (len) 0x07 "new-fee" 0x01 + 16-byte BE uint
    const feeHex = newFee.toString(16).padStart(32, "0");
    const argsBuffHex = "0c" + "00000001" + "07" + Buffer.from("new-fee").toString("hex") + "01" + feeHex;
    const hashBuff = computeHash(TARGET_FACTORY, FN_FACTORY_SET_FEE, argsBuffHex);

    const eta = simnet.blockHeight + 150;
    const q = simnet.callPublicFn(
      TL, "queue",
      [Cl.uint(99), Cl.buffer(hashBuff), Cl.uint(TARGET_FACTORY), Cl.uint(FN_FACTORY_SET_FEE), Cl.uint(eta)],
      admin
    );
    expect(q.result).toBeOk(Cl.bool(true));

    // Mine past eta
    simnet.mineEmptyBlocks(150);

    const exec = simnet.callPublicFn(
      TL, "execute-factory-set-fee",
      [Cl.uint(99), Cl.uint(newFee)],
      admin
    );
    expect(exec.result).toBeOk(Cl.bool(true));

    const feeNow = simnet.callReadOnlyFn(FACTORY, "get-registration-fee", [], deployer);
    expect(feeNow.result).toStrictEqual(Cl.uint(newFee));
  });

  it("post-lock, direct deployer call to admin function is rejected", () => {
    const r = simnet.callPublicFn(FACTORY, "set-registration-fee", [Cl.uint(123)], deployer);
    expect(r.result).toBeErr(Cl.uint(700)); // ERR_UNAUTHORIZED
  });

  it("self-set-delay enforces MIN_DELAY / MAX_DELAY bounds", () => {
    // tuple {new-delay: u0}
    const argsBuffHex = "0c" + "00000001" + "09" + Buffer.from("new-delay").toString("hex") + "01" + "00".repeat(16);
    const hashBuff = computeHash(TARGET_SELF, FN_SELF_SET_DELAY, argsBuffHex);
    const eta = simnet.blockHeight + 150;
    simnet.callPublicFn(
      TL, "queue",
      [Cl.uint(123), Cl.buffer(hashBuff), Cl.uint(TARGET_SELF), Cl.uint(FN_SELF_SET_DELAY), Cl.uint(eta)],
      admin
    );
    simnet.mineEmptyBlocks(150);
    const r = simnet.callPublicFn(TL, "execute-self-set-delay", [Cl.uint(123), Cl.uint(0)], admin);
    expect(r.result).toBeErr(Cl.uint(1010)); // ERR-DELAY-OUT-OF-RANGE
  });
});
