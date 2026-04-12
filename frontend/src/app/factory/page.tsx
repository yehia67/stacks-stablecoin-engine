"use client";

import { useState, useEffect, useCallback } from "react";
import { Info, Coins, CheckCircle, Loader2, ExternalLink, XCircle, Clock, ChevronDown, ChevronUp, Settings, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/hooks/useWallet";
import { useContract } from "@/hooks/useContract";
import { CONTRACTS, DEFAULTS } from "@/lib/constants";
import { useRegistrationFee, useRegisteredStablecoins, useIsNameTaken, useIsSymbolTaken, useCollateralTypes, useStablecoinCollateralList } from "@/hooks/useContractRead";

// Per-collateral config state for the factory form
interface CollateralConfigEntry {
  asset: string;
  existsOnChain: boolean;
  enabledOnChain: boolean;
  enabled: boolean;
  minCollateralRatio: number;
  liquidationRatio: number;
  liquidationPenalty: number;
  stabilityFee: number;
  debtCeiling: number;
  debtFloor: number;
  // Global defaults for reference
  globalMinCollateralRatio: number;
  globalLiquidationRatio: number;
  globalLiquidationPenalty: number;
  globalStabilityFee: number;
  globalDebtCeiling: number;
  globalDebtFloor: number;
}

export default function FactoryPage() {
  const { isConnected, address } = useWallet();
  const {
    registerStablecoin,
    deployTokenContract,
    setTokenContract,
    configureCollateralForStablecoin,
    updateCollateralForStablecoin,
    disableCollateralForStablecoin,
    enableCollateralForStablecoin,
  } = useContract();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");

  // Live duplicate checks against on-chain state
  const { isTaken: isNameTaken, isChecking: isCheckingName } = useIsNameTaken(name);
  const { isTaken: isSymbolTaken, isChecking: isCheckingSymbol } = useIsSymbolTaken(symbol);
  const [isLoading, setIsLoading] = useState(false);

  // Deploy & Link token contract state
  const [deployingCoinId, setDeployingCoinId] = useState<number | null>(null);
  const [deployTxId, setDeployTxId] = useState<string | null>(null);
  const [deployedContractName, setDeployedContractName] = useState<string | null>(null);
  const [deployStatus, setDeployStatus] = useState<'deploying' | 'linking' | 'done' | 'error' | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [txId, setTxId] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<'pending' | 'success' | 'failed' | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  // Collateral configuration state
  const { collateralTypes, isLoading: collateralTypesLoading } = useCollateralTypes();
  const [configuringCoinId, setConfiguringCoinId] = useState<number | null>(null);
  const [collateralConfigs, setCollateralConfigs] = useState<CollateralConfigEntry[]>([]);
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [configError, setConfigError] = useState<string | null>(null);
  const [configProgress, setConfigProgress] = useState(0);
  const {
    collaterals: existingCollaterals,
    isLoading: existingCollateralsLoading,
    refetch: refetchExistingCollaterals,
  } = useStablecoinCollateralList(configuringCoinId);

  // Merge global collateral options with the stablecoin's on-chain configuration.
  useEffect(() => {
    if (configuringCoinId !== null && collateralTypes.length > 0 && !existingCollateralsLoading) {
      const existingByAsset = new Map(existingCollaterals.map((collateral) => [collateral.asset, collateral]));
      const merged = collateralTypes.map((ct) => ({
        existsOnChain: existingByAsset.has(ct.asset),
        enabledOnChain: existingByAsset.get(ct.asset)?.enabled ?? false,
        asset: ct.asset,
        enabled: existingByAsset.get(ct.asset)?.enabled ?? false,
        minCollateralRatio: existingByAsset.get(ct.asset)?.minCollateralRatio ?? ct.minCollateralRatio,
        liquidationRatio: existingByAsset.get(ct.asset)?.liquidationRatio ?? ct.liquidationRatio,
        liquidationPenalty: existingByAsset.get(ct.asset)?.liquidationPenalty ?? ct.liquidationPenalty,
        stabilityFee: existingByAsset.get(ct.asset)?.stabilityFee ?? ct.stabilityFee,
        debtCeiling: existingByAsset.get(ct.asset)?.debtCeiling ?? ct.debtCeiling,
        debtFloor: existingByAsset.get(ct.asset)?.debtFloor ?? ct.debtFloor,
        globalMinCollateralRatio: ct.minCollateralRatio,
        globalLiquidationRatio: ct.liquidationRatio,
        globalLiquidationPenalty: ct.liquidationPenalty,
        globalStabilityFee: ct.stabilityFee,
        globalDebtCeiling: ct.debtCeiling,
        globalDebtFloor: ct.debtFloor,
      }));
      setCollateralConfigs(merged);
    }
  }, [collateralTypes, configuringCoinId, existingCollaterals, existingCollateralsLoading]);

  // Fetch registered stablecoins from contract — filter to show only the connected user's coins
  const { stablecoins: allStablecoins, isLoading: coinsLoading, refetch: refetchCoins } = useRegisteredStablecoins();
  const registeredStablecoins = allStablecoins.filter((coin) => coin.creator === address);

  // Fetch registration fee from blockchain
  const { fee: registrationFee, isLoading: feeLoading, error: feeError } = useRegistrationFee();
  const isValidForm = name.length >= 3 && symbol.length >= 2 && symbol.length <= 10 && !isNameTaken && !isSymbolTaken;

  const pendingCollateralActions = collateralConfigs.filter((config) => {
    // New collateral to configure
    if (!config.existsOnChain && config.enabled) return true;
    // Disable an enabled collateral
    if (config.existsOnChain && config.enabledOnChain && !config.enabled) return true;
    // Re-enable a disabled collateral
    if (config.existsOnChain && !config.enabledOnChain && config.enabled) return true;
    // Update an enabled collateral (check if params changed - for now always include)
    if (config.existsOnChain && config.enabledOnChain && config.enabled) return true;
    return false;
  });

  const updateCollateralConfig = (asset: string, updates: Partial<CollateralConfigEntry>) => {
    setCollateralConfigs((prev) =>
      prev.map((c) => (c.asset === asset ? { ...c, ...updates } : c))
    );
  };

  const handleSaveCollateralConfigs = async () => {
    if (configuringCoinId === null || pendingCollateralActions.length === 0) return;
    setConfigStatus('saving');
    setConfigError(null);
    setConfigProgress(0);

    let completed = 0;
    for (const config of pendingCollateralActions) {
      try {
        // Step 1: Submit transaction and get txId
        const txId = await new Promise<string>((resolve, reject) => {
          const params = {
            minCollateralRatio: config.minCollateralRatio,
            liquidationRatio: config.liquidationRatio,
            liquidationPenalty: config.liquidationPenalty,
            stabilityFee: config.stabilityFee,
            debtCeiling: config.debtCeiling,
            debtFloor: config.debtFloor,
          };

          const onSuccess = (txId: string) => resolve(txId);
          const onError = (err: Error) => reject(err);

          if (!config.existsOnChain && config.enabled) {
            configureCollateralForStablecoin(
              configuringCoinId,
              config.asset,
              params,
              onSuccess,
              onError
            );
            return;
          }

          if (config.existsOnChain && config.enabledOnChain && !config.enabled) {
            // Disable an enabled collateral
            disableCollateralForStablecoin(
              configuringCoinId,
              config.asset,
              onSuccess,
              onError
            );
            return;
          }

          if (config.existsOnChain && !config.enabledOnChain && config.enabled) {
            // Re-enable a disabled collateral
            enableCollateralForStablecoin(
              configuringCoinId,
              config.asset,
              onSuccess,
              onError
            );
            return;
          }

          if (config.existsOnChain && config.enabledOnChain && config.enabled) {
            // Update an enabled collateral's parameters
            updateCollateralForStablecoin(
              configuringCoinId,
              config.asset,
              params,
              onSuccess,
              onError
            );
            return;
          }

          // No action needed for this config
          resolve('');
        });

        // Step 2: If we got a txId, wait for confirmation
        if (txId) {
          console.log(`[SSE] Waiting for tx ${txId} to confirm...`);
          const result = await waitForTxConfirmation(txId);
          if (!result.success) {
            throw new Error(result.error || 'Transaction failed');
          }
          console.log(`[SSE] Tx ${txId} confirmed successfully`);
        }

        completed++;
        setConfigProgress(completed);
      } catch (err: any) {
        setConfigStatus('error');
        setConfigError(`Failed to save ${config.asset}: ${err.message}`);
        // Refetch to show actual on-chain state
        refetchExistingCollaterals();
        return;
      }
    }

    setConfigStatus('done');
    // Refetch to get confirmed on-chain state
    refetchExistingCollaterals();
  };

  const resetCollateralConfig = () => {
    setConfiguringCoinId(null);
    setCollateralConfigs([]);
    setExpandedAsset(null);
    setConfigStatus('idle');
    setConfigError(null);
    setConfigProgress(0);
  };

  const formatAssetName = (asset: string) => {
    const [, contractName] = asset.split(".");
    return contractName || asset;
  };

  // Poll transaction status
  const checkTxStatus = useCallback(async (txHash: string) => {
    try {
      const response = await fetch(
        `https://api.testnet.hiro.so/extended/v1/tx/${txHash}`,
        { headers: { 'x-api-key': process.env.NEXT_PUBLIC_HIRO_API_KEY || '' } }
      );
      if (!response.ok) return null;
      const data = await response.json();
      return data;
    } catch {
      return null;
    }
  }, []);

  // Helper to wait for transaction confirmation (polls until success/failure)
  const waitForTxConfirmation = useCallback(async (txId: string, maxAttempts = 60): Promise<{ success: boolean; error?: string }> => {
    for (let i = 0; i < maxAttempts; i++) {
      const txData = await checkTxStatus(txId);
      if (txData) {
        if (txData.tx_status === 'success') {
          return { success: true };
        } else if (txData.tx_status === 'abort_by_response' || txData.tx_status === 'abort_by_post_condition') {
          return { success: false, error: txData.tx_result?.repr || 'Transaction failed on-chain' };
        }
      }
      // Wait 3 seconds before next poll
      await new Promise(r => setTimeout(r, 3000));
    }
    return { success: false, error: 'Transaction confirmation timeout' };
  }, [checkTxStatus]);

  useEffect(() => {
    if (!txId || txStatus === 'success' || txStatus === 'failed') return;

    const pollInterval = setInterval(async () => {
      const txData = await checkTxStatus(txId);
      if (txData) {
        if (txData.tx_status === 'success') {
          setTxStatus('success');
          setIsLoading(false);
          refetchCoins();
          clearInterval(pollInterval);
        } else if (txData.tx_status === 'abort_by_response' || txData.tx_status === 'abort_by_post_condition') {
          setTxStatus('failed');
          setTxError(txData.tx_result?.repr || 'Transaction failed');
          setIsLoading(false);
          clearInterval(pollInterval);
        }
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [txId, txStatus, checkTxStatus, refetchCoins]);

  const handleRegister = async () => {
    if (!isValidForm) return;

    setIsLoading(true);
    setTxId(null);
    setTxStatus('pending');
    setTxError(null);
    
    // Convert fee from STX to microSTX (1 STX = 1,000,000 microSTX)
    const feeInMicroSTX = registrationFee ? registrationFee * 1_000_000 : 0;
    
    try {
      await registerStablecoin(
        name,
        symbol,
        (newTxId) => {
          console.log("Transaction submitted:", newTxId);
          setTxId(newTxId);
          // Keep loading - we'll poll for actual status
        },
        (error) => {
          console.error("Registration failed:", error);
          setTxStatus('failed');
          setTxError(error?.message || 'Transaction was rejected');
          setIsLoading(false);
        },
        address || undefined, // Sender address for post condition
        feeInMicroSTX // Fee amount in microSTX
      );
    } catch (error: any) {
      console.error(error);
      setTxStatus('failed');
      setTxError(error?.message || 'Failed to submit transaction');
      setIsLoading(false);
    }
  };

  // Poll deploy tx, then auto-link when confirmed
  useEffect(() => {
    if (!deployTxId || !deployedContractName || !address || deployingCoinId === null) return;
    if (deployStatus !== 'deploying') return;

    const poll = setInterval(async () => {
      const txData = await checkTxStatus(deployTxId);
      if (!txData) return;

      if (txData.tx_status === 'success') {
        clearInterval(poll);
        // Token deployed — now link it to the stablecoin registration
        const tokenPrincipal = `${address}.${deployedContractName}`;
        setDeployStatus('linking');
        try {
          await setTokenContract(
            deployingCoinId,
            tokenPrincipal,
            () => {
              setDeployStatus('done');
              refetchCoins();
            },
            (err) => {
              console.error('[SSE] Link after deploy failed:', err);
              setDeployStatus('error');
              setDeployError(`Token deployed at ${tokenPrincipal} but linking failed: ${err.message}. You can link it manually.`);
            }
          );
        } catch (err: any) {
          setDeployStatus('error');
          setDeployError(`Token deployed at ${tokenPrincipal} but linking failed. You can link it manually.`);
        }
      } else if (txData.tx_status === 'abort_by_response' || txData.tx_status === 'abort_by_post_condition') {
        clearInterval(poll);
        setDeployStatus('error');
        setDeployError(txData.tx_result?.repr || 'Token deployment failed on-chain');
      }
    }, 5000);

    return () => clearInterval(poll);
  }, [deployTxId, deployedContractName, deployStatus, deployingCoinId, address, checkTxStatus, setTokenContract, refetchCoins]);

  const handleDeployAndLink = async (coin: { id: number; name: string; symbol: string }) => {
    setDeployingCoinId(coin.id);
    setDeployTxId(null);
    setDeployedContractName(null);
    setDeployStatus('deploying');
    setDeployError(null);

    try {
      await deployTokenContract(
        coin.name,
        coin.symbol,
        (txId, contractName) => {
          setDeployTxId(txId);
          setDeployedContractName(contractName);
        },
        (error) => {
          console.error('[SSE] Deploy failed:', error);
          setDeployStatus('error');
          setDeployError(error.message);
        }
      );
    } catch (err: any) {
      setDeployStatus('error');
      setDeployError(err.message);
    }
  };

  const resetDeployState = () => {
    setDeployingCoinId(null);
    setDeployTxId(null);
    setDeployedContractName(null);
    setDeployStatus(null);
    setDeployError(null);
  };

  const resetForm = () => {
    setTxId(null);
    setTxStatus(null);
    setTxError(null);
    setName("");
    setSymbol("");
  };

  if (!isConnected) {
    return (
      <div className="container flex flex-col items-center justify-center px-4 py-24">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <Coins className="mx-auto h-12 w-12 text-muted-foreground" />
            <CardTitle className="mt-4">Connect Wallet</CardTitle>
            <CardDescription>
              Connect your wallet to create a new stablecoin.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Transaction pending screen
  if (txStatus === 'pending' && txId) {
    return (
      <div className="container flex flex-col items-center justify-center px-4 py-24">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <Clock className="mx-auto h-16 w-16 text-yellow-500 animate-pulse" />
            <CardTitle className="mt-4">Transaction Pending</CardTitle>
            <CardDescription>
              Your transaction has been submitted and is waiting to be confirmed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Waiting for confirmation...</span>
            </div>
            <a
              href={`https://explorer.hiro.so/txid/${txId}?chain=testnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              View on Explorer <ExternalLink className="h-3 w-3" />
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Transaction failed screen
  if (txStatus === 'failed') {
    return (
      <div className="container flex flex-col items-center justify-center px-4 py-24">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <XCircle className="mx-auto h-16 w-16 text-red-500" />
            <CardTitle className="mt-4">Transaction Failed</CardTitle>
            <CardDescription>
              Your stablecoin registration failed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {txError && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-300">
                {txError.includes('u702') ? 'A stablecoin with this name or symbol is already registered. Please choose a different name and symbol.' : txError}
              </div>
            )}
            {txId && (
              <a
                href={`https://explorer.hiro.so/txid/${txId}?chain=testnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                View on Explorer <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <Button className="w-full" onClick={resetForm}>
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Transaction success screen
  if (txStatus === 'success') {
    return (
      <div className="container flex flex-col items-center justify-center px-4 py-24">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CheckCircle className="mx-auto h-16 w-16 text-green-500" />
            <CardTitle className="mt-4">Stablecoin Registered!</CardTitle>
            <CardDescription>
              Your stablecoin &quot;{name}&quot; ({symbol}) has been successfully registered.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Next step: configure which collateral types your stablecoin accepts, then deploy a token contract.
            </p>
            {txId && (
              <a
                href={`https://explorer.hiro.so/txid/${txId}?chain=testnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                View on Explorer <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <div className="flex gap-4">
              <Button variant="outline" className="flex-1" onClick={resetForm}>
                Create Another
              </Button>
              <Button className="flex-1" onClick={() => { resetForm(); }}>
                <Settings className="mr-1 h-4 w-4" /> Configure Collaterals
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Stablecoin Factory</h1>
        <p className="text-muted-foreground">
          Create and register your own stablecoin on the SSE platform
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Registration Form */}
        <Card>
          <CardHeader>
            <CardTitle>Register New Stablecoin</CardTitle>
            <CardDescription>
              Pay a one-time registration fee to create your stablecoin
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium">
                Stablecoin Name
              </label>
              <Input
                placeholder="e.g., My Stablecoin"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {isCheckingName && name.length >= 3 && (
                <p className="mt-1 text-xs text-muted-foreground">Checking availability...</p>
              )}
              {isNameTaken === true && (
                <p className="mt-1 text-xs text-red-500">This name is already taken</p>
              )}
              {isNameTaken === false && name.length >= 3 && !isCheckingName && (
                <p className="mt-1 text-xs text-green-500">Name is available</p>
              )}
              {!isCheckingName && isNameTaken === null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Minimum 3 characters
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Symbol
              </label>
              <Input
                placeholder="e.g., MUSD or myUSD"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                maxLength={10}
              />
              {isCheckingSymbol && symbol.length >= 2 && (
                <p className="mt-1 text-xs text-muted-foreground">Checking availability...</p>
              )}
              {isSymbolTaken === true && (
                <p className="mt-1 text-xs text-red-500">This symbol is already taken</p>
              )}
              {isSymbolTaken === false && symbol.length >= 2 && !isCheckingSymbol && (
                <p className="mt-1 text-xs text-green-500">Symbol is available</p>
              )}
              {!isCheckingSymbol && isSymbolTaken === null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  2-10 characters
                </p>
              )}
            </div>

            <div className="rounded-lg bg-muted p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Registration Fee</span>
                <span className="font-bold">
                  {feeLoading ? "Loading..." : feeError ? "Error" : `${registrationFee} STX`}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {feeError ? "Could not fetch fee from blockchain" : "This fee is sent to the protocol treasury"}
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-900 dark:bg-blue-950">
              <Info className="mt-0.5 h-4 w-4 text-blue-500" />
              <div className="text-blue-700 dark:text-blue-300">
                <p className="font-medium">What happens next?</p>
                <p className="mt-1">
                  After registration, configure which collateral types your stablecoin accepts
                  and set risk parameters (ratios, fees, debt ceilings). Then deploy & link a token contract.
                </p>
              </div>
            </div>

            <Button
              className="w-full"
              disabled={!isValidForm || feeLoading || registrationFee === null || isCheckingName || isCheckingSymbol}
              onClick={handleRegister}
              loading={isLoading}
            >
              {feeLoading ? "Loading fee..." : feeError ? "Error loading fee" : `Register Stablecoin (${registrationFee} STX)`}
            </Button>
          </CardContent>
        </Card>

        {/* Registered Stablecoins */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Your Stablecoins</CardTitle>
                <CardDescription>
                  {coinsLoading ? 'Loading...' : `${registeredStablecoins.length} stablecoin${registeredStablecoins.length !== 1 ? 's' : ''}`}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchCoins()}>
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {coinsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : registeredStablecoins.length === 0 ? (
              <div className="text-center py-8">
                <Coins className="mx-auto h-12 w-12 text-muted-foreground" />
                <p className="mt-4 text-muted-foreground">No stablecoins registered yet</p>
                <p className="text-sm text-muted-foreground">Be the first to create one!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {registeredStablecoins.map((coin) => (
                  <div
                    key={coin.id}
                    className="flex flex-col rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                        {coin.symbol.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium">{coin.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {coin.symbol}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline">{coin.symbol}</Badge>
                      <p className="mt-1 text-xs text-muted-foreground">
                        ID: {coin.id}
                      </p>
                      {coin.tokenContract ? (
                        <Badge variant="default" className="mt-1">Linked</Badge>
                      ) : coin.creator === address ? (
                        <Badge variant="destructive" className="mt-1">Not linked</Badge>
                      ) : (
                        <Badge variant="secondary" className="mt-1">No token</Badge>
                      )}
                      {coin.creator === address && (
                        <Badge variant="secondary" className="mt-1 ml-1">Your coin</Badge>
                      )}
                    </div>
                    </div>
                    {/* Configure Collaterals + Deploy & Link Token flow */}
                    {coin.creator === address && (
                      <div className="mt-3 w-full border-t pt-3 space-y-2">
                        {/* Configure Collaterals button & panel */}
                        {configuringCoinId === coin.id ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-semibold">Manage Accepted Collaterals</h4>
                              <Button size="sm" variant="ghost" onClick={resetCollateralConfig}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </div>

                            {collateralTypesLoading || existingCollateralsLoading ? (
                              <p className="text-xs text-muted-foreground">Loading collateral configuration...</p>
                            ) : collateralConfigs.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No global collateral types found in registry.</p>
                            ) : (
                              <div className="space-y-2">
                                {collateralConfigs.map((config) => (
                                  <div key={config.asset} className="rounded-lg border p-3">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={config.enabled}
                                          disabled={config.existsOnChain && !config.enabledOnChain}
                                          onChange={(e) => updateCollateralConfig(config.asset, { enabled: e.target.checked })}
                                          className="h-4 w-4 rounded"
                                        />
                                        <span className="text-sm font-medium">{formatAssetName(config.asset)}</span>
                                        {config.existsOnChain ? (
                                          <Badge variant={config.enabledOnChain ? "default" : "secondary"}>
                                            {config.enabledOnChain ? "Configured" : "Disabled"}
                                          </Badge>
                                        ) : (
                                          <Badge variant="outline">Available</Badge>
                                        )}
                                        <span className="text-xs text-muted-foreground">
                                          (Global: {config.globalMinCollateralRatio}% / {config.globalLiquidationRatio}%)
                                        </span>
                                      </div>
                                      {(config.enabled || config.existsOnChain) && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => setExpandedAsset(expandedAsset === config.asset ? null : config.asset)}
                                        >
                                          {expandedAsset === config.asset ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                        </Button>
                                      )}
                                    </div>

                                    {expandedAsset === config.asset && (config.enabled || config.existsOnChain) && (
                                      <div className="mt-3 grid grid-cols-2 gap-3">
                                        <div className="col-span-2 rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
                                          {config.existsOnChain && !config.enabledOnChain
                                            ? "This collateral is already disabled on-chain. The current contract supports updates and disables, but not re-enabling."
                                            : config.existsOnChain && !config.enabled
                                              ? "This collateral will be disabled for the stablecoin when you save."
                                              : config.existsOnChain
                                                ? "This is the current on-chain config. Edit values here, then save to update it."
                                                : config.enabled
                                                  ? "This collateral will be added for the stablecoin when you save."
                                                  : "Enable this collateral to configure and save it."}
                                        </div>
                                        <div>
                                          <label className="mb-1 block text-xs font-medium">Min Collateral Ratio (%)</label>
                                          <Input
                                            type="number"
                                            value={config.minCollateralRatio}
                                            min={config.globalMinCollateralRatio}
                                            disabled={config.existsOnChain && !config.enabledOnChain}
                                            onChange={(e) => updateCollateralConfig(config.asset, { minCollateralRatio: parseInt(e.target.value) || config.globalMinCollateralRatio })}
                                            className="h-8 text-sm"
                                          />
                                          <p className="mt-0.5 text-xs text-muted-foreground">Min: {config.globalMinCollateralRatio}%</p>
                                        </div>
                                        <div>
                                          <label className="mb-1 block text-xs font-medium">Liquidation Ratio (%)</label>
                                          <Input
                                            type="number"
                                            value={config.liquidationRatio}
                                            min={config.globalLiquidationRatio}
                                            disabled={config.existsOnChain && !config.enabledOnChain}
                                            onChange={(e) => updateCollateralConfig(config.asset, { liquidationRatio: parseInt(e.target.value) || config.globalLiquidationRatio })}
                                            className="h-8 text-sm"
                                          />
                                          <p className="mt-0.5 text-xs text-muted-foreground">Min: {config.globalLiquidationRatio}%</p>
                                        </div>
                                        <div>
                                          <label className="mb-1 block text-xs font-medium">Liquidation Penalty (%)</label>
                                          <Input
                                            type="number"
                                            value={config.liquidationPenalty}
                                            min={config.globalLiquidationPenalty}
                                            disabled={config.existsOnChain && !config.enabledOnChain}
                                            onChange={(e) => updateCollateralConfig(config.asset, { liquidationPenalty: parseInt(e.target.value) || config.globalLiquidationPenalty })}
                                            className="h-8 text-sm"
                                          />
                                          <p className="mt-0.5 text-xs text-muted-foreground">Min: {config.globalLiquidationPenalty}%</p>
                                        </div>
                                        <div>
                                          <label className="mb-1 block text-xs font-medium">Stability Fee (bps)</label>
                                          <Input
                                            type="number"
                                            value={config.stabilityFee}
                                            min={0}
                                            disabled={config.existsOnChain && !config.enabledOnChain}
                                            onChange={(e) => updateCollateralConfig(config.asset, { stabilityFee: parseInt(e.target.value) || 0 })}
                                            className="h-8 text-sm"
                                          />
                                          <p className="mt-0.5 text-xs text-muted-foreground">{(config.stabilityFee / 100).toFixed(2)}% annual</p>
                                        </div>
                                        <div>
                                          <label className="mb-1 block text-xs font-medium">Debt Ceiling</label>
                                          <Input
                                            type="number"
                                            value={config.debtCeiling}
                                            min={0}
                                            disabled={config.existsOnChain && !config.enabledOnChain}
                                            onChange={(e) => updateCollateralConfig(config.asset, { debtCeiling: parseInt(e.target.value) || 0 })}
                                            className="h-8 text-sm"
                                          />
                                        </div>
                                        <div>
                                          <label className="mb-1 block text-xs font-medium">Debt Floor</label>
                                          <Input
                                            type="number"
                                            value={config.debtFloor}
                                            min={0}
                                            disabled={config.existsOnChain && !config.enabledOnChain}
                                            onChange={(e) => updateCollateralConfig(config.asset, { debtFloor: parseInt(e.target.value) || 0 })}
                                            className="h-8 text-sm"
                                          />
                                        </div>
                                        <div className="col-span-2">
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="text-xs"
                                            disabled={config.existsOnChain && !config.enabledOnChain}
                                            onClick={() => updateCollateralConfig(config.asset, {
                                              minCollateralRatio: config.globalMinCollateralRatio,
                                              liquidationRatio: config.globalLiquidationRatio,
                                              liquidationPenalty: config.globalLiquidationPenalty,
                                              stabilityFee: config.globalStabilityFee,
                                              debtCeiling: config.globalDebtCeiling,
                                              debtFloor: config.globalDebtFloor,
                                            })}
                                          >
                                            <RotateCcw className="mr-1 h-3 w-3" /> Reset to Defaults
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {configStatus === 'saving' && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Saving collateral change {configProgress + 1} of {pendingCollateralActions.length}...
                              </div>
                            )}
                            {configStatus === 'done' && (
                              <div className="flex items-center gap-2 text-sm text-green-600">
                                <CheckCircle className="h-4 w-4" />
                                Collateral configuration saved on-chain.
                              </div>
                            )}
                            {configStatus === 'error' && (
                              <p className="text-xs text-red-500">{configError}</p>
                            )}

                            {configStatus !== 'saving' && configStatus !== 'done' && (
                              <Button
                                size="sm"
                                className="w-full"
                                disabled={pendingCollateralActions.length === 0}
                                onClick={handleSaveCollateralConfigs}
                              >
                                <Settings className="mr-1 h-3 w-3" />
                                Save Collateral Changes ({pendingCollateralActions.length})
                              </Button>
                            )}
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            onClick={() => { setConfiguringCoinId(coin.id); setCollateralConfigs([]); }}
                          >
                            <Settings className="mr-1 h-3 w-3" /> Manage Collaterals
                          </Button>
                        )}

                        {/* Existing collateral config summary */}
                        {existingCollaterals.length > 0 && configuringCoinId === coin.id && configStatus === 'done' && (
                          <div className="rounded-lg bg-muted/50 p-2">
                            <p className="text-xs font-medium mb-1">Configured collaterals:</p>
                            {existingCollaterals.map((ec) => (
                              <p key={ec.asset} className="text-xs text-muted-foreground">
                                {formatAssetName(ec.asset)} — {ec.minCollateralRatio}% ratio, {ec.liquidationRatio}% liq, {ec.enabled ? "enabled" : "disabled"}
                              </p>
                            ))}
                          </div>
                        )}

                        {/* Deploy & Link Token - only for unlinked coins */}
                        {!coin.tokenContract && (
                          <>
                            {deployingCoinId === coin.id && deployStatus === 'deploying' && !deployTxId && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Waiting for wallet approval...
                              </div>
                            )}
                            {deployingCoinId === coin.id && deployStatus === 'deploying' && deployTxId && (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Deploying token contract...
                                </div>
                                <a
                                  href={`https://explorer.hiro.so/txid/${deployTxId}?chain=testnet`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                >
                                  View deploy tx <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            )}
                            {deployingCoinId === coin.id && deployStatus === 'linking' && (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Token deployed! Linking to stablecoin...
                              </div>
                            )}
                            {deployingCoinId === coin.id && deployStatus === 'done' && (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-green-600">
                                  <CheckCircle className="h-4 w-4" />
                                  Token deployed and linked!
                                </div>
                                <Button size="sm" variant="outline" onClick={resetDeployState}>
                                  Dismiss
                                </Button>
                              </div>
                            )}
                            {deployingCoinId === coin.id && deployStatus === 'error' && (
                              <div className="space-y-2">
                                <p className="text-xs text-red-500">{deployError}</p>
                                <Button size="sm" variant="outline" onClick={resetDeployState}>
                                  Dismiss
                                </Button>
                              </div>
                            )}
                            {(deployingCoinId !== coin.id || deployStatus === null) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full"
                                disabled={deployStatus === 'deploying' || deployStatus === 'linking'}
                                onClick={() => handleDeployAndLink(coin)}
                              >
                                <Coins className="mr-1 h-3 w-3" /> Deploy & Link Token
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {coin.tokenContract && (
                      <p className="mt-2 w-full truncate text-xs text-muted-foreground" title={coin.tokenContract}>
                        Token: {coin.tokenContract}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Info Section */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-4">
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                1
              </div>
              <h3 className="mt-4 font-semibold">Register</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Pay the registration fee and reserve your stablecoin name and symbol
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                2
              </div>
              <h3 className="mt-4 font-semibold">Configure Collaterals</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Select which collateral types your stablecoin accepts and set risk parameters
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                3
              </div>
              <h3 className="mt-4 font-semibold">Deploy & Link Token</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Click &quot;Deploy & Link Token&quot; to auto-deploy a SIP-010 contract and link it
              </p>
            </div>
            <div className="text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                4
              </div>
              <h3 className="mt-4 font-semibold">Create Vaults</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Your stablecoin is ready — create vaults and start minting
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
