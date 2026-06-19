#!/usr/bin/env node
/**
 * SSE protocol activity report (Stacks mainnet).
 *
 * Produces a grant-ready summary of real, external on-chain usage of the SSE
 * contracts deployed by the project deployer:
 *
 *   - Number of deployed contracts
 *   - Number of unique EXTERNAL wallets that interacted with the protocol
 *   - Total number of external transactions (contract calls)
 *   - Vault lifecycle breakdown with an explorer URL for every step:
 *         open vault -> deposit collateral -> mint -> repay -> withdraw
 *   - Number of wallets that completed the FULL vault flow
 *   - Number of wallets that interacted but did NOT complete the full flow
 *
 * "External wallet" = any transaction sender that is not the deployer key
 * itself. Contract deployments by the deployer and the deployer's own
 * bootstrap/admin calls are excluded from the external counts.
 *
 * Usage:
 *   node scripts/count-external-wallets.cjs
 *
 * Options (env vars):
 *   DEPLOYER=SP...        Override the deployer address (default: mainnet deployer)
 *   HIRO_API_KEY=...      Hiro API key to avoid rate limiting (recommended)
 *   INCLUDE_DEPLOYER=1    Also count the deployer in vault-flow stats (for testing)
 *   VERBOSE=1             Print every external address per contract
 *
 * Requires Node 18+ (global fetch).
 */

const API_BASE = "https://api.hiro.so";
const EXPLORER_BASE = "https://explorer.hiro.so";
const DEPLOYER = process.env.DEPLOYER || "SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0";
const VERBOSE = process.env.VERBOSE === "1";
const INCLUDE_DEPLOYER = process.env.INCLUDE_DEPLOYER === "1";
const PAGE_LIMIT = 50;

// Polite delay between requests; Hiro rate-limits unauthenticated clients.
const REQUEST_DELAY_MS = process.env.HIRO_API_KEY ? 50 : 600;

// Explorer link for a given transaction id.
const txUrl = (txId) => `${EXPLORER_BASE}/txid/${txId}?chain=mainnet`;

/**
 * Vault lifecycle steps. Each step maps a human label to the set of public
 * function names in the vault engine that represent that step. Both the plain
 * and the *-for-stablecoin variants are treated as the same logical step.
 */
const VAULT_STEPS = [
  { key: "open", label: "Open vault", fns: ["open-vault", "open-vault-for-stablecoin"] },
  { key: "deposit", label: "Deposit collateral", fns: ["deposit-collateral", "deposit-collateral-for-stablecoin"] },
  { key: "mint", label: "Mint / borrow asset", fns: ["mint-against-asset", "mint-against-asset-for-stablecoin"] },
  { key: "repay", label: "Repay debt", fns: ["repay-against-asset", "repay-against-asset-for-stablecoin"] },
  { key: "withdraw", label: "Withdraw collateral", fns: ["withdraw-collateral", "withdraw-collateral-for-stablecoin"] },
];

// Steps that define a "full flow" wallet (per grant requirement):
// open vault -> deposit collateral -> repay -> withdraw asset.
const FULL_FLOW_KEYS = ["open", "deposit", "repay", "withdraw"];

// Map any function name -> step key.
const FN_TO_STEP = new Map();
for (const step of VAULT_STEPS) for (const fn of step.fns) FN_TO_STEP.set(fn, step.key);

// A contract is treated as the vault engine if its name contains this.
const VAULT_ENGINE_MATCH = "multi-asset-vault-engine";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiGet(path, params = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const headers = { Accept: "application/json" };
  if (process.env.HIRO_API_KEY) headers["x-api-key"] = process.env.HIRO_API_KEY;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      const wait = 2000 * attempt;
      console.error(`  rate limited (429), retrying in ${wait / 1000}s...`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      throw new Error(`GET ${url.pathname} failed: ${res.status} ${res.statusText}`);
    }
    await sleep(REQUEST_DELAY_MS);
    return res.json();
  }
  throw new Error(`GET ${url.pathname} failed: rate limited after 5 attempts`);
}

/** Page through all transactions sent BY the deployer to find its contract deployments. */
async function discoverDeployedContracts(deployer) {
  const contracts = [];
  let offset = 0;
  for (;;) {
    const page = await apiGet(`/extended/v1/address/${deployer}/transactions`, {
      limit: PAGE_LIMIT,
      offset,
    });
    for (const tx of page.results) {
      if (
        tx.tx_type === "smart_contract" &&
        tx.tx_status === "success" &&
        tx.sender_address === deployer
      ) {
        contracts.push(tx.smart_contract.contract_id);
      }
    }
    offset += page.results.length;
    if (offset >= page.total || page.results.length === 0) break;
  }
  return contracts;
}

/**
 * Page through all transactions involving a contract principal and collect the
 * successful contract calls as { sender, fn, txId } records.
 */
async function collectCalls(contractId) {
  const calls = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await apiGet(`/extended/v1/address/${contractId}/transactions`, {
      limit: PAGE_LIMIT,
      offset,
    });
    total = page.total;
    for (const tx of page.results) {
      if (tx.tx_type !== "contract_call") continue;
      if (tx.tx_status !== "success") continue;
      calls.push({
        sender: tx.sender_address,
        fn: tx.contract_call ? tx.contract_call.function_name : null,
        txId: tx.tx_id,
      });
    }
    offset += page.results.length;
    if (page.results.length === 0) break;
  }
  return calls;
}

