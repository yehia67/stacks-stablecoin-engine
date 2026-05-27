"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { CONTRACTS, getContractId, getCollateralDecimals, STABLECOIN_DECIMALS } from "@/lib/constants";
import { cvToValue, hexToCV, cvToHex, principalCV, uintCV, stringAsciiCV } from "@stacks/transactions";

const API_BASE = "/api/stacks";
const API_KEY: string | undefined = undefined;


interface ReadContractOptions {
  contractName: string;
  functionName: string;
  functionArgs?: string[]; // Hex-encoded Clarity values
}

interface UseContractReadResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

// Parse Clarity value from hex response
function parseClarityValue(hex: string): bigint | string | boolean | null {
  if (!hex || hex === "0x") return null;
  try {
    const cv = hexToCV(hex);
    const parsed = cvToValue(cv) as any;

    if (typeof parsed === "bigint" || typeof parsed === "string" || typeof parsed === "boolean") {
      return parsed;
    }

    return JSON.stringify(parsed);
  } catch {
    return hex;
  }
}

function parseRequiredUint(hex: string | null, context: string): number {
  if (!hex) {
    throw new Error(`[SSE] Missing read-only result for ${context}`);
  }

  try {
    const cv = hexToCV(hex);
    const parsed = cvToValue(cv) as any;
    
    // Direct bigint
    if (typeof parsed === "bigint") {
      return Number(parsed);
    }
    
    // Typed wrapper { type: "uint", value: bigint }
    if (parsed && typeof parsed === "object" && parsed.type === "uint" && typeof parsed.value === "bigint") {
      return Number(parsed.value);
    }
    
    // Fallback to parseClarityValue
    const value = parseClarityValue(hex);
    if (typeof value === "bigint") {
      return Number(value);
    }
    
    console.error(`[SSE] parseRequiredUint: unexpected parsed value for ${context}:`, parsed);
    throw new Error(`[SSE] Expected uint for ${context}, received ${JSON.stringify(parsed)}`);
  } catch (e) {
    console.error(`[SSE] parseRequiredUint error for ${context}:`, e, "hex:", hex);
    throw e;
  }
}

// Parse (ok uint) response - extracts the uint value from an ok response
// Used for oracle get-price which returns (response uint uint)
function parseOkUint(hex: string | null): number | null {
  if (!hex) return null;
  try {
    const cv = hexToCV(hex);
    const parsed = cvToValue(cv) as any;
    
    // Handle direct bigint (some contracts return just uint)
    if (typeof parsed === "bigint") {
      return Number(parsed);
    }
    
    // Handle (ok uint) response - cvToValue may return nested objects with bigint or string values
    if (parsed && typeof parsed === "object") {
      // Check for ok response wrapper
      if (parsed.type === "ok" && parsed.value !== undefined) {
        const inner = parsed.value;
        if (typeof inner === "bigint" || typeof inner === "number") {
          return Number(inner);
        }
        if (typeof inner === "string" && /^\d+$/.test(inner)) {
          return Number(inner);
        }
        if (inner && typeof inner === "object" && inner.value !== undefined) {
          return Number(inner.value);
        }
      }
      // Direct value wrapper { type: "uint", value: string|bigint }
      if (parsed.value !== undefined) {
        const v = parsed.value;
        if (typeof v === "bigint" || typeof v === "number") {
          return Number(v);
        }
        if (typeof v === "string" && /^\d+$/.test(v)) {
          return Number(v);
        }
      }
    }
    
    return null;
  } catch (e) {
    console.error("[SSE] Error parsing ok uint:", e, "hex:", hex);
    return null;
  }
}

export function useContractRead<T = any>(
  options: ReadContractOptions
): UseContractReadResult<T> {
  const { contractName, functionName, functionArgs = [] } = options;
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Memoize args to prevent infinite re-renders
  const argsKey = useMemo(() => JSON.stringify(functionArgs), [functionArgs]);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const url = `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${contractName}/${functionName}`;
        
        
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        
        // Add API key if available
        if (API_KEY) {
          headers["x-api-key"] = API_KEY;
        }

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            sender: CONTRACTS.DEPLOYER,
            arguments: JSON.parse(argsKey),
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        
        if (!result.okay) {
          throw new Error(result.cause || "Contract call failed");
        }

        // Parse the Clarity value from hex
        const value = parseClarityValue(result.result);
        
        if (!cancelled) {
          setData(value as T);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [contractName, functionName, argsKey, refreshKey]);

  const refetch = useCallback(async () => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  return { data, isLoading, error, refetch };
}

// Specific hook for registration fee
export function useRegistrationFee() {
  const { data, isLoading, error, refetch } = useContractRead<bigint>({
    contractName: CONTRACTS.STABLECOIN_FACTORY,
    functionName: "get-registration-fee",
  });

  // Convert from microSTX to STX
  const feeInSTX = data !== null ? Number(data) / 1_000_000 : null;

  return { fee: feeInSTX, isLoading, error, refetch };
}

// Hook for stablecoin count
export function useStablecoinCount() {
  const { data, isLoading, error, refetch } = useContractRead<bigint>({
    contractName: CONTRACTS.STABLECOIN_FACTORY,
    functionName: "get-stablecoin-count",
  });

  return { count: data !== null ? Number(data) : null, isLoading, error, refetch };
}

// Stablecoin interface
export interface Stablecoin {
  id: number;
  name: string;
  symbol: string;
  creator: string;
  tokenContract: string | null;
  registeredAt: number;
  feePaid: number;
}

// Hook to fetch all registered stablecoins
export function useRegisteredStablecoins() {
  const [stablecoins, setStablecoins] = useState<Stablecoin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { count: initialCount } = useStablecoinCount();

  const fetchStablecoins = useCallback(async () => {
    // Always re-fetch the count directly to avoid stale values after registration
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (API_KEY) {
      headers["x-api-key"] = API_KEY;
    }

    let count: number | null = initialCount;
    try {
      const countResp = await fetch(
        `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.STABLECOIN_FACTORY}/get-stablecoin-count`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ sender: CONTRACTS.DEPLOYER, arguments: [] }),
        }
      );
      if (countResp.ok) {
        const countResult = await countResp.json();
        if (countResult.okay && countResult.result) {
          const val = parseClarityValue(countResult.result);
          if (typeof val === "bigint") count = Number(val);
        }
      }
    } catch {
      // Fall back to hook count
    }

    if (count === null || count === 0) {
      setStablecoins([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const coins: Stablecoin[] = [];

      for (let i = 0; i < count; i++) {
        const url = `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.STABLECOIN_FACTORY}/get-stablecoin`;

        const idHex = i.toString(16).padStart(32, '0');
        const uintArg = `0x01${idHex}`;

        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            sender: CONTRACTS.DEPLOYER,
            arguments: [uintArg],
          }),
        });

        if (response.ok) {
          const result = await response.json();
          if (result.okay && result.result) {
            const decoded = decodeClarityTuple(result.result);
            if (!decoded) {
              console.error(`[SSE] Failed to decode stablecoin id=${i}: decodeClarityTuple returned null for hex`, result.result);
              continue;
            }

            const { name, symbol, creator } = decoded;
            if (typeof name !== "string" || typeof symbol !== "string" || typeof creator !== "string") {
              console.error(`[SSE] Stablecoin id=${i} has missing or invalid required fields:`, decoded);
              continue;
            }

            coins.push({
              id: i,
              name,
              symbol,
              creator,
              tokenContract: decoded["token-contract"] ?? null,
              registeredAt: decoded["registered-at"] ?? 0,
              feePaid: decoded["fee-paid"] ?? 0,
            });
          }
        }
      }

      setStablecoins(coins);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [initialCount]);

  useEffect(() => {
    fetchStablecoins();
  }, [fetchStablecoins]);

  return { stablecoins, isLoading, error, refetch: fetchStablecoins };
}

