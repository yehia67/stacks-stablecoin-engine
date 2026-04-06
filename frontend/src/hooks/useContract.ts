"use client";

import { useCallback } from "react";
import { useConnect, openContractDeploy } from "@stacks/connect-react";
import {
  PostConditionMode,
  uintCV,
  stringAsciiCV,
  principalCV,
  contractPrincipalCV,
  makeStandardSTXPostCondition,
  FungibleConditionCode,
} from "@stacks/transactions";
import { CONTRACTS, APP_CONFIG, IS_MAINNET } from "@/lib/constants";
import { StacksTestnet, StacksMainnet } from "@stacks/connect/node_modules/@stacks/network";
import { generateTokenContract, deriveTokenContractName } from "@/lib/tokenTemplate";

const stacksNetwork = IS_MAINNET ? new StacksMainnet() : new StacksTestnet();

export interface ContractCallOptions {
  contractName: string;
  functionName: string;
  functionArgs: any[];
  postConditions?: any[];
  postConditionMode?: PostConditionMode;
  onSuccess?: (txId: string) => void;
  onError?: (error: Error) => void;
}

export function useContract() {
  const { doContractCall } = useConnect();

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
        postConditionMode = PostConditionMode.Deny,
        onSuccess,
        onError,
      } = options;

      try {
        await doContractCall({
          network: stacksNetwork,
          contractAddress: CONTRACTS.DEPLOYER,
          contractName,
          functionName,
          functionArgs,
          postConditionMode: postConditionMode as any,
          postConditions,
          onFinish: (data: any) => {
            console.log("Transaction submitted:", data.txId);
            onSuccess?.(data.txId);
          },
          onCancel: () => {
            console.log("Transaction cancelled");
            onError?.(new Error("Transaction cancelled by user"));
          },
        });
      } catch (error) {
        console.error("Contract call error:", error);
        onError?.(error as Error);
      }
    },
    [doContractCall]
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
      return callContract({
        contractName: CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
        functionName: "deposit-collateral-for-stablecoin",
        functionArgs: [
          uintCV(stablecoinId),
          parseContractPrincipal(collateralAsset),
          parseContractPrincipal(collateralAsset),
          uintCV(amount),
        ],
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
      return callContract({
        contractName: CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
        functionName: "repay-against-asset-for-stablecoin",
        functionArgs: [
          uintCV(stablecoinId),
          principalCV(collateralAsset),
          parseContractPrincipal(tokenContract),
          uintCV(amount),
        ],
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
      return callContract({
        contractName: CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
        functionName: "withdraw-collateral-for-stablecoin",
        functionArgs: [
          uintCV(stablecoinId),
          parseContractPrincipal(collateralAsset),
          parseContractPrincipal(collateralAsset),
          uintCV(amount),
        ],
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
      feeAmount?: number // Fee in microSTX (e.g., 500000 for 0.5 STX)
    ) => {
      // Create post condition to show STX transfer in wallet
      const hasPostConditions = senderAddress && feeAmount && feeAmount > 0;
      const postConditions = hasPostConditions
        ? [
            makeStandardSTXPostCondition(
              senderAddress,
              FungibleConditionCode.LessEqual,
              feeAmount
            ),
          ]
        : [];

      return callContract({
        contractName: CONTRACTS.STABLECOIN_FACTORY,
        functionName: "register-stablecoin",
        functionArgs: [stringAsciiCV(name), stringAsciiCV(symbol)],
        // Use Allow mode when we can't construct proper post-conditions,
        // otherwise the wallet defaults to denying any STX transfer
        postConditionMode: hasPostConditions ? PostConditionMode.Deny : PostConditionMode.Allow,
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

        await openContractDeploy({
          network: stacksNetwork,
          contractName,
          codeBody,
          appDetails: APP_CONFIG,
          onFinish: (data: any) => {
            console.log("Token deploy tx submitted:", data.txId);
            onSuccess?.(data.txId, contractName);
          },
          onCancel: () => {
            onError?.(new Error("Contract deployment cancelled by user"));
          },
        });
      } catch (error) {
        console.error("Deploy error:", error);
        onError?.(error as Error);
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
        onSuccess,
        onError,
      });
    },
    [callContract]
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
      return callContract({
        contractName: CONTRACTS.STABILITY_POOL,
        functionName: "deposit",
        functionArgs: [
          uintCV(stablecoinId),
          parseContractPrincipal(stablecoinTokenPrincipal),
          uintCV(amount),
        ],
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
      return callContract({
        contractName: CONTRACTS.STABILITY_POOL,
        functionName: "withdraw",
        functionArgs: [
          uintCV(stablecoinId),
          parseContractPrincipal(stablecoinTokenPrincipal),
          uintCV(amount),
        ],
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
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
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
        onSuccess,
        onError,
      });
    },
    [callContract, parseContractPrincipal]
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
    // Pool operations
    depositToPool,
    withdrawFromPool,
    setLiquidationRewardPct,
    claimCollateralReward,
    // Liquidation
    liquidate,
  };
}
