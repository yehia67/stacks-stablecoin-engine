"use client";

import { useCallback } from "react";
import { request } from "@stacks/connect";
// Xverse deploy channel. @stacks/connect's `request` resolves the Xverse
// provider as `window.XverseProviders.StacksProvider`, whose `.request` is a
// stub that throws "request function is not implemented". sats-connect instead
// routes through `window.XverseProviders.BitcoinProvider` -- Xverse's unified
// RPC channel that actually implements `.request` -- and its modern
// `request("stx_deployContract", ...)` path sends clean JSON-RPC params (no
// JWT transit token, unlike the legacy `openContractDeploy` helper that
// produced an on-chain JWT source and `(err none)`).
import SatsConnectWallet from "sats-connect";
import {
  Pc,
  uintCV,
  stringAsciiCV,
  principalCV,
  standardPrincipalCV,
  contractPrincipalCV,
} from "@stacks/transactions";
import { assertWalletSelected, getProviderObjectForWallet, getSelectedStacksWallet } from "@/lib/walletProvider";
import { CONTRACTS, APP_CONFIG, FT_ASSET_NAMES, getContractId, VAULT_ENGINE_IS_V8 } from "@/lib/constants";
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

  // Dynamic stablecoin tokens follow pattern: symbol-token-timestamp where the
  // symbol is the lowercased stablecoin symbol and MAY contain digits
  // (e.g. "btc01-token-1779913203"). Their FT name is `<symbol>-ft`
  // (see deriveTokenContractName / generateTokenContract in tokenTemplate.ts).
  // The symbol charset must include 0-9; a letters-only match dropped the
  // post-condition for tokens like btc01-ft and deny mode rolled the tx back.
  const match = contractName.match(/^([a-z0-9]+)-token-\d+$/);
  if (match) {
    return `${match[1]}-ft`;
  }

  return null;
}

/**
 * Strict variant of getFtAssetName. Throws when the FT asset name can't be
 * derived instead of returning null.
 *
 * Why this matters: every asset a contract call moves must be covered by a
 * post-condition. When the name couldn't be derived the callers silently fell
 * back to an EMPTY post-condition array, and under postConditionMode "deny" the
 * wallet then rolled the transaction back on-chain -- AFTER the fee was charged
 * (e.g. "btc01-ft was moved ... but not checked"). Failing fast here surfaces
 * the naming gap in the UI before the user pays for a doomed tx.
 */
