const {
  AnchorMode,
  PostConditionMode,
  makeContractCall,
  makeContractDeploy,
  broadcastTransaction,
  uintCV,
  principalCV,
  boolCV,
} = require("@stacks/transactions");
const fs = require("fs");
const path = require("path");

const HIRO_API = process.env.STACKS_API_URL || "https://api.testnet.hiro.so";
const HIRO_API_KEY = process.env.HIRO_API_KEY || "";

let PRIVATE_KEY = process.env.STACKS_PRIVATE_KEY || "";
let DEPLOYER = process.env.STACKS_DEPLOYER_ADDRESS || "";

const DEFAULT_COLLATERALS = [
  {
    contractName: "sbtc-token-v3",
    name: "Test sBTC",
    symbol: "sBTC",
    decimals: 8,
    initialMint: 1_000_000_000_000,
    oracleContract: "price-oracle-sbtc-v3",
    price: 6_701_683_000_000,
    risk: {
      minCollateralRatio: 150,
      liquidationRatio: 130,
      liquidationPenalty: 10,
      stabilityFee: 200,
      debtCeiling: 1_000_000_000_000,
      debtFloor: 1_000_000,
    },
  },
  {
    contractName: "stx-token-v3",
    name: "Test STX",
    symbol: "STX",
    decimals: 6,
    initialMint: 5_000_000_000_000,
    oracleContract: "price-oracle-stx-v3",
    price: 21_200_000,
    risk: {
      minCollateralRatio: 200,
      liquidationRatio: 170,
      liquidationPenalty: 12,
      stabilityFee: 300,
      debtCeiling: 5_000_000_000_000,
      debtFloor: 1_000_000,
    },
  },
];

const envCollaterals = process.env.SSE_COLLATERALS_JSON
  ? JSON.parse(process.env.SSE_COLLATERALS_JSON)
  : DEFAULT_COLLATERALS;

const CONFIG = {
  stablecoinFactory: "stablecoin-factory-v3",
  collateralRegistry: "collateral-registry-v3",
  stablecoinToken: "stablecoin-token-v3",
  vaultEngine: "vault-engine-v3",
  multiAssetVaultEngine: "multi-asset-vault-engine-v3",
  oracles: {
    sbtc: "price-oracle-sbtc-v3",
    stx: "price-oracle-stx-v3",
  },
  collaterals: envCollaterals,
};

const headers = () => ({
  "Content-Type": "application/octet-stream",
  ...(HIRO_API_KEY ? { "x-api-key": HIRO_API_KEY } : {}),
});

async function contractExists(address, contractName) {
  const resp = await fetch(`${HIRO_API}/v2/contracts/interface/${address}/${contractName}`, {
    headers: HIRO_API_KEY ? { "x-api-key": HIRO_API_KEY } : {},
  });
  return resp.ok;
}

async function getNonce(address) {
  const resp = await fetch(`${HIRO_API}/extended/v1/address/${address}/nonces`, {
    headers: HIRO_API_KEY ? { "x-api-key": HIRO_API_KEY } : {},
  });
  if (!resp.ok) throw new Error(`Failed fetching nonce: ${resp.status}`);
  const data = await resp.json();
  return BigInt(data.possible_next_nonce);
}

async function broadcast(tx) {
  const result = await broadcastTransaction({
    transaction: tx,
    network: "testnet",
  });
  if (result.error) {
    throw new Error(`Broadcast failed: ${result.error} - ${result.reason}`);
  }
  return result.txid;
}

async function waitForConfirmation(txid) {
  for (;;) {
    const resp = await fetch(`${HIRO_API}/extended/v1/tx/${txid}`, {
      headers: HIRO_API_KEY ? { "x-api-key": HIRO_API_KEY } : {},
    });
    if (resp.ok) {
      const tx = await resp.json();
      if (tx.tx_status === "success") return;
      if (tx.tx_status === "abort_by_response" || tx.tx_status === "abort_by_post_condition") {
        throw new Error(`Transaction ${txid} failed: ${tx.tx_result?.repr || tx.tx_status}`);
      }
    }
    await new Promise((r) => setTimeout(r, 7000));
  }
}

