// scripts/timelock-tx.cjs
//
// Dynamic-parameter CLI for sse-timelock-v1 proposals. Generates everything a
// human needs to paste into Asigna (or any Stacks multisig UI): action-hash,
// fresh eta, Clarity expression, JSON args, and post-execution verification
// curls. Optionally broadcasts directly if --signer-key is supplied -- only
// useful when the timelock admin is a single-key wallet (NOT the case on
// mainnet, where admin is the Asigna vault). Single-key broadcast is the
// happy path on testnet / staging deployments where the deployer is admin.
//
// Subcommands
//   queue-coll-set-vault-auth --engine <fqn> --authorized <bool> [--id N] [--eta-buffer N]
//   queue-coll-add --asset <p> --min-cr N --liq-r N --liq-pen N --fee N --ceiling N --floor-amt N --oracle <p> [--id N] [--eta-buffer N]
//   queue-coll-update --asset <p> --min-cr N --liq-r N --liq-pen N --fee N --ceiling N --floor-amt N [--id N]
//   queue-coll-set-enabled --asset <p> --enabled <bool> [--id N]
//   queue-coll-update-oracle --asset <p> --new-oracle <p> [--id N]
//   execute --id N [--engine <p>] [--authorized <bool>] [--asset <p>] [...]
//       (positional execute wrapper inferred from --target/--fn or by passing
//        the execute fn name via --fn-name)
//   compute-hash --target N --fn N --args-json <json>   (raw debugging)
//
// Common flags
//   --network mainnet|testnet         default mainnet
//   --deployer <principal>            override deployer (default = mainnet SP3QMDAC...)
//   --signer-key <hex>                if set, broadcasts the tx directly (single-key admin only)
//   --json                            machine-readable output

const crypto = require("crypto");
const t = require("@stacks/transactions");
const net = require("@stacks/network");

const DEFAULTS = {
  mainnet: {
    deployer: "SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0",
    api: "https://api.hiro.so",
    explorer: "https://explorer.hiro.so",
  },
  testnet: {
    deployer: "ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF",
    api: "https://api.testnet.hiro.so",
    explorer: "https://explorer.hiro.so",
  },
};

const TIMELOCK_DELAY_BLOCKS = 144;
const DEFAULT_ETA_BUFFER = 24;

// Mirror sse-timelock-v1 constants exactly.
const TARGETS = { FACTORY: 1, COLLATERAL: 2, BRIDGE: 3, XRESERVE: 4, VAULT: 5, SELF: 6 };
const FN = {
  FACTORY: { SET_FEE: 1, SET_TREASURY: 2 },
  COLLATERAL: { ADD: 1, UPDATE: 2, SET_ENABLED: 3, UPDATE_ORACLE: 4, SET_VAULT_AUTH: 5 },
};

// ── tiny arg parser ──────────────────────────────────────────────────────────
function parseArgs(argv) {
  const sub = argv[2];
  const out = { _: sub };
  for (let i = 3; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

function fail(msg) { console.error(`error: ${msg}`); process.exit(1); }

function parseBool(v) {
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  fail(`expected bool, got ${v}`);
}

function parseUint(v) {
  if (v == null) fail(`missing uint arg`);
  const cleaned = String(v).replace(/^u/, "").replace(/_/g, "");
  if (!/^\d+$/.test(cleaned)) fail(`bad uint: ${v}`);
  return BigInt(cleaned);
}

// ── serialization helpers ────────────────────────────────────────────────────
function serializeBuf(cv) {
  return Buffer.from(t.serializeCV(cv), "hex");
}

function computeHash(target, fn, argsTupleCV) {
  const targetFn = serializeBuf(t.tupleCV({ t: t.uintCV(target), f: t.uintCV(fn) }));
  const args = serializeBuf(argsTupleCV);
  return "0x" + crypto.createHash("sha256").update(Buffer.concat([targetFn, args])).digest("hex");
}

async function fetchTip(api) {
  const r = await fetch(`${api}/extended/v1/block`, {
    headers: process.env.HIRO_API_KEY ? { "x-api-key": process.env.HIRO_API_KEY } : {},
  });
  if (!r.ok) throw new Error(`tip fetch failed: ${r.status}`);
  return (await r.json()).results[0].height;
}

async function callReadCompute(api, deployer, target, fn, argsTupleCV) {
  const argBuf = serializeBuf(argsTupleCV);
  const argHex = "0x" + t.serializeCV(t.bufferCV(argBuf));
  const u = (n) => "0x" + t.serializeCV(t.uintCV(n));
  const r = await fetch(`${api}/v2/contracts/call-read/${deployer}/sse-timelock-v1/compute-hash`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(process.env.HIRO_API_KEY ? { "x-api-key": process.env.HIRO_API_KEY } : {}) },
    body: JSON.stringify({ sender: deployer, arguments: [u(target), u(fn), argHex] }),
  });
  const j = await r.json();
  if (!j.okay) return null;
  // strip (buff 32) prefix 0x0200000020 (5 bytes = 10 hex chars after 0x)
  return "0x" + j.result.replace(/^0x0200000020/, "");
}

