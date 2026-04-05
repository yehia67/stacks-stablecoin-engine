"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Info, AlertTriangle, Coins, Loader2, CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { cvToHex, principalCV, uintCV } from "@stacks/transactions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useWallet } from "@/hooks/useWallet";
import { useContract } from "@/hooks/useContract";
import { useCollateralTypes, useContractRead, useRegisteredStablecoins, useStablecoinCollateralList } from "@/hooks/useContractRead";
import { CONTRACTS } from "@/lib/constants";
import { calculateHealthFactor, formatNumber } from "@/lib/utils";

type StepStatus = 'pending' | 'active' | 'done' | 'skipped' | 'error';

function FlowStepRow({ label, status }: { label: string; status: StepStatus }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {status === 'active' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
      {status === 'done' && <CheckCircle className="h-4 w-4 text-green-500" />}
      {status === 'skipped' && <CheckCircle className="h-4 w-4 text-muted-foreground" />}
      {status === 'pending' && <div className="h-4 w-4 rounded-full border-2 border-muted" />}
      {status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
      <span className={status === 'pending' ? 'text-muted-foreground' : status === 'skipped' ? 'text-muted-foreground line-through' : ''}>
        {label}
      </span>
    </div>
  );
}

export default function NewVaultPage() {
  const router = useRouter();
  const { isConnected, address } = useWallet();
  const {
    openVaultForStablecoin,
    depositCollateralForStablecoin,
    mintAgainstAssetForStablecoin,
  } = useContract();
  const { stablecoins, isLoading: stablecoinsLoading } = useRegisteredStablecoins();
  const { collateralTypes, isLoading: collateralLoading } = useCollateralTypes();

  const [selectedCollateralAsset, setSelectedCollateralAsset] = useState<string | null>(null);
  const [selectedStablecoinId, setSelectedStablecoinId] = useState<number | null>(null);

  const { collaterals: stablecoinCollaterals } = useStablecoinCollateralList(selectedStablecoinId);

  // Use only collateral explicitly configured for the selected stablecoin.
  const effectiveCollateralTypes = useMemo(() => {
    if (selectedStablecoinId === null) return [];
    return stablecoinCollaterals
      .filter((sc) => sc.enabled)
      .map((sc) => {
        const globalType = collateralTypes.find((ct) => ct.asset === sc.asset);
        return {
          asset: sc.asset,
          minCollateralRatio: sc.minCollateralRatio,
          liquidationRatio: sc.liquidationRatio,
          debtFloor: sc.debtFloor,
          enabled: sc.enabled,
          oraclePrice: globalType?.oraclePrice ?? null,
        };
      });
  }, [selectedStablecoinId, stablecoinCollaterals, collateralTypes]);
  const [collateralAmount, setCollateralAmount] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState(1);

  // Vault flow execution state
  type FlowStep = 'idle' | 'checking' | 'opening' | 'depositing' | 'minting' | 'done' | 'error';
  const [flowStep, setFlowStep] = useState<FlowStep>('idle');
  const [flowTxId, setFlowTxId] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [vaultExists, setVaultExists] = useState<boolean | null>(null);

  useEffect(() => {
    if (!selectedCollateralAsset && effectiveCollateralTypes.length > 0) {
      setSelectedCollateralAsset(effectiveCollateralTypes[0].asset);
    }
  }, [selectedCollateralAsset, effectiveCollateralTypes]);

  // Reset collateral selection when stablecoin changes
  useEffect(() => {
    setSelectedCollateralAsset(null);
  }, [selectedStablecoinId]);

  const selectedCollateral =
    effectiveCollateralTypes.find((type) => type.asset === selectedCollateralAsset) || null;

  const oraclePrice = selectedCollateral?.oraclePrice || 1;

  const formatAssetName = (asset: string) => {
    const [, contractName] = asset.split(".");
    return contractName || asset;
  };

  const linkedStablecoins = useMemo(
    () => stablecoins.filter((coin) => coin.tokenContract),
    [stablecoins]
  );

  const selectedStablecoin = linkedStablecoins.find((coin) => coin.id === selectedStablecoinId) || null;
  const stablecoinSymbol = selectedStablecoin?.symbol || "Stablecoin";

  const collateralValue = parseFloat(collateralAmount || "0") * oraclePrice;
  const borrowValue = parseFloat(borrowAmount || "0");
  const minRatio = selectedCollateral?.minCollateralRatio || 150;
  const debtFloor = selectedCollateral?.debtFloor ?? 0;
  const previewHealthFactor = calculateHealthFactor(collateralValue, borrowValue, minRatio);
  const maxBorrow = (collateralValue / minRatio) * 100;

  const collateralUnits = Math.floor(parseFloat(collateralAmount || "0"));
  const borrowUnits = Math.floor(parseFloat(borrowAmount || "0"));

  const isBelowDebtFloor = borrowUnits > 0 && borrowUnits < debtFloor;

  const isValidPosition =
    !!selectedStablecoin &&
    !!selectedCollateral &&
    collateralUnits > 0 &&
    borrowUnits > 0 &&
    !isBelowDebtFloor &&
    previewHealthFactor >= minRatio;

  const ownerPrincipal = address || CONTRACTS.DEPLOYER;
  const healthFactorArgs = [
    cvToHex(principalCV(ownerPrincipal)),
    cvToHex(uintCV(selectedStablecoinId || 0)),
    cvToHex(principalCV(selectedCollateral?.asset || `${CONTRACTS.DEPLOYER}.${CONTRACTS.STABLECOIN_TOKEN}`)),
  ];

  const { data: onChainHealthFactorData, refetch: refetchOnChainHealth } = useContractRead<bigint>({
    contractName: CONTRACTS.MULTI_ASSET_VAULT_ENGINE,
    functionName: "get-position-health-factor-for-stablecoin",
    functionArgs: healthFactorArgs,
  });

  const ZERO_DEBT_SENTINEL = 1000000;
  const onChainHealthFactorRaw = onChainHealthFactorData !== null ? Number(onChainHealthFactorData) : null;
  const onChainHealthFactor =
    onChainHealthFactorRaw === null
      ? null
      : onChainHealthFactorRaw >= ZERO_DEBT_SENTINEL
        ? null // No debt position on-chain
        : onChainHealthFactorRaw;

  // Poll a tx until it confirms or fails on-chain
  const pollTx = useCallback(async (txId: string): Promise<'success' | 'failed'> => {
    const maxAttempts = 120; // ~10 minutes at 5s intervals
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const resp = await fetch(
          `https://api.testnet.hiro.so/extended/v1/tx/${txId}`,
          { headers: { 'x-api-key': process.env.NEXT_PUBLIC_HIRO_API_KEY || '' } }
        );
        if (resp.ok) {
          const data = await resp.json();
          if (data.tx_status === 'success') return 'success';
          if (data.tx_status === 'abort_by_response' || data.tx_status === 'abort_by_post_condition') {
            throw new Error(data.tx_result?.repr || 'Transaction failed on-chain');
          }
        }
      } catch (err: any) {
        if (err.message && !err.message.includes('fetch')) throw err;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    throw new Error('Transaction polling timed out');
  }, []);

  // Check if vault already exists for the selected stablecoin
  const checkVaultExists = useCallback(async (): Promise<boolean> => {
    if (!address || selectedStablecoinId === null) return false;
    try {
      const resp = await fetch(
        `https://api.testnet.hiro.so/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${CONTRACTS.MULTI_ASSET_VAULT_ENGINE}/get-vault-for-stablecoin`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.NEXT_PUBLIC_HIRO_API_KEY || '' },
          body: JSON.stringify({
            sender: address,
            arguments: [cvToHex(principalCV(address)), cvToHex(uintCV(selectedStablecoinId))],
          }),
        }
      );
      if (!resp.ok) return false;
      const data = await resp.json();
      // (some ...) means vault exists, 0x09 = none
      return data.okay && data.result && !data.result.startsWith('0x09');
    } catch {
      return false;
    }
  }, [address, selectedStablecoinId]);

  // Wrap a contract call in a promise that resolves with the txId
  const callAsPromise = useCallback(
    (fn: (...args: any[]) => any, ...args: any[]): Promise<string> => {
      return new Promise((resolve, reject) => {
        fn(...args, (txId: string) => resolve(txId), (err: Error) => reject(err));
      });
    },
    []
  );

  const handleCreateVault = async () => {
    if (!selectedStablecoin || !selectedStablecoin.tokenContract || !selectedCollateral || !isValidPosition) return;

    setIsLoading(true);
    setFlowError(null);
    setFlowTxId(null);

    try {
      // Step 1: Check if vault already exists
      setFlowStep('checking');
      const exists = await checkVaultExists();
      setVaultExists(exists);

      // Step 2: Open vault (skip if already exists)
      if (!exists) {
        setFlowStep('opening');
        const openTxId = await callAsPromise(openVaultForStablecoin, selectedStablecoin.id);
        setFlowTxId(openTxId);
        await pollTx(openTxId);
      }

      // Step 3: Deposit collateral
      setFlowStep('depositing');
      const depositTxId = await callAsPromise(
        depositCollateralForStablecoin,
        selectedStablecoin.id,
        selectedCollateral.asset,
        collateralUnits
      );
      setFlowTxId(depositTxId);
      await pollTx(depositTxId);

      // Step 4: Mint stablecoin
      setFlowStep('minting');
      const mintTxId = await callAsPromise(
        mintAgainstAssetForStablecoin,
        selectedStablecoin.id,
        selectedCollateral.asset,
        selectedStablecoin.tokenContract,
        borrowUnits
      );
      setFlowTxId(mintTxId);
      await pollTx(mintTxId);

      // Done!
      setFlowStep('done');
      await refetchOnChainHealth();
    } catch (error: any) {
      console.error('[SSE] Vault flow failed:', error);
      setFlowStep('error');
      setFlowError(error?.message || 'Vault creation failed');
    } finally {
      setIsLoading(false);
    }
  };

  const resetFlow = () => {
    setFlowStep('idle');
    setFlowTxId(null);
    setFlowError(null);
    setVaultExists(null);
  };

  if (!isConnected) {
    return (
      <div className="container flex flex-col items-center justify-center px-4 py-24">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>Connect Wallet</CardTitle>
            <CardDescription>Please connect your wallet to create a vault.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl px-4 py-8">
      <div className="mb-8">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/vaults">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Vaults
          </Link>
        </Button>
        <h1 className="text-3xl font-bold">Open New Vault</h1>
        <p className="text-muted-foreground">Create and fund a vault for a specific registered stablecoin</p>
      </div>

      <div className="mb-8 flex items-center justify-between">
        {["Select Stablecoin", "Set Position", "Confirm"].map((label, index) => (
          <div key={label} className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                step >= index + 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {index + 1}
            </div>
            <span className="ml-2 hidden text-sm sm:inline">{label}</span>
            {index < 2 && <div className="mx-4 h-px w-8 bg-border sm:w-16" />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Select Stablecoin</CardTitle>
            <CardDescription>Choose the stablecoin namespace this vault belongs to</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stablecoinsLoading ? (
              <p className="text-sm text-muted-foreground">Loading registered stablecoins...</p>
            ) : linkedStablecoins.length === 0 ? (
              <div className="rounded-lg border p-4">
                <p className="font-medium">No linked stablecoins found</p>
                <p className="text-sm text-muted-foreground">
                  Register a stablecoin and link a token contract in the factory first.
                </p>
                <Button className="mt-3" asChild>
                  <Link href="/factory">Go to Factory</Link>
                </Button>
              </div>
            ) : (
              linkedStablecoins.map((coin) => (
                <button
                  key={coin.id}
                  onClick={() => {
                    setSelectedStablecoinId(coin.id);
                    setStep(2);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-muted ${
                    selectedStablecoinId === coin.id ? "border-primary" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <Coins className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{coin.name}</p>
                      <p className="text-sm text-muted-foreground">{coin.symbol}</p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">ID: {coin.id}</span>
                </button>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configure Position</CardTitle>
              <CardDescription>Set collateral and borrow target for {stablecoinSymbol}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {effectiveCollateralTypes.map((type) => (
                <button
                  key={type.asset}
                  onClick={() => setSelectedCollateralAsset(type.asset)}
                  className={`flex w-full items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted ${
                    selectedCollateralAsset === type.asset ? "border-primary" : ""
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {formatAssetName(type.asset).charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left">
                      <p className="font-medium">{formatAssetName(type.asset)}</p>
                      <p className="text-sm text-muted-foreground">Min Ratio: {type.minCollateralRatio}%</p>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">{type.asset}</div>
                </button>
              ))}
              {collateralLoading && (
                <p className="text-sm text-muted-foreground">Loading collateral types from registry...</p>
              )}
              {!collateralLoading && effectiveCollateralTypes.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {selectedStablecoinId !== null && selectedStablecoinId > 0
                    ? "No collateral types configured for this stablecoin. Configure them in the Factory page."
                    : "Select a stablecoin to load collateral options."}
                </p>
              )}

              <div>
                <label className="mb-2 block text-sm font-medium">Collateral Amount</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={collateralAmount}
                  onChange={(e) => setCollateralAmount(e.target.value)}
                />
                <p className="mt-1 text-sm text-muted-foreground">
                  Estimated value: ${formatNumber(collateralValue)} (oracle price: ${formatNumber(oraclePrice)})
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Borrow Amount ({stablecoinSymbol})</label>
                <Input
                  type="number"
                  placeholder="0"
                  value={borrowAmount}
                  onChange={(e) => setBorrowAmount(e.target.value)}
                />
                <p className="mt-1 text-sm text-muted-foreground">
                  Max estimated: {formatNumber(maxBorrow)} {stablecoinSymbol}
                  {debtFloor > 0 && ` · Min: ${formatNumber(debtFloor)} ${stablecoinSymbol}`}
                </p>
                {isBelowDebtFloor && (
                  <div className="mt-1 flex items-center gap-1 text-sm text-destructive">
                    <AlertTriangle className="h-3 w-3" />
                    Minimum borrow is {formatNumber(debtFloor)} {stablecoinSymbol} (debt floor)
                  </div>
                )}
              </div>

              <div className="rounded-lg bg-muted p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">Preview Health Factor</span>
                  <span
                    className={`font-bold ${
                      previewHealthFactor >= 200
                        ? "text-green-500"
                        : previewHealthFactor >= 150
                          ? "text-yellow-500"
                          : "text-red-500"
                    }`}
                  >
                    {borrowValue > 0 ? `${previewHealthFactor}%` : "-"}
                  </span>
                </div>
                <Progress value={Math.min(previewHealthFactor, 100)} className="h-2" />
                {previewHealthFactor < minRatio && borrowValue > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    Health factor too low. Reduce borrow amount.
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  On-chain current health factor: {onChainHealthFactor !== null ? `${onChainHealthFactor}%` : "-"}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-4">
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button className="flex-1" disabled={!isValidPosition} onClick={() => setStep(3)}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Confirm Vault Flow</CardTitle>
              <CardDescription>This will submit open-vault, deposit, then mint transactions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stablecoin</span>
                  <span className="font-medium">{selectedStablecoin?.name} ({stablecoinSymbol})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stablecoin ID</span>
                  <span className="font-medium">{selectedStablecoin?.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Collateral Asset</span>
                  <span className="font-medium">{selectedCollateral?.asset || "-"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Collateral Amount</span>
                  <span className="font-medium">{collateralUnits}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Borrow Amount</span>
                  <span className="font-medium">{borrowUnits} {stablecoinSymbol}</span>
                </div>
                {debtFloor > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Debt Floor (minimum)</span>
                    <span>{formatNumber(debtFloor)} {stablecoinSymbol}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Preview Health Factor</span>
                  <span className="font-bold">{previewHealthFactor}%</span>
                </div>
              </div>

              {flowStep === 'idle' && (
                <div className="flex items-start gap-2 rounded-lg bg-muted p-4 text-sm">
                  <Info className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    You will confirm wallet prompts for each step. The flow checks for an existing vault,
                    deposits collateral, then mints the selected stablecoin token.
                  </p>
                </div>
              )}

              {/* Flow progress tracker */}
              {flowStep !== 'idle' && (
                <div className="space-y-3 rounded-lg border p-4">
                  <p className="text-sm font-medium">Vault Flow Progress</p>
                  {/* Step: Check vault */}
                  <FlowStepRow
                    label="Check existing vault"
                    status={flowStep === 'checking' ? 'active' : 'done'}
                  />
                  {/* Step: Open vault */}
                  <FlowStepRow
                    label={vaultExists ? 'Open vault (skipped — already exists)' : 'Open vault'}
                    status={
                      flowStep === 'opening' ? 'active'
                      : (['checking', 'idle'].includes(flowStep)) ? 'pending'
                      : vaultExists ? 'skipped' : 'done'
                    }
                  />
                  {/* Step: Deposit */}
                  <FlowStepRow
                    label="Deposit collateral"
                    status={
                      flowStep === 'depositing' ? 'active'
                      : (['checking', 'opening'].includes(flowStep)) ? 'pending'
                      : flowStep === 'error' ? 'error'
                      : flowStep === 'done' || flowStep === 'minting' ? 'done'
                      : 'pending'
                    }
                  />
                  {/* Step: Mint */}
                  <FlowStepRow
                    label={`Mint ${stablecoinSymbol}`}
                    status={
                      flowStep === 'minting' ? 'active'
                      : flowStep === 'done' ? 'done'
                      : 'pending'
                    }
                  />

                  {flowTxId && (
                    <a
                      href={`https://explorer.hiro.so/txid/${flowTxId}?chain=testnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      View latest tx on Explorer <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}

              {/* Success */}
              {flowStep === 'done' && (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
                  <CheckCircle className="h-4 w-4" />
                  Vault created, collateral deposited, and {stablecoinSymbol} minted successfully!
                </div>
              )}

              {/* Error */}
              {flowStep === 'error' && flowError && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                    <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{flowError}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex gap-4">
            {flowStep === 'idle' && (
              <Button variant="outline" onClick={() => setStep(2)}>
                Back
              </Button>
            )}
            {flowStep === 'done' ? (
              <Button className="flex-1" onClick={() => router.push('/vaults')}>
                Go to Vaults
              </Button>
            ) : flowStep === 'error' ? (
              <>
                <Button variant="outline" onClick={() => { resetFlow(); setStep(2); }}>
                  Back
                </Button>
                <Button className="flex-1" onClick={() => { resetFlow(); handleCreateVault(); }}>
                  Retry
                </Button>
              </>
            ) : (
              <Button className="flex-1" onClick={handleCreateVault} loading={isLoading} disabled={isLoading}>
                {isLoading ? 'Executing...' : 'Execute Vault Flow'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
