"use client";

import { useCallback } from "react";
import { request } from "@stacks/connect";
import {
  Pc,
  uintCV,
  stringAsciiCV,
  principalCV,
  standardPrincipalCV,
  contractPrincipalCV,
} from "@stacks/transactions";
import { CONTRACTS, APP_CONFIG, FT_ASSET_NAMES, getContractId } from "@/lib/constants";
import { networkName, getUserAddress } from "@/lib/stacks";
import { generateTokenContract, deriveTokenContractName } from "@/lib/tokenTemplate";

/**
 * Resolve the native fungible token asset name from a contract principal string.
 * For known SSE tokens, looks up FT_ASSET_NAMES.
 * For dynamically deployed tokens (e.g. "musd-token-1712345678"), derives from symbol convention.
 */
function getFtAssetName(contractPrincipal: string): string | null {
  const parts = contractPrincipal.split(".");
  const contractName = parts.length > 1 ? parts[parts.length - 1] : contractPrincipal;

  // Check known tokens
  if (FT_ASSET_NAMES[contractName]) {
    return FT_ASSET_NAMES[contractName];
  }

  // Dynamic stablecoin tokens follow pattern: symbol-token-timestamp
  // Their FT name is: symbol-ft (set in tokenTemplate.ts)
  const match = contractName.match(/^([a-z]+)-token-\d+$/);
  if (match) {
    return `${match[1]}-ft`;
  }

  return null;
}

export interface ContractCallOptions {
  contractName: string;
  functionName: string;
  functionArgs: any[];
  postConditions?: any[];
  postConditionMode?: "allow" | "deny";
  onSuccess?: (txId: string) => void;
  onError?: (error: Error) => void;
}

