# Unified Deployment System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all version-specific deployment scripts and YAML plans with a single `npm run deploy` command driven by `sse.config.json`.

**Architecture:** One script (`scripts/deploy.cjs`) reads `sse.config.json`, runs tests, generates a Clarinet deployment YAML, applies it, then bootstraps on-chain state (authorize engines, register oracles, add collaterals). All config comes from the JSON file — zero hardcoded values.

**Tech Stack:** Node.js (CJS), `@stacks/transactions`, `@stacks/wallet-sdk`, Clarinet CLI, YAML string generation.

---

### Task 1: Update `sse.config.json` with deployment fields

**Files:**
- Modify: `sse.config.json`

- [ ] **Step 1: Add `deployContracts` and `contractCosts` fields**

Add the two new fields after the `contracts` block in `sse.config.json`. The file should look like this after editing:

```json
{
  "$schema": "./sse.config.schema.json",
  "version": "4",
  "network": "testnet",
  "deployer": "ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF",

  "contracts": {
    "stablecoinFactory": "stablecoin-factory-v3",
    "stablecoinToken": "stablecoin-token-v3",
    "collateralRegistry": "collateral-registry-v4",
    "multiAssetVaultEngine": "multi-asset-vault-engine-v4",
    "stabilityPool": "stability-pool-v4",
    "liquidationEngine": "liquidation-engine-v4",
    "diaOracleAdapter": "dia-oracle-adapter",
    "priceOracleDiaBtc": "price-oracle-dia-btc",
    "priceOracleDiaStx": "price-oracle-dia-stx"
  },

  "deployContracts": [
    "diaOracleAdapter",
    "priceOracleDiaBtc",
    "priceOracleDiaStx",
    "collateralRegistry",
    "stabilityPool",
    "multiAssetVaultEngine",
    "liquidationEngine"
  ],

  "contractCosts": {
    "dia-oracle-adapter": 12000,
    "price-oracle-dia-btc": 12000,
    "price-oracle-dia-stx": 12000,
    "collateral-registry-v4": 60000,
    "stability-pool-v4": 60000,
    "multi-asset-vault-engine-v4": 200000,
    "liquidation-engine-v4": 60000
  },

  "collaterals": [
    {
      "name": "Test sBTC",
      "symbol": "sBTC",
      "contractName": "sbtc-token-v3",
      "decimals": 8,
      "initialMint": 1000000000000,
      "mockOracleContract": "price-oracle-sbtc-v3",
      "mockPrice": 6701683000000,
      "diaOracleId": 3,
      "risk": {
        "minCollateralRatio": 150,
        "liquidationRatio": 130,
        "liquidationPenalty": 10,
        "stabilityFee": 200,
        "debtCeiling": 1000000000000,
        "debtFloor": 1000000
      }
    },
    {
      "name": "Test STX",
      "symbol": "STX",
      "contractName": "stx-token-v3",
      "decimals": 6,
      "initialMint": 5000000000000,
      "mockOracleContract": "price-oracle-stx-v3",
      "mockPrice": 21200000,
      "diaOracleId": 4,
      "risk": {
        "minCollateralRatio": 200,
        "liquidationRatio": 170,
        "liquidationPenalty": 12,
        "stabilityFee": 300,
        "debtCeiling": 5000000000000,
        "debtFloor": 1000000
      }
    }
  ],

  "oracles": {
    "dia": {
      "testnet": "ST1S5ZGRZV5K4S9205RWPRTX9RGS9JV40KQMR4G1J.dia-oracle",
      "mainnet": "SP1G48FZ4Y7JY8G2Z0N51QTCYGBQ6F4J43J77BQC0.dia-oracle"
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add sse.config.json
git commit -m "feat: add deployContracts and contractCosts to sse.config.json"
```

---

### Task 2: Create `scripts/deploy.cjs`

**Files:**
- Create: `scripts/deploy.cjs`

This is the main task. The script has three phases. Build it incrementally.

- [ ] **Step 1: Write the config reader, signer resolver, and Stacks utilities**

