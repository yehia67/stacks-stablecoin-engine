"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { CONTRACTS, IS_MAINNET, DEFAULTS } from "@/lib/constants";

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
  
  // Remove 0x prefix
  const bytes = hex.slice(2);
  
  // First byte is the type
  const type = parseInt(bytes.slice(0, 2), 16);
  
  // Type 0x01 = int128, Type 0x00 = int128 (negative)
  // For uint, the value follows the type byte
  if (type === 0x01 || type === 0x00) {
    // uint128 - next 16 bytes (32 hex chars)
    const valueHex = bytes.slice(2, 34);
    return BigInt("0x" + valueHex);
  }
  
  // Type 0x03 = true, Type 0x04 = false
  if (type === 0x03) return true;
  if (type === 0x04) return false;
  
  return hex;
}

export function useContractRead<T = any>(
  options: ReadContractOptions
): UseContractReadResult<T> {
  const { contractName, functionName, functionArgs = [] } = options;
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

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
  }, [contractName, functionName, argsKey]);

  const refetch = useCallback(async () => {
    // Trigger re-fetch by updating state
    setIsLoading(true);
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

// Parse a stablecoin tuple from hex response
function parseStablecoinTuple(hex: string): Stablecoin | null {
  // This is a simplified parser - in production you'd use @stacks/transactions cvToValue
  // For now, we'll use the raw API response which returns decoded values
  return null;
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
            if (decoded) {
              coins.push({
                id: i,
                name: decoded.name || `Stablecoin ${i}`,
                symbol: decoded.symbol || `SC${i}`,
                creator: decoded.creator || "",
                tokenContract: decoded["token-contract"] || null,
                registeredAt: decoded["registered-at"] || 0,
                feePaid: decoded["fee-paid"] || 0,
              });
            }
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

// Helper to decode Clarity tuple from hex
function decodeClarityTuple(hex: string): Record<string, any> | null {
  try {
    if (!hex || hex === "0x09") return null; // 0x09 = none
    
    // Remove 0x prefix
    const bytes = hex.slice(2);
    
    // First byte is type - 0x0a = some, 0x0c = tuple
    const type = parseInt(bytes.slice(0, 2), 16);
    
    // If it's an optional (some), skip the wrapper
    let tupleStart = 0;
    if (type === 0x0a) {
      // some - next byte is the inner type
      tupleStart = 2;
    }
    
    const innerType = parseInt(bytes.slice(tupleStart, tupleStart + 2), 16);
    if (innerType !== 0x0c) {
      // Not a tuple
      return null;
    }
    
    // Parse tuple - format: 0x0c + 4 bytes length + entries
    let pos = tupleStart + 2;
    const numEntries = parseInt(bytes.slice(pos, pos + 8), 16);
    pos += 8;
    
    const result: Record<string, any> = {};
    
    for (let i = 0; i < numEntries; i++) {
      // Key: 1 byte length + string
      const keyLen = parseInt(bytes.slice(pos, pos + 2), 16);
      pos += 2;
      const keyHex = bytes.slice(pos, pos + keyLen * 2);
      const key = hexToString(keyHex);
      pos += keyLen * 2;
      
      // Value: parse based on type
      const valueType = parseInt(bytes.slice(pos, pos + 2), 16);
      pos += 2;
      
      if (valueType === 0x01) {
        // uint128
        const valueHex = bytes.slice(pos, pos + 32);
        result[key] = parseInt(valueHex, 16);
        pos += 32;
      } else if (valueType === 0x0d) {
        // string-ascii
        const strLen = parseInt(bytes.slice(pos, pos + 8), 16);
        pos += 8;
        const strHex = bytes.slice(pos, pos + strLen * 2);
        result[key] = hexToString(strHex);
        pos += strLen * 2;
      } else if (valueType === 0x05) {
        // principal
        const version = parseInt(bytes.slice(pos, pos + 2), 16);
        pos += 2;
        const hash = bytes.slice(pos, pos + 40);
        pos += 40;
        // Simplified - just store the hash for now
        result[key] = `${version === 0x1a ? 'ST' : 'SP'}${hash.slice(0, 20)}...`;
      } else if (valueType === 0x09) {
        // none
        result[key] = null;
      } else if (valueType === 0x0a) {
        // some - skip for now
        result[key] = "some";
        // Would need to recursively parse the inner value
      } else {
        // Unknown type, skip
        result[key] = null;
      }
    }
    
    return result;
  } catch (e) {
    console.error("Error decoding tuple:", e);
    return null;
  }
}

function hexToString(hex: string): string {
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return str;
}