export function useContract() {
  const parseContractPrincipal = useCallback((contractId: string) => {
    const [address, ...nameParts] = contractId.split(".");
    if (!address || nameParts.length === 0) {
      return principalCV(contractId);
    }
    return contractPrincipalCV(address, nameParts.join("."));
  }, []);

  const callContract = useCallback(
    async (options: ContractCallOptions) => {
      const {
        contractName,
        functionName,
        functionArgs,
        postConditions = [],
        postConditionMode = "deny",
        onSuccess,
        onError,
      } = options;

      try {
        const response: any = await request("stx_callContract", {
          contract: `${CONTRACTS.DEPLOYER}.${contractName}`,
          functionName,
          functionArgs,
          postConditionMode,
          postConditions,
          network: networkName,
        });
        const txId = response.txid || response.result?.txid || "";
        console.log("Transaction submitted:", txId);
        onSuccess?.(txId);
      } catch (error: any) {
        if (error?.message?.includes("cancel") || error?.code === 4001) {
          console.log("Transaction cancelled");
          onError?.(new Error("Transaction cancelled by user"));
        } else {
          console.error("Contract call error:", error);
          onError?.(error as Error);
        }
      }
    },
    []
  );

  // Multi-Asset Vault Engine functions
  const openVaultForStablecoin = useCallback(
    (
      stablecoinId: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
        functionName: "open-vault-for-stablecoin",
        functionArgs: [uintCV(stablecoinId)],
        postConditions: [],
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract]
  );

  const depositCollateralForStablecoin = useCallback(
    (
      stablecoinId: number,
      collateralAsset: string,
      amount: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      const sender = getUserAddress();
      const ftName = getFtAssetName(collateralAsset);
      const postConditions =
        sender && ftName
          ? [Pc.principal(sender).willSendLte(amount).ft(collateralAsset as `${string}.${string}`, ftName)]
          : [];

      return callContract({
        contractName: CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
        functionName: "deposit-collateral-for-stablecoin",
        functionArgs: [
          uintCV(stablecoinId),
          parseContractPrincipal(collateralAsset),
          parseContractPrincipal(collateralAsset),
          uintCV(amount),
        ],
        postConditions,
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  const mintAgainstAssetForStablecoin = useCallback(
    (
      stablecoinId: number,
      collateralAsset: string,
      tokenContract: string,
      amount: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
        functionName: "mint-against-asset-for-stablecoin",
        functionArgs: [
          uintCV(stablecoinId),
          principalCV(collateralAsset),
          parseContractPrincipal(tokenContract),
          uintCV(amount),
        ],
        postConditions: [],
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  const repayAgainstAssetForStablecoin = useCallback(
    (
      stablecoinId: number,
      collateralAsset: string,
      tokenContract: string,
      amount: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      const sender = getUserAddress();
      const ftName = getFtAssetName(tokenContract);
      const postConditions =
        sender && ftName
          ? [Pc.principal(sender).willSendLte(amount).ft(tokenContract as `${string}.${string}`, ftName)]
          : [];

      return callContract({
        contractName: CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
        functionName: "repay-against-asset-for-stablecoin",
        functionArgs: [
          uintCV(stablecoinId),
          principalCV(collateralAsset),
          parseContractPrincipal(tokenContract),
          uintCV(amount),
        ],
        postConditions,
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  const withdrawCollateralForStablecoin = useCallback(
    (
      stablecoinId: number,
      collateralAsset: string,
      amount: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      const ftName = getFtAssetName(collateralAsset);
      const vaultPrincipal = getContractId(CONTRACTS.MULTI_ASSET_VAULT_ENGINE) as `${string}.${string}`;
      const postConditions =
        ftName
          ? [Pc.principal(vaultPrincipal).willSendLte(amount).ft(collateralAsset as `${string}.${string}`, ftName)]
          : [];

      return callContract({
        contractName: CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
        functionName: "withdraw-collateral-for-stablecoin",
        functionArgs: [
          uintCV(stablecoinId),
          parseContractPrincipal(collateralAsset),
          parseContractPrincipal(collateralAsset),
          uintCV(amount),
        ],
        postConditions,
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  // Stablecoin Factory functions
  const registerStablecoin = useCallback(
    (
      name: string,
      symbol: string,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void,
      senderAddress?: string,
      feeAmount?: number
    ) => {
      // Build STX post-condition for registration fee
      const sender = senderAddress || getUserAddress();
      const postConditions =
        sender && feeAmount && feeAmount > 0
          ? [Pc.principal(sender).willSendLte(feeAmount).ustx()]
          : [];

      return callContract({
        contractName: CONTRACTS.STABLECOIN_FACTORY,
        functionName: "register-stablecoin",
        functionArgs: [stringAsciiCV(name), stringAsciiCV(symbol)],
        postConditionMode: "deny",
        postConditions,
        onSuccess,
        onError,
      });
    },
    [callContract]
  );

  // Deploy a new SIP-010 token contract for a registered stablecoin
  const deployTokenContract = useCallback(
    async (
      stablecoinName: string,
      stablecoinSymbol: string,
      onSuccess?: (txId: string, contractName: string) => void,
      onError?: (error: Error) => void
    ) => {
      try {
        const contractName = deriveTokenContractName(stablecoinSymbol);
        const codeBody = generateTokenContract(stablecoinName, stablecoinSymbol);

        const response: any = await request("stx_deployContract", {
          name: contractName,
          clarityCode: codeBody,
          network: networkName,
        });
        const txId = response.txid || response.result?.txid || "";
        console.log("Token deploy tx submitted:", txId);
        onSuccess?.(txId, contractName);
      } catch (error: any) {
        if (error?.message?.includes("cancel") || error?.code === 4001) {
          onError?.(new Error("Contract deployment cancelled by user"));
        } else {
          console.error("Deploy error:", error);
          onError?.(error as Error);
        }
      }
    },
    []
  );

  // Link a token contract to a registered stablecoin (only creator can call)
  const setTokenContract = useCallback(
    (
      stablecoinId: number,
      tokenContract: string,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.STABLECOIN_FACTORY,
        functionName: "set-token-contract",
        functionArgs: [uintCV(stablecoinId), parseContractPrincipal(tokenContract)],
        postConditions: [],
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  // Per-stablecoin collateral configuration
  const configureCollateralForStablecoin = useCallback(
    (
      stablecoinId: number,
      asset: string,
      params: {
        minCollateralRatio: number;
        liquidationRatio: number;
        liquidationPenalty: number;
        stabilityFee: number;
        debtCeiling: number;
        debtFloor: number;
      },
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.COLLATERAL_REGISTRY,
        functionName: "configure-collateral-for-stablecoin",
        functionArgs: [
          uintCV(stablecoinId),
          parseContractPrincipal(asset),
          uintCV(params.minCollateralRatio),
          uintCV(params.liquidationRatio),
          uintCV(params.liquidationPenalty),
          uintCV(params.stabilityFee),
          uintCV(params.debtCeiling),
          uintCV(params.debtFloor),
        ],
        postConditions: [],
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  const updateCollateralForStablecoin = useCallback(
    (
      stablecoinId: number,
      asset: string,
      params: {
        minCollateralRatio: number;
        liquidationRatio: number;
        liquidationPenalty: number;
        stabilityFee: number;
        debtCeiling: number;
        debtFloor: number;
      },
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.COLLATERAL_REGISTRY,
        functionName: "update-collateral-for-stablecoin",
        functionArgs: [
          uintCV(stablecoinId),
          parseContractPrincipal(asset),
          uintCV(params.minCollateralRatio),
          uintCV(params.liquidationRatio),
          uintCV(params.liquidationPenalty),
          uintCV(params.stabilityFee),
          uintCV(params.debtCeiling),
          uintCV(params.debtFloor),
        ],
        postConditions: [],
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  const disableCollateralForStablecoin = useCallback(
    (
      stablecoinId: number,
      asset: string,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.COLLATERAL_REGISTRY,
        functionName: "disable-collateral-for-stablecoin",
        functionArgs: [uintCV(stablecoinId), parseContractPrincipal(asset)],
        postConditions: [],
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  const enableCollateralForStablecoin = useCallback(
    (
      stablecoinId: number,
      asset: string,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.COLLATERAL_REGISTRY,
        functionName: "enable-collateral-for-stablecoin",
        functionArgs: [uintCV(stablecoinId), parseContractPrincipal(asset)],
        postConditions: [],
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  // Stability Pool functions
  const depositToPool = useCallback(
    (
      stablecoinId: number,
      stablecoinTokenPrincipal: string,
      amount: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      const sender = getUserAddress();
      const ftName = getFtAssetName(stablecoinTokenPrincipal);
      const postConditions =
        sender && ftName
          ? [Pc.principal(sender).willSendLte(amount).ft(stablecoinTokenPrincipal as `${string}.${string}`, ftName)]
          : [];

      return callContract({
        contractName: CONTRACTS.STABILITY_POOL,
        functionName: "deposit",
        functionArgs: [
          uintCV(stablecoinId),
          parseContractPrincipal(stablecoinTokenPrincipal),
          uintCV(amount),
        ],
        postConditions,
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  const withdrawFromPool = useCallback(
    (
      stablecoinId: number,
      stablecoinTokenPrincipal: string,
      amount: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      const ftName = getFtAssetName(stablecoinTokenPrincipal);
      const poolPrincipal = getContractId(CONTRACTS.STABILITY_POOL) as `${string}.${string}`;
      const postConditions =
        ftName
          ? [Pc.principal(poolPrincipal).willSendLte(amount).ft(stablecoinTokenPrincipal as `${string}.${string}`, ftName)]
          : [];

      return callContract({
        contractName: CONTRACTS.STABILITY_POOL,
        functionName: "withdraw",
        functionArgs: [
          uintCV(stablecoinId),
          parseContractPrincipal(stablecoinTokenPrincipal),
          uintCV(amount),
        ],
        postConditions,
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  // Pool reward config (creator only)
  const setLiquidationRewardPct = useCallback(
    (
      stablecoinId: number,
      pct: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.STABILITY_POOL,
        functionName: "set-liquidation-reward-pct",
        functionArgs: [
          uintCV(stablecoinId),
          uintCV(pct),
        ],
        postConditions: [],
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract]
  );

  // Claim collateral rewards from stability pool
  const claimCollateralReward = useCallback(
    (
      stablecoinId: number,
      assetPrincipal: string,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.STABILITY_POOL,
        functionName: "claim-collateral-reward",
        functionArgs: [
          uintCV(stablecoinId),
          parseContractPrincipal(assetPrincipal),
          parseContractPrincipal(assetPrincipal),
        ],
        postConditions: [],
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  // Faucet mint for testnet collateral tokens
  const faucetMint = useCallback(
    async (
      tokenContractName: string,
      amount: number,
      recipient: string,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      try {
        const response: any = await request("stx_callContract", {
          contract: `${CONTRACTS.DEPLOYER}.${tokenContractName}`,
          functionName: "faucet-mint",
          functionArgs: [uintCV(amount), standardPrincipalCV(recipient)],
          postConditionMode: "allow",
          postConditions: [],
          network: networkName,
        });
        const txId = response.txid || response.result?.txid || "";
        console.log("Faucet mint tx submitted:", txId);
        onSuccess?.(txId);
      } catch (error: any) {
        if (error?.message?.includes("cancel") || error?.code === 4001) {
          console.log("Faucet mint cancelled");
          onError?.(new Error("Transaction cancelled by user"));
        } else {
          console.error("Faucet mint error:", error);
          onError?.(error as Error);
        }
      }
    },
    []
  );

  // Liquidation functions
  const liquidate = useCallback(
    (
      owner: string,
      stablecoinId: number,
      collateralAsset: string,
      stablecoinTokenPrincipal: string,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.LIQUIDATION_ENGINE,
        functionName: "liquidate",
        functionArgs: [
          principalCV(owner),
          uintCV(stablecoinId),
          parseContractPrincipal(collateralAsset),
          parseContractPrincipal(collateralAsset),
          parseContractPrincipal(stablecoinTokenPrincipal),
        ],
        postConditions: [],
        postConditionMode: "deny",
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
  );

  return {
    callContract,
    // Vault operations
    openVaultForStablecoin,
    depositCollateralForStablecoin,
    mintAgainstAssetForStablecoin,
    repayAgainstAssetForStablecoin,
    withdrawCollateralForStablecoin,
    // Factory operations
    registerStablecoin,
    deployTokenContract,
    setTokenContract,
    // Per-stablecoin collateral config
    configureCollateralForStablecoin,
    updateCollateralForStablecoin,
    disableCollateralForStablecoin,
    enableCollateralForStablecoin,
    // Pool operations
    depositToPool,
    withdrawFromPool,
    setLiquidationRewardPct,
    claimCollateralReward,
    // Liquidation
    liquidate,
    // Faucet
    faucetMint,
  };
}
