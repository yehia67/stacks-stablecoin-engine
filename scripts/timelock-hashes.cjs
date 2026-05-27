// Compute action-hashes + queue eta for the two vGLD-rollout timelock proposals.
// Hash scheme mirrors sse-timelock-v1::compute-hash:
//   sha256( consensus-buff({t: target, f: fn}) ++ consensus-buff(args-tuple) )
// where args-tuple matches the (to-consensus-buff? {...}) literal in each
// execute-* wrapper.
//
// Usage:
//   node scripts/timelock-hashes.cjs
// Optional env:
//   STACKS_API_URL (default https://api.hiro.so)
//   ETA_BUFFER_BLOCKS (default 24, ~4h headroom past the 144-block minimum so
//                      multisig signature collection latency cannot push us
//                      under the timelock's ETA-TOO-EARLY assertion)

const crypto = require("crypto");
const t = require("@stacks/transactions");

const DEPLOYER = "SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0";
const VGLD_ASSET = "SP183MTM6NNBG18YSKCQG7Y5P5HVTAK8WSXJNKYMW.vgld-token-v4";
const TIMELOCK_DELAY_BLOCKS = 144;
const ETA_BUFFER = parseInt(process.env.ETA_BUFFER_BLOCKS || "24", 10);
const API_URL = process.env.STACKS_API_URL || "https://api.hiro.so";

// Match the contract's enum constants exactly.
const TARGET_COLLATERAL = 2;
const FN_COLL_ADD = 1;
const FN_COLL_SET_VAULT_AUTH = 5;

// @stacks/transactions v6+ returns serializeCV as a hex STRING (not a
// Uint8Array). Decode through Buffer.from(hex, "hex") so the bytes hashed
// here are the same bytes Clarity's to-consensus-buff? + sha256 produce.
function serializeToBuf(cv) {
  return Buffer.from(t.serializeCV(cv), "hex");
}

function computeHash(target, fn, argsTupleCV) {
  const targetFnBuf = serializeToBuf(t.tupleCV({ t: t.uintCV(target), f: t.uintCV(fn) }));
  const argsBuf = serializeToBuf(argsTupleCV);
  return crypto.createHash("sha256").update(Buffer.concat([targetFnBuf, argsBuf])).digest("hex");
}

// ──────────────────────────────────────────────────────────────────────────────
// Proposal A — execute-coll-set-vault-auth(engine, authorized)
//   contract literal: {engine: principal, authorized: bool}
// ──────────────────────────────────────────────────────────────────────────────
const engineV8 = `${DEPLOYER}.multi-asset-vault-engine-v8`;
const proposalA = {
  label: "Authorize v8 vault engine in collateral-registry-v6",
  executeFn: "execute-coll-set-vault-auth",
  target: TARGET_COLLATERAL,
  fn: FN_COLL_SET_VAULT_AUTH,
  args: { engine: engineV8, authorized: true },
  argsTuple: t.tupleCV({
    engine: t.principalCV(engineV8),
    authorized: t.boolCV(true),
  }),
};
proposalA.hash = computeHash(proposalA.target, proposalA.fn, proposalA.argsTuple);

// ──────────────────────────────────────────────────────────────────────────────
// Proposal B — execute-coll-add(asset, min-cr, liq-r, liq-pen, fee, ceiling, floor-amt, oracle)
//   contract literal: {asset, min-cr, liq-r, liq-pen, fee, ceiling, floor-amt, oracle}
//   Tuple key order is whatever Clarity's deterministic ordering produces;
//   @stacks/transactions serializes tuple keys sorted alphabetically, which
//   matches Clarity's to-consensus-buff? output.
// ──────────────────────────────────────────────────────────────────────────────
const oracleVgld = `${DEPLOYER}.price-oracle-vgld-v1`;
const proposalB = {
  label: "Add vGLD as collateral type in collateral-registry-v6",
  executeFn: "execute-coll-add",
  target: TARGET_COLLATERAL,
  fn: FN_COLL_ADD,
  args: {
    asset: VGLD_ASSET,
    "min-cr": 150n,
    "liq-r": 120n,
    "liq-pen": 10n,
    fee: 200n,
    ceiling: 100_000_000_000n,
    "floor-amt": 10_000_000n,
    oracle: oracleVgld,
  },
  argsTuple: t.tupleCV({
    asset: t.principalCV(VGLD_ASSET),
    "min-cr": t.uintCV(150),
    "liq-r": t.uintCV(120),
    "liq-pen": t.uintCV(10),
    fee: t.uintCV(200),
    ceiling: t.uintCV(100_000_000_000n),
    "floor-amt": t.uintCV(10_000_000),
    oracle: t.principalCV(oracleVgld),
  }),
};
proposalB.hash = computeHash(proposalB.target, proposalB.fn, proposalB.argsTuple);

async function fetchTip() {
  const r = await fetch(`${API_URL}/extended/v1/block`, {
    headers: process.env.HIRO_API_KEY ? { "x-api-key": process.env.HIRO_API_KEY } : {},
  });
  if (!r.ok) throw new Error(`tip fetch failed: ${r.status}`);
  const j = await r.json();
  return j.results[0].height;
}

(async () => {
  let tip = null;
  try {
    tip = await fetchTip();
  } catch (e) {
    console.error(`(warning) could not fetch mainnet tip: ${e.message}. Compute eta manually.`);
  }

  const minEta = tip != null ? tip + TIMELOCK_DELAY_BLOCKS : null;
  const recommendedEta = tip != null ? tip + TIMELOCK_DELAY_BLOCKS + ETA_BUFFER : null;

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(" SSE timelock proposals — vGLD + v8 mainnet rollout");
  console.log("══════════════════════════════════════════════════════════════════");
  if (tip != null) {
    console.log(` Mainnet tip:          ${tip}`);
    console.log(` Minimum eta:          ${minEta}    (tip + ${TIMELOCK_DELAY_BLOCKS})`);
    console.log(` Recommended eta:      ${recommendedEta}    (tip + ${TIMELOCK_DELAY_BLOCKS + ETA_BUFFER}, ${ETA_BUFFER}-block buffer for multisig signing latency)`);
  }
  console.log(` Timelock contract:    ${DEPLOYER}.sse-timelock-v1`);
  console.log("");

  for (const [name, p] of [["A", proposalA], ["B", proposalB]]) {
    console.log(`── Proposal ${name} ─────────────────────────────────────────────────`);
    console.log(` Purpose:        ${p.label}`);
    console.log(` Action hash:    0x${p.hash}`);
    console.log(` Queue call:     ${DEPLOYER}.sse-timelock-v1 :: queue`);
    console.log(`   id            uint  (choose any unused, e.g. u${name === "A" ? 1001 : 1002})`);
    console.log(`   action-hash   (buff 32)  0x${p.hash}`);
    console.log(`   target        uint  u${p.target}`);
    console.log(`   fn            uint  u${p.fn}`);
    console.log(`   eta           uint  ${recommendedEta != null ? `u${recommendedEta}` : "u<tip + 168 or higher>"}`);
    console.log("");
    console.log(` Execute call (after eta):  ${DEPLOYER}.sse-timelock-v1 :: ${p.executeFn}`);
    Object.entries(p.args).forEach(([k, v]) => {
      const display = typeof v === "boolean"
        ? (v ? "true" : "false")
        : typeof v === "bigint"
          ? `u${v}`
          : (typeof v === "string" && v.startsWith("S")) ? `'${v}` : `'${v}`;
      console.log(`   ${k.padEnd(13)} ${display}`);
    });
    console.log("");
  }
})();
