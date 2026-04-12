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
      `echo Y | clarinet deployments apply -p deployments/generated-testnet-plan.yaml --no-dashboard`,
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

  // 4. Add collateral types with DIA oracle contracts
  console.log("\n  Adding collateral types...");
  const oracleMap = {
    3: config.contracts.priceOracleDiaBtc,
    4: config.contracts.priceOracleDiaStx,
  };
  for (const collateral of config.collaterals) {
    const oracleContract = oracleMap[collateral.diaOracleId];
    if (!oracleContract) {
      throw new Error(`No oracle contract mapped for DIA oracle ID ${collateral.diaOracleId}`);
    }
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
        principalCV(`${DEPLOYER}.${oracleContract}`),
      ],
      nonce++,
      { skipOnAbort: true }
    );
  }

  // 5. Update oracle principals in collateral registry (for re-deployments)
  console.log("\n  Updating oracle principals...");
  for (const collateral of config.collaterals) {
    const oracleContract = oracleMap[collateral.diaOracleId];
    await callContract(
      apiUrl,
      network,
      collateralRegistry,
      "update-oracle",
      [
        principalCV(`${DEPLOYER}.${collateral.contractName}`),
        principalCV(`${DEPLOYER}.${oracleContract}`),
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