Create `scripts/deploy.cjs` with this content:

```js
const {
  AnchorMode,
  PostConditionMode,
  makeContractCall,
  broadcastTransaction,
  uintCV,
  principalCV,
  boolCV,
} = require("@stacks/transactions");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── Config ──────────────────────────────────────────────────────────────────

const NETWORK_APIS = {
  testnet: "https://api.testnet.hiro.so",
  mainnet: "https://api.hiro.so",
};

function readConfig() {
  const raw = fs.readFileSync(path.resolve(__dirname, "../sse.config.json"), "utf8");
  return JSON.parse(raw);
}

function getApiUrl(network) {
  return process.env.STACKS_API_URL || NETWORK_APIS[network];
}

function getApiKey() {
  return process.env.HIRO_API_KEY || "";
}

function apiHeaders() {
  const key = getApiKey();
  return key ? { "x-api-key": key } : {};
}

// ── Signer ──────────────────────────────────────────────────────────────────

let PRIVATE_KEY = process.env.STACKS_PRIVATE_KEY || "";
let DEPLOYER = "";

function readMnemonicFromSettings(network) {
  const filename = network === "mainnet" ? "Mainnet.toml" : "Testnet.toml";
  const settingsPath = path.resolve(__dirname, "../settings", filename);
  if (!fs.existsSync(settingsPath)) return null;
  const content = fs.readFileSync(settingsPath, "utf8");
  const match = content.match(/mnemonic\s*=\s*"([^"]+)"/);
  return match ? match[1] : null;
}

async function resolveSigner(config) {
  DEPLOYER = config.deployer;

  if (PRIVATE_KEY) return;

  const mnemonic =
    process.env.STACKS_MNEMONIC || readMnemonicFromSettings(config.network);
  if (!mnemonic) {
    throw new Error(
      "Missing credentials. Set STACKS_PRIVATE_KEY, STACKS_MNEMONIC, or add mnemonic to settings/Testnet.toml"
    );
  }

  const { generateWallet, getStxAddress } = await import("@stacks/wallet-sdk");
  const wallet = await generateWallet({ secretKey: mnemonic, password: "" });
  const account = wallet.accounts[0];
  PRIVATE_KEY = account.stxPrivateKey;

  const resolved = getStxAddress({ account, network: config.network });
  if (resolved !== DEPLOYER) {
    throw new Error(
      `Mnemonic resolves to ${resolved} but config.deployer is ${DEPLOYER}`
    );
  }
}

// ── Stacks Helpers ──────────────────────────────────────────────────────────

async function getNonce(apiUrl) {
  const resp = await fetch(`${apiUrl}/extended/v1/address/${DEPLOYER}/nonces`, {
    headers: apiHeaders(),
  });
  if (!resp.ok) throw new Error(`Failed fetching nonce: ${resp.status}`);
  const data = await resp.json();
  return BigInt(data.possible_next_nonce);
}

async function broadcast(tx, network) {
  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) {
    throw new Error(`Broadcast failed: ${result.error} - ${result.reason}`);
  }
  return result.txid;
}

async function waitForConfirmation(txid, apiUrl) {
  for (;;) {
    const resp = await fetch(`${apiUrl}/extended/v1/tx/${txid}`, {
      headers: apiHeaders(),
    });
    if (resp.ok) {
      const tx = await resp.json();
      if (tx.tx_status === "success") return;
      if (
        tx.tx_status === "abort_by_response" ||
        tx.tx_status === "abort_by_post_condition"
      ) {
        throw new Error(
          `Transaction ${txid} failed: ${tx.tx_result?.repr || tx.tx_status}`
        );
      }
    }
    await new Promise((r) => setTimeout(r, 7000));
  }
}

async function contractExists(apiUrl, contractName) {
  const resp = await fetch(
    `${apiUrl}/v2/contracts/interface/${DEPLOYER}/${contractName}`,
    { headers: apiHeaders() }
  );
  return resp.ok;
}

async function callContract(
  apiUrl,
  network,
  contractName,
  functionName,
  functionArgs,
  nonce,
  { skipOnAbort = false } = {}
) {
  const tx = await makeContractCall({
    contractAddress: DEPLOYER,
    contractName,
    functionName,
    functionArgs,
    senderKey: PRIVATE_KEY,
    network,
    anchorMode: AnchorMode.OnChainOnly,
    postConditionMode: PostConditionMode.Allow,
    fee: 200000n,
    nonce,
  });
  const txid = await broadcast(tx, network);
  const explorerChain = network === "mainnet" ? "mainnet" : "testnet";
  console.log(
    `  → ${contractName}.${functionName} ... tx: 0x${txid}\n    https://explorer.hiro.so/txid/0x${txid}?chain=${explorerChain}`
  );
  try {
    await waitForConfirmation(txid, apiUrl);
    console.log(`    ✓ confirmed`);
  } catch (e) {
    if (skipOnAbort) {
      console.log(`    ⊘ skipped (already configured): ${e.message}`);
      return;
    }
    throw e;
  }
}

