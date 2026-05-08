// Network configuration
export const NETWORK = process.env.NEXT_PUBLIC_NETWORK || "testnet";
export const IS_MAINNET = NETWORK === "mainnet";

// Contract deployer address from environment variable
// Falls back to testnet deployer if not set
const DEFAULT_TESTNET_DEPLOYER = "ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF";
const DEPLOYER_ADDRESS = process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS || DEFAULT_TESTNET_DEPLOYER;
const STABLECOIN_FACTORY_CONTRACT =
  process.env.NEXT_PUBLIC_STABLECOIN_FACTORY_CONTRACT || "stablecoin-factory-v3";
const MULTI_ASSET_VAULT_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_MULTI_ASSET_VAULT_ENGINE_CONTRACT || "multi-asset-vault-engine-v6";
const COLLATERAL_REGISTRY_CONTRACT =
  process.env.NEXT_PUBLIC_COLLATERAL_REGISTRY_CONTRACT || "collateral-registry-v5";
const LIQUIDATION_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_LIQUIDATION_ENGINE_CONTRACT || "liquidation-engine-v6";

// Contract addresses
export const CONTRACTS = {
  DEPLOYER: DEPLOYER_ADDRESS,

  // Core contracts
  MULTI_ASSET_VAULT_ENGINE: MULTI_ASSET_VAULT_ENGINE_CONTRACT,
  STABLECOIN_TOKEN: "stablecoin-token-v4",
  STABLECOIN_FACTORY: STABLECOIN_FACTORY_CONTRACT,
  COLLATERAL_REGISTRY: COLLATERAL_REGISTRY_CONTRACT,
  LIQUIDATION_ENGINE: LIQUIDATION_ENGINE_CONTRACT,
  STABILITY_POOL: "stability-pool-v5",
  PRICE_ORACLE_DIA_BTC: "price-oracle-dia-btc-v2",
  PRICE_ORACLE_DIA_STX: "price-oracle-dia-stx-v2",
  DIA_ORACLE_ADAPTER: "dia-oracle-adapter",
  STABLECOIN_ENGINE_TOKEN_TRAIT: "stablecoin-engine-token-trait",
  BRIDGE_ADAPTER_TRAIT: "bridge-adapter-trait",
  BRIDGE_REGISTRY: "bridge-registry-v3",
};

// Helper to get full contract identifier
export const getContractId = (contractName: string) =>
  `${CONTRACTS.DEPLOYER}.${contractName}`;

// Mapping from token contract name to native fungible token asset name
// Used for building Pc.ft() post-conditions
export const FT_ASSET_NAMES: Record<string, string> = {
  "sbtc-token-v4": "sbtc-token",
  "stx-token-v4": "stx-token",
  "stablecoin-token-v4": "sse-stablecoin",
};

// App configuration
export const APP_CONFIG = {
  name: "Stacks Stablecoin Engine",
  icon: "/logo.jpg",
};

// Oracle IDs matching contract constants in multi-asset-vault-engine-v5
// DIA oracles: BTC=3, STX=4
export const ORACLE_IDS = {
  DIA_BTC: 3,
  DIA_STX: 4,
};

export const ACTIVE_ORACLE_ID_BTC = ORACLE_IDS.DIA_BTC;
export const ACTIVE_ORACLE_ID_STX = ORACLE_IDS.DIA_STX;

// Faucet collateral tokens (testnet only)
export const FAUCET_COLLATERALS = [
  {
    name: "Test sBTC",
    symbol: "sBTC",
    contractName: "sbtc-token-v4",
    decimals: 8,
    mintAmount: 10_00000000, // 10 sBTC (8 decimals)
  },
  {
    name: "Test STX",
    symbol: "STX",
    contractName: "stx-token-v4",
    decimals: 6,
    mintAmount: 10_000000, // 10 STX (6 decimals)
  },
];

// Default values (used when contracts aren't deployed or data can't be fetched)
export const DEFAULTS = {
  REGISTRATION_FEE_STX: 100, // 100 STX registration fee
  MIN_COLLATERAL_RATIO: 150, // 150%
  LIQUIDATION_PENALTY: 10, // 10%
  STABILITY_FEE: 2, // 2% annual
};

// Explorer URLs
const EXPLORER_CHAIN = IS_MAINNET ? "mainnet" : "testnet";
export const EXPLORER_URL = "https://explorer.hiro.so";

export const getExplorerTxUrl = (txId: string) =>
  `${EXPLORER_URL}/txid/${txId}?chain=${EXPLORER_CHAIN}`;

export const getExplorerAddressUrl = (address: string) =>
  `${EXPLORER_URL}/address/${address}?chain=${EXPLORER_CHAIN}`;