// ── action specs: each maps subcommand -> {target, fn, argsTuple, executeFnName, executeArgsClarity} ──
function specFor(sub, args) {
  switch (sub) {
    case "queue-coll-set-vault-auth": {
      const engine = args.engine || fail("--engine required");
      const authorized = parseBool(args.authorized);
      return {
        target: TARGETS.COLLATERAL,
        fn: FN.COLLATERAL.SET_VAULT_AUTH,
        argsTuple: t.tupleCV({ engine: t.principalCV(engine), authorized: t.boolCV(authorized) }),
        executeFnName: "execute-coll-set-vault-auth",
        executeArgs: [
          { name: "id", clarity: `u${args.id || "PICK_ID"}`, type: "uint" },
          { name: "engine", clarity: `'${engine}`, type: "principal" },
          { name: "authorized", clarity: `${authorized}`, type: "bool" },
        ],
      };
    }
    case "queue-coll-add": {
      const asset = args.asset || fail("--asset required");
      const oracle = args.oracle || fail("--oracle required");
      const minCr = parseUint(args["min-cr"]);
      const liqR = parseUint(args["liq-r"]);
      const liqPen = parseUint(args["liq-pen"]);
      const fee = parseUint(args.fee);
      const ceiling = parseUint(args.ceiling);
      const floorAmt = parseUint(args["floor-amt"]);
      return {
        target: TARGETS.COLLATERAL,
        fn: FN.COLLATERAL.ADD,
        argsTuple: t.tupleCV({
          asset: t.principalCV(asset),
          "min-cr": t.uintCV(minCr),
          "liq-r": t.uintCV(liqR),
          "liq-pen": t.uintCV(liqPen),
          fee: t.uintCV(fee),
          ceiling: t.uintCV(ceiling),
          "floor-amt": t.uintCV(floorAmt),
          oracle: t.principalCV(oracle),
        }),
        executeFnName: "execute-coll-add",
        executeArgs: [
          { name: "id", clarity: `u${args.id || "PICK_ID"}`, type: "uint" },
          { name: "asset", clarity: `'${asset}`, type: "principal" },
          { name: "min-cr", clarity: `u${minCr}`, type: "uint" },
          { name: "liq-r", clarity: `u${liqR}`, type: "uint" },
          { name: "liq-pen", clarity: `u${liqPen}`, type: "uint" },
          { name: "fee", clarity: `u${fee}`, type: "uint" },
          { name: "ceiling", clarity: `u${ceiling}`, type: "uint" },
          { name: "floor-amt", clarity: `u${floorAmt}`, type: "uint" },
          { name: "oracle", clarity: `'${oracle}`, type: "principal" },
        ],
      };
    }
    case "queue-coll-update": {
      const asset = args.asset || fail("--asset required");
      const minCr = parseUint(args["min-cr"]);
      const liqR = parseUint(args["liq-r"]);
      const liqPen = parseUint(args["liq-pen"]);
      const fee = parseUint(args.fee);
      const ceiling = parseUint(args.ceiling);
      const floorAmt = parseUint(args["floor-amt"]);
      return {
        target: TARGETS.COLLATERAL,
        fn: FN.COLLATERAL.UPDATE,
        argsTuple: t.tupleCV({
          asset: t.principalCV(asset),
          "min-cr": t.uintCV(minCr),
          "liq-r": t.uintCV(liqR),
          "liq-pen": t.uintCV(liqPen),
          fee: t.uintCV(fee),
          ceiling: t.uintCV(ceiling),
          "floor-amt": t.uintCV(floorAmt),
        }),
        executeFnName: "execute-coll-update",
        executeArgs: [
          { name: "id", clarity: `u${args.id || "PICK_ID"}`, type: "uint" },
          { name: "asset", clarity: `'${asset}`, type: "principal" },
          { name: "min-cr", clarity: `u${minCr}`, type: "uint" },
          { name: "liq-r", clarity: `u${liqR}`, type: "uint" },
          { name: "liq-pen", clarity: `u${liqPen}`, type: "uint" },
          { name: "fee", clarity: `u${fee}`, type: "uint" },
          { name: "ceiling", clarity: `u${ceiling}`, type: "uint" },
          { name: "floor-amt", clarity: `u${floorAmt}`, type: "uint" },
        ],
      };
    }
    case "queue-coll-set-enabled": {
      const asset = args.asset || fail("--asset required");
      const enabled = parseBool(args.enabled);
      return {
        target: TARGETS.COLLATERAL,
        fn: FN.COLLATERAL.SET_ENABLED,
        argsTuple: t.tupleCV({ asset: t.principalCV(asset), enabled: t.boolCV(enabled) }),
        executeFnName: "execute-coll-set-enabled",
        executeArgs: [
          { name: "id", clarity: `u${args.id || "PICK_ID"}`, type: "uint" },
          { name: "asset", clarity: `'${asset}`, type: "principal" },
          { name: "enabled", clarity: `${enabled}`, type: "bool" },
        ],
      };
    }
    case "queue-coll-update-oracle": {
      const asset = args.asset || fail("--asset required");
      const newOracle = args["new-oracle"] || fail("--new-oracle required");
      return {
        target: TARGETS.COLLATERAL,
        fn: FN.COLLATERAL.UPDATE_ORACLE,
        argsTuple: t.tupleCV({ asset: t.principalCV(asset), "new-oracle": t.principalCV(newOracle) }),
        executeFnName: "execute-coll-update-oracle",
        executeArgs: [
          { name: "id", clarity: `u${args.id || "PICK_ID"}`, type: "uint" },
          { name: "asset", clarity: `'${asset}`, type: "principal" },
          { name: "new-oracle", clarity: `'${newOracle}`, type: "principal" },
        ],
      };
    }
    default:
      fail(`unknown subcommand: ${sub}. Run with no args for help.`);
  }
}

// ── Asigna-style payload renderers ──────────────────────────────────────────
function renderQueueClarity(deployer, id, hash, target, fn, eta) {
  return `(contract-call? '${deployer}.sse-timelock-v1 queue u${id} ${hash} u${target} u${fn} u${eta})`;
}

function renderExecuteClarity(deployer, executeFnName, executeArgs) {
  const args = executeArgs.map((a) => a.clarity).join(" ");
  return `(contract-call? '${deployer}.sse-timelock-v1 ${executeFnName} ${args})`;
}