// ── YAML Generator ──────────────────────────────────────────────────────────

function resolveContractPath(contractName) {
  // Default: contracts/<contract-name>.clar
  return `contracts/${contractName}.clar`;
}

function generateDeploymentYaml(config, contractsToDeploy) {
  const network = config.network;
  const apiUrl = getApiUrl(network);
  const bitcoinNode =
    network === "mainnet"
      ? "http://blockstack:blockstacksystem@bitcoin.mainnet.stacks.co:8332"
      : "http://blockstack:blockstacksystem@bitcoind.testnet.stacks.co:18332";

  let transactions = "";
  for (const contractName of contractsToDeploy) {
    const cost = config.contractCosts[contractName] || 50000;
    const sourcePath = resolveContractPath(contractName);
    transactions += `        - contract-publish:\n`;
    transactions += `            contract-name: ${contractName}\n`;
    transactions += `            expected-sender: ${config.deployer}\n`;
    transactions += `            cost: ${cost}\n`;
    transactions += `            path: ${sourcePath}\n`;
    transactions += `            anchor-block-only: true\n`;
    transactions += `            clarity-version: 3\n`;
  }

  return `---
id: 0
name: "SSE deployment (generated ${new Date().toISOString()})"
network: ${network}
stacks-node: "${apiUrl}"
bitcoin-node: "${bitcoinNode}"
plan:
  batches:
    - id: 0
      transactions:
${transactions}      epoch: "3.1"
`;
}

// ── Phase 1: Pre-flight ─────────────────────────────────────────────────────

async function preflight(config) {
  const apiUrl = getApiUrl(config.network);

  console.log("\n[1/3] Pre-flight");

  // Run tests
  console.log("  Running tests...");
  try {
    execSync("npm test", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
    });
    console.log("  ✓ Tests passed");
  } catch {
    console.error("  ✗ Tests failed — aborting deployment");
    process.exit(1);
  }

  // Check which contracts need deploying
  const toDeploy = [];
  const skipped = [];

  for (const key of config.deployContracts) {
    const contractName = config.contracts[key];
    if (!contractName) {
      throw new Error(
        `deployContracts references key "${key}" not found in contracts map`
      );
    }
    const exists = await contractExists(apiUrl, contractName);
    if (exists) {
      console.log(`  ⊘ ${contractName} — already on-chain, skipping`);
      skipped.push(contractName);
    } else {
      console.log(`  ✓ ${contractName} — will deploy`);
      toDeploy.push(contractName);
    }
  }

  return { toDeploy, skipped };
}

// ── Phase 2: Deploy ─────────────────────────────────────────────────────────

