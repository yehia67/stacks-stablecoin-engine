"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Info, AlertTriangle, Coins, Loader2, CheckCircle, XCircle, ExternalLink } from "lucide-react";
import { cvToHex, principalCV, uintCV } from "@stacks/transactions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useWallet } from "@/hooks/useWallet";
import { useContract } from "@/hooks/useContract";
import { useCollateralTypes, useContractRead, useRegisteredStablecoins, useStablecoinCollateralList, useDiaOraclePrices, useTokenDecimals } from "@/hooks/useContractRead";
import { CONTRACTS } from "@/lib/constants";
import { calculateHealthFactor, formatNumber, toSmallestUnits, toHumanReadable } from "@/lib/utils";

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
  const searchParams = useSearchParams();
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
  const { prices: diaOraclePrices } = useDiaOraclePrices();

  // Fetch token decimals dynamically from chain
  const { decimals: collateralDecimals } = useTokenDecimals(selectedCollateralAsset);
  const stablecoinTokenContract = useMemo(() => {
    if (selectedStablecoinId === null) return null;
    const coin = stablecoins.find((c) => c.id === selectedStablecoinId);
    return coin?.tokenContract ?? null;
  }, [selectedStablecoinId, stablecoins]);
  const { decimals: stablecoinDecimals } = useTokenDecimals(stablecoinTokenContract);

  // Helper to get oracle price for an asset - use DIA prices with fallback to registry oracle
  const getOraclePrice = useCallback((asset: string): number | null => {
    const assetName = asset.split(".").pop()?.toLowerCase() ?? "";
    // Map asset names to DIA oracle prices
    if (assetName.includes("sbtc") || assetName.includes("btc")) {
      return diaOraclePrices.btcUsd;
    }
    if (assetName.includes("stx")) {
      return diaOraclePrices.stxUsd;
    }
    // Fallback to global collateral type oracle price
    const globalType = collateralTypes.find((ct) => ct.asset === asset);
    return globalType?.oraclePrice ?? null;
  }, [diaOraclePrices, collateralTypes]);

  // Use only collateral explicitly configured for the selected stablecoin.
  const effectiveCollateralTypes = useMemo(() => {
    if (selectedStablecoinId === null) return [];
    return stablecoinCollaterals
      .filter((sc) => sc.enabled)
      .map((sc) => {
        return {
          asset: sc.asset,
          minCollateralRatio: sc.minCollateralRatio,
          liquidationRatio: sc.liquidationRatio,
          debtFloor: sc.debtFloor,
          enabled: sc.enabled,
          oraclePrice: getOraclePrice(sc.asset),
        };
      });
  }, [selectedStablecoinId, stablecoinCollaterals, getOraclePrice]);
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

  const oraclePrice = selectedCollateral?.oraclePrice ?? null;

  const formatAssetName = (asset: string) => {
    const [, contractName] = asset.split(".");
    return contractName || asset;
  };

  const linkedStablecoins = useMemo(
    () => stablecoins.filter((coin) => coin.tokenContract),
    [stablecoins]
  );

  const requestedStablecoinId = useMemo(() => {
    const value = searchParams.get("stablecoinId");
    if (value === null) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }, [searchParams]);

  useEffect(() => {
    if (requestedStablecoinId === null || selectedStablecoinId !== null || linkedStablecoins.length === 0) {
      return;
    }

    const requestedStablecoin = linkedStablecoins.find((coin) => coin.id === requestedStablecoinId);
    if (!requestedStablecoin) return;

    setSelectedStablecoinId(requestedStablecoin.id);
    setStep(2);
  }, [linkedStablecoins, requestedStablecoinId, selectedStablecoinId]);

  const selectedStablecoin = linkedStablecoins.find((coin) => coin.id === selectedStablecoinId) || null;
  const stablecoinSymbol = selectedStablecoin?.symbol || "Stablecoin";

  // Human-readable input amounts (e.g. 0.001 BTC, 50 EGP)
  const collateralHuman = parseFloat(collateralAmount || "0");
  const borrowHuman = parseFloat(borrowAmount || "0");

  const minRatio = selectedCollateral?.minCollateralRatio || 150;
  const debtFloorRaw = selectedCollateral?.debtFloor ?? 0; // in smallest units on-chain

  // Convert human inputs to on-chain smallest units (for contract calls only)
  const collateralUnits = collateralDecimals !== null ? toSmallestUnits(collateralHuman, collateralDecimals) : 0;
  const borrowUnits = stablecoinDecimals !== null ? toSmallestUnits(borrowHuman, stablecoinDecimals) : 0;

  // USD value of collateral deposit (human-readable: whole tokens × USD per token)
  const collateralUsd = oraclePrice !== null ? collateralHuman * oraclePrice : 0;

  // Preview health factor in human-readable terms (collateralUSD vs borrowHuman stablecoins)
  const previewHealthFactor = calculateHealthFactor(collateralUsd, borrowHuman, minRatio);

  // Max borrowable in human-readable stablecoins (assuming $1 peg)
  const maxBorrow = minRatio > 0 ? (collateralUsd * 100) / minRatio : 0;

  // Debt floor in human-readable
  const debtFloorHuman = stablecoinDecimals !== null ? toHumanReadable(debtFloorRaw, stablecoinDecimals) : 0;

  const isBelowDebtFloor = borrowUnits > 0 && borrowUnits < debtFloorRaw;

  // Dynamic placeholder values: minimum acceptable amounts from on-chain config
  const minBorrowPlaceholder = stablecoinDecimals !== null && debtFloorRaw > 0
    ? `e.g. ${toHumanReadable(debtFloorRaw, stablecoinDecimals)}`
    : stablecoinDecimals !== null ? "e.g. 1" : "Loading...";
  const minCollateralPlaceholder = useMemo(() => {
    if (collateralDecimals === null || oraclePrice === null || oraclePrice === 0) return "Loading...";
    // Min collateral (human-readable) to cover debt floor at min ratio
    const minDebtHuman = debtFloorRaw > 0
      ? toHumanReadable(debtFloorRaw, stablecoinDecimals ?? 6)
      : 1;
    // minCollateral (in whole tokens) = minDebt * minRatio% / pricePerToken
    const minCollateralHuman = (minDebtHuman * minRatio) / (100 * oraclePrice);
    return `e.g. ${Number(minCollateralHuman.toPrecision(3))}`;
  }, [collateralDecimals, stablecoinDecimals, oraclePrice, debtFloorRaw, minRatio]);

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

              {selectedCollateral ? (
                <div className="rounded-lg border border-primary/50 bg-primary/5 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                      {formatAssetName(selectedCollateral.asset).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium">{formatAssetName(selectedCollateral.asset)}</p>
                      <p className="text-xs text-muted-foreground">Min Ratio: {selectedCollateral.minCollateralRatio}%</p>
                    </div>
                  </div>
                  <label className="mb-2 block text-sm font-medium">
                    Deposit Amount ({formatAssetName(selectedCollateral.asset)})
                  </label>
                  <Input
                    type="number"
                    step="any"
                    placeholder={minCollateralPlaceholder}
                    value={collateralAmount}
                    onChange={(e) => setCollateralAmount(e.target.value)}
                    className="text-lg"
                  />
                  <div className="mt-2 space-y-1">
                    {oraclePrice !== null && oraclePrice > 0 ? (
                      <p className="text-sm text-muted-foreground">
                        ≈ <span className="font-medium text-foreground">${formatNumber(collateralUsd, 2)}</span> USD
                        <span className="ml-2 text-xs">(@ ${formatNumber(oraclePrice, 2)} per {formatAssetName(selectedCollateral.asset)})</span>
                      </p>
                    ) : (
                      <p className="text-sm text-yellow-600">
                        ⚠ Oracle price unavailable - value estimate not shown
                      </p>
                    )}
                    {collateralDecimals === null && (
                      <p className="text-sm text-yellow-600">Loading token decimals...</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-muted-foreground/50 p-4 text-center">
                  <p className="text-sm text-muted-foreground">👆 Select a collateral type above to continue</p>
                </div>
              )}

              <div className={!selectedCollateral ? "pointer-events-none opacity-50" : ""}>
                <label className="mb-2 block text-sm font-medium">Mint Amount ({stablecoinSymbol})</label>
                <Input
                  type="number"
                  step="any"
                  placeholder={selectedCollateral ? minBorrowPlaceholder : "Select collateral first"}
                  value={borrowAmount}
                  onChange={(e) => setBorrowAmount(e.target.value)}
                  disabled={!selectedCollateral}
                  className="text-lg"
                />
                {selectedCollateral && (
                  <div className="mt-2 space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Max mintable: <span className="font-medium text-foreground">{formatNumber(maxBorrow, 2)}</span> {stablecoinSymbol}
                      {debtFloorHuman > 0 && (
                        <span className="ml-2">· Min: <span className="font-medium">{formatNumber(debtFloorHuman)}</span> {stablecoinSymbol}</span>
                      )}
                    </p>
                    {isBelowDebtFloor && (
                      <div className="flex items-center gap-1 text-sm text-destructive">
                        <AlertTriangle className="h-3 w-3" />
                        Minimum mint is {formatNumber(debtFloorHuman)} {stablecoinSymbol} (debt floor)
                      </div>
                    )}
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
                    {borrowHuman > 0 ? `${previewHealthFactor}%` : "-"}
                  </span>
                </div>
                <Progress value={Math.min(previewHealthFactor, 100)} className="h-2" />
                {previewHealthFactor < minRatio && borrowHuman > 0 && (
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
                  <span className="font-medium">{collateralHuman} {formatAssetName(selectedCollateral?.asset || "")} ({collateralUnits} units)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Borrow Amount</span>
                  <span className="font-medium">{borrowHuman} {stablecoinSymbol} ({borrowUnits} units)</span>
                </div>
                {debtFloorHuman > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Debt Floor (minimum)</span>
                    <span>{formatNumber(debtFloorHuman)} {stablecoinSymbol}</span>
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