function renderJsonArgs(args) {
  return JSON.stringify(args.map((a) => {
    if (a.type === "uint") return { type: "uint", value: a.clarity.replace(/^u/, "") };
    if (a.type === "principal") return { type: "principal", value: a.clarity.replace(/^'/, "") };
    if (a.type === "bool") return { type: "bool", value: a.clarity === "true" };
    if (a.type === "buffer") return { type: "buffer", value: a.clarity };
    return a;
  }), null, 2);
}

// ── direct broadcast (single-key admin path only) ───────────────────────────
async function broadcastQueue(api, deployer, signerKey, id, hash, target, fn, eta) {
  const { makeContractCall, broadcastTransaction, AnchorMode, PostConditionMode } = t;
  const hashBuf = Buffer.from(hash.replace(/^0x/, ""), "hex");
  const tx = await makeContractCall({
    contractAddress: deployer,
    contractName: "sse-timelock-v1",
    functionName: "queue",
    functionArgs: [t.uintCV(id), t.bufferCV(hashBuf), t.uintCV(target), t.uintCV(fn), t.uintCV(eta)],
    senderKey: signerKey,
    network: api.includes("testnet") ? "testnet" : "mainnet",
    anchorMode: AnchorMode.OnChainOnly,
    postConditionMode: PostConditionMode.Allow,
    fee: 300000n,
  });
  const res = await broadcastTransaction({ transaction: tx, network: api.includes("testnet") ? "testnet" : "mainnet" });
  if (res.error) throw new Error(`broadcast: ${res.error} ${res.reason}`);
  return res.txid;
}

// ──────────────────────────────────────────────────────────────────────────────
// Native Stacks multisig (Mode B) — partial-signed tx hex passes between
// signers off-chain. Each signer runs ms-sign with their key. Final signer
// runs ms-broadcast (or ms-sign auto-broadcasts when sig threshold met).
// All signers must agree on the SAME nonce/fee/args; subsequent signers sign
// the digest of the initiator's tx exactly.
//
// Asigna native multisig vault: c32-decoded version byte = 20 (P2SH multisig
// standard principal). @stacks/transactions builds this via publicKeys +
// numSignatures on makeUnsignedContractCall.
// ──────────────────────────────────────────────────────────────────────────────

function parsePubKeys(csv) {
  if (!csv) fail("--pubkeys required (comma-separated compressed hex pubkeys, 33 bytes each)");
  const list = csv.split(",").map((s) => s.trim()).filter(Boolean);
  for (const pk of list) {
    if (!/^[0-9a-fA-F]{66}$/.test(pk)) {
      fail(`bad pubkey ${pk}: expect 66 hex chars (compressed secp256k1)`);
    }
  }
  return list;
}

function deriveMultisigAddress(pubkeysHex, numSigs, network, opts = {}) {
  // @stacks/transactions v7: addressFromPublicKeys returns {type, version, hash160}.
  // c32check converts (version, hash160) -> c32 address string.
  const c32 = require("c32check");
  const pubs = pubkeysHex.map((hex) => t.createStacksPublicKey(hex));
  const versionByte = network === "mainnet" ? 20 : 21;
  // Sequential P2SH for legacy multisig; P2SHNonSequential for modern. Most
  // Asigna vaults are sequential P2SH but pass --non-sequential to switch.
  const hashMode = opts.nonSequential
    ? t.AddressHashMode.P2SHNonSequential
    : t.AddressHashMode.P2SH;
  const addr = t.addressFromPublicKeys(versionByte, hashMode, numSigs, pubs);
  if (!addr) fail("addressFromPublicKeys returned nothing -- check @stacks/transactions version");
  return c32.c32address(addr.version, addr.hash160);
}

async function fetchNonce(api, principal) {
  const r = await fetch(`${api}/extended/v1/address/${principal}/nonces`, {
    headers: process.env.HIRO_API_KEY ? { "x-api-key": process.env.HIRO_API_KEY } : {},
  });
  if (!r.ok) throw new Error(`nonce fetch ${r.status}`);
  const j = await r.json();
  return BigInt(j.possible_next_nonce);
}

function txToHex(tx) {
  const ser = tx.serialize();
  // serialize returns Uint8Array in v6+, possibly string in older
  if (typeof ser === "string") return ser.startsWith("0x") ? ser : "0x" + ser;
  return "0x" + Buffer.from(ser).toString("hex");
}

function txFromHex(hex) {
  return t.deserializeTransaction(hex.replace(/^0x/, ""));
}

function countSignatures(tx) {
  // Walk auth condition's fields, count those that are signatures (not pubkeys).
  const fields = tx.auth?.spendingCondition?.fields || [];
  let sigs = 0;
  for (const f of fields) {
    // contents.type is enum; signature variants vs pubkey variants
    const ty = f?.contents?.type ?? f?.type;
    // Heuristic: signature field types contain "Signature" or value buffer 65 bytes
    if (f?.contents?.data && (f.contents.data.length === 130 || f.contents.data.length === 65)) sigs++;
    else if (typeof ty === "string" && ty.toLowerCase().includes("sig")) sigs++;
  }
  return sigs;
}

async function buildMultisigQueueTx({ api, network, deployer, multisigAddress, pubkeys, numSigs, id, hash, target, fn, eta, fee, nonce }) {
  const { makeUnsignedContractCall, AnchorMode, PostConditionMode, AuthType } = t;
  const hashBuf = Buffer.from(hash.replace(/^0x/, ""), "hex");
  const txOpts = {
    contractAddress: deployer,
    contractName: "sse-timelock-v1",
    functionName: "queue",
    functionArgs: [t.uintCV(id), t.bufferCV(hashBuf), t.uintCV(target), t.uintCV(fn), t.uintCV(eta)],
    network,
    anchorMode: AnchorMode.OnChainOnly,
    postConditionMode: PostConditionMode.Allow,
    fee,
    nonce,
    publicKeys: pubkeys,
    numSignatures: numSigs,
  };
  return makeUnsignedContractCall(txOpts);
}

async function buildMultisigExecuteTx({ api, network, deployer, executeFnName, executeArgsCV, pubkeys, numSigs, fee, nonce }) {
  const { makeUnsignedContractCall, AnchorMode, PostConditionMode } = t;
  return makeUnsignedContractCall({
    contractAddress: deployer,
    contractName: "sse-timelock-v1",
    functionName: executeFnName,
    functionArgs: executeArgsCV,
    network,
    anchorMode: AnchorMode.OnChainOnly,
    postConditionMode: PostConditionMode.Allow,
    fee,
    nonce,
    publicKeys: pubkeys,
    numSignatures: numSigs,
  });
}

function signTx(tx, signerKey) {
  // Simple signOrigin — used by ms-init-queue/execute as the FIRST signer.
  // Subsequent signers must use smartSign so skipped pubkey slots get
  // filled with appendOrigin in the right order.
  const signer = new t.TransactionSigner(tx);
  signer.signOrigin(signerKey);
  return tx;
}

function countSignedFields(tx) {
  // A field is a "signature" if its contents.type indicates a signature
  // variant (not a bare public-key field). In @stacks/transactions v7 the
  // field type byte distinguishes them: pubkey-only fields use type 9 in
  // contents (PublicKey), signature fields use type 2 / 3 (MessageSignature
  // compressed/uncompressed). Treat anything with a 65-byte hex data blob
  // as a signature.
  const fields = tx.auth?.spendingCondition?.fields || [];
  return fields.filter((f) => {
    const data = f?.contents?.data || "";
    return typeof data === "string" && data.length === 130; // 65 bytes hex
  }).length;
}

function privateKeyToCompressedPubHex(privKey) {
  // Accept hex string with or without the trailing "01" compressed marker.
  // @stacks privateKeyToPublic returns the matching pubkey hex.
  const pub = t.privateKeyToPublic(privKey);
  // pub may already be lower-case compressed hex (66 chars). Normalize.
  return String(pub).toLowerCase();
}

function smartSign(tx, signerKey, pubkeysHex, numSigs) {
  // Fill skipped pubkey slots with appendOrigin so positions match the
  // original publicKeys array order, then signOrigin in this signer's slot.
  // After signing, if threshold met, fill remaining pubkeys after this slot
  // so the final tx has fields.length == pubkeysHex.length.
  const signerPub = privateKeyToCompressedPubHex(signerKey);
  const idx = pubkeysHex.findIndex((p) => p.toLowerCase() === signerPub);
  if (idx < 0) fail(`signer key's pubkey ${signerPub} not present in --pubkeys list`);

  const fieldsBefore = (tx.auth?.spendingCondition?.fields || []).length;
  if (fieldsBefore > idx) {
    fail(`slot ${idx + 1} already filled (current fields=${fieldsBefore}). Signers must add in pubkey order.`);
  }

  const signer = new t.TransactionSigner(tx);
  for (let i = fieldsBefore; i < idx; i++) {
    signer.appendOrigin(t.createStacksPublicKey(pubkeysHex[i]));
  }
  signer.signOrigin(signerKey);

  const sigsNow = countSignedFields(tx);
  if (sigsNow >= numSigs) {
    // Fill any remaining pubkey slots so the auth condition matches the
    // vault's hash160 -- otherwise broadcast rejects with AuthError.
    for (let i = idx + 1; i < pubkeysHex.length; i++) {
      signer.appendOrigin(t.createStacksPublicKey(pubkeysHex[i]));
    }
  }
  return tx;
}

async function broadcastTx(network, tx) {
  const res = await t.broadcastTransaction({ transaction: tx, network });
  if (res.error) throw new Error(`broadcast: ${res.error} ${res.reason || ""}`);
  return res.txid;
}

function multisigHelp() {
  console.log(`
NATIVE MULTISIG SUBCOMMANDS (Mode B — no Asigna UI)

  ms-init-queue <queue-subcommand> --pubkeys pk1,pk2,pk3 --sigs-required N --signer-key <hex>
      Build + sign-as-first the queue tx for the given spec. Outputs partial-
      sig tx hex. <queue-subcommand> is any of the queue-coll-* names.

  ms-init-execute <execute-subcommand> --queue-id N --pubkeys ... --sigs-required N --signer-key <hex>
      Same but for execute-coll-*. Needs the queue id from the earlier ms-init-queue.

  ms-sign --tx-hex <hex> --signer-key <hex>
      Append signature to an existing partial-sig hex. Outputs updated hex.

  ms-broadcast --tx-hex <hex>
      Broadcast a tx that already has ≥ numSignatures sigs.

  ms-inspect --tx-hex <hex>
      Decode and print contract/function/args/nonce/fee/sigs-collected.

  ms-derive-address --pubkeys pk1,pk2,pk3 --sigs-required N [--network mainnet|testnet]
      Print the multisig principal these pubkeys produce. Compare to your
      vault address before trusting the tx.

EXAMPLES

  # 1. Derive + confirm multisig address matches your vault
  node scripts/timelock-tx.cjs ms-derive-address \\
    --pubkeys 02aaaa..,02bbbb..,02cccc.. --sigs-required 2

  # 2. Initiator (signer 1) builds and partial-signs the queue tx
  node scripts/timelock-tx.cjs ms-init-queue queue-coll-add \\
    --pubkeys 02aaaa..,02bbbb..,02cccc.. --sigs-required 2 \\
    --signer-key <key1-hex> \\
    --asset SP183MTM6NNBG18YSKCQG7Y5P5HVTAK8WSXJNKYMW.vgld-token-v4 \\
    --min-cr 150 --liq-r 120 --liq-pen 10 --fee 200 \\
    --ceiling 100000000000 --floor-amt 10000000 \\
    --oracle SP3QMDAC....price-oracle-vgld-v1 --id 1002

  # 3. Send the hex to signer 2 who appends signature
  node scripts/timelock-tx.cjs ms-sign --tx-hex 0x000000... --signer-key <key2-hex>

  # 4. Final signer broadcasts (or ms-sign auto-broadcasts at threshold)
  node scripts/timelock-tx.cjs ms-broadcast --tx-hex 0x000000...

WARNINGS
  - Initiator decides nonce/fee/args; later signers sign the SAME digest.
    Always run ms-inspect on hex received from someone else BEFORE signing
    so you don't blind-sign their args.
  - Asigna native multisig uses sequential P2SH on most vaults. If
    ms-derive-address doesn't match your vault principal, your vault is
    non-sequential multisig and you need to verify @stacks/transactions
    serialization mode -- see Stacks SIP for non-sequential P2SH multisig.
  - Nonce must come from the multisig principal, not any individual signer.
`);
}


// ── main ────────────────────────────────────────────────────────────────────
function help() {
  console.log(`
sse-timelock-tx — generate and (optionally) broadcast sse-timelock-v1 proposals

USAGE
  node scripts/timelock-tx.cjs <subcommand> [flags]

QUEUE SUBCOMMANDS
  queue-coll-set-vault-auth --engine <fqn> --authorized <bool>
  queue-coll-add --asset <p> --min-cr N --liq-r N --liq-pen N --fee N --ceiling N --floor-amt N --oracle <p>
  queue-coll-update --asset <p> --min-cr N --liq-r N --liq-pen N --fee N --ceiling N --floor-amt N
  queue-coll-set-enabled --asset <p> --enabled <bool>
  queue-coll-update-oracle --asset <p> --new-oracle <p>

COMMON FLAGS
  --id N                    queue id (default: tip-derived unique)
  --eta-buffer N            blocks past minimum eta (default ${DEFAULT_ETA_BUFFER})
  --network mainnet|testnet (default mainnet)
  --deployer <p>            override deployer principal
  --signer-key <hex>        broadcast directly (single-key admin ONLY; multisig vaults need UI sign-collection)
  --json                    machine-readable JSON output
  --no-verify               skip cross-check against deployed compute-hash

EXAMPLES
  # Queue vGLD add (Asigna multisig path)
  node scripts/timelock-tx.cjs queue-coll-add \\
    --asset SP183MTM6NNBG18YSKCQG7Y5P5HVTAK8WSXJNKYMW.vgld-token-v4 \\
    --min-cr 150 --liq-r 120 --liq-pen 10 --fee 200 \\
    --ceiling 100000000000 --floor-amt 10000000 \\
    --oracle SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0.price-oracle-vgld-v1 \\
    --id 1002

  # Queue v8 authorization
  node scripts/timelock-tx.cjs queue-coll-set-vault-auth \\
    --engine SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0.multi-asset-vault-engine-v8 \\
    --authorized true --id 1001

  # Testnet, single-key, broadcast directly
  STACKS_PRIVATE_KEY=... node scripts/timelock-tx.cjs queue-coll-set-enabled \\
    --asset ST3DGG....sbtc-token-v4 --enabled false --id 42 \\
    --network testnet --signer-key $STACKS_PRIVATE_KEY
`);
}

// Execute-subcommand specs (parallel to the queue ones, used by ms-init-execute)
function executeSpecFor(sub, args) {
  switch (sub) {
    case "execute-coll-set-vault-auth": {
      const engine = args.engine || fail("--engine required");
      const authorized = parseBool(args.authorized);
      const id = parseUint(args["queue-id"] || args.id || fail("--queue-id (or --id) required"));
      return {
        fnName: "execute-coll-set-vault-auth",
        argsCV: [t.uintCV(id), t.principalCV(engine), t.boolCV(authorized)],
      };
    }
    case "execute-coll-add": {
      const asset = args.asset || fail("--asset required");
      const oracle = args.oracle || fail("--oracle required");
      const id = parseUint(args["queue-id"] || args.id || fail("--queue-id (or --id) required"));
      return {
        fnName: "execute-coll-add",
        argsCV: [
          t.uintCV(id), t.principalCV(asset),
          t.uintCV(parseUint(args["min-cr"])), t.uintCV(parseUint(args["liq-r"])),
          t.uintCV(parseUint(args["liq-pen"])), t.uintCV(parseUint(args.fee)),
          t.uintCV(parseUint(args.ceiling)), t.uintCV(parseUint(args["floor-amt"])),
          t.principalCV(oracle),
        ],
      };
    }
    case "execute-coll-update": {
      const asset = args.asset || fail("--asset required");
      const id = parseUint(args["queue-id"] || args.id);
      return {
        fnName: "execute-coll-update",
        argsCV: [
          t.uintCV(id), t.principalCV(asset),
          t.uintCV(parseUint(args["min-cr"])), t.uintCV(parseUint(args["liq-r"])),
          t.uintCV(parseUint(args["liq-pen"])), t.uintCV(parseUint(args.fee)),
          t.uintCV(parseUint(args.ceiling)), t.uintCV(parseUint(args["floor-amt"])),
        ],
      };
    }
    case "execute-coll-set-enabled": {
      const asset = args.asset || fail("--asset required");
      const enabled = parseBool(args.enabled);
      const id = parseUint(args["queue-id"] || args.id);
      return {
        fnName: "execute-coll-set-enabled",
        argsCV: [t.uintCV(id), t.principalCV(asset), t.boolCV(enabled)],
      };
    }
    case "execute-coll-update-oracle": {
      const asset = args.asset || fail("--asset required");
      const newOracle = args["new-oracle"] || fail("--new-oracle required");
      const id = parseUint(args["queue-id"] || args.id);
      return {
        fnName: "execute-coll-update-oracle",
        argsCV: [t.uintCV(id), t.principalCV(asset), t.principalCV(newOracle)],
      };
    }
    default: fail(`unknown execute subcommand: ${sub}`);
  }
}

async function handleMultisig(sub, args, cfg, network, deployer, api) {
  const stxNet = network === "mainnet" ? net.STACKS_MAINNET : net.STACKS_TESTNET;

  // ms-derive-key — mnemonic -> {privKey, pubKey, address}. Stacks standard
  // BIP-44 path m/44'/5757'/0'/0/<account-index> via @stacks/wallet-sdk.
  if (sub === "ms-derive-key") {
    const mnemonic = args.mnemonic || process.env.STACKS_MNEMONIC || fail("--mnemonic or STACKS_MNEMONIC required");
    const accountIndex = parseInt(args["account-index"] || 0, 10);
    const { generateWallet, generateNewAccount } = await import("@stacks/wallet-sdk");
    let wallet = await generateWallet({ secretKey: mnemonic, password: "" });
    // @stacks/wallet-sdk only seeds account 0; iterate generateNewAccount
    // to derive m/44'/5757'/0'/0/<accountIndex>.
    while (wallet.accounts.length <= accountIndex) {
      wallet = generateNewAccount(wallet);
    }
    const acct = wallet.accounts[accountIndex];
    const privKey = acct.stxPrivateKey;
    const pubKey = t.privateKeyToPublic(privKey);
    const addr = t.getAddressFromPrivateKey(privKey, network === "mainnet" ? "mainnet" : "testnet");
    console.log(`account-index:  ${accountIndex}`);
    console.log(`private-key:    ${privKey}`);
    console.log(`public-key:     ${pubKey}`);
    console.log(`stx-address:    ${addr}`);
    console.log(``);
    console.log(`STORE THE PRIVATE KEY SECRETLY. Pass via --signer-key in subsequent ms-* commands.`);
    return;
  }

  // ms-derive-address — sanity-check the multisig pubkey set produces vault
  if (sub === "ms-derive-address") {
    const pubkeys = parsePubKeys(args.pubkeys);
    const numSigs = parseInt(args["sigs-required"] || fail("--sigs-required required"), 10);
    const seq = deriveMultisigAddress(pubkeys, numSigs, network);
    const nonSeq = deriveMultisigAddress(pubkeys, numSigs, network, { nonSequential: true });
    console.log(`sequential P2SH (legacy):     ${seq}`);
    console.log(`non-sequential P2SH (modern): ${nonSeq}`);
    console.log(`compare to your Asigna vault principal -- match determines which mode to pass to ms-init-*`);
    return;
  }

  if (sub === "ms-inspect") {
    const hex = args["tx-hex"] || fail("--tx-hex required");
    const tx = txFromHex(hex);
    console.log(JSON.stringify({
      version: tx.version,
      chainId: tx.chainId,
      auth: { type: tx.auth.authType, condition: tx.auth.spendingCondition },
      anchorMode: tx.anchorMode,
      postConditionMode: tx.postConditionMode,
      payload: tx.payload,
      sigsCollected: countSignatures(tx),
    }, (k, v) => typeof v === "bigint" ? v.toString() : v, 2));
    return;
  }

  if (sub === "ms-broadcast") {
    const hex = args["tx-hex"] || fail("--tx-hex required");
    const tx = txFromHex(hex);
    const txid = await broadcastTx(stxNet, tx);
    console.log(`broadcast tx: 0x${txid}`);
    console.log(`${cfg.explorer}/txid/0x${txid}?chain=${network}`);
    return;
  }

  if (sub === "ms-sign") {
    const hex = args["tx-hex"] || fail("--tx-hex required");
    const signerKey = args["signer-key"] || fail("--signer-key required");
    const pubkeys = parsePubKeys(args.pubkeys);
    const numSigs = parseInt(args["sigs-required"] || fail("--sigs-required required"), 10);
    const tx = txFromHex(hex);
    smartSign(tx, signerKey, pubkeys, numSigs);
    const updated = txToHex(tx);
    const sigsNow = countSignedFields(tx);
    const required = tx.auth?.spendingCondition?.signaturesRequired || numSigs;
    console.log(`tx-hex: ${updated}`);
    console.log(`sigs collected: ${sigsNow} / ${required}`);
    const fieldsLen = (tx.auth?.spendingCondition?.fields || []).length;
    console.log(`fields filled: ${fieldsLen} / ${pubkeys.length}`);
    if (args.broadcast && sigsNow >= required && fieldsLen === pubkeys.length) {
      const txid = await broadcastTx(stxNet, tx);
      console.log(`broadcast: 0x${txid}`);
      console.log(`${cfg.explorer}/txid/0x${txid}?chain=${network}`);
    } else if (sigsNow >= required && fieldsLen === pubkeys.length) {
      console.log(`threshold met + all pubkey slots filled — re-run with --broadcast or use ms-broadcast`);
    } else if (sigsNow >= required) {
      console.log(`threshold met but ${pubkeys.length - fieldsLen} pubkey slot(s) missing -- a final signer must append remaining pubkeys (run ms-sign with their key) or use ms-append-pubkeys`);
    } else {
      console.log(`pass updated tx-hex to next signer (in pubkey order)`);
    }
    return;
  }

  if (sub === "ms-append-pubkeys") {
    // Edge case: threshold met but some signers never signed. Anyone can
    // finalize the auth condition by appending the remaining pubkeys.
    const hex = args["tx-hex"] || fail("--tx-hex required");
    const pubkeys = parsePubKeys(args.pubkeys);
    const tx = txFromHex(hex);
    const filled = (tx.auth?.spendingCondition?.fields || []).length;
    const signer = new t.TransactionSigner(tx);
    for (let i = filled; i < pubkeys.length; i++) {
      signer.appendOrigin(t.createStacksPublicKey(pubkeys[i]));
    }
    const updated = txToHex(tx);
    console.log(`tx-hex: ${updated}`);
    console.log(`appended ${pubkeys.length - filled} pubkey slot(s)`);
    return;
  }

  // ms-init-queue <queue-coll-*> ...
  if (sub === "ms-init-queue") {
    const subSpec = process.argv[3];
    if (!subSpec || subSpec.startsWith("--")) fail(`ms-init-queue requires a queue subcommand (e.g. queue-coll-add)`);
    const innerArgs = { ...args, _: subSpec };
    const spec = specFor(subSpec, innerArgs);

    const pubkeys = parsePubKeys(args.pubkeys);
    const numSigs = parseInt(args["sigs-required"] || fail("--sigs-required required"), 10);
    const signerKey = args["signer-key"] || fail("--signer-key required");
    const multisigAddress = args["multisig-address"] || deriveMultisigAddress(pubkeys, numSigs, network);
    // --tx-fee is the Stacks tx fee in µSTX; do NOT use bare --fee here
    // because queue-coll-add reserves --fee for the collateral stability fee.
    const fee = BigInt(args["tx-fee"] || 500000n);
    const tip = await fetchTip(api);
    const etaBuffer = parseInt(args["eta-buffer"] || DEFAULT_ETA_BUFFER, 10);
    const eta = parseInt(args.eta || tip + TIMELOCK_DELAY_BLOCKS + etaBuffer, 10);
    const id = parseInt(args.id || (1000 + (tip % 9000)), 10);
    const nonce = args.nonce ? BigInt(args.nonce) : await fetchNonce(api, multisigAddress);

    const localHash = computeHash(spec.target, spec.fn, spec.argsTuple);
    if (!args["no-verify"]) {
      const chainHash = await callReadCompute(api, deployer, spec.target, spec.fn, spec.argsTuple);
      if (chainHash && chainHash !== localHash) {
        fail(`HASH MISMATCH local=${localHash} chain=${chainHash}`);
      }
    }

    const tx = await buildMultisigQueueTx({
      api, network: stxNet, deployer, multisigAddress, pubkeys,
      numSigs, id, hash: localHash, target: spec.target, fn: spec.fn, eta,
      fee, nonce,
    });
    signTx(tx, signerKey);
    const hex = txToHex(tx);
    console.log(`multisigAddress: ${multisigAddress}`);
    console.log(`nonce:           ${nonce}`);
    console.log(`fee:             ${fee}`);
    console.log(`id:              u${id}`);
    console.log(`eta:             u${eta}    (tip ${tip} + ${TIMELOCK_DELAY_BLOCKS} + buffer ${etaBuffer})`);
    console.log(`action-hash:     ${localHash}`);
    console.log(`sigs:            1 / ${numSigs}`);
    console.log(`tx-hex:`);
    console.log(hex);
    console.log(``);
    console.log(`Pass tx-hex to the next signer:`);
    console.log(`  node scripts/timelock-tx.cjs ms-sign --tx-hex ${hex.slice(0, 20)}... --signer-key <key>`);
    return;
  }

  // ms-init-execute <execute-coll-*> ...
  if (sub === "ms-init-execute") {
    const subSpec = process.argv[3];
    if (!subSpec || subSpec.startsWith("--")) fail(`ms-init-execute requires an execute subcommand`);
    const innerArgs = { ...args, _: subSpec };
    const espec = executeSpecFor(subSpec, innerArgs);

    const pubkeys = parsePubKeys(args.pubkeys);
    const numSigs = parseInt(args["sigs-required"] || fail("--sigs-required required"), 10);
    const signerKey = args["signer-key"] || fail("--signer-key required");
    const multisigAddress = args["multisig-address"] || deriveMultisigAddress(pubkeys, numSigs, network);
    // --tx-fee is the Stacks tx fee in µSTX; do NOT use bare --fee here
    // because queue-coll-add reserves --fee for the collateral stability fee.
    const fee = BigInt(args["tx-fee"] || 500000n);
    const nonce = args.nonce ? BigInt(args.nonce) : await fetchNonce(api, multisigAddress);

    const tx = await buildMultisigExecuteTx({
      api, network: stxNet, deployer, executeFnName: espec.fnName,
      executeArgsCV: espec.argsCV, pubkeys, numSigs, fee, nonce,
    });
    signTx(tx, signerKey);
    const hex = txToHex(tx);
    console.log(`multisigAddress: ${multisigAddress}`);
    console.log(`nonce:           ${nonce}`);
    console.log(`fee:             ${fee}`);
    console.log(`executeFn:       ${espec.fnName}`);
    console.log(`sigs:            1 / ${numSigs}`);
    console.log(`tx-hex:`);
    console.log(hex);
    return;
  }

  fail(`unknown multisig subcommand: ${sub}`);
}

(async () => {
  const args = parseArgs(process.argv);
  if (!args._ || args._ === "help" || args._ === "-h" || args._ === "--help") {
    help();
    multisigHelp();
    process.exit(0);
  }

  const network = args.network || "mainnet";
  const cfg = DEFAULTS[network];
  if (!cfg) fail(`unknown network ${network}`);
  const deployer = args.deployer || cfg.deployer;
  const api = cfg.api;

  // Multisig (Mode B) branch
  if (args._.startsWith("ms-")) {
    await handleMultisig(args._, args, cfg, network, deployer, api);
    return;
  }

  const spec = specFor(args._, args);
  const localHash = computeHash(spec.target, spec.fn, spec.argsTuple);

  let chainHash = null;
  if (!args["no-verify"]) {
    try {
      chainHash = await callReadCompute(api, deployer, spec.target, spec.fn, spec.argsTuple);
    } catch (e) {
      console.error(`(warning) compute-hash cross-check failed: ${e.message}`);
    }
  }

  if (chainHash && chainHash !== localHash) {
    fail(`HASH MISMATCH between local (${localHash}) and on-chain compute-hash (${chainHash}). Args do not serialize to the same bytes the contract hashes -- fix the JS encoder, do not paste this hash.`);
  }

  const tip = await fetchTip(api);
  const etaBuffer = parseInt(args["eta-buffer"] || DEFAULT_ETA_BUFFER, 10);
  const eta = tip + TIMELOCK_DELAY_BLOCKS + etaBuffer;
  const id = args.id || (1000 + (tip % 9000));

  const queueClarity = renderQueueClarity(deployer, id, localHash, spec.target, spec.fn, eta);
  const queueJson = renderJsonArgs([
    { name: "id", clarity: `u${id}`, type: "uint" },
    { name: "action-hash", clarity: localHash, type: "buffer" },
    { name: "target", clarity: `u${spec.target}`, type: "uint" },
    { name: "fn", clarity: `u${spec.fn}`, type: "uint" },
    { name: "eta", clarity: `u${eta}`, type: "uint" },
  ]);
  const executeClarity = renderExecuteClarity(deployer, spec.executeFnName, [
    { clarity: `u${id}` }, ...spec.executeArgs.slice(1),
  ]);
  const executeJson = renderJsonArgs([
    { name: "id", clarity: `u${id}`, type: "uint" },
    ...spec.executeArgs.slice(1),
  ]);

  if (args.json) {
    console.log(JSON.stringify({
      subcommand: args._,
      network,
      deployer,
      tip,
      eta,
      id,
      target: spec.target,
      fn: spec.fn,
      actionHash: localHash,
      chainHashVerified: chainHash === localHash,
      executeFn: spec.executeFnName,
      queue: { clarity: queueClarity, jsonArgs: JSON.parse(queueJson) },
      execute: { clarity: executeClarity, jsonArgs: JSON.parse(executeJson) },
    }, null, 2));
  } else {
    const line = "═".repeat(72);
    console.log(`\n${line}`);
    console.log(` ${spec.executeFnName}  (target=u${spec.target} fn=u${spec.fn})`);
    console.log(line);
    console.log(` network:       ${network}`);
    console.log(` deployer:      ${deployer}`);
    console.log(` tip:           ${tip}`);
    console.log(` eta:           ${eta}    (tip + ${TIMELOCK_DELAY_BLOCKS} + ${etaBuffer} buffer)`);
    console.log(` id:            u${id}`);
    console.log(` action-hash:   ${localHash}`);
    console.log(` chain verify:  ${chainHash === localHash ? "✓ matches deployed compute-hash" : (chainHash ? `✗ MISMATCH (${chainHash})` : "skipped/unavailable")}`);
    console.log("");
    console.log(" ── QUEUE call (paste into Asigna now) ──");
    console.log(` Contract:      ${deployer}.sse-timelock-v1`);
    console.log(` Function:      queue`);
    console.log(` Clarity:`);
    console.log(`   ${queueClarity}`);
    console.log(` JSON args:`);
    console.log(queueJson.split("\n").map((l) => "   " + l).join("\n"));
    console.log("");
    console.log(` ── EXECUTE call (paste into Asigna AFTER ${TIMELOCK_DELAY_BLOCKS} blocks past eta, ~24h) ──`);
    console.log(` Contract:      ${deployer}.sse-timelock-v1`);
    console.log(` Function:      ${spec.executeFnName}`);
    console.log(` Clarity:`);
    console.log(`   ${executeClarity}`);
    console.log(` JSON args:`);
    console.log(executeJson.split("\n").map((l) => "   " + l).join("\n"));
    console.log("");
    console.log(` ── post-queue verification curl ──`);
    const idHex = "0x" + t.serializeCV(t.uintCV(id));
    console.log(`   curl -s -X POST ${api}/v2/contracts/call-read/${deployer}/sse-timelock-v1/get-action \\`);
    console.log(`     -H 'Content-Type: application/json' \\`);
    console.log(`     -d '{"sender":"${deployer}","arguments":["${idHex}"]}'`);
    console.log(line + "\n");
  }

  // Optional direct broadcast (single-key admin only)
  if (args["signer-key"]) {
    console.log(" ⚠ --signer-key supplied: attempting direct broadcast of the QUEUE call");
    console.log(" ⚠ This will only succeed if the timelock admin is a single-key wallet matching this key.");
    console.log(" ⚠ Mainnet admin is the Asigna multisig — direct broadcast WILL revert with (err u1001) ERR-NOT-ADMIN.");
    try {
      const txid = await broadcastQueue(api, deployer, args["signer-key"], id, localHash, spec.target, spec.fn, eta);
      console.log(`   tx: 0x${txid}`);
      console.log(`   ${cfg.explorer}/txid/0x${txid}?chain=${network}`);
    } catch (e) {
      console.error(`   broadcast failed: ${e.message}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
