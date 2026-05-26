// Asset -> oracle resolution helpers.
//
// The v8 vault engine routes every pricing decision through a trait reference
// passed at the call boundary (mint, withdraw, liquidate). The oracle that is
// considered "canonical" for an asset is the one stored on the collateral
// registry entry for that asset -- the engine compares the trait the caller
// passed against the stored principal at runtime and treats any mismatch as
// price=u0 (which makes the position fail the health check).
//
// The frontend must therefore look up oracles per-asset from the registry
// rather than hardcoding `assetName.includes("btc") -> btcOracle` style
// mappings. The old string-matching code only works for sBTC/STX and silently
// misroutes new assets (e.g. vGLD) into the wrong price.

import { CollateralType } from "@/hooks/useContractRead";
import { CONTRACTS, getContractId } from "./constants";

export interface AssetOracleResolution {
  /** Full principal of the oracle contract (e.g. "ST….price-oracle-vgld-v1"). */
  principal: string;
  /** Human-readable USD per whole token (raw oracle value / 1e8). */
  priceUsd: number | null;
  /** Raw oracle value still scaled by 1e8 (PRICE-SCALE), for read-only engine fns. */
  priceRaw: number | null;
}

/**
 * Returns the registry-backed oracle for `asset`, or `null` if no global
 * collateral type is registered for it (i.e. the protocol does not price
 * that asset on-chain yet). Callers must surface the null case explicitly --
 * never silently fall back to "the BTC oracle" or similar, which would route
 * the asset's value through the wrong feed.
 */
export function resolveAssetOracle(
  asset: string,
  collateralTypes: ReadonlyArray<CollateralType>
): AssetOracleResolution | null {
  const entry = collateralTypes.find((c) => c.asset === asset);
  if (!entry || !entry.oraclePrincipal) return null;
  return {
    principal: entry.oraclePrincipal,
    priceUsd: entry.oraclePrice,
    priceRaw: entry.oraclePriceRaw,
  };
}

/**
 * Convenience: just the oracle principal, used by write paths
 * (mint-against-asset, withdraw-collateral, liquidate-position) which pass
 * the oracle as a contract-arg trait reference under v8.
 */
export function getOraclePrincipalForAsset(
  asset: string,
  collateralTypes: ReadonlyArray<CollateralType>
): string | null {
  return resolveAssetOracle(asset, collateralTypes)?.principal ?? null;
}

/**
 * Convenience: just the human-readable USD price, used by preview math
 * (collateral USD, health factor, max borrow). Returns null when the registry
 * does not yet have a price for the asset -- callers should disable the
 * preview/UX rather than substituting a default.
 */
export function getOraclePriceForAsset(
  asset: string,
  collateralTypes: ReadonlyArray<CollateralType>
): number | null {
  return resolveAssetOracle(asset, collateralTypes)?.priceUsd ?? null;
}

/**
 * Returns the default oracle principal for the protocol-owned stablecoin
 * token (e.g. for the EGPB collateral entry on v7). Currently used only by
 * UI fallbacks; v8 always reads from the registry instead.
 */
export function defaultStablecoinOraclePrincipal(): string {
  // vGLD constant-$1 oracle doubles as a generic "stable" feed under v8.
  return getContractId(CONTRACTS.PRICE_ORACLE_VGLD);
}
