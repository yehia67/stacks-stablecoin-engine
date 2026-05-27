// Network configuration
export const NETWORK = process.env.NEXT_PUBLIC_NETWORK || "testnet";
export const IS_MAINNET = NETWORK === "mainnet";

// Default deployer per network. Override with NEXT_PUBLIC_DEPLOYER_ADDRESS if needed.
const DEFAULT_TESTNET_DEPLOYER = "ST3DGG4B53XA12A6NQTXWK4346YPTC3B2B0ATA6HF";
const DEFAULT_MAINNET_DEPLOYER = "SP3QMDACSJPCZQTBM5RZWQSE5561ZTFYV63J8ZMY0";
const DEPLOYER_ADDRESS =
  process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS ||
  (IS_MAINNET ? DEFAULT_MAINNET_DEPLOYER : DEFAULT_TESTNET_DEPLOYER);

// Real sBTC token principal on mainnet (canonical SIP-010 token).
// Used as a registered collateral asset under the mainnet collateral registry.
export const MAINNET_SBTC_ASSET_PRINCIPAL =
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

// Real vGLD token principal on mainnet (VoltFi Gold, SIP-010, hard $1 peg).
// Registered as a collateral asset on the mainnet collateral registry via
// the timelock execute-coll-add call. Native FT asset name is "vGLDv4".
export const MAINNET_VGLD_ASSET_PRINCIPAL =
  "SP183MTM6NNBG18YSKCQG7Y5P5HVTAK8WSXJNKYMW.vgld-token-v4";

// Allow per-contract overrides via env, but default to the on-chain names
// in sse.config.json for the active network. Mainnet runs v8 (trait-based
// oracle dispatch + vGLD + stability-pool-v7); testnet stays on v7 + v6 pool.
const STABLECOIN_FACTORY_CONTRACT =
  process.env.NEXT_PUBLIC_STABLECOIN_FACTORY_CONTRACT || "stablecoin-factory-v4";
const DEFAULT_VAULT_ENGINE = IS_MAINNET
  ? "multi-asset-vault-engine-v8"
  : "multi-asset-vault-engine-v7";
const DEFAULT_LIQUIDATION_ENGINE = IS_MAINNET
  ? "liquidation-engine-v8"
  : "liquidation-engine-v7";
const DEFAULT_STABILITY_POOL = IS_MAINNET
  ? "stability-pool-v7"
  : "stability-pool-v6";
const MULTI_ASSET_VAULT_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_MULTI_ASSET_VAULT_ENGINE_CONTRACT || DEFAULT_VAULT_ENGINE;
const COLLATERAL_REGISTRY_CONTRACT =
  process.env.NEXT_PUBLIC_COLLATERAL_REGISTRY_CONTRACT || "collateral-registry-v6";
const LIQUIDATION_ENGINE_CONTRACT =
  process.env.NEXT_PUBLIC_LIQUIDATION_ENGINE_CONTRACT || DEFAULT_LIQUIDATION_ENGINE;
// True when the active engine is v8 — the frontend uses this to choose
// trait-based oracle dispatch (engine takes oracle trait + price uint at the
// boundary) vs the v7 hardcoded oracle-id path.
export const VAULT_ENGINE_IS_V8 =
  MULTI_ASSET_VAULT_ENGINE_CONTRACT.includes("-v8");
