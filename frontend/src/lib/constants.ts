// Network configuration
export const NETWORK = process.env.NEXT_PUBLIC_NETWORK || "testnet";
export const IS_MAINNET = NETWORK === "mainnet";

// Contract deployer address from environment variable
// Falls back to testnet deployer if not set
const DEFAULT_TESTNET_DEPLOYER = "ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF";
const DEPLOYER_ADDRESS = process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS || DEFAULT_TESTNET_DEPLOYER;
const STABLECOIN_FACTORY_CONTRACT =
  process.env.NEXT_PUBLIC_STABLECOIN_FACTORY_CONTRACT || "stablecoin-factory-v3";
const VAULT_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_VAULT_ENGINE_CONTRACT || "vault-engine-v3";
const MULTI_ASSET_VAULT_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_MULTI_ASSET_VAULT_ENGINE_CONTRACT || "multi-asset-vault-engine-v3";
const COLLATERAL_REGISTRY_CONTRACT =
  process.env.NEXT_PUBLIC_COLLATERAL_REGISTRY_CONTRACT || "collateral-registry-v3";
const LIQUIDATION_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_LIQUIDATION_ENGINE_CONTRACT || "liquidation-engine-v3";

// Contract addresses
export const CONTRACTS = {
  DEPLOYER: DEPLOYER_ADDRESS,

  // Core contracts
  VAULT_ENGINE: VAULT_ENGINE_CONTRACT,
  MULTI_ASSET_VAULT_ENGINE: MULTI_ASSET_VAULT_ENGINE_CONTRACT,
  STABLECOIN_TOKEN: "stablecoin-token-v3",
  STABLECOIN_FACTORY: STABLECOIN_FACTORY_CONTRACT,
  COLLATERAL_REGISTRY: COLLATERAL_REGISTRY_CONTRACT,
  LIQUIDATION_ENGINE: LIQUIDATION_ENGINE_CONTRACT,
  STABILITY_POOL: "stability-pool-v3",
  PRICE_ORACLE_SBTC: "price-oracle-sbtc-v3",
  PRICE_ORACLE_STX: "price-oracle-stx-v3",
  STABLECOIN_ENGINE_TOKEN_TRAIT: "stablecoin-engine-token-trait",
  BRIDGE_ADAPTER_TRAIT: "bridge-adapter-trait",
  BRIDGE_REGISTRY: "bridge-registry-v3",
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