export interface CollateralType {
  asset: string;
  minCollateralRatio: number;
  liquidationRatio: number;
  liquidationPenalty: number;
  stabilityFee: number;
  debtCeiling: number;
  debtFloor: number;
  enabled: boolean;
  /**
   * Oracle contract principal registered for this asset. Required by the v8
   * vault engine, which dispatches all pricing through a trait reference at
   * mint/withdraw/liquidate time. Use this to look up the oracle to pass into
   * those calls instead of hardcoding asset-symbol -> oracle mappings.
   */
  oraclePrincipal: string | null;
  /** Live USD-per-token price (raw oracle value / 1e8), human-readable. */
  oraclePrice: number | null;
  /** Raw oracle value scaled by 1e8 (PRICE-SCALE). Pass straight to read-only engine fns. */
  oraclePriceRaw: number | null;
}

export function useCollateralTypes() {
  const [collateralTypes, setCollateralTypes] = useState<CollateralType[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const { data: countData } = useContractRead<bigint>({
    contractName: CONTRACTS.COLLATERAL_REGISTRY,
    functionName: "get-collateral-count",
  });

  const count = countData !== null ? Number(countData) : 0;

  const fetchCollateralTypes = useCallback(async () => {
    if (count === 0) {
      setCollateralTypes([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (API_KEY) {
        headers["x-api-key"] = API_KEY;
      }

      const assets: string[] = [];
      for (let i = 0; i < count; i++) {
        const indexArg = cvToHex(uintCV(i));
        const indexResp = await fetch(
          `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.COLLATERAL_REGISTRY}/get-collateral-at-index`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              sender: CONTRACTS.DEPLOYER,
              arguments: [indexArg],
            }),
          }
        );

        if (!indexResp.ok) continue;
        const indexResult = await indexResp.json();
        if (!indexResult.okay || !indexResult.result) continue;

        const decoded = decodeClarityTuple(indexResult.result);
        const asset = decoded?.asset;
        if (typeof asset === "string") assets.push(asset);
      }

      const configs: CollateralType[] = [];
      for (const asset of assets) {
        const assetArg = cvToHex(principalCV(asset));
        const configResp = await fetch(
          `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.COLLATERAL_REGISTRY}/get-collateral-config`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              sender: CONTRACTS.DEPLOYER,
              arguments: [assetArg],
            }),
          }
        );

        if (!configResp.ok) continue;
        const configResult = await configResp.json();
        if (!configResult.okay || !configResult.result) continue;

        const decoded = decodeClarityTuple(configResult.result);
        if (!decoded) continue;

        // Fetch oracle price for this asset. v8 trait dispatch needs both:
        //   - the principal (passed to mint/withdraw/liquidate as a trait ref)
        //   - the raw uint price (passed into read-only health-factor fns)
        let oraclePrice: number | null = null;
        let oraclePriceRaw: number | null = null;
        const oracleAddr = decoded.oracle as string | undefined;
        const oraclePrincipal = oracleAddr ?? null;
        if (oracleAddr) {
          const [oracleContractAddr, oracleContractName] = oracleAddr.split(".");
          if (oracleContractAddr && oracleContractName) {
            try {
              const priceResp = await fetch(
                `${API_BASE}/v2/contracts/call-read/${oracleContractAddr}/${oracleContractName}/get-price`,
                {
                  method: "POST",
                  headers,
                  body: JSON.stringify({ sender: CONTRACTS.DEPLOYER, arguments: [] }),
                }
              );
              if (priceResp.ok) {
                const priceResult = await priceResp.json();
                if (priceResult.okay && priceResult.result) {
                  const priceVal = parseOkUint(priceResult.result);
                  if (priceVal !== null) {
                    oraclePriceRaw = priceVal;
                    oraclePrice = priceVal / 1e8;
                  }
                }
              }
            } catch (e) {
              console.error(`[SSE] Error fetching oracle price from ${oracleAddr}:`, e);
            }
          }
        }

        if (decoded["min-collateral-ratio"] == null || decoded["liquidation-ratio"] == null) {
          console.error(`[SSE] Collateral config for ${asset} has missing required fields:`, decoded);
          continue;
        }

        configs.push({
          asset,
          minCollateralRatio: Number(decoded["min-collateral-ratio"]),
          liquidationRatio: Number(decoded["liquidation-ratio"]),
          liquidationPenalty: Number(decoded["liquidation-penalty"] ?? 0),
          stabilityFee: Number(decoded["stability-fee"] ?? 0),
          debtCeiling: Number(decoded["debt-ceiling"] ?? 0),
          debtFloor: Number(decoded["debt-floor"] ?? 0),
          enabled: Boolean(decoded.enabled),
          oraclePrincipal,
          oraclePrice,
          oraclePriceRaw,
        });
      }

      setCollateralTypes(configs.filter((c) => c.enabled));
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [count]);

  useEffect(() => {
    fetchCollateralTypes();
  }, [fetchCollateralTypes]);

  return { collateralTypes, isLoading, error, refetch: fetchCollateralTypes };
}

// Per-stablecoin collateral configuration
export interface StablecoinCollateralConfig {
  asset: string;
  minCollateralRatio: number;
  liquidationRatio: number;
  liquidationPenalty: number;
  stabilityFee: number;
  debtCeiling: number;
  debtFloor: number;
  enabled: boolean;
}

