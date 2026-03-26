// Network configuration
export const NETWORK = process.env.NEXT_PUBLIC_NETWORK || "testnet";
export const IS_MAINNET = NETWORK === "mainnet";

// Contract deployer address from environment variable
// Falls back to testnet deployer if not set
const DEFAULT_TESTNET_DEPLOYER = "ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF";
const DEPLOYER_ADDRESS = process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS || DEFAULT_TESTNET_DEPLOYER;

// Contract addresses
export const CONTRACTS = {
  DEPLOYER: DEPLOYER_ADDRESS,

  // Core contracts
  VAULT_ENGINE: "vault-engine",
  MULTI_ASSET_VAULT_ENGINE: "multi-asset-vault-engine",
  STABLECOIN_TOKEN: "stablecoin-token",
  STABLECOIN_FACTORY: "stablecoin-factory-v2",
  COLLATERAL_REGISTRY: "collateral-registry",
  LIQUIDATION_ENGINE: "liquidation-engine",
  STABILITY_POOL: "stability-pool",
  PRICE_ORACLE: "price-oracle-mock",
};

// Helper to get full contract identifier
export const getContractId = (contractName: string) =>
  `${CONTRACTS.DEPLOYER}.${contractName}`;

// App configuration
export const APP_CONFIG = {
  name: "Stacks Stablecoin Engine",
  icon: "/logo.png",
};

// Default values (used when contracts aren't deployed or data can't be fetched)
export const DEFAULTS = {
  REGISTRATION_FEE_STX: 100, // 100 STX registration fee
  MIN_COLLATERAL_RATIO: 150, // 150%
  LIQUIDATION_PENALTY: 10, // 10%
  STABILITY_FEE: 2, // 2% annual
};

// Explorer URLs
export const EXPLORER_URL = IS_MAINNET
  ? "https://explorer.stacks.co"
  : "https://explorer.stacks.co/?chain=testnet";

export const getExplorerTxUrl = (txId: string) =>
  `${EXPLORER_URL}/txid/${txId}`;

export const getExplorerAddressUrl = (address: string) =>
  `${EXPLORER_URL}/address/${address}`;
