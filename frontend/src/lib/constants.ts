// Network configuration
export const NETWORK = process.env.NEXT_PUBLIC_NETWORK || "testnet";
export const IS_MAINNET = NETWORK === "mainnet";

// Contract deployer address from environment variable
// Falls back to testnet deployer if not set
const DEFAULT_TESTNET_DEPLOYER = "ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF";
const DEPLOYER_ADDRESS = process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS || DEFAULT_TESTNET_DEPLOYER;

// Allow per-contract overrides via env, but default to the on-chain names
// in sse.config.json. Keep these in sync with that file when versioning.
const STABLECOIN_FACTORY_CONTRACT =
  process.env.NEXT_PUBLIC_STABLECOIN_FACTORY_CONTRACT || "stablecoin-factory-v4";
const MULTI_ASSET_VAULT_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_MULTI_ASSET_VAULT_ENGINE_CONTRACT || "multi-asset-vault-engine-v7";
const COLLATERAL_REGISTRY_CONTRACT =
  process.env.NEXT_PUBLIC_COLLATERAL_REGISTRY_CONTRACT || "collateral-registry-v6";
const LIQUIDATION_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_LIQUIDATION_ENGINE_CONTRACT || "liquidation-engine-v7";
const STABILITY_POOL_CONTRACT =
  process.env.NEXT_PUBLIC_STABILITY_POOL_CONTRACT || "stability-pool-v6";
const BRIDGE_REGISTRY_CONTRACT =
  process.env.NEXT_PUBLIC_BRIDGE_REGISTRY_CONTRACT || "bridge-registry-v4";
const XRESERVE_ADAPTER_CONTRACT =
  process.env.NEXT_PUBLIC_XRESERVE_ADAPTER_CONTRACT || "xreserve-adapter-v5";

// Contract addresses
export const CONTRACTS = {
  DEPLOYER: DEPLOYER_ADDRESS,

  // Core contracts
  MULTI_ASSET_VAULT_ENGINE: MULTI_ASSET_VAULT_ENGINE_CONTRACT,
  STABLECOIN_TOKEN: "stablecoin-token-v4",
  STABLECOIN_FACTORY: STABLECOIN_FACTORY_CONTRACT,
  COLLATERAL_REGISTRY: COLLATERAL_REGISTRY_CONTRACT,
  LIQUIDATION_ENGINE: LIQUIDATION_ENGINE_CONTRACT,
  STABILITY_POOL: STABILITY_POOL_CONTRACT,
  PRICE_ORACLE_DIA_BTC: "price-oracle-dia-btc-v2",
  PRICE_ORACLE_DIA_STX: "price-oracle-dia-stx-v2",
  DIA_ORACLE_ADAPTER: "dia-oracle-adapter",
  STABLECOIN_ENGINE_TOKEN_TRAIT: "stablecoin-engine-token-trait",
  BRIDGE_ADAPTER_TRAIT: "bridge-adapter-trait",
  BRIDGE_REGISTRY: BRIDGE_REGISTRY_CONTRACT,
  XRESERVE_ADAPTER: XRESERVE_ADAPTER_CONTRACT,

  // Governance
  SSE_GOVERNANCE: "sse-governance-v1",
  SSE_TIMELOCK: "sse-timelock-v1",
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

// Oracle IDs matching contract constants in the vault engine
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

/** Known decimal counts for collateral tokens, keyed by contract name. */
export const COLLATERAL_DECIMALS: Record<string, number> = {
  "sbtc-token-v4": 8,
  "stx-token-v4": 6,
};

/** All factory-created stablecoins use 6 decimals. */
export const STABLECOIN_DECIMALS = 6;

/** Resolve the decimal count for a collateral asset principal or contract name. */
export function getCollateralDecimals(assetOrPrincipal: string): number {
  const contractName = assetOrPrincipal.includes(".")
    ? assetOrPrincipal.split(".").pop()!
    : assetOrPrincipal;
  return COLLATERAL_DECIMALS[contractName] ?? STABLECOIN_DECIMALS;
}

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

// ============================================================================
// Governance
// ============================================================================

/** Target enum — keep in sync with contracts/sse-timelock-v1.clar. */
export const TIMELOCK_TARGETS = {
  FACTORY: 1,
  COLLATERAL: 2,
  BRIDGE: 3,
  XRESERVE: 4,
  VAULT: 5,
  SELF: 6,
} as const;

/** Per-target function IDs — keep in sync with contracts/sse-timelock-v1.clar. */
export const TIMELOCK_FNS = {
  factory: {
    SET_FEE: 1,
    SET_TREASURY: 2,
  },
  collateral: {
    ADD: 1,
    UPDATE: 2,
    SET_ENABLED: 3,
    UPDATE_ORACLE: 4,
    SET_VAULT_AUTH: 5,
  },
  bridge: {
    ADD_CHAIN: 1,
    DISABLE_CHAIN: 2,
    REGISTER_TOKEN: 3,
    UPDATE_ADAPTER: 4,
    SET_TOKEN_ENABLED: 5,
    CONFIG_CHAIN: 6,
  },
  xreserve: {
    SET_ATTEST: 1,
    SET_TOKEN: 2,
    SET_PAUSED: 3,
    ADD_CHAIN: 4,
    REMOVE_CHAIN: 5,
  },
  vault: {
    REGISTER_ORACLE: 1,
  },
  self: {
    SET_DELAY: 1,
    SET_EMERGENCY: 2,
    ROTATE_ADMIN: 3,
    ROTATE_GUARDIAN: 4,
  },
} as const;