// Hook to fetch collaterals configured for a specific stablecoin
export function useStablecoinCollateralList(stablecoinId: number | null) {
  const [collaterals, setCollaterals] = useState<StablecoinCollateralConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchCollaterals = useCallback(async () => {
    if (stablecoinId === null || stablecoinId < 0) {
      setCollaterals([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (API_KEY) headers["x-api-key"] = API_KEY;

      // First get the count
      const countResp = await fetch(
        `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.COLLATERAL_REGISTRY}/get-stablecoin-collateral-count-ro`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            sender: CONTRACTS.DEPLOYER,
            arguments: [cvToHex(uintCV(stablecoinId))],
          }),
        }
      );

      if (!countResp.ok) {
        throw new Error(`[SSE] Failed to fetch stablecoin collateral count for stablecoin ${stablecoinId}`);
      }
      const countResult = await countResp.json();
      if (!countResult.okay) {
        throw new Error(countResult.cause || `[SSE] Failed read-only call for stablecoin collateral count ${stablecoinId}`);
      }
      const count = parseRequiredUint(
        countResult.result,
        `stablecoin collateral count for stablecoin ${stablecoinId}`
      );

      if (count === 0) {
        setCollaterals([]);
        setIsLoading(false);
        return;
      }

      const configs: StablecoinCollateralConfig[] = [];

      for (let i = 0; i < count; i++) {
        // Get asset at index
        const indexResp = await fetch(
          `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.COLLATERAL_REGISTRY}/get-stablecoin-collateral-at-index`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              sender: CONTRACTS.DEPLOYER,
              arguments: [cvToHex(uintCV(stablecoinId)), cvToHex(uintCV(i))],
            }),
          }
        );

        if (!indexResp.ok) continue;
        const indexResult = await indexResp.json();
        if (!indexResult.okay) continue;
        const decoded = decodeClarityTuple(indexResult.result);
        const asset = decoded?.asset;
        if (typeof asset !== "string") continue;

        // Get config for this stablecoin+asset
        const configResp = await fetch(
          `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.COLLATERAL_REGISTRY}/get-stablecoin-collateral-config`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              sender: CONTRACTS.DEPLOYER,
              arguments: [cvToHex(uintCV(stablecoinId)), cvToHex(principalCV(asset))],
            }),
          }
        );

        if (!configResp.ok) continue;
        const configResult = await configResp.json();
        if (!configResult.okay) continue;
        const configDecoded = decodeClarityTuple(configResult.result);
        if (!configDecoded) {
          console.error(
            `[SSE] Failed to decode stablecoin collateral config for stablecoin=${stablecoinId}, asset=${asset}. Raw:`,
            configResult.result
          );
          continue;
        }

        const requiredUintFields = [
          "min-collateral-ratio",
          "liquidation-ratio",
          "liquidation-penalty",
          "stability-fee",
          "debt-ceiling",
          "debt-floor",
        ] as const;

        const invalidUintField = requiredUintFields.find(
          (field) => typeof configDecoded[field] !== "number"
        );

        if (invalidUintField || typeof configDecoded.enabled !== "boolean") {
          continue;
        }

        configs.push({
          asset,
          minCollateralRatio: Number(configDecoded["min-collateral-ratio"]),
          liquidationRatio: Number(configDecoded["liquidation-ratio"]),
          liquidationPenalty: Number(configDecoded["liquidation-penalty"]),
          stabilityFee: Number(configDecoded["stability-fee"]),
          debtCeiling: Number(configDecoded["debt-ceiling"]),
          debtFloor: Number(configDecoded["debt-floor"]),
          enabled: configDecoded.enabled,
        });
      }

      setCollaterals(configs);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [stablecoinId]);

  useEffect(() => {
    fetchCollaterals();
  }, [fetchCollaterals]);

  return { collaterals, isLoading, error, refetch: fetchCollaterals };
}

// Debounced hook to check if a stablecoin name is already taken
export function useIsNameTaken(name: string) {
  const [isTaken, setIsTaken] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (!name || name.length < 3) {
      setIsTaken(null);
      setIsChecking(false);
      return;
    }

    setIsChecking(true);
    const timeout = setTimeout(async () => {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (API_KEY) headers["x-api-key"] = API_KEY;

        const url = `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.STABLECOIN_FACTORY}/is-name-taken`;
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            sender: CONTRACTS.DEPLOYER,
            arguments: [cvToHex(stringAsciiCV(name))],
          }),
        });

        if (response.ok) {
          const result = await response.json();
          if (result.okay && result.result) {
            const val = parseClarityValue(result.result);
            setIsTaken(val === true);
          }
        }
      } catch {
        setIsTaken(null);
      } finally {
        setIsChecking(false);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [name]);

  return { isTaken, isChecking };
}

// Debounced hook to check if a stablecoin symbol is already taken
export function useIsSymbolTaken(symbol: string) {
  const [isTaken, setIsTaken] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    if (!symbol || symbol.length < 2) {
      setIsTaken(null);
      setIsChecking(false);
      return;
    }

    setIsChecking(true);
    const timeout = setTimeout(async () => {
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (API_KEY) headers["x-api-key"] = API_KEY;

        const url = `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.STABLECOIN_FACTORY}/is-symbol-taken`;
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            sender: CONTRACTS.DEPLOYER,
            arguments: [cvToHex(stringAsciiCV(symbol))],
          }),
        });

        if (response.ok) {
          const result = await response.json();
          if (result.okay && result.result) {
            const val = parseClarityValue(result.result);
            setIsTaken(val === true);
          }
        }
      } catch {
        setIsTaken(null);
      } finally {
        setIsChecking(false);
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [symbol]);

  return { isTaken, isChecking };
}

// Helper to unwrap a single Clarity typed-value object.
// cvToValue (v6) returns { type: string, value: ... } wrappers.
// This recursively extracts the plain JS value.
function unwrapClarityValue(raw: any): any {
  if (raw === null || raw === undefined) return raw;
  
  // Detect { type, value } wrapper produced by cvToValue v6
  if (typeof raw === "object" && "type" in raw && typeof raw.type === "string") {
    const clarityType = raw.type;
    
    // Handle optional types
    if (clarityType === "none") {
      return null;
    }
    if (clarityType === "some" && "value" in raw) {
      return unwrapClarityValue(raw.value);
    }
    
    // Handle ok/err response types
    if (clarityType === "ok" && "value" in raw) {
      return unwrapClarityValue(raw.value);
    }
    if (clarityType === "err" && "value" in raw) {
      return null; // Treat errors as null
    }
    
    // Handle principal type - return the string directly
    if (clarityType === "principal" && "value" in raw) {
      return String(raw.value);
    }
    
    // Handle boolean types (true/false in Clarity)
    if (clarityType === "true") {
      return true;
    }
    if (clarityType === "false") {
      return false;
    }
    if (clarityType === "bool" && "value" in raw) {
      return Boolean(raw.value);
    }
    
    // Handle int/uint types
    if ((clarityType === "uint" || clarityType === "int") && "value" in raw) {
      if (typeof raw.value === "bigint") return Number(raw.value);
      if (typeof raw.value === "string") return Number(raw.value);
      return raw.value;
    }
    
    // Handle other typed values with value property
    if ("value" in raw) {
      return unwrapClarityValue(raw.value);
    }
  }
  
  if (typeof raw === "bigint") return Number(raw);
  
  // Handle string numbers (cvToValue sometimes returns bigints as strings)
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    return Number(raw);
  }
  
  // If it's a plain object (could be a tuple's inner fields), unwrap each value
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return Object.fromEntries(
      Object.entries(raw).map(([key, val]) => [key, unwrapClarityValue(val)])
    );
  }
  return raw;
}

// Helper to decode Clarity tuple from hex
function decodeClarityTuple(hex: string): Record<string, any> | null {
  try {
    if (!hex) return null;
    const cv = hexToCV(hex);
    const raw = cvToValue(cv) as any;
    if (!raw || typeof raw !== "object") return null;

    const unwrapped = unwrapClarityValue(raw);
    if (!unwrapped || typeof unwrapped !== "object") return null;
    return unwrapped;
  } catch {
    return null;
  }
}

// ========================================
// User Vault Data
// ========================================

export interface CollateralPosition {
  asset: string;
  amount: number;
  debtShare: number;
  healthFactor: number;
}

export interface UserVault {
  stablecoinId: number;
  stablecoinName: string;
  stablecoinSymbol: string;
  tokenContract: string | null;
  totalDebt: number;
  createdAt: number;
  positions: CollateralPosition[];
}