function buildFaucetTokenSource({ name, symbol, decimals }) {
  return `
(impl-trait '${DEPLOYER}.sip-010-trait.sip-010-trait)

(define-constant TOKEN-NAME "${name}")
(define-constant TOKEN-SYMBOL "${symbol}")
(define-constant TOKEN-DECIMALS u${decimals})

(define-map balances { owner: principal } { balance: uint })
(define-data-var total-supply uint u0)

(define-private (balance-of-internal (owner principal))
  (default-to u0 (get balance (map-get? balances { owner: owner })))
)

(define-public (faucet-mint (amount uint) (recipient principal))
  (begin
    (map-set balances { owner: recipient } { balance: (+ (balance-of-internal recipient) amount) })
    (var-set total-supply (+ (var-get total-supply) amount))
    (ok true)
  )
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) (err u401))
    (let ((sender-balance (balance-of-internal sender))
          (recipient-balance (balance-of-internal recipient)))
      (asserts! (>= sender-balance amount) (err u402))
      (map-set balances { owner: sender } { balance: (- sender-balance amount) })
      (map-set balances { owner: recipient } { balance: (+ recipient-balance amount) })
      (ok true)
    )
  )
)

(define-read-only (get-name) (ok TOKEN-NAME))
(define-read-only (get-symbol) (ok TOKEN-SYMBOL))
(define-read-only (get-decimals) (ok TOKEN-DECIMALS))
(define-read-only (get-balance (who principal)) (ok (balance-of-internal who)))
(define-read-only (get-total-supply) (ok (var-get total-supply)))
(define-read-only (get-token-uri) (ok none))
`.trim();
}

function readMnemonicFromSettings() {
  const settingsPath = path.resolve(process.cwd(), "settings/Testnet.toml");
  if (!fs.existsSync(settingsPath)) return null;
  const content = fs.readFileSync(settingsPath, "utf8");
  const match = content.match(/mnemonic\s*=\s*"([^"]+)"/);
  return match ? match[1] : null;
}

async function resolveSigner() {
  if (PRIVATE_KEY) {
    if (!DEPLOYER) {
      throw new Error("When STACKS_PRIVATE_KEY is provided, also set STACKS_DEPLOYER_ADDRESS");
    }
    return;
  }

  const mnemonic = process.env.STACKS_MNEMONIC || readMnemonicFromSettings();
  if (!mnemonic) {
    throw new Error("Missing STACKS_PRIVATE_KEY (or STACKS_MNEMONIC/settings/Testnet.toml mnemonic)");
  }

  const { generateWallet, getStxAddress } = await import("@stacks/wallet-sdk");
  const wallet = await generateWallet({ secretKey: mnemonic, password: "" });
  const account = wallet.accounts[0];
  PRIVATE_KEY = account.stxPrivateKey;
  if (!DEPLOYER) {
    DEPLOYER = getStxAddress({ account, network: "testnet" });
  }
}

async function deployContract(contractName, codeBody, nonce) {
  const tx = await makeContractDeploy({
    contractName,
    codeBody,
    senderKey: PRIVATE_KEY,
    network: "testnet",
    anchorMode: AnchorMode.OnChainOnly,
    fee: 200000n,
    nonce,
  });
  const txid = await broadcast(tx);
  console.log(`deployed ${contractName}: ${txid}`);
  await waitForConfirmation(txid);
}

async function callContract(contractName, functionName, functionArgs, nonce, { skipOnAbort = false } = {}) {
  const tx = await makeContractCall({
    contractAddress: DEPLOYER,
    contractName,
    functionName,
    functionArgs,
    senderKey: PRIVATE_KEY,
    network: "testnet",
    anchorMode: AnchorMode.OnChainOnly,
    postConditionMode: PostConditionMode.Allow,
    fee: 200000n,
    nonce,
  });
  const txid = await broadcast(tx);
  console.log(`called ${contractName}.${functionName}: ${txid}`);
  try {
    await waitForConfirmation(txid);
  } catch (e) {
    if (skipOnAbort) {
      console.log(`  -> skipped (already configured or idempotent): ${e.message}`);
      return;
    }
    throw e;
  }
}

