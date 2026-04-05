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
  const { count } = useStablecoinCount();

  const fetchStablecoins = useCallback(async () => {
    if (count === null || count === 0) {
      setStablecoins([]);
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

      const coins: Stablecoin[] = [];
      
      // Fetch each stablecoin by ID
      for (let i = 0; i < count; i++) {
        const url = `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.STABLECOIN_FACTORY}/get-stablecoin`;
        
        // Encode uint as Clarity value: 0x01 + 16 bytes big-endian
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
            // Parse the tuple response - it's returned as a Clarity value
            // For simplicity, we'll decode it manually or use the repr
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
  }, [count]);

  useEffect(() => {
    fetchStablecoins();
  }, [fetchStablecoins]);

  return { stablecoins, isLoading, error, refetch: fetchStablecoins };
}

export interface CollateralType {
  asset: string;
  minCollateralRatio: number;
  liquidationRatio: number;
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
                const priceVal = parseClarityValue(priceResult.result);
                if (priceVal !== null) {
                  // Price is scaled by 1e8 (PRICE-SCALE)
                  oraclePrice = Number(priceVal) / 1e8;
                }
              }
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

      if (!countResp.ok) { setCollaterals([]); return; }
      const countResult = await countResp.json();
      if (!countResult.okay) { setCollaterals([]); return; }
      const count = Number(parseClarityValue(countResult.result) || 0);

      if (count === 0) { setCollaterals([]); setIsLoading(false); return; }

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
        if (!configDecoded) continue;

        configs.push({
          asset,
          minCollateralRatio: Number(configDecoded["min-collateral-ratio"] ?? 150),
          liquidationRatio: Number(configDecoded["liquidation-ratio"] ?? 120),
          liquidationPenalty: Number(configDecoded["liquidation-penalty"] ?? 10),
          stabilityFee: Number(configDecoded["stability-fee"] ?? 200),
          debtCeiling: Number(configDecoded["debt-ceiling"] ?? 0),
          debtFloor: Number(configDecoded["debt-floor"] ?? 0),
          enabled: Boolean(configDecoded.enabled),
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
  if (typeof raw === "object" && "type" in raw && "value" in raw && typeof raw.type === "string") {
    return unwrapClarityValue(raw.value);
  }
  if (typeof raw === "bigint") return Number(raw);
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
    const raw = cvToValue(hexToCV(hex)) as any;
    if (!raw || typeof raw !== "object") return null;

    const unwrapped = unwrapClarityValue(raw);
    if (!unwrapped || typeof unwrapped !== "object") return null;
    return unwrapped;
  } catch (e) {
    console.error("[SSE] Error decoding Clarity tuple:", e, "hex:", hex);
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
      const userVaults: UserVault[] = [];

      for (const coin of stablecoins) {
        // Check if user has a vault for this stablecoin
        const vaultHex = await readContract(
          CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
          "get-vault-for-stablecoin",
          [cvToHex(principalCV(userAddress)), cvToHex(uintCV(coin.id))],
          userAddress
        );

        if (!vaultHex || vaultHex.startsWith("0x09")) continue; // 0x09 = none

        const vaultData = decodeClarityTuple(vaultHex);
        if (!vaultData) {
          console.error(`[SSE] Failed to decode vault for stablecoin ${coin.id}, hex:`, vaultHex);
          continue;
        }

        // Get asset count for this vault
        const countHex = await readContract(
          CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
          "get-vault-asset-count-for-stablecoin",
          [cvToHex(principalCV(userAddress)), cvToHex(uintCV(coin.id))],
          userAddress
        );

        const assetCount = countHex ? Number(parseClarityValue(countHex) ?? 0) : 0;

        const positions: CollateralPosition[] = [];

        for (let i = 0; i < assetCount; i++) {
          // Get asset at index
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
            console.error(`[SSE] Invalid asset at index ${i} for vault stablecoin=${coin.id}:`, assetData);
            continue;
          }

          // Get collateral position
          const posHex = await readContract(
            CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
            "get-collateral-position-for-stablecoin",
            [cvToHex(principalCV(userAddress)), cvToHex(uintCV(coin.id)), cvToHex(principalCV(asset))],
            userAddress
          );

          if (!posHex || posHex.startsWith("0x09")) continue;
          const posData = decodeClarityTuple(posHex);
          if (!posData) continue;

          if (posData.amount == null || posData["debt-share"] == null) {
            console.error(`[SSE] Missing required fields in position for asset=${asset}, stablecoin=${coin.id}:`, posData);
            continue;
          }

          // Get health factor
          const hfHex = await readContract(
            CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
            "get-position-health-factor-for-stablecoin",
            [cvToHex(principalCV(userAddress)), cvToHex(uintCV(coin.id)), cvToHex(principalCV(asset))],
            userAddress
          );

          const healthFactor = hfHex ? Number(parseClarityValue(hfHex) ?? 0) : 0;

          positions.push({
            asset,
            amount: Number(posData.amount),
            debtShare: Number(posData["debt-share"]),
            healthFactor,
          });
        }

        userVaults.push({
          stablecoinId: coin.id,
          stablecoinName: coin.name,
          stablecoinSymbol: coin.symbol,
          tokenContract: coin.tokenContract,
          totalDebt: Number(vaultData["total-debt"] ?? 0),
          createdAt: Number(vaultData["created-at"] ?? 0),
          positions,
        });
      }

      setVaults(userVaults);
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