function requireFtAssetName(contractPrincipal: string): string {
  const ftName = getFtAssetName(contractPrincipal);
  if (!ftName) {
    throw new Error(
      `[SSE] Could not derive the fungible-token asset name for "${contractPrincipal}". ` +
        "Add it to FT_ASSET_NAMES, or ensure the contract name follows the " +
        "'<symbol>-token-<timestamp>' convention. Refusing to send a transaction " +
        "with an unchecked asset movement."
    );
  }
  return ftName;
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
      let postConditions;
      try {
        const sender = getUserAddress();
        if (!sender) throw new Error("[SSE] No connected wallet address; cannot build post-condition.");
        const ftName = requireFtAssetName(collateralAsset);
        postConditions = [Pc.principal(sender).willSendLte(amount).ft(collateralAsset as `${string}.${string}`, ftName)];
      } catch (err) {
        onError?.(err as Error);
        return Promise.reject(err);
      }

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
      // v8 requires the oracle trait; v7 ignores it. Callers should always
      // pass the registry-stored oracle principal for `collateralAsset` --
      // letting it default to null only works on v7.
      oracleContract: string | null,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      if (VAULT_ENGINE_IS_V8 && !oracleContract) {
        const err = new Error(
          `[SSE] mint-against-asset-for-stablecoin requires an oracleContract on v8 (asset=${collateralAsset}). ` +
            "Resolve it via getOraclePrincipalForAsset() before calling."
        );
        onError?.(err);
        return Promise.reject(err);
      }
      const v8ExtraArgs = VAULT_ENGINE_IS_V8 && oracleContract
        ? [parseContractPrincipal(oracleContract)]
        : [];
      return callContract({
        contractName: CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
        functionName: "mint-against-asset-for-stablecoin",
        functionArgs: [
          uintCV(stablecoinId),
          principalCV(collateralAsset),
          parseContractPrincipal(tokenContract),
          ...v8ExtraArgs,
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
      let postConditions;
      try {
        const sender = getUserAddress();
        if (!sender) throw new Error("[SSE] No connected wallet address; cannot build post-condition.");
        const ftName = requireFtAssetName(tokenContract);
        postConditions = [Pc.principal(sender).willSendLte(amount).ft(tokenContract as `${string}.${string}`, ftName)];
      } catch (err) {
        onError?.(err as Error);
        return Promise.reject(err);
      }

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
      // v8 only: oracle trait required at the withdraw boundary so the engine
      // can re-check health-factor with a live price.
      oracleContract: string | null,
      onSuccess?: (txId: string) => void,
      onError?: (error: Error) => void
    ) => {
      if (VAULT_ENGINE_IS_V8 && !oracleContract) {
        const err = new Error(
          `[SSE] withdraw-collateral-for-stablecoin requires an oracleContract on v8 (asset=${collateralAsset}).`
        );
        onError?.(err);
        return Promise.reject(err);
      }
      const vaultPrincipal = getContractId(CONTRACTS.MULTI_ASSET_VAULT_ENGINE) as `${string}.${string}`;
      let postConditions;
      try {
        const ftName = requireFtAssetName(collateralAsset);
        postConditions = [Pc.principal(vaultPrincipal).willSendLte(amount).ft(collateralAsset as `${string}.${string}`, ftName)];
      } catch (err) {
        onError?.(err as Error);
        return Promise.reject(err);
      }

      const v8ExtraArgs = VAULT_ENGINE_IS_V8 && oracleContract
        ? [parseContractPrincipal(oracleContract)]
        : [];

      return callContract({
        contractName: CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
        functionName: "withdraw-collateral-for-stablecoin",
        functionArgs: [
          uintCV(stablecoinId),
          parseContractPrincipal(collateralAsset),
          parseContractPrincipal(collateralAsset),
          ...v8ExtraArgs,
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

        // DIAGNOSTIC: log exactly what we hand to the wallet so we can see
        // why the wallet validator says "Invalid input at clarityCode".
        console.log("[SSE] deployTokenContract params:", {
          name: contractName,
          nameLength: contractName.length,
          stablecoinName,
          stablecoinSymbol,
          clarityCodeLength: codeBody.length,
          clarityCodeFirst200: codeBody.slice(0, 200),
          clarityCodeLast200: codeBody.slice(-200),
          network: networkName,
        });

        // Dispatch per-wallet. Each wallet has different API surface:
        //
        //   Leather: exposes SIP-030 `request(method, params)` directly on
        //   `window.LeatherProvider`. Calling it bypasses any
        //   `window.StacksProvider` race and bypasses the @stacks/connect
        //   wrapper's transforms (which were JWT-wrapping the source). Most
        //   reliable path for Leather.
        //
        //   Xverse: route through the `sats-connect` SDK. Its `request`
        //   resolves Xverse's unified `BitcoinProvider` (which implements
        //   `.request`) and sends clean JSON-RPC -- NOT the old
        //   `openContractDeploy` JWT path that published a JWT string as the
        //   contract source. Do NOT switch Xverse to @stacks/connect's
        //   `request`: it targets `XverseProviders.StacksProvider`, whose
        //   `.request` is a stub that throws "request function is not implemented".
        //
        // Adding a new wallet: extend KNOWN_WALLETS in walletProvider.ts
        // and add a branch here matching the wallet id.
        const selected = assertWalletSelected();
        console.log("[SSE] deploying via wallet provider:", selected.name, `(${selected.id})`);

        let txId = "";

        if (selected.id === "LeatherProvider") {
          const provider = getProviderObjectForWallet(selected.id);
          if (!provider) {
            throw new Error("Leather provider disappeared between selection and deploy. Reconnect and retry.");
          }
          const resp: any = await provider.request("stx_deployContract", {
            name: contractName,
            clarityCode: codeBody,
            network: networkName,
          });
          txId = resp?.txid || resp?.result?.txid || resp?.txId || "";
        } else if (selected.id === "XverseProviders.StacksProvider") {
          // sats-connect talks to Xverse's BitcoinProvider RPC channel. Its
          // modern `request` sends clean params (no JWT). See import comment.
          const resp: any = await SatsConnectWallet.request("stx_deployContract", {
            name: contractName,
            clarityCode: codeBody,
          });
          if (resp?.status === "error") {
            const errMsg = resp?.error?.message || JSON.stringify(resp?.error);
            throw new Error(`Xverse deploy rejected: ${errMsg}`);
          }
          txId = resp?.result?.txid || resp?.result?.transactionId || "";
        } else {
          throw new Error(`No deploy dispatch implemented for wallet "${selected.name}" (${selected.id})`);
        }

        if (!txId) {
          throw new Error("Wallet returned no txid. Check console for the raw response.");
        }
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
      let postConditions;
      try {
        const sender = getUserAddress();
        if (!sender) throw new Error("[SSE] No connected wallet address; cannot build post-condition.");
        const ftName = requireFtAssetName(stablecoinTokenPrincipal);
        postConditions = [Pc.principal(sender).willSendLte(amount).ft(stablecoinTokenPrincipal as `${string}.${string}`, ftName)];
      } catch (err) {
        onError?.(err as Error);
        return Promise.reject(err);
      }

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
      const poolPrincipal = getContractId(CONTRACTS.STABILITY_POOL) as `${string}.${string}`;
      let postConditions;
      try {
        const ftName = requireFtAssetName(stablecoinTokenPrincipal);
        postConditions = [Pc.principal(poolPrincipal).willSendLte(amount).ft(stablecoinTokenPrincipal as `${string}.${string}`, ftName)];
      } catch (err) {
        onError?.(err as Error);
        return Promise.reject(err);
      }

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