async function main() {
  await resolveSigner();

  let nonce = await getNonce(DEPLOYER);
  console.log(`deployer: ${DEPLOYER}`);
  console.log(`starting nonce: ${nonce.toString()}`);

  for (const token of CONFIG.collaterals) {
    const exists = await contractExists(DEPLOYER, token.contractName);
    if (exists) {
      console.log(`skipping deploy ${token.contractName} (already exists)`);
    } else {
      const codeBody = buildFaucetTokenSource(token);
      await deployContract(token.contractName, codeBody, nonce++);
    }
  }

  await callContract(
    CONFIG.stablecoinToken,
    "set-vault-engine",
    [principalCV(`${DEPLOYER}.${CONFIG.vaultEngine}`)],
    nonce++,
    { skipOnAbort: true }
  );

  await callContract(
    CONFIG.collateralRegistry,
    "set-vault-engine-authorized",
    [principalCV(`${DEPLOYER}.${CONFIG.vaultEngine}`), boolCV(true)],
    nonce++,
    { skipOnAbort: true }
  );

  await callContract(
    CONFIG.collateralRegistry,
    "set-vault-engine-authorized",
    [principalCV(`${DEPLOYER}.${CONFIG.multiAssetVaultEngine}`), boolCV(true)],
    nonce++,
    { skipOnAbort: true }
  );

  // Register per-asset oracle IDs in the multi-asset vault engine
  // ORACLE-SBTC = u1, ORACLE-STX = u2
  // NOTE: only call if the function exists on-chain (v3 contracts updated locally
  // may not be redeployed yet).
  const mavInterface = await fetch(
    `${HIRO_API}/v2/contracts/interface/${DEPLOYER}/${CONFIG.multiAssetVaultEngine}`,
    { headers: HIRO_API_KEY ? { "x-api-key": HIRO_API_KEY } : {} }
  );
  const mavHasOracleReg = mavInterface.ok &&
    (await mavInterface.json()).functions?.some(f => f.name === "register-asset-oracle");

  if (mavHasOracleReg) {
    for (const token of CONFIG.collaterals) {
      const oracleId = token.symbol === "sBTC" ? 1 : 2;
      await callContract(
        CONFIG.multiAssetVaultEngine,
        "register-asset-oracle",
        [principalCV(`${DEPLOYER}.${token.contractName}`), uintCV(oracleId)],
        nonce++,
        { skipOnAbort: true }
      );
    }
  } else {
    console.log("skipping register-asset-oracle (function not on-chain yet — using price-oracle-mock fallback)");
  }

  for (const token of CONFIG.collaterals) {
    await callContract(
      token.oracleContract,
      "set-price",
      [uintCV(token.price)],
      nonce++,
      { skipOnAbort: true }
    );

    await callContract(
      token.contractName,
      "faucet-mint",
      [uintCV(token.initialMint), principalCV(DEPLOYER)],
      nonce++,
      { skipOnAbort: true }
    );

    await callContract(
      CONFIG.collateralRegistry,
      "add-collateral-type",
      [
        principalCV(`${DEPLOYER}.${token.contractName}`),
        uintCV(token.risk.minCollateralRatio),
        uintCV(token.risk.liquidationRatio),
        uintCV(token.risk.liquidationPenalty),
        uintCV(token.risk.stabilityFee),
        uintCV(token.risk.debtCeiling),
        uintCV(token.risk.debtFloor),
        principalCV(`${DEPLOYER}.${token.oracleContract}`),
      ],
      nonce++,
      { skipOnAbort: true }
    );
  }

  console.log("bootstrap-v3 completed successfully");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