async function deploy(config, contractsToDeploy) {
  console.log(`\n[2/3] Deploy (${contractsToDeploy.length} contracts)`);

  if (contractsToDeploy.length === 0) {
    console.log("  Nothing to deploy — all contracts already on-chain");
    return;
  }

  // Verify all source files exist
  for (const contractName of contractsToDeploy) {
    const sourcePath = path.resolve(
      __dirname,
      "..",
      resolveContractPath(contractName)
    );
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file not found: ${sourcePath}`);
    }
  }

  const yaml = generateDeploymentYaml(config, contractsToDeploy);
  const yamlPath = path.resolve(
    __dirname,
    "../deployments/generated-testnet-plan.yaml"
  );
  fs.writeFileSync(yamlPath, yaml);
  console.log(`  Generated: deployments/generated-testnet-plan.yaml`);

  // Apply with Clarinet
  console.log("  Applying deployment plan...");
  try {
    execSync(
      `clarinet deployments apply -p deployments/generated-testnet-plan.yaml --no-dashboard`,
      {
        cwd: path.resolve(__dirname, ".."),
        stdio: "inherit",
      }
    );
    console.log("  ✓ Deployment applied");
  } catch {
    console.error("  ✗ Deployment failed");
    process.exit(1);
  }
}

// ── Phase 3: Bootstrap ──────────────────────────────────────────────────────

async function bootstrap(config) {
  console.log("\n[3/3] Bootstrap");

  const apiUrl = getApiUrl(config.network);
  const network = config.network;
  let nonce = await getNonce(apiUrl);

  const stablecoinToken = config.contracts.stablecoinToken;
  const collateralRegistry = config.contracts.collateralRegistry;
  const vaultEngine = config.contracts.multiAssetVaultEngine;

  // 1. Authorize vault engine in stablecoin token
  console.log("\n  Authorizing vault engine...");
  await callContract(
    apiUrl,
    network,
    stablecoinToken,
    "set-vault-engine",
    [principalCV(`${DEPLOYER}.${vaultEngine}`)],
    nonce++,
    { skipOnAbort: true }
  );

  // 2. Authorize vault engine in collateral registry
  await callContract(
    apiUrl,
    network,
    collateralRegistry,
    "set-vault-engine-authorized",
    [principalCV(`${DEPLOYER}.${vaultEngine}`), boolCV(true)],
    nonce++,
    { skipOnAbort: true }
  );

  // 3. Register DIA oracle mappings
  console.log("\n  Registering oracle mappings...");
  for (const collateral of config.collaterals) {
    await callContract(
      apiUrl,
      network,
      vaultEngine,
      "register-asset-oracle",
      [
        principalCV(`${DEPLOYER}.${collateral.contractName}`),
        uintCV(collateral.diaOracleId),
      ],
      nonce++,
      { skipOnAbort: true }
    );
  }

  // 4. Set mock oracle prices (fallback for testing)
  console.log("\n  Setting mock oracle prices...");
  for (const collateral of config.collaterals) {
    await callContract(
      apiUrl,
      network,
      collateral.mockOracleContract,
      "set-price",
      [uintCV(collateral.mockPrice)],
      nonce++,
      { skipOnAbort: true }
    );
  }

  // 5. Mint faucet tokens
  console.log("\n  Minting faucet tokens...");
  for (const collateral of config.collaterals) {
    await callContract(
      apiUrl,
      network,
      collateral.contractName,
      "faucet-mint",
      [uintCV(collateral.initialMint), principalCV(DEPLOYER)],
      nonce++,
      { skipOnAbort: true }
    );
  }

  // 6. Add collateral types
  console.log("\n  Adding collateral types...");
  for (const collateral of config.collaterals) {
    await callContract(
      apiUrl,
      network,
      collateralRegistry,
      "add-collateral-type",
      [
        principalCV(`${DEPLOYER}.${collateral.contractName}`),
        uintCV(collateral.risk.minCollateralRatio),
        uintCV(collateral.risk.liquidationRatio),
        uintCV(collateral.risk.liquidationPenalty),
        uintCV(collateral.risk.stabilityFee),
        uintCV(collateral.risk.debtCeiling),
        uintCV(collateral.risk.debtFloor),
        principalCV(`${DEPLOYER}.${collateral.mockOracleContract}`),
      ],
      nonce++,
      { skipOnAbort: true }
    );
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const config = readConfig();

  // CLI override: --network testnet|mainnet
  const networkArg = process.argv.find((a) => a.startsWith("--network"));
  if (networkArg) {
    const val = networkArg.includes("=")
      ? networkArg.split("=")[1]
      : process.argv[process.argv.indexOf(networkArg) + 1];
    if (val) config.network = val;
  }

  const timestamp = new Date().toISOString();
  console.log(`\nSSE Deploy v${config.version} — ${timestamp}`);
  console.log("═".repeat(50));
  console.log(`Network:  ${config.network}`);
  console.log(`Deployer: ${config.deployer}`);

  await resolveSigner(config);

  const { toDeploy, skipped } = await preflight(config);
  await deploy(config, toDeploy);
  await bootstrap(config);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  console.log("\n" + "═".repeat(50));
  console.log(`✓ Deployment complete`);
  console.log(`  Contracts deployed: ${toDeploy.length}`);
  console.log(`  Contracts skipped:  ${skipped.length}`);
  console.log(
    `  Duration: ${minutes > 0 ? `${minutes}m ` : ""}${seconds}s`
  );
}

main().catch((error) => {
  console.error("\n✗ Deployment failed:", error.message);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the script parses correctly**

Run: `node -c scripts/deploy.cjs`
Expected: no output (syntax OK)

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy.cjs
git commit -m "feat: add unified deploy script reading from sse.config.json"
```

---

### Task 3: Update `package.json` scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace version-specific scripts with unified deploy commands**

In `package.json`, replace the `scripts` block:

```json
  "scripts": {
    "lint": "clarinet check -d",
    "ci": "npm run lint && npm test",
    "test": "vitest run",
    "test:report": "vitest run -- --coverage --costs",
    "test:watch": "chokidar \"tests/**/*.ts\" \"contracts/**/*.clar\" -c \"npm run test:report\"",
    "deploy": "node scripts/deploy.cjs",
    "deploy:testnet": "node scripts/deploy.cjs --network testnet",
    "deploy:mainnet": "node scripts/deploy.cjs --network mainnet"
  },
```

This removes:
- `deploy:v3`
- `deploy:collaterals:v3`
- `bootstrap:v3`
- `deploy:v4`
- `bootstrap:v4`

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "feat: replace version-specific npm scripts with unified deploy command"
```

---

### Task 4: Delete old scripts and deployment plans

**Files:**
- Delete: `scripts/bootstrap-v3.cjs`
- Delete: `scripts/bootstrap-v4.cjs`
- Delete: `scripts/deploy-factory.cjs`
- Delete: `scripts/deploy-factory.js`
- Delete: `scripts/deploy-direct.cjs`
- Delete: `scripts/set-fee.cjs`
- Delete: `scripts/get-private-key.cjs`
- Delete: `deployments/default.testnet-plan.yaml`
- Delete: `deployments/collaterals-v3.testnet-plan.yaml`
- Delete: `deployments/new-v3-contracts.testnet-plan.yaml`
- Delete: `deployments/stablecoin-factory.testnet-plan.yaml`
- Delete: `deployments/dia-oracles.testnet-plan.yaml`
- Delete: `deployments/v4-upgrade.testnet-plan.yaml`

Keep: `deployments/default.simnet-plan.yaml` (needed for local tests)

- [ ] **Step 1: Delete all old scripts**

```bash
rm scripts/bootstrap-v3.cjs scripts/bootstrap-v4.cjs scripts/deploy-factory.cjs scripts/deploy-factory.js scripts/deploy-direct.cjs scripts/set-fee.cjs scripts/get-private-key.cjs
```

- [ ] **Step 2: Delete all old testnet deployment plans**

```bash
rm deployments/default.testnet-plan.yaml deployments/collaterals-v3.testnet-plan.yaml deployments/new-v3-contracts.testnet-plan.yaml deployments/stablecoin-factory.testnet-plan.yaml deployments/dia-oracles.testnet-plan.yaml deployments/v4-upgrade.testnet-plan.yaml
```

- [ ] **Step 3: Add generated YAML to .gitignore**

Append to `.gitignore` (create if it doesn't exist):

```
# Generated deployment plans
deployments/generated-*.yaml
```

- [ ] **Step 4: Verify only simnet plan and deploy script remain**

Run: `ls scripts/ && ls deployments/`

Expected:
```
scripts/:
deploy.cjs

deployments/:
default.simnet-plan.yaml
```

- [ ] **Step 5: Commit**

```bash
git add -A scripts/ deployments/ .gitignore
git commit -m "chore: delete version-specific deployment scripts and YAML plans"
```

---

### Task 5: Update `AGENTS.md` deployment rules

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Replace the Deployment Rules section**

Find the `## Deployment Rules` section in `AGENTS.md` (starts around line 86) and replace it entirely with:

```markdown
## Deployment Rules

- **Stacks contracts cannot be redeployed.** If a deployed contract's logic changes, create a new version (e.g., `stability-pool-v3` → `stability-pool-v4`). Never assume you can redeploy an existing contract name.
- **Tightly-coupled contracts must be versioned together.** If contract A references contract B by name and B changes, A must also be re-versioned with updated references. Map ALL cross-references before versioning.
- **Unchanged contracts keep their existing version.** Only bump version for contracts with actual logic changes.
- **Single-command deployment.** All deployments use `npm run deploy` which reads `sse.config.json`, runs tests, generates the Clarinet deployment plan, deploys contracts, and runs bootstrap — in one command. Never create version-specific scripts or deployment plans.
- **`sse.config.json` is the single source of truth.** When versioning contracts:
  1. Update contract names in `sse.config.json` → `contracts`
  2. Update `deployContracts` list (only new/changed contracts)
  3. Update `contractCosts` for new contract names
  4. Run `npm run deploy`
- **Deploy = clean state for new contracts only.** A new version (e.g., `multi-asset-vault-engine-v5`) has empty state. Shared contracts that are NOT re-versioned (e.g., `stablecoin-factory-v3`) retain their existing on-chain state including old test data. Account for this in the frontend by filtering stale data.
- **Frontend constants must match deployed contracts.** After deployment, update `frontend/src/lib/constants.ts` to point to the new contract versions. Verify with `next build`.
- **Update deployment docs in the same task.** After deploying, update `README.md` (deployment section), `docs/SSE_CONTEXT.md`, and `docs/current.md` with the new contract names and version info.
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md deployment rules for unified deploy system"
```

---

### Task 6: Verify everything works end-to-end

- [ ] **Step 1: Run lint to make sure Clarinet is happy**

Run: `npm run lint`
Expected: no errors (simnet plan still works, contracts still check)

- [ ] **Step 2: Run tests to make sure nothing broke**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 3: Verify deploy script syntax and config loading**

Run: `node -e "const c = require('./sse.config.json'); console.log('v' + c.version, c.deployContracts.length + ' contracts to deploy'); c.deployContracts.forEach(k => console.log(' ', k, '->', c.contracts[k]))"`

Expected:
```
v4 7 contracts to deploy
  diaOracleAdapter -> dia-oracle-adapter
  priceOracleDiaBtc -> price-oracle-dia-btc
  priceOracleDiaStx -> price-oracle-dia-stx
  collateralRegistry -> collateral-registry-v4
  stabilityPool -> stability-pool-v4
  multiAssetVaultEngine -> multi-asset-vault-engine-v4
  liquidationEngine -> liquidation-engine-v4
```

- [ ] **Step 4: Dry-run YAML generation (verify output)**

Run: `node -e "const fs=require('fs'); const path=require('path'); const c=JSON.parse(fs.readFileSync('sse.config.json','utf8')); const contracts=c.deployContracts.map(k=>c.contracts[k]); console.log('Contracts:', contracts); contracts.forEach(n => { const p='contracts/'+n+'.clar'; console.log(p, fs.existsSync(p)?'EXISTS':'MISSING') })"`

Expected: all contract source files should show EXISTS.