// Helper for read-only contract calls
async function readContract(
  contractName: string,
  functionName: string,
  args: string[],
  sender: string
): Promise<any> {
  try {
    const resp = await fetch(
      `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${contractName}/${functionName}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender, arguments: args }),
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.okay) return null;
    return data.result;
  } catch {
    return null;
  }
}

async function loadVaultForStablecoin(
  userAddress: string,
  coin: Stablecoin
): Promise<UserVault | null> {
  const vaultHex = await readContract(
    CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
    "get-vault-for-stablecoin",
    [cvToHex(principalCV(userAddress)), cvToHex(uintCV(coin.id))],
    userAddress
  );

  if (!vaultHex || vaultHex.startsWith("0x09")) {
    return null;
  }

  const vaultData = decodeClarityTuple(vaultHex);
  if (!vaultData) {
    console.error(`[SSE] Failed to decode vault for stablecoin ${coin.id}, hex:`, vaultHex);
    return null;
  }

  if (typeof vaultData["total-debt"] !== "number" || typeof vaultData["created-at"] !== "number") {
    console.error(`[SSE] Vault for stablecoin ${coin.id} has missing required fields:`, vaultData);
    return null;
  }

  const countHex = await readContract(
    CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
    "get-vault-asset-count-for-stablecoin",
    [cvToHex(principalCV(userAddress)), cvToHex(uintCV(coin.id))],
    userAddress
  );

  const assetCount = parseRequiredUint(
    countHex,
    `vault asset count for owner=${userAddress} stablecoin=${coin.id}`
  );

  const positions: CollateralPosition[] = [];

  for (let i = 0; i < assetCount; i++) {
    const assetHex = await readContract(
      CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
      "get-vault-asset-at-index-for-stablecoin",
      [cvToHex(principalCV(userAddress)), cvToHex(uintCV(coin.id)), cvToHex(uintCV(i))],
      userAddress
    );

    if (!assetHex || assetHex.startsWith("0x09")) continue;

    const assetData = decodeClarityTuple(assetHex);
    const asset = assetData?.asset;
    if (typeof asset !== "string") {
      console.error(
        `[SSE] Invalid vault asset at index ${i} for owner=${userAddress} stablecoin=${coin.id}:`,
        assetData
      );
      continue;
    }

    const posHex = await readContract(
      CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
      "get-collateral-position-for-stablecoin",
      [cvToHex(principalCV(userAddress)), cvToHex(uintCV(coin.id)), cvToHex(principalCV(asset))],
      userAddress
    );

    if (!posHex || posHex.startsWith("0x09")) continue;

    const posData = decodeClarityTuple(posHex);
    if (!posData) {
      console.error(
        `[SSE] Failed to decode collateral position for owner=${userAddress}, stablecoin=${coin.id}, asset=${asset}. Raw:`,
        posHex
      );
      continue;
    }

    if (typeof posData.amount !== "number" || typeof posData["debt-share"] !== "number") {
      console.error(
        `[SSE] Missing required fields in position for owner=${userAddress}, stablecoin=${coin.id}, asset=${asset}:`,
        posData
      );
      continue;
    }

    // v8 read-only health factor takes (owner, stablecoin-id, asset, price).
    // v7 took 3 args (no price). Detect which engine the frontend is pointing
    // at and pass args accordingly. For v8 we fetch the registry-stored
    // oracle's current price; if that read fails, fall back to u0 -- which
    // is fine when debt-share == 0 (the engine short-circuits to the
    // ZERO-DEBT-HEALTH-FACTOR constant before touching price).
    const isV8 = CONTRACTS.MULTI_ASSET_VAULT_ENGINE.includes("-v8");
    const hfArgs = [cvToHex(principalCV(userAddress)), cvToHex(uintCV(coin.id)), cvToHex(principalCV(asset))];
    if (isV8) {
      let priceRaw = 0;
      try {
        const oraclePrincipalHex = await readContract(
          CONTRACTS.COLLATERAL_REGISTRY,
          "get-oracle",
          [cvToHex(principalCV(asset))],
          userAddress
        );
        // get-oracle returns (optional principal); 0x09 = none
        if (oraclePrincipalHex && !oraclePrincipalHex.startsWith("0x09")) {
          // Strip the (some ...) wrapper to get the inner principal CV bytes.
          // Easier path: decode and re-extract via cvToValue.
          const cv = hexToCV(oraclePrincipalHex);
          const oraclePrincipal = cvToValue(cv) as { value?: string } | string | null;
          const oracleStr = typeof oraclePrincipal === "string"
            ? oraclePrincipal
            : (oraclePrincipal && typeof oraclePrincipal === "object" && "value" in oraclePrincipal)
              ? String(oraclePrincipal.value)
              : null;
          if (oracleStr && oracleStr.includes(".")) {
            const [oraAddr, oraName] = oracleStr.split(".");
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (API_KEY) headers["x-api-key"] = API_KEY;
            const oResp = await fetch(
              `${API_BASE}/v2/contracts/call-read/${oraAddr}/${oraName}/get-price`,
              { method: "POST", headers, body: JSON.stringify({ sender: userAddress, arguments: [] }) }
            );
            if (oResp.ok) {
              const oJson = await oResp.json();
              const oCv = hexToCV(oJson.result);
              const oVal = cvToValue(oCv);
              // get-price returns (response uint); cvToValue unwraps ok
              const parsed = typeof oVal === "object" && oVal && "value" in (oVal as any)
                ? Number((oVal as any).value)
                : Number(oVal);
              if (!Number.isNaN(parsed)) priceRaw = parsed;
            }
          }
        }
      } catch (e) {
        console.warn(`[SSE] oracle price lookup failed for asset=${asset}; using u0`, e);
      }
      hfArgs.push(cvToHex(uintCV(priceRaw)));
    }

    const hfHex = await readContract(
      CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
      "get-position-health-factor-for-stablecoin",
      hfArgs,
      userAddress
    );

    let healthFactor = 0;
    try {
      healthFactor = parseRequiredUint(
        hfHex,
        `health factor for owner=${userAddress} stablecoin=${coin.id} asset=${asset}`
      );
    } catch (e) {
      // Don't drop the position -- the UI needs the existence + amount even
      // if the health read returned null. Default healthFactor=0 so the
      // existing health-badge logic still renders.
      console.warn(
        `[SSE] health factor unreadable for owner=${userAddress} stablecoin=${coin.id} asset=${asset} raw=${hfHex}; defaulting to 0`,
        e
      );
    }

    positions.push({
      asset,
      amount: Number(posData.amount),
      debtShare: Number(posData["debt-share"]),
      healthFactor,
    });
  }

  return {
    stablecoinId: coin.id,
    stablecoinName: coin.name,
    stablecoinSymbol: coin.symbol,
    tokenContract: coin.tokenContract,
    totalDebt: Number(vaultData["total-debt"]),
    createdAt: Number(vaultData["created-at"]),
    positions,
  };
}

export function useUserVaults(userAddress: string | null) {
  const [vaults, setVaults] = useState<UserVault[]>([]);
  const [isLoading, setIsLoading] = useState(!!userAddress);
  const [error, setError] = useState<Error | null>(null);

  const { stablecoins } = useRegisteredStablecoins();

  const fetchVaults = useCallback(async () => {
    if (!userAddress || stablecoins.length === 0) {
      setVaults([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const settledVaults = await Promise.allSettled(
        stablecoins.map((coin) => loadVaultForStablecoin(userAddress, coin))
      );

      const loadedVaults = settledVaults
        .filter((result): result is PromiseFulfilledResult<UserVault | null> => result.status === "fulfilled")
        .map((result) => result.value)
        .filter((vault): vault is UserVault => vault !== null);

      for (const result of settledVaults) {
        if (result.status === "rejected") {
          console.error("[SSE] Failed to load one stablecoin vault; continuing with remaining vaults:", result.reason);
        }
      }

      setVaults(loadedVaults);
    } catch (err) {
      console.error("[SSE] Error fetching user vaults:", err);
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [userAddress, stablecoins]);

  useEffect(() => {
    fetchVaults();
  }, [fetchVaults]);

  return { vaults, isLoading, error, refetch: fetchVaults };
}

export function useUserVault(userAddress: string | null, stablecoinId: number | null) {
  const [vault, setVault] = useState<UserVault | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { stablecoins } = useRegisteredStablecoins();

  const fetchVault = useCallback(async () => {
    if (!userAddress || stablecoinId === null) {
      setVault(null);
      return;
    }

    const coin = stablecoins.find((stablecoin) => stablecoin.id === stablecoinId);
    if (!coin) {
      setVault(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const loadedVault = await loadVaultForStablecoin(userAddress, coin);
      setVault(loadedVault);
    } catch (err) {
      console.error(
        `[SSE] Error fetching vault for owner=${userAddress} stablecoin=${stablecoinId}:`,
        err
      );
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [stablecoinId, stablecoins, userAddress]);

  useEffect(() => {
    fetchVault();
  }, [fetchVault]);

  return { vault, isLoading, error, refetch: fetchVault };
}

export interface StabilityPoolReward {
  asset: string;
  claimableAmount: number;
  enabled: boolean;
}

export interface StabilityPoolState {
  totalDeposits: number;
  userDeposit: number;
  userShare: number;
  liquidationRewardPct: number;
  rewards: StabilityPoolReward[];
}

export function useStabilityPoolState(userAddress: string | null, stablecoinId: number | null) {
  const [poolState, setPoolState] = useState<StabilityPoolState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { collaterals } = useStablecoinCollateralList(stablecoinId);

  const fetchPoolState = useCallback(async () => {
    if (stablecoinId === null) {
      setPoolState(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const sender = userAddress || CONTRACTS.DEPLOYER;

      const totalDeposits = parseRequiredUint(
        await readContract(
          CONTRACTS.STABILITY_POOL,
          "get-total-deposits",
          [cvToHex(uintCV(stablecoinId))],
          sender
        ),
        `stability pool total deposits for stablecoin=${stablecoinId}`
      );

      const liquidationRewardPct = parseRequiredUint(
        await readContract(
          CONTRACTS.STABILITY_POOL,
          "get-liquidation-reward-pct",
          [cvToHex(uintCV(stablecoinId))],
          sender
        ),
        `stability pool reward pct for stablecoin=${stablecoinId}`
      );

      const userDeposit = userAddress
        ? parseRequiredUint(
            await readContract(
              CONTRACTS.STABILITY_POOL,
              "balance-of-for-stablecoin",
              [cvToHex(principalCV(userAddress)), cvToHex(uintCV(stablecoinId))],
              sender
            ),
            `stability pool user balance for owner=${userAddress} stablecoin=${stablecoinId}`
          )
        : 0;

      const rewards: StabilityPoolReward[] = [];

      for (const collateral of collaterals) {
        const claimableAmount = userAddress
          ? parseRequiredUint(
              await readContract(
                CONTRACTS.STABILITY_POOL,
                "get-claimable-collateral-reward",
                [
                  cvToHex(principalCV(userAddress)),
                  cvToHex(uintCV(stablecoinId)),
                  cvToHex(principalCV(collateral.asset)),
                ],
                sender
              ),
              `claimable reward for owner=${userAddress} stablecoin=${stablecoinId} asset=${collateral.asset}`
            )
          : 0;

        rewards.push({
          asset: collateral.asset,
          claimableAmount,
          enabled: collateral.enabled,
        });
      }

      setPoolState({
        totalDeposits,
        userDeposit,
        userShare: totalDeposits > 0 ? (userDeposit / totalDeposits) * 100 : 0,
        liquidationRewardPct,
        rewards,
      });
    } catch (err) {
      console.error(`[SSE] Error fetching stability pool state for stablecoin=${stablecoinId}:`, err);
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [collaterals, stablecoinId, userAddress]);

  useEffect(() => {
    fetchPoolState();
  }, [fetchPoolState]);

  return { poolState, isLoading, error, refetch: fetchPoolState };
}

// ========================================
// DIA Oracle Price Hook
// ========================================

export interface OraclePrices {
  btcUsd: number | null;
  stxUsd: number | null;
}

// Fetch prices directly from DIA oracle contracts
export function useDiaOraclePrices() {
  const [prices, setPrices] = useState<OraclePrices>({ btcUsd: null, stxUsd: null });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPrices = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (API_KEY) headers["x-api-key"] = API_KEY;

      const fetchOraclePrice = async (contractName: string): Promise<number | null> => {
        try {
          const resp = await fetch(
            `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${contractName}/get-price`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ sender: CONTRACTS.DEPLOYER, arguments: [] }),
            }
          );
          if (!resp.ok) return null;
          const result = await resp.json();
          if (!result.okay || !result.result) return null;
          const priceVal = parseOkUint(result.result);
          return priceVal !== null ? priceVal / 1e8 : null;
        } catch (e) {
          console.error(`[SSE] Error fetching price from ${contractName}:`, e);
          return null;
        }
      };

      const [btcUsd, stxUsd] = await Promise.all([
        fetchOraclePrice(CONTRACTS.PRICE_ORACLE_DIA_BTC),
        fetchOraclePrice(CONTRACTS.PRICE_ORACLE_DIA_STX),
      ]);

      setPrices({ btcUsd, stxUsd });
    } catch (err) {
      console.error("[SSE] Error fetching DIA oracle prices:", err);
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrices();
    // Refresh prices every 60 seconds
    const interval = setInterval(fetchPrices, 60000);
    return () => clearInterval(interval);
  }, [fetchPrices]);

  return { prices, isLoading, error, refetch: fetchPrices };
}

/**
 * Fetch the number of decimals for a SIP-010 token by calling its `get-decimals` read-only function.
 * Returns `null` while loading or if the call fails.
 */
export function useTokenDecimals(tokenPrincipal: string | null) {
  const [decimals, setDecimals] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchDecimals = useCallback(async () => {
    if (!tokenPrincipal) {
      setDecimals(null);
      return;
    }

    const [addr, name] = tokenPrincipal.split(".");
    if (!addr || !name) {
      setDecimals(null);
      return;
    }

    setIsLoading(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (API_KEY) headers["x-api-key"] = API_KEY;

      const resp = await fetch(
        `${API_BASE}/v2/contracts/call-read/${addr}/${name}/get-decimals`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ sender: addr, arguments: [] }),
        }
      );
      if (!resp.ok) { setDecimals(null); return; }

      const result = await resp.json();
      const parsed = parseOkUint(result.result);
      setDecimals(parsed);
    } catch {
      setDecimals(null);
    } finally {
      setIsLoading(false);
    }
  }, [tokenPrincipal]);

  useEffect(() => {
    fetchDecimals();
  }, [fetchDecimals]);

  return { decimals, isLoading };
}

// ========================================
// Creator-scoped stablecoin management data
// ========================================

/**
 * Stablecoins created by a specific address.
 *
 * Implementation note: the factory exposes `get-creator-stablecoin-at-index`
 * but the returned tuple lacks the numeric id. We walk the global list instead
 * (`get-stablecoin-count` + `get-stablecoin(id)`) and filter by creator, which
 * keeps the id alongside each stablecoin and avoids a second lookup round-trip.
 */
export function useCreatorStablecoins(creator: string | null) {
  const [stablecoins, setStablecoins] = useState<Stablecoin[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchCreatorStablecoins = useCallback(async () => {
    if (!creator) {
      setStablecoins([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (API_KEY) headers["x-api-key"] = API_KEY;

      const countResp = await fetch(
        `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.STABLECOIN_FACTORY}/get-stablecoin-count`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ sender: CONTRACTS.DEPLOYER, arguments: [] }),
        }
      );
      if (!countResp.ok) throw new Error(`Failed to fetch stablecoin count: ${countResp.status}`);
      const countResult = await countResp.json();
      if (!countResult.okay) throw new Error(countResult.cause || "Failed to read stablecoin count");
      const totalCount = parseRequiredUint(countResult.result, "stablecoin count");

      const coins: Stablecoin[] = [];
      for (let i = 0; i < totalCount; i++) {
        const idArg = cvToHex(uintCV(i));
        const resp = await fetch(
          `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.STABLECOIN_FACTORY}/get-stablecoin`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ sender: CONTRACTS.DEPLOYER, arguments: [idArg] }),
          }
        );
        if (!resp.ok) continue;
        const result = await resp.json();
        if (!result.okay || !result.result) continue;

        const decoded = decodeClarityTuple(result.result);
        if (!decoded) continue;
        const { name, symbol, creator: coinCreator } = decoded;
        if (typeof name !== "string" || typeof symbol !== "string" || typeof coinCreator !== "string") continue;
        if (coinCreator !== creator) continue;

        coins.push({
          id: i,
          name,
          symbol,
          creator: coinCreator,
          tokenContract: decoded["token-contract"] ?? null,
          registeredAt: decoded["registered-at"] ?? 0,
          feePaid: decoded["fee-paid"] ?? 0,
        });
      }

      setStablecoins(coins);
    } catch (err) {
      console.error("[SSE] useCreatorStablecoins error:", err);
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [creator]);

  useEffect(() => {
    fetchCreatorStablecoins();
  }, [fetchCreatorStablecoins]);

  return { stablecoins, isLoading, error, refetch: fetchCreatorStablecoins };
}

/**
 * Total supply of a SIP-010 stablecoin token. Returns raw smallest-unit value.
 * Callers combine with `useTokenDecimals` for a human-readable number.
 */
export function useTokenTotalSupply(tokenPrincipal: string | null) {
  const [totalSupply, setTotalSupply] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSupply = useCallback(async () => {
    if (!tokenPrincipal) {
      setTotalSupply(null);
      return;
    }
    const [addr, name] = tokenPrincipal.split(".");
    if (!addr || !name) {
      setTotalSupply(null);
      return;
    }

    setIsLoading(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (API_KEY) headers["x-api-key"] = API_KEY;

      const resp = await fetch(
        `${API_BASE}/v2/contracts/call-read/${addr}/${name}/get-total-supply`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ sender: addr, arguments: [] }),
        }
      );
      if (!resp.ok) {
        setTotalSupply(null);
        return;
      }
      const result = await resp.json();
      const parsed = parseOkUint(result.result);
      setTotalSupply(parsed);
    } catch {
      setTotalSupply(null);
    } finally {
      setIsLoading(false);
    }
  }, [tokenPrincipal]);

  useEffect(() => {
    fetchSupply();
  }, [fetchSupply]);

  return { totalSupply, isLoading, refetch: fetchSupply };
}

export interface TokenHolder {
  address: string;
  balance: string;
}

export interface TokenHoldersSummary {
  total: number;
  topHolders: TokenHolder[];
}

/**
 * Number of holders for a SIP-010 token via Hiro's token holders endpoint.
 * Returns `null` if the endpoint errors or the token isn't indexed yet.
 */
export function useTokenHolders(tokenPrincipal: string | null, previewSize = 5) {
  const [holders, setHolders] = useState<TokenHoldersSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchHolders = useCallback(async () => {
    if (!tokenPrincipal) {
      setHolders(null);
      return;
    }

    setIsLoading(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (API_KEY) headers["x-api-key"] = API_KEY;

      const url = `${API_BASE}/extended/v1/tokens/ft/${encodeURIComponent(tokenPrincipal)}/holders?limit=${previewSize}`;
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        setHolders(null);
        return;
      }
      const data = await resp.json();
      const total = typeof data?.total === "number" ? data.total : 0;
      const results = Array.isArray(data?.results) ? data.results : [];
      const topHolders: TokenHolder[] = results
        .map((r: any) => ({ address: String(r?.address ?? ""), balance: String(r?.balance ?? "0") }))
        .filter((h: TokenHolder) => h.address);
      setHolders({ total, topHolders });
    } catch {
      setHolders(null);
    } finally {
      setIsLoading(false);
    }
  }, [tokenPrincipal, previewSize]);

  useEffect(() => {
    fetchHolders();
  }, [fetchHolders]);

  return { holders, isLoading, refetch: fetchHolders };
}

export interface StablecoinCollateralMetrics {
  asset: string;
  enabled: boolean;
  minCollateralRatio: number;
  liquidationRatio: number;
  liquidationPenalty: number;
  stabilityFee: number;
  debtCeiling: number;
  debtFloor: number;
  debtOutstanding: number;
  utilization: number;
  oraclePrice: number | null;
  requiredCollateralValueUsd: number | null;
}

export interface StablecoinMetrics {
  stablecoinId: number;
  totalDebt: number;
  totalRequiredCollateralUsd: number | null;
  perAsset: StablecoinCollateralMetrics[];
}

/**
 * Aggregated debt + collateral metrics for a stablecoin. Iterates the
 * stablecoin's configured collaterals, reads outstanding debt per asset, and
 * joins oracle prices. Collateral "value" reported here is the REQUIRED
 * collateral floor (debt * minRatio/100) — the actual deposited collateral
 * across all users isn't enumerable per-stablecoin on-chain.
 */
export function useStablecoinMetrics(
  stablecoinId: number | null,
  priceByAsset?: Record<string, number | null>
) {
  const [metrics, setMetrics] = useState<StablecoinMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const priceKey = useMemo(() => JSON.stringify(priceByAsset ?? {}), [priceByAsset]);

  const fetchMetrics = useCallback(async () => {
    if (stablecoinId === null) {
      setMetrics(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (API_KEY) headers["x-api-key"] = API_KEY;

      const countResp = await fetch(
        `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.COLLATERAL_REGISTRY}/get-stablecoin-collateral-count-ro`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            sender: CONTRACTS.DEPLOYER,
            arguments: [cvToHex(uintCV(stablecoinId))],
          }),
        }
      );
      if (!countResp.ok) throw new Error(`Failed to fetch collateral count: ${countResp.status}`);
      const countResult = await countResp.json();
      if (!countResult.okay) throw new Error(countResult.cause || "Failed collateral count read");
      const count = parseRequiredUint(countResult.result, `stablecoin collateral count for ${stablecoinId}`);

      const perAsset: StablecoinCollateralMetrics[] = [];
      let totalDebt = 0;
      let totalRequiredCollateralUsd = 0;
      let anyPriceMissing = false;
      const prices = JSON.parse(priceKey) as Record<string, number | null>;

      for (let i = 0; i < count; i++) {
        const indexResp = await fetch(
          `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.COLLATERAL_REGISTRY}/get-stablecoin-collateral-at-index`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              sender: CONTRACTS.DEPLOYER,
              arguments: [cvToHex(uintCV(stablecoinId)), cvToHex(uintCV(i))],
            }),
          }
        );
        if (!indexResp.ok) continue;
        const indexResult = await indexResp.json();
        if (!indexResult.okay) continue;
        const indexDecoded = decodeClarityTuple(indexResult.result);
        const asset = indexDecoded?.asset;
        if (typeof asset !== "string") continue;

        const configResp = await fetch(
          `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.COLLATERAL_REGISTRY}/get-stablecoin-collateral-config`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              sender: CONTRACTS.DEPLOYER,
              arguments: [cvToHex(uintCV(stablecoinId)), cvToHex(principalCV(asset))],
            }),
          }
        );
        if (!configResp.ok) continue;
        const configResult = await configResp.json();
        if (!configResult.okay) continue;
        const cfg = decodeClarityTuple(configResult.result);
        if (!cfg) continue;

        const debtResp = await fetch(
          `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.COLLATERAL_REGISTRY}/get-stablecoin-collateral-debt-ro`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              sender: CONTRACTS.DEPLOYER,
              arguments: [cvToHex(uintCV(stablecoinId)), cvToHex(principalCV(asset))],
            }),
          }
        );
        const debtResult = debtResp.ok ? await debtResp.json() : null;
        const debtOutstanding = debtResult?.okay
          ? parseRequiredUint(debtResult.result, `debt for stablecoin=${stablecoinId} asset=${asset}`)
          : 0;

        const minCollateralRatio = Number(cfg["min-collateral-ratio"] ?? 0);
        const liquidationRatio = Number(cfg["liquidation-ratio"] ?? 0);
        const liquidationPenalty = Number(cfg["liquidation-penalty"] ?? 0);
        const stabilityFee = Number(cfg["stability-fee"] ?? 0);
        const debtCeiling = Number(cfg["debt-ceiling"] ?? 0);
        const debtFloor = Number(cfg["debt-floor"] ?? 0);
        const enabled = Boolean(cfg.enabled);

        const utilization = debtCeiling > 0 ? (debtOutstanding / debtCeiling) * 100 : 0;
        const oraclePrice = prices[asset] ?? null;
        const requiredCollateralValueUsd =
          minCollateralRatio > 0 ? (debtOutstanding * minCollateralRatio) / 100 : null;

        if (requiredCollateralValueUsd !== null) {
          totalRequiredCollateralUsd += requiredCollateralValueUsd;
        } else {
          anyPriceMissing = true;
        }
        totalDebt += debtOutstanding;

        perAsset.push({
          asset,
          enabled,
          minCollateralRatio,
          liquidationRatio,
          liquidationPenalty,
          stabilityFee,
          debtCeiling,
          debtFloor,
          debtOutstanding,
          utilization,
          oraclePrice,
          requiredCollateralValueUsd,
        });
      }

      setMetrics({
        stablecoinId,
        totalDebt,
        totalRequiredCollateralUsd: anyPriceMissing && totalRequiredCollateralUsd === 0 ? null : totalRequiredCollateralUsd,
        perAsset,
      });
    } catch (err) {
      console.error(`[SSE] useStablecoinMetrics error for stablecoin=${stablecoinId}:`, err);
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [stablecoinId, priceKey]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return { metrics, isLoading, error, refetch: fetchMetrics };
}

// ========================================
// Protocol-wide Stats (Landing Page)
// ========================================

export interface ProtocolStats {
  stablecoinCount: number;
  totalDebtUsd: number;
  tvlUsd: number | null;
  tvlPartial: boolean; // true when some oracle prices were unavailable
}

const PROTOCOL_STATS_CACHE_TTL_MS = 30_000;

export function useProtocolStats() {
  const [stats, setStats] = useState<ProtocolStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const collateralOracleCacheRef = useRef<Map<string, string | null>>(new Map());
  const statsCacheRef = useRef<{ value: ProtocolStats; cachedAt: number } | null>(null);

  const fetchStats = useCallback(async (signal: AbortSignal, force = false) => {
    // Only show loading spinner on initial fetch, not on background refresh
    setError(null);

    if (!force && statsCacheRef.current) {
      const ageMs = Date.now() - statsCacheRef.current.cachedAt;
      if (ageMs < PROTOCOL_STATS_CACHE_TTL_MS) {
        setStats(statsCacheRef.current.value);
        setIsLoading(false);
        return;
      }
    }

    try {
      // Helper: fetch oracle price with caching per asset within this call
      const oraclePriceCache = new Map<string, number | null>();
      const fetchOraclePrice = async (oraclePrincipal: string): Promise<number | null> => {
        if (oraclePriceCache.has(oraclePrincipal)) return oraclePriceCache.get(oraclePrincipal)!;
        const [addr, name] = oraclePrincipal.split(".");
        if (!addr || !name) return null;
        try {
          const resp = await fetch(`${API_BASE}/v2/contracts/call-read/${addr}/${name}/get-price`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({ sender: CONTRACTS.DEPLOYER, arguments: [] }),
          });
          if (!resp.ok) { oraclePriceCache.set(oraclePrincipal, null); return null; }
          const result = await resp.json();
          if (!result.okay || !result.result) { oraclePriceCache.set(oraclePrincipal, null); return null; }
          const val = parseOkUint(result.result);
          const price = val !== null ? val / 1e8 : null;
          oraclePriceCache.set(oraclePrincipal, price);
          return price;
        } catch {
          oraclePriceCache.set(oraclePrincipal, null);
          return null;
        }
      };

      // 1. Stablecoin count
      const countHex = await readContract(
        CONTRACTS.STABLECOIN_FACTORY,
        "get-stablecoin-count",
        [],
        CONTRACTS.DEPLOYER
      );
      if (!countHex) {
        console.error("[SSE] useProtocolStats: failed to read stablecoin count from factory");
        throw new Error("Failed to read stablecoin count");
      }
      const stablecoinCount = parseRequiredUint(countHex, "stablecoin-count");

      const totalDebtUsdPromise = (async () => {
        // 2. Aggregate debt across all stablecoins (parallelized per-stablecoin)
        // Assumes factory IDs are monotonic starting at 1 (consistent with all other hooks)
        const debtPerStablecoin = await Promise.all(
          Array.from({ length: stablecoinCount }, (_, i) => i + 1).map(async (sid) => {
            const colCountHex = await readContract(
              CONTRACTS.COLLATERAL_REGISTRY,
              "get-stablecoin-collateral-count-ro",
              [cvToHex(uintCV(sid))],
              CONTRACTS.DEPLOYER
            );
            if (!colCountHex) {
              console.warn(`[SSE] useProtocolStats: missing collateral count for stablecoin ${sid}, skipping`);
              return 0;
            }
            const colCount = parseRequiredUint(colCountHex, `col-count-${sid}`);

            const assetDebts = await Promise.all(
              Array.from({ length: colCount }, (_, ci) => ci).map(async (ci) => {
                const indexHex = await readContract(
                  CONTRACTS.COLLATERAL_REGISTRY,
                  "get-stablecoin-collateral-at-index",
                  [cvToHex(uintCV(sid)), cvToHex(uintCV(ci))],
                  CONTRACTS.DEPLOYER
                );
                const decoded = indexHex ? decodeClarityTuple(indexHex) : null;
                const asset = decoded?.asset;
                if (typeof asset !== "string") return 0;

                const debtHex = await readContract(
                  CONTRACTS.COLLATERAL_REGISTRY,
                  "get-stablecoin-collateral-debt-ro",
                  [cvToHex(uintCV(sid)), cvToHex(principalCV(asset))],
                  CONTRACTS.DEPLOYER
                );
                if (!debtHex) {
                  console.warn(`[SSE] useProtocolStats: missing debt for stablecoin=${sid} asset=${asset}`);
                  return 0;
                }
                return parseRequiredUint(debtHex, `debt-${sid}-${asset}`);
              })
            );
            return assetDebts.reduce((sum, d) => sum + d, 0);
          })
        );
        const totalDebtRaw = debtPerStablecoin.reduce((sum, d) => sum + d, 0);
        return totalDebtRaw / Math.pow(10, STABLECOIN_DECIMALS);
      })();

      const tvlPromise = (async (): Promise<{ tvlUsd: number | null; tvlPartial: boolean }> => {
        // 3. TVL: read assets from collateral registry, then
        //    get-balance(vault-engine) × oracle price for each asset.
        try {
          const vaultEnginePrincipal = getContractId(CONTRACTS.MULTI_ASSET_VAULT_ENGINE);
          const collateralCountHex = await readContract(
            CONTRACTS.COLLATERAL_REGISTRY,
            "get-collateral-count",
            [],
            CONTRACTS.DEPLOYER
          );
          if (!collateralCountHex) {
            return { tvlUsd: 0, tvlPartial: true };
          }

          const collateralCount = parseRequiredUint(collateralCountHex, "protocol-tvl-collateral-count");
          if (collateralCount === 0) {
            return { tvlUsd: 0, tvlPartial: false };
          }

          const collateralAssets = await Promise.all(
            Array.from({ length: collateralCount }, (_, i) => i).map(async (index) => {
              const atIndexHex = await readContract(
                CONTRACTS.COLLATERAL_REGISTRY,
                "get-collateral-at-index",
                [cvToHex(uintCV(index))],
                CONTRACTS.DEPLOYER
              );
              const decoded = atIndexHex ? decodeClarityTuple(atIndexHex) : null;
              return typeof decoded?.asset === "string" ? decoded.asset : null;
            })
          );

          const uniqueAssets = Array.from(new Set(collateralAssets.filter((a): a is string => !!a)));
          if (uniqueAssets.length === 0) {
            return { tvlUsd: 0, tvlPartial: true };
          }

          // Read a function on a token contract at its OWN address (not the
          // SSE deployer). External tokens like sBTC (SM3VDXK...) and vGLD
          // (SP183M...) are deployed by third parties, so we must use the
          // full asset principal here -- not CONTRACTS.DEPLOYER -- or every
          // get-balance / get-decimals call silently returns null and TVL
          // collapses to $0 even when collateral is correctly escrowed.
          const readTokenContract = async (
            assetPrincipal: string,
            functionName: string,
            args: string[]
          ): Promise<string | null> => {
            const [addr, name] = assetPrincipal.includes(".")
              ? assetPrincipal.split(".")
              : [CONTRACTS.DEPLOYER, assetPrincipal];
            try {
              const tokenHeaders: Record<string, string> = { "Content-Type": "application/json" };
              if (API_KEY) tokenHeaders["x-api-key"] = API_KEY;
              const resp = await fetch(
                `${API_BASE}/v2/contracts/call-read/${addr}/${name}/${functionName}`,
                {
                  method: "POST",
                  headers: tokenHeaders,
                  signal,
                  body: JSON.stringify({ sender: CONTRACTS.DEPLOYER, arguments: args }),
                }
              );
              if (!resp.ok) return null;
              const data = await resp.json();
              if (!data.okay) return null;
              return data.result as string;
            } catch {
              return null;
            }
          };

          const decimalsCache = new Map<string, number>();
          const getAssetDecimals = async (assetPrincipal: string): Promise<number> => {
            if (decimalsCache.has(assetPrincipal)) return decimalsCache.get(assetPrincipal)!;
            const decimalsHex = await readTokenContract(assetPrincipal, "get-decimals", []);
            const decimals = decimalsHex
              ? parseOkUint(decimalsHex) ?? getCollateralDecimals(assetPrincipal)
              : getCollateralDecimals(assetPrincipal);
            decimalsCache.set(assetPrincipal, decimals);
            return decimals;
          };

          let total = 0;
          let allPriced = true;

          const results = await Promise.all(
            uniqueAssets.map(async (assetPrincipal) => {
              const contractName = assetPrincipal.includes(".") ? assetPrincipal.split(".")[1] : assetPrincipal;
              const balHex = await readTokenContract(assetPrincipal, "get-balance", [
                cvToHex(principalCV(vaultEnginePrincipal)),
              ]);
              if (!balHex) return { priced: false, value: 0 };
              const balRaw = parseOkUint(balHex);
              if (balRaw === null || balRaw === 0) return { priced: true, value: 0 };

              const decimals = await getAssetDecimals(assetPrincipal);
              const balHuman = balRaw / Math.pow(10, decimals);

              let oraclePrincipal = collateralOracleCacheRef.current.get(assetPrincipal) ?? null;

              if (!oraclePrincipal) {
                const configHex = await readContract(
                  CONTRACTS.COLLATERAL_REGISTRY,
                  "get-collateral-config",
                  [cvToHex(principalCV(assetPrincipal))],
                  CONTRACTS.DEPLOYER
                );
                const config = configHex ? decodeClarityTuple(configHex) : null;
                oraclePrincipal = typeof config?.oracle === "string" ? config.oracle : null;
                collateralOracleCacheRef.current.set(assetPrincipal, oraclePrincipal);
              }

              if (typeof oraclePrincipal !== "string") {
                console.warn(`[SSE] useProtocolStats: no oracle found for collateral ${contractName}`);
                return { priced: false, value: 0 };
              }

              const price = await fetchOraclePrice(oraclePrincipal);
              if (price !== null) return { priced: true, value: balHuman * price };
              return { priced: false, value: 0 };
            })
          );

          for (const r of results) {
            if (r.priced) total += r.value;
            else allPriced = false;
          }

          return { tvlUsd: total, tvlPartial: !allPriced };
        } catch (e) {
          console.error("[SSE] useProtocolStats TVL fetch error:", e);
          return { tvlUsd: null, tvlPartial: false };
        }
      })();

      const [totalDebtUsd, { tvlUsd, tvlPartial }] = await Promise.all([totalDebtUsdPromise, tvlPromise]);

      if (!signal.aborted) {
        const nextStats: ProtocolStats = { stablecoinCount, totalDebtUsd, tvlUsd, tvlPartial };
        statsCacheRef.current = { value: nextStats, cachedAt: Date.now() };
        setStats(nextStats);
      }
    } catch (err) {
      if (!signal.aborted) {
        console.error("[SSE] useProtocolStats error:", err);
        setError(err as Error);
      }
    } finally {
      if (!signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchStats(controller.signal);
    const interval = setInterval(() => {
      fetchStats(controller.signal, true);
    }, 60000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchStats]);

  return { stats, isLoading, error, refetch: () => fetchStats(new AbortController().signal, true) };
}
