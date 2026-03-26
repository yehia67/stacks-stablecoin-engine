"use client";

import { useCallback } from "react";
import { useConnect } from "@stacks/connect-react";
import {
  PostConditionMode,
  uintCV,
  stringAsciiCV,
  principalCV,
} from "@stacks/transactions";
import { CONTRACTS } from "@/lib/constants";

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

  // Vault Engine functions
  const openVault = useCallback(
    (onSuccess?: (txId: string) => void, onError?: (error: Error) => void) => {
      return callContract({
        contractName: CONTRACTS.VAULT_ENGINE,
        functionName: "open-vault",
        functionArgs: [],
        onSuccess,
        onError,
      });
    },
    [callContract]
  );

  const depositCollateral = useCallback(
    (
      amount: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.VAULT_ENGINE,
        functionName: "deposit-collateral",
        functionArgs: [uintCV(amount)],
        onSuccess,
        onError,
      });
    },
    [callContract]
  );

  const withdrawCollateral = useCallback(
    (
      amount: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.VAULT_ENGINE,
        functionName: "withdraw-collateral",
        functionArgs: [uintCV(amount)],
        onSuccess,
        onError,
      });
    },
    [callContract]
  );

  const mint = useCallback(
    (
      amount: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.VAULT_ENGINE,
        functionName: "mint",
        functionArgs: [uintCV(amount)],
        onSuccess,
        onError,
      });
    },
    [callContract]
  );

  const burn = useCallback(
    (
      amount: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.VAULT_ENGINE,
        functionName: "burn",
        functionArgs: [uintCV(amount)],
        onSuccess,
        onError,
      });
    },
    [callContract]
  );

  // Stablecoin Factory functions
  const registerStablecoin = useCallback(
    (
      name: string,
      symbol: string,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.STABLECOIN_FACTORY,
        functionName: "register-stablecoin",
        functionArgs: [stringAsciiCV(name), stringAsciiCV(symbol)],
        postConditionMode: PostConditionMode.Allow, // Allow STX transfer for fee
        onSuccess,
        onError,
      });
    },
    [callContract]
  );

  // Stability Pool functions
  const depositToPool = useCallback(
    (
      amount: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.STABILITY_POOL,
        functionName: "deposit",
        functionArgs: [uintCV(amount)],
        onSuccess,
        onError,
      });
    },
    [callContract]
  );

  const withdrawFromPool = useCallback(
    (
      amount: number,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.STABILITY_POOL,
        functionName: "withdraw",
        functionArgs: [uintCV(amount)],
        onSuccess,
        onError,
      });
    },
    [callContract]
  );

  // Liquidation functions
  const liquidate = useCallback(
    (
      owner: string,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      return callContract({
        contractName: CONTRACTS.LIQUIDATION_ENGINE,
        functionName: "liquidate",
        functionArgs: [principalCV(owner)],
        onSuccess,
        onError,
      });
    },
    [callContract]
  );

  return {
    callContract,
    // Vault operations
    openVault,
    depositCollateral,
    withdrawCollateral,
    mint,
    burn,
    // Factory operations
    registerStablecoin,
    // Pool operations
    depositToPool,
    withdrawFromPool,
    // Liquidation
    liquidate,
  };
}