function hr() {
  console.log("=".repeat(70));
}

async function main() {
  console.log(`SSE PROTOCOL ACTIVITY REPORT — Stacks mainnet`);
  console.log(`Deployer: ${DEPLOYER}`);
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log("Discovering deployed contracts...\n");

  const contracts = await discoverDeployedContracts(DEPLOYER);
  if (contracts.length === 0) {
    console.error("No contract deployments found for this deployer.");
    process.exit(1);
  }
  console.log(`Found ${contracts.length} deployed contracts:`);
  for (const c of contracts) console.log(`  - ${c}`);
  console.log("");

  const allExternal = new Map(); // address -> total external tx count across all contracts

  // Per-step: txId records, keyed by step. Each record { sender, txId, contractId }.
  const stepRecords = new Map();
  for (const step of VAULT_STEPS) stepRecords.set(step.key, []);

  // Per-wallet set of completed step keys (vault engine only).
  const walletSteps = new Map(); // address -> Set<stepKey>

  let totalExternalTxs = 0;

  for (const contractId of contracts) {
    process.stdout.write(`Scanning ${contractId} ... `);
    const calls = await collectCalls(contractId);

    const isVaultEngine = contractId.includes(VAULT_ENGINE_MATCH);
    let external = 0;

    for (const { sender, fn, txId } of calls) {
      const isDeployer = sender === DEPLOYER;
      if (!isDeployer) {
        allExternal.set(sender, (allExternal.get(sender) || 0) + 1);
        external += 1;
        totalExternalTxs += 1;
      }

      // Vault lifecycle classification.
      if (isVaultEngine && fn && FN_TO_STEP.has(fn)) {
        if (isDeployer && !INCLUDE_DEPLOYER) continue;
        const stepKey = FN_TO_STEP.get(fn);
        stepRecords.get(stepKey).push({ sender, txId, contractId });
        if (!walletSteps.has(sender)) walletSteps.set(sender, new Set());
        walletSteps.get(sender).add(stepKey);
      }
    }

    console.log(`${calls.length} calls (${external} external)${isVaultEngine ? " [vault engine]" : ""}`);
  }

  // ---- Vault lifecycle section -------------------------------------------
  console.log("");
  hr();
  console.log("VAULT LIFECYCLE BREAKDOWN");
  console.log("open vault -> deposit collateral -> mint -> repay -> withdraw");
  hr();

  for (const step of VAULT_STEPS) {
    const records = stepRecords.get(step.key);
    const uniqueWallets = new Set(records.map((r) => r.sender)).size;
    console.log(`\n${step.label}: ${records.length} txs from ${uniqueWallets} wallets`);
    for (const r of records) {
      console.log(`    ${r.sender}`);
      console.log(`      ${txUrl(r.txId)}`);
    }
  }

  // ---- Full-flow analysis -------------------------------------------------
  const fullFlowWallets = [];
  for (const [addr, steps] of walletSteps.entries()) {
    if (FULL_FLOW_KEYS.every((k) => steps.has(k))) fullFlowWallets.push(addr);
  }
  const vaultInteractors = walletSteps.size;
  const partialInteractors = vaultInteractors - fullFlowWallets.length;

  const openedVaults = stepRecords.get("open").length;
  // A withdraw of collateral is the closing step of a vault flow.
  const closedVaults = stepRecords.get("withdraw").length;

  console.log("");
  hr();
  console.log("FULL FLOW (open -> deposit -> repay -> withdraw)");
  hr();
  console.log(`Wallets that completed the FULL flow: ${fullFlowWallets.length}`);
  for (const addr of fullFlowWallets) console.log(`    ${addr}`);
  console.log(`Wallets that touched vaults but did NOT finish: ${partialInteractors}`);

  // ---- Grant summary ------------------------------------------------------
  const ranked = [...allExternal.entries()].sort((a, b) => b[1] - a[1]);

  console.log("");
  hr();
  console.log("GRANT SUMMARY");
  hr();
  console.log(`Deployed contracts ................. ${contracts.length}`);
  console.log(`Unique external wallets ............ ${ranked.length}`);
  console.log(`Total external transactions ........ ${totalExternalTxs}`);
  console.log(`Vaults opened ...................... ${openedVaults}`);
  console.log(`Vaults closed (withdraw) ........... ${closedVaults}`);
  console.log(`Wallets — full vault flow .......... ${fullFlowWallets.length}`);
  console.log(`Wallets — interacted only .......... ${ranked.length - fullFlowWallets.length}`);
  hr();

  console.log("\nExternal wallets (by tx count):");
  for (const [addr, n] of ranked) {
    console.log(`  ${addr}  ${n} tx${n === 1 ? "" : "s"}`);
    if (VERBOSE && walletSteps.has(addr)) {
      console.log(`      vault steps: ${[...walletSteps.get(addr)].join(", ")}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
