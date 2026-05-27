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

// Flatten a network-aware sse.config.json into the shape the rest of this
// script expects. Pulls deployer / governance / collaterals / deployContracts /
// factoryFeeMicroStx out of rawConfig.networks[network] and merges them with
// the shared top-level fields. Hard-fails if the network block is missing.
function resolveForNetwork(rawConfig, network) {
  if (!rawConfig.networks || !rawConfig.networks[network]) {
    throw new Error(
      `sse.config.json has no "networks.${network}" block. Available: ${Object.keys(rawConfig.networks || {}).join(", ") || "(none)"}`
    );
  }
  const netCfg = rawConfig.networks[network];
  // Merge per-network contractOverrides over the global contracts map. Used to
  // route different networks at different engine versions (e.g. testnet on v8
  // while mainnet stays on v7 pending audit).
  const mergedContracts = {
    ...(rawConfig.contracts || {}),
    ...(netCfg.contractOverrides || {}),
  };
  return {
    version: rawConfig.version,
    network,
    deployer: netCfg.deployer,
    governance: netCfg.governance || {},
    factoryFeeMicroStx: netCfg.factoryFeeMicroStx,
    deployContracts: netCfg.deployContracts || [],
    collaterals: netCfg.collaterals || [],
    contracts: mergedContracts,
    contractCosts: rawConfig.contractCosts || {},
    oracles: rawConfig.oracles || {},
  };
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
  // Use /source rather than /interface: the interface endpoint can 404
  // briefly after a confirmed publish while the node finishes analysis,
  // which would cause the deploy script to try to publish a contract
  // that already exists (rejected as ContractAlreadyExists).
  const resp = await fetch(
    `${apiUrl}/v2/contracts/source/${DEPLOYER}/${contractName}?proof=0`,
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

function resolveContractPath(contractName, network) {
  // The dia-oracle-adapter source differs by target network because it forwards
  // to a different real DIA oracle principal. Pick the matching source file.
  if (contractName === "dia-oracle-adapter") {
    return `contracts/dia-oracle-adapter-${network}.clar`;
  }
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
    const sourcePath = resolveContractPath(contractName, network);
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
      resolveContractPath(contractName, config.network)
    );
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file not found: ${sourcePath}`);
    }
  }

  const yaml = generateDeploymentYaml(config, contractsToDeploy);
  const yamlPath = path.resolve(
    __dirname,
    `../deployments/generated-${config.network}-plan.yaml`
  );
  fs.writeFileSync(yamlPath, yaml);
  console.log(`  Generated: deployments/generated-${config.network}-plan.yaml`);

  // Apply with Clarinet
  console.log("  Applying deployment plan...");
  try {
    execSync(
      `echo Y | clarinet deployments apply -p deployments/generated-${config.network}-plan.yaml --no-dashboard`,
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
  // v8 engine reads the oracle from collateral-registry-v6 directly and has
  // no register-asset-oracle / bootstrap-set-governance functions. Detect it
  // by name so the bootstrap loop skips those v7-only calls.
  const isVaultEngineV8 = vaultEngine && vaultEngine.includes("-v8");

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

  // Prefer collateral.assetPrincipal (full external principal, e.g. real sBTC
  // on mainnet at SM3VDXK….sbtc-token) over the deployer-namespaced fallback.
  const assetPrincipalOf = (collateral) =>
    collateral.assetPrincipal || `${DEPLOYER}.${collateral.contractName}`;

  // Resolve the oracle contract for a collateral entry. New entries use
  // `oracleKey` (a key into config.contracts) which is the v8-aligned shape.
  // Older entries still using `diaOracleId` are mapped through the legacy
  // {3: priceOracleDiaBtc, 4: priceOracleDiaStx} table for backwards compat.
  const legacyOracleByDiaId = {
    3: config.contracts.priceOracleDiaBtc,
    4: config.contracts.priceOracleDiaStx,
  };
  const oracleContractOf = (collateral) => {
    if (collateral.oracleKey) {
      const name = config.contracts[collateral.oracleKey];
      if (!name) {
        throw new Error(
          `Collateral "${collateral.symbol || collateral.name}" references unknown oracleKey "${collateral.oracleKey}"`
        );
      }
      return name;
    }
    if (collateral.diaOracleId != null) {
      const name = legacyOracleByDiaId[collateral.diaOracleId];
      if (!name) {
        throw new Error(
          `Collateral "${collateral.symbol || collateral.name}" has unmapped diaOracleId ${collateral.diaOracleId}. Add an oracleKey instead.`
        );
      }
      return name;
    }
    throw new Error(
      `Collateral "${collateral.symbol || collateral.name}" must specify oracleKey (preferred) or diaOracleId.`
    );
  };

  // 3. Register oracle mappings on the engine (v7 only -- v8 reads oracle
  //    from the collateral registry directly).
  if (!isVaultEngineV8) {
    console.log("\n  Registering oracle mappings (v7 engine)...");
    for (const collateral of config.collaterals) {
      if (collateral.diaOracleId == null) {
        throw new Error(
          `v7 engine requires diaOracleId on every collateral entry; "${collateral.symbol || collateral.name}" is missing it.`
        );
      }
      await callContract(
        apiUrl,
        network,
        vaultEngine,
        "register-asset-oracle",
        [
          principalCV(assetPrincipalOf(collateral)),
          uintCV(collateral.diaOracleId),
        ],
        nonce++,
        { skipOnAbort: true }
      );
    }
  } else {
    console.log("\n  ⊘ Skipping register-asset-oracle (v8 engine reads oracle from collateral-registry-v6 directly)");
  }

  // 4. Add collateral types with their resolved oracle contracts
  console.log("\n  Adding collateral types...");
  for (const collateral of config.collaterals) {
    const oracleContract = oracleContractOf(collateral);
    await callContract(
      apiUrl,
      network,
      collateralRegistry,
      "add-collateral-type",
      [
        principalCV(assetPrincipalOf(collateral)),
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

  // 5. Update oracle principals in collateral registry (for re-deployments
  //    where the registry already has a stale oracle stored).
  console.log("\n  Updating oracle principals...");
  for (const collateral of config.collaterals) {
    const oracleContract = oracleContractOf(collateral);
    await callContract(
      apiUrl,
      network,
      collateralRegistry,
      "update-oracle",
      [
        principalCV(assetPrincipalOf(collateral)),
        principalCV(`${DEPLOYER}.${oracleContract}`),
      ],
      nonce++,
      { skipOnAbort: true }
    );
  }

  // 6. Wire governance: each governed contract points at the timelock, then locks.
  //    sse-governance-v1 stores admin (Asigna multisig) + guardian + timelock principal.
  //    sse-timelock-v1 seeds default emergency whitelist, then locks bootstrap.
  //    Order matters: this MUST run last because once locked, no further admin calls
  //    can come from the deployer — only from the timelock.
  console.log("\n  Wiring governance...");

  const governanceContract = config.contracts.sseGovernance;
  const timelockContract = config.contracts.sseTimelock;
  const bridgeRegistry = config.contracts.bridgeRegistry;
  const xreserveAdapter = config.contracts.xreserveAdapter;
  const stablecoinFactory = config.contracts.stablecoinFactory;

  // 6.pre. If a network-level factoryFeeMicroStx is configured, set it before
  // the factory's lock-bootstrap runs. Allowed pre-lock because the factory's
  // is-governance-caller accepts CONTRACT-OWNER while bootstrap-locked = false.
  // Used by mainnet to set the registration fee to 0 at launch.
  if (typeof config.factoryFeeMicroStx === "number" && stablecoinFactory) {
    console.log(`  Setting factory registration fee to ${config.factoryFeeMicroStx} microSTX...`);
    await callContract(
      apiUrl,
      network,
      stablecoinFactory,
      "set-registration-fee",
      [uintCV(config.factoryFeeMicroStx)],
      nonce++,
      { skipOnAbort: true }
    );
  }

  const governance = config.governance || {};
  const adminPrincipal = governance.admin || DEPLOYER;
  const guardianPrincipal = governance.guardian || DEPLOYER;

  if (!governanceContract || !timelockContract) {
    console.log("  ⊘ sseGovernance / sseTimelock not configured — skipping governance wiring");
  } else {
    const timelockFqn = `${DEPLOYER}.${timelockContract}`;

    // 6a. Each governed contract: set governance var to the timelock principal, then lock.
    //     v8 vault engine has NO governance var AND NO lock-bootstrap (admin
    //     surface lives entirely in collateral-registry-v6). Both calls must
    //     be skipped or the script aborts with NoSuchPublicFunction once it
    //     reaches the engine row.
    const governedContracts = [
      { name: config.contracts.stablecoinFactory, hasGovernance: true, hasLockBootstrap: true },
      { name: bridgeRegistry, hasGovernance: true, hasLockBootstrap: true },
      { name: config.contracts.collateralRegistry, hasGovernance: true, hasLockBootstrap: true },
      {
        name: config.contracts.multiAssetVaultEngine,
        hasGovernance: !isVaultEngineV8,
        hasLockBootstrap: !isVaultEngineV8,
      },
      { name: xreserveAdapter, hasGovernance: true, hasLockBootstrap: true },
    ].filter((c) => Boolean(c.name));

    for (const { name, hasGovernance, hasLockBootstrap } of governedContracts) {
      if (hasGovernance) {
        await callContract(apiUrl, network, name, "bootstrap-set-governance",
          [principalCV(timelockFqn)], nonce++, { skipOnAbort: true });
      }
      if (hasLockBootstrap) {
        await callContract(apiUrl, network, name, "lock-bootstrap",
          [], nonce++, { skipOnAbort: true });
      }
    }

    // 6b. Governance registry: store admin (Asigna multisig), guardian, timelock principal.
    await callContract(apiUrl, network, governanceContract, "bootstrap-set-admin",
      [principalCV(adminPrincipal)], nonce++, { skipOnAbort: true });
    await callContract(apiUrl, network, governanceContract, "bootstrap-set-guardian",
      [principalCV(guardianPrincipal)], nonce++, { skipOnAbort: true });
    await callContract(apiUrl, network, governanceContract, "bootstrap-set-timelock",
      [principalCV(timelockFqn)], nonce++, { skipOnAbort: true });
    await callContract(apiUrl, network, governanceContract, "lock-bootstrap",
      [], nonce++, { skipOnAbort: true });

    // 6c. Timelock: seed default emergency whitelist (pause-style fns), then lock.
    //     target=COLLATERAL(u2), fn=SET-ENABLED(u3); BRIDGE(u3) SET-TOKEN-ENABLED(u5); XRESERVE(u4) SET-PAUSED(u3)
    const emergencyDefaults = [
      { target: 2, fn: 3, label: "collateral.set-collateral-enabled" },
      { target: 3, fn: 5, label: "bridge.set-token-enabled" },
      { target: 4, fn: 3, label: "xreserve.set-paused" },
    ];
    for (const e of emergencyDefaults) {
      await callContract(apiUrl, network, timelockContract, "bootstrap-set-emergency",
        [uintCV(e.target), uintCV(e.fn), boolCV(true)], nonce++, { skipOnAbort: true });
    }
    await callContract(apiUrl, network, timelockContract, "lock-bootstrap",
      [], nonce++, { skipOnAbort: true });

    console.log(`  ✓ Governance wired — admin=${adminPrincipal} guardian=${guardianPrincipal} timelock=${timelockFqn}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  const config = readConfig();

  // CLI override: --network testnet|mainnet (falls back to defaultNetwork)
  let network = config.defaultNetwork || "testnet";
  const networkArg = process.argv.find((a) => a.startsWith("--network"));
  if (networkArg) {
    const val = networkArg.includes("=")
      ? networkArg.split("=")[1]
      : process.argv[process.argv.indexOf(networkArg) + 1];
    if (val) network = val;
  }

  // Flatten the network-aware config into the shape the rest of the script
  // expects (legacy single-network shape with deployer/governance/etc. at top).
  const resolved = resolveForNetwork(config, network);
  // Re-bind so downstream uses the resolved view.
  // eslint-disable-next-line no-param-reassign
  Object.assign(config, resolved);

  const timestamp = new Date().toISOString();
  console.log(`\nSSE Deploy v${config.version} — ${timestamp}`);
  console.log("═".repeat(50));
  console.log(`Network:  ${config.network}`);
  console.log(`Deployer: ${config.deployer}`);
  if (typeof config.factoryFeeMicroStx === "number") {
    console.log(`Factory fee: ${config.factoryFeeMicroStx} microSTX (set during bootstrap)`);
  }

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
