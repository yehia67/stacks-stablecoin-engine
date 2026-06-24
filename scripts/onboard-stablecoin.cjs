// Standard "add a borrowable stablecoin" onboarding plan generator.
//
// SSE Finance onboards a new stablecoin with GOVERNANCE CALLS + CONFIG ROWS ONLY
// -- no new contracts, no redeploy. This script turns an onboarding config into
// the exact ordered sequence of sse-finance-timelock-v1 actions (queue hash +
// execute-* call) an operator runs.
//
// Hash scheme mirrors sse-finance-timelock-v1::compute-hash:
//   sha256( consensus-buff({t: target, f: fn}) ++ consensus-buff(args-tuple) )
// Tuple keys are serialized alphabetically by @stacks/transactions, matching
// Clarity's to-consensus-buff? output and each execute-* wrapper's literal.
//
// Usage:  node scripts/onboard-stablecoin.cjs [path/to/onboarding.json]
//
// The market-id is ASSIGNED when register-market executes, so onboarding is two
// phases: (1) queue+execute register-market, read the assigned id, then (2) queue
// the remaining actions with that id. This script prints both phases.

const crypto = require("crypto");
const t = require("@stacks/transactions");
const fs = require("fs");
const path = require("path");

const TIMELOCK_DELAY_BLOCKS = 144;

// Target / fn enums -- must match sse-finance-timelock-v1.
const TARGET_REGISTRY = 1;
const TARGET_MATRIX = 2;
const FN_REG_REGISTER_MARKET = 1;
const FN_REG_SET_DEPEG = 7;
const FN_MTX_ADD = 1;
const FN_MTX_SET_ORACLE = 4;

// @stacks/transactions serializeCV returns a hex string; decode to bytes so the
// hash matches Clarity's to-consensus-buff? + sha256.
const ser = (cv) => Buffer.from(t.serializeCV(cv), "hex");
function computeHash(target, fn, argsTupleCV) {
  const head = ser(t.tupleCV({ t: t.uintCV(target), f: t.uintCV(fn) }));
  return crypto.createHash("sha256").update(Buffer.concat([head, ser(argsTupleCV)])).digest("hex");
}

// Default example config: onboard USDC with sBTC + vGLD collateral.
const DEFAULT_CONFIG = {
  borrowToken: "SP000000000000000000002Q6VF78.usdc",
  oracle: "SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0.price-oracle-pegged-usd-v1",
  borrowCap: 100000000000,
  borrowFeeBps: 50,        // 0.5%
  borrowFeeLpShareBps: 0,  // launch decision: liquidation-only
  protocolLiqShareBps: 2000, // 20% of penalty
  earlyRepayFeeBps: 0,
  depegBandBps: 200,       // 2% before new borrows pause
  collaterals: [
    { asset: "SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0.sbtc-token-v4", oracle: "SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0.price-oracle-pegged-usd-v1", minCr: 150, liqR: 120, liqPen: 1000, debtFloor: 100000000, debtCeiling: 50000000000 },
    { asset: "SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0.vgld-token-v4", oracle: "SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0.price-oracle-pegged-usd-v1", minCr: 130, liqR: 115, liqPen: 800, debtFloor: 100000000, debtCeiling: 20000000000 },
  ],
};

function loadConfig() {
  const arg = process.argv[2];
  if (!arg) return DEFAULT_CONFIG;
  return JSON.parse(fs.readFileSync(path.resolve(arg), "utf8"));
}

function main() {
  const c = loadConfig();
  const out = [];

  // Phase 1: register the market (id assigned on execute).
  const regArgs = t.tupleCV({
    "borrow-token": t.principalCV(c.borrowToken),
    oracle: t.principalCV(c.oracle),
    "borrow-cap": t.uintCV(c.borrowCap),
    "borrow-fee-bps": t.uintCV(c.borrowFeeBps),
    "borrow-fee-lp-share-bps": t.uintCV(c.borrowFeeLpShareBps),
    "protocol-liq-share-bps": t.uintCV(c.protocolLiqShareBps),
    "early-repay-fee-bps": t.uintCV(c.earlyRepayFeeBps),
  });
  out.push({
    phase: 1,
    step: "register-market",
    executeFn: "execute-reg-register-market",
    target: TARGET_REGISTRY,
    fn: FN_REG_REGISTER_MARKET,
    hash: computeHash(TARGET_REGISTRY, FN_REG_REGISTER_MARKET, regArgs),
    executeArgs: [c.borrowToken, c.oracle, c.borrowCap, c.borrowFeeBps, c.borrowFeeLpShareBps, c.protocolLiqShareBps, c.earlyRepayFeeBps],
    note: "After execute, READ the returned market-id from the (ok uN) result; use it for phase 2.",
  });

  // Phase 2: depeg band + collateral rows (use MARKET_ID placeholder).
  const MARKET_ID = "<MARKET_ID>"; // substitute the id assigned in phase 1
  const planFor = (marketId) => {
    const items = [];
    const bandArgs = t.tupleCV({ "market-id": t.uintCV(marketId), "band-bps": t.uintCV(c.depegBandBps) });
    items.push({
      phase: 2, step: "set-depeg-band", executeFn: "execute-reg-set-depeg-band",
      target: TARGET_REGISTRY, fn: FN_REG_SET_DEPEG,
      hash: computeHash(TARGET_REGISTRY, FN_REG_SET_DEPEG, bandArgs),
      executeArgs: [marketId, c.depegBandBps],
    });
    for (const col of c.collaterals) {
      const addArgs = t.tupleCV({
        "market-id": t.uintCV(marketId), collateral: t.principalCV(col.asset),
        "min-cr": t.uintCV(col.minCr), "liq-r": t.uintCV(col.liqR), "liq-pen": t.uintCV(col.liqPen),
        "debt-floor": t.uintCV(col.debtFloor), "debt-ceiling": t.uintCV(col.debtCeiling),
      });
      items.push({
        phase: 2, step: `add-collateral ${col.asset}`, executeFn: "execute-mtx-add",
        target: TARGET_MATRIX, fn: FN_MTX_ADD,
        hash: computeHash(TARGET_MATRIX, FN_MTX_ADD, addArgs),
        executeArgs: [marketId, col.asset, col.minCr, col.liqR, col.liqPen, col.debtFloor, col.debtCeiling],
      });
      const oraArgs = t.tupleCV({ asset: t.principalCV(col.asset), oracle: t.principalCV(col.oracle) });
      items.push({
        phase: 2, step: `set-collateral-oracle ${col.asset}`, executeFn: "execute-mtx-set-oracle",
        target: TARGET_MATRIX, fn: FN_MTX_SET_ORACLE,
        hash: computeHash(TARGET_MATRIX, FN_MTX_SET_ORACLE, oraArgs),
        executeArgs: [col.asset, col.oracle],
      });
    }
    return items;
  };

  console.log("SSE Finance — stablecoin onboarding plan");
  console.log("Timelock delay:", TIMELOCK_DELAY_BLOCKS, "blocks. Each action: (1) admin queue(id, hash, target, fn, eta>=height+delay); (2) after eta, execute-*.\n");
  console.log("PHASE 1 (register the market):");
  console.dir(out[0], { depth: null });
  console.log("\nPHASE 2 (after reading the assigned market-id; hashes shown for MARKET_ID=<id>):");
  console.log("Re-run phase-2 hashing with the concrete id. Example structure for id=0:");
  console.dir(planFor(0), { depth: null });
  console.log("\nNOTE: phase-2 hashes are id-specific. Substitute the real id before queueing.");
}

main();
