"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { CONTRACTS, IS_MAINNET, DEFAULTS } from "@/lib/constants";
import { cvToValue, hexToCV, cvToHex, principalCV, uintCV, stringAsciiCV } from "@stacks/transactions";

const API_BASE = IS_MAINNET 
  ? "https://api.mainnet.hiro.so" 
  : "https://api.testnet.hiro.so";

// Optional API key from environment
const API_KEY = process.env.NEXT_PUBLIC_HIRO_API_KEY;


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
    
    // Handle (ok uint) response - cvToValue returns { type: "ok", value: { type: "uint", value: bigint } }
    if (parsed && typeof parsed === "object") {
      // Check for ok response wrapper
      if (parsed.type === "ok" && parsed.value !== undefined) {
        const inner = parsed.value;
        if (typeof inner === "bigint") {
          return Number(inner);
        }
        if (inner && typeof inner === "object" && inner.value !== undefined) {
          if (typeof inner.value === "bigint") {
            return Number(inner.value);
          }
        }
      }
      // Direct value wrapper { type: "uint", value: bigint }
      if (parsed.value !== undefined && typeof parsed.value === "bigint") {
        return Number(parsed.value);
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
  oraclePrice: number | null;
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

        // Fetch oracle price for this asset
        let oraclePrice: number | null = null;
        const oracleAddr = decoded.oracle as string | undefined;
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
                  // Use parseOkUint to handle (ok uint) response from oracles
                  const priceVal = parseOkUint(priceResult.result);
                  if (priceVal !== null) {
                    // Price is scaled by 1e8 (PRICE-SCALE)
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
          oraclePrice,
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
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers["x-api-key"] = API_KEY;

  const resp = await fetch(
    `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${contractName}/${functionName}`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ sender, arguments: args }),
    }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.okay) return null;
  return data.result;
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

    const hfHex = await readContract(
      CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
      "get-position-health-factor-for-stablecoin",
      [cvToHex(principalCV(userAddress)), cvToHex(uintCV(coin.id)), cvToHex(principalCV(asset))],
      userAddress
    );

    const healthFactor = parseRequiredUint(
      hfHex,
      `health factor for owner=${userAddress} stablecoin=${coin.id} asset=${asset}`
    );

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
  const [isLoading, setIsLoading] = useState(false);
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
      const loadedVaults = await Promise.all(
        stablecoins.map((coin) => loadVaultForStablecoin(userAddress, coin))
      );
      setVaults(loadedVaults.filter((vault): vault is UserVault => vault !== null));
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