const STABILITY_POOL_CONTRACT =
  process.env.NEXT_PUBLIC_STABILITY_POOL_CONTRACT || DEFAULT_STABILITY_POOL;
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
  PRICE_ORACLE_VGLD: "price-oracle-vgld-v1",
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
// Used for building Pc.ft() post-conditions.
// Keys may be either a bare contract name (e.g. "sbtc-token-v4") or a full
// principal (e.g. "SM3VDXK….sbtc-token") — callers should look up by whichever
// identifier they hold.
export const FT_ASSET_NAMES: Record<string, string> = {
  "sbtc-token-v4": "sbtc-token",
  "stx-token-v4": "stx-token",
  // vGLD's on-chain FT asset name is "vGLDv4" (not "vgld-token") — required
  // for Pc.ft() post-conditions to match the asset declared by VoltFi's
  // real vgld-token-v4 contract on mainnet. The testnet simnet stub in
  // contracts/vgld-token-v4.clar uses the same name for parity.
  "vgld-token-v4": "vGLDv4",
  "stablecoin-token-v4": "sse-stablecoin",
  // Real mainnet sBTC native fungible token name
  [MAINNET_SBTC_ASSET_PRINCIPAL]: "sbtc-token",
  "sbtc-token": "sbtc-token",
  // Real mainnet vGLD principal -> on-chain FT asset name
  [MAINNET_VGLD_ASSET_PRINCIPAL]: "vGLDv4",
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

// Faucet collateral tokens (testnet only). The vgld-token-v4 contract is a
// simnet/testnet stand-in; real vGLD on mainnet is sourced from VoltFi
// (https://app.voltfi.xyz/), not from this faucet, so the vGLD entry is
// excluded under IS_MAINNET to prevent the UI from offering a non-existent
// mintable mainnet token.
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
  ...(IS_MAINNET
    ? []
    : [
        {
          name: "Test vGLD",
          symbol: "vGLD",
          contractName: "vgld-token-v4",
          decimals: 8,
          mintAmount: 1000_00000000, // 1000 vGLD (8 decimals, $1 each)
        },
      ]),
];

/** Known decimal counts for collateral tokens, keyed by contract name or principal. */
export const COLLATERAL_DECIMALS: Record<string, number> = {
  "sbtc-token-v4": 8,
  "stx-token-v4": 6,
  "vgld-token-v4": 8,
  // Real mainnet sBTC — looked up by either bare name or full principal
  "sbtc-token": 8,
  [MAINNET_SBTC_ASSET_PRINCIPAL]: 8,
  // Real mainnet vGLD — same lookup pattern; 8 decimals per VoltFi's contract
  [MAINNET_VGLD_ASSET_PRINCIPAL]: 8,
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

/**
 * Short, user-facing symbol for a collateral asset, keyed by bare contract
 * name or full principal. Falls back to the contract-name slug if unknown.
 * Use this for any UI surface that needs a chip-style label rather than the
 * full `SP….vgld-token-v4` principal.
 */
export const COLLATERAL_SYMBOLS: Record<string, string> = {
  "sbtc-token-v4": "sBTC",
  "stx-token-v4": "STX",
  "vgld-token-v4": "vGLD",
  "sbtc-token": "sBTC",
  [MAINNET_SBTC_ASSET_PRINCIPAL]: "sBTC",
  [MAINNET_VGLD_ASSET_PRINCIPAL]: "vGLD",
};

/** Resolve a short symbol for an asset principal or contract name. */
export function getCollateralSymbol(assetOrPrincipal: string): string {
  const contractName = assetOrPrincipal.includes(".")
    ? assetOrPrincipal.split(".").pop()!
    : assetOrPrincipal;
  return (
    COLLATERAL_SYMBOLS[assetOrPrincipal] ||
    COLLATERAL_SYMBOLS[contractName] ||
    contractName
  );
}

/**
 * Per-collateral UX metadata (only what the UI needs at render time).
 * Acquisition links point users at the on-ramp for the asset; tagline is a
 * short hint displayed near the collateral selector.
 */
export interface CollateralUxMeta {
  symbol: string;
  acquisitionLabel: string;
  acquisitionUrl: string;
  tagline: string;
}

export const COLLATERAL_UX: Record<string, CollateralUxMeta> = {
  [MAINNET_VGLD_ASSET_PRINCIPAL]: {
    symbol: "vGLD",
    acquisitionLabel: "Get vGold on VoltFi",
    acquisitionUrl: "https://app.voltfi.xyz/",
    tagline: "USD-pegged share token from VoltFi's gold carry vault. 1 vGLD ≈ $1.",
  },
  "vgld-token-v4": {
    symbol: "vGLD",
    acquisitionLabel: "Get vGold on VoltFi",
    acquisitionUrl: "https://app.voltfi.xyz/",
    tagline: "USD-pegged share token from VoltFi's gold carry vault. 1 vGLD ≈ $1.",
  },
};

export function getCollateralUx(assetOrPrincipal: string): CollateralUxMeta | null {
  const contractName = assetOrPrincipal.includes(".")
    ? assetOrPrincipal.split(".").pop()!
    : assetOrPrincipal;
  return COLLATERAL_UX[assetOrPrincipal] || COLLATERAL_UX[contractName] || null;
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
