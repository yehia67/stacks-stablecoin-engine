"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Coins,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/hooks/useWallet";
import { useContract } from "@/hooks/useContract";
import { useCollateralTypes, useRegisteredStablecoins, useUserVault, useOracleStatus } from "@/hooks/useContractRead";
import { OracleStatusBanner } from "@/components/OracleStatusBanner";
import { formatTokenAmount, toSmallestUnits, toHumanReadable } from "@/lib/utils";
import { getExplorerTxUrl, STABLECOIN_DECIMALS, getCollateralDecimals, getCollateralDisplayDecimals, getCollateralSymbol } from "@/lib/constants";
import { getOraclePrincipalForAsset } from "@/lib/oracles";

const ZERO_DEBT_SENTINEL = 1000000;
const API_BASE = "/api/stacks";

function formatAssetName(asset: string) {
  const [, contractName] = asset.split(".");
  return contractName || asset;
}

function getPositionBadgeVariant(
  healthFactor: number,
  debtShare: number
): "default" | "secondary" | "destructive" | "outline" {
  if (debtShare === 0 || healthFactor >= ZERO_DEBT_SENTINEL) return "outline";
  if (healthFactor >= 200) return "default";
  if (healthFactor >= 150) return "secondary";
  return "destructive";
}

function getPositionBadgeLabel(healthFactor: number, debtShare: number) {
  if (debtShare === 0 || healthFactor >= ZERO_DEBT_SENTINEL) return "No debt";
  if (healthFactor >= 200) return "Healthy";
  if (healthFactor >= 150) return "Caution";
  return "At risk";
}

export default function VaultManagePage({
  params,
}: {
  params: { stablecoinId: string };
}) {
  const { isConnected, address } = useWallet();
  const {
    repayAgainstAssetForStablecoin,
    withdrawCollateralForStablecoin,
  } = useContract();
  const { stablecoins, isLoading: stablecoinsLoading } = useRegisteredStablecoins();
  // Needed to resolve the oracle principal v8 requires for withdraw calls.
  const { collateralTypes } = useCollateralTypes();

  const parsedStablecoinId = Number(params.stablecoinId);
  const stablecoinId =
    Number.isInteger(parsedStablecoinId) && parsedStablecoinId >= 0
      ? parsedStablecoinId
      : null;

  const {
    vault,
    isLoading: vaultLoading,
    refetch,
  } = useUserVault(address, stablecoinId);

  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [activeTab, setActiveTab] = useState("repay");
  const [actionState, setActionState] = useState<"idle" | "submitting" | "confirming" | "success" | "error">("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [latestTxId, setLatestTxId] = useState<string | null>(null);
  const [lastActionLabel, setLastActionLabel] = useState<string | null>(null);

  const stablecoin = useMemo(
    () => stablecoins.find((coin) => coin.id === stablecoinId) ?? null,
    [stablecoinId, stablecoins]
  );

  useEffect(() => {
    if (!vault?.positions.length) {
      setSelectedAsset(null);
      return;
    }

    if (!selectedAsset || !vault.positions.some((position) => position.asset === selectedAsset)) {
      setSelectedAsset(vault.positions[0].asset);
    }
  }, [selectedAsset, vault]);

  const selectedPosition = useMemo(
    () => vault?.positions.find((position) => position.asset === selectedAsset) ?? vault?.positions[0] ?? null,
    [selectedAsset, vault]
  );

  // Oracle freshness for the selected position's collateral. Informational here
  // (mint lives on /vaults/new); withdraw re-checks price on-chain, so this also
  // explains a withdraw that the engine would reject on a stale feed.
  const positionOraclePrincipal = selectedPosition
    ? getOraclePrincipalForAsset(selectedPosition.asset, collateralTypes)
    : null;
  const positionOracleStatus = useOracleStatus(positionOraclePrincipal);

  // Human-readable input (e.g. user types "1000" meaning 1000 tokens)
  const repayHuman = parseFloat(repayAmount || "0");
  const withdrawHuman = parseFloat(withdrawAmount || "0");

  // Convert to on-chain smallest units for contract calls
  const collateralDecimals = selectedPosition ? getCollateralDecimals(selectedPosition.asset) : 6;
  const repayUnits = toSmallestUnits(repayHuman, STABLECOIN_DECIMALS);
  const withdrawUnits = toSmallestUnits(withdrawHuman, collateralDecimals);

  const canRepay =
    !!selectedPosition &&
    !!stablecoin?.tokenContract &&
    repayUnits > 0 &&
    repayUnits <= selectedPosition.debtShare;
  const canWithdraw =
    !!selectedPosition &&
    withdrawUnits > 0 &&
    withdrawUnits <= selectedPosition.amount;

  const callAsPromise = useCallback(
    (fn: (...args: any[]) => void, ...args: any[]) =>
      new Promise<string>((resolve, reject) => {
        fn(...args, (txId: string) => resolve(txId), (error: Error) => reject(error));
      }),
    []
  );

  const pollTx = useCallback(async (txId: string) => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const response = await fetch(`${API_BASE}/extended/v1/tx/${txId}`, {
        headers: { "Content-Type": "application/json" },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.tx_status === "success") return;
        if (data.tx_status === "abort_by_response" || data.tx_status === "abort_by_post_condition") {
          throw new Error(data.tx_result?.repr || "Transaction failed on-chain");
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    throw new Error("Transaction confirmation timed out");
  }, []);

  const executeVaultAction = useCallback(
    async (label: string, action: () => Promise<string>) => {
      setActionState("submitting");
      setActionError(null);
      setLatestTxId(null);
      setLastActionLabel(label);

      try {
        const txId = await action();
        setLatestTxId(txId);
        setActionState("confirming");
        await pollTx(txId);
        await refetch();
        setActionState("success");
      } catch (error: any) {
        setActionState("error");
        setActionError(error?.message || `${label} failed`);
      }
    },
    [pollTx, refetch]
  );

  const handleRepay = useCallback(async () => {
    if (stablecoinId === null || !selectedPosition || !stablecoin?.tokenContract || !canRepay) return;

    await executeVaultAction(`Repay ${stablecoin.symbol}`, () =>
      callAsPromise(
        repayAgainstAssetForStablecoin,
        stablecoinId,
        selectedPosition.asset,
        stablecoin.tokenContract,
        repayUnits
      )
    );

    setRepayAmount("");
  }, [
    callAsPromise,
    canRepay,
    executeVaultAction,
    repayAgainstAssetForStablecoin,
    repayUnits,
    selectedPosition,
    stablecoin,
    stablecoinId,
  ]);

  const handleWithdraw = useCallback(async () => {
    if (stablecoinId === null || !selectedPosition || !canWithdraw) return;

    const withdrawOracle = getOraclePrincipalForAsset(selectedPosition.asset, collateralTypes);
    await executeVaultAction("Withdraw collateral", () =>
      callAsPromise(
        withdrawCollateralForStablecoin,
        stablecoinId,
        selectedPosition.asset,
        withdrawUnits,
        withdrawOracle
      )
    );

    setWithdrawAmount("");
  }, [
    callAsPromise,
    canWithdraw,
    collateralTypes,
    executeVaultAction,
    selectedPosition,
    stablecoinId,
    withdrawCollateralForStablecoin,
    withdrawUnits,
  ]);

  if (!isConnected) {
    return (
      <div className="container flex flex-col items-center justify-center px-4 py-24">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Wallet className="mx-auto h-12 w-12 text-muted-foreground" />
            <CardTitle className="mt-4">Connect Your Wallet</CardTitle>
            <CardDescription>
              Connect your Stacks wallet to manage vault positions.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (stablecoinId === null) {
    return (
      <div className="container px-4 py-8">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/vaults">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Vaults
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Invalid Vault Route</CardTitle>
            <CardDescription>The vault identifier in the URL is not valid.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (stablecoinsLoading || vaultLoading) {
    return (
      <div className="container flex items-center justify-center px-4 py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Loading vault data from chain...</span>
      </div>
    );
  }

  if (!stablecoin) {
    return (
      <div className="container px-4 py-8">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/vaults">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Vaults
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Stablecoin Not Found</CardTitle>
            <CardDescription>This stablecoin ID is not registered in the factory.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!vault) {
    return (
      <div className="container px-4 py-8">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/vaults">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Vaults
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>No Vault Yet</CardTitle>
            <CardDescription>
              You do not have a vault open for {stablecoin.name} ({stablecoin.symbol}) yet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href={`/vaults/new?stablecoinId=${stablecoin.id}`}>
                Open Vault for {stablecoin.symbol}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container px-4 py-8">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-4">
            <Link href="/vaults">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Vaults
            </Link>
          </Button>
          <h1 className="text-3xl font-bold">{stablecoin.name}</h1>
          <p className="text-muted-foreground">
            Manage vault #{stablecoin.id} for {stablecoin.symbol}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button asChild>
            <Link href={`/vaults/new?stablecoinId=${stablecoin.id}`}>Add Collateral / Mint</Link>
          </Button>
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Debt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatTokenAmount(vault.totalDebt, STABLECOIN_DECIMALS)} {stablecoin.symbol}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Collateral Positions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vault.positions.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Created At</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Block {vault.createdAt}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>Collateral Positions</CardTitle>
            <CardDescription>Select a collateral asset to repay debt or withdraw collateral.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {vault.positions.map((position) => (
              <button
                key={position.asset}
                type="button"
                onClick={() => setSelectedAsset(position.asset)}
                className={`w-full rounded-lg border p-4 text-left transition-colors hover:bg-muted ${
                  selectedPosition?.asset === position.asset ? "border-primary bg-primary/5" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{getCollateralSymbol(position.asset)}</p>
                      <Badge variant={getPositionBadgeVariant(position.healthFactor, position.debtShare)}>
                        {getPositionBadgeLabel(position.healthFactor, position.debtShare)}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{position.asset}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p>
                      <span className="text-muted-foreground">Deposited:</span>{" "}
                      <span className="font-medium">{formatTokenAmount(position.amount, getCollateralDecimals(position.asset), getCollateralDisplayDecimals(position.asset))}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Debt Share:</span>{" "}
                      <span className="font-medium">{formatTokenAmount(position.debtShare, STABLECOIN_DECIMALS)}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Health:</span>{" "}
                      <span className="font-medium">
                        {position.debtShare === 0 || position.healthFactor >= ZERO_DEBT_SENTINEL
                          ? "No debt"
                          : `${position.healthFactor}%`}
                      </span>
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Selected Position</CardTitle>
              <CardDescription>
                {selectedPosition ? getCollateralSymbol(selectedPosition.asset) : "Choose a collateral asset"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedPosition ? (
                <>
                  {positionOraclePrincipal && (
                    <OracleStatusBanner
                      state={positionOracleStatus.state}
                      symbol={getCollateralSymbol(selectedPosition.asset)}
                      ageSeconds={positionOracleStatus.ageSeconds}
                      isValidating={positionOracleStatus.isValidating}
                      onRefresh={positionOracleStatus.refetch}
                    />
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Collateral Deposited</span>
                    <span className="font-medium">{formatTokenAmount(selectedPosition.amount, getCollateralDecimals(selectedPosition.asset), getCollateralDisplayDecimals(selectedPosition.asset))}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Debt Share</span>
                    <span className="font-medium">
                      {formatTokenAmount(selectedPosition.debtShare, STABLECOIN_DECIMALS)} {stablecoin.symbol}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Health Factor</span>
                    <span className="font-medium">
                      {selectedPosition.debtShare === 0 || selectedPosition.healthFactor >= ZERO_DEBT_SENTINEL
                        ? "No debt"
                        : `${selectedPosition.healthFactor}%`}
                    </span>
                  </div>
                  <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                    Withdrawals remain health-factor checked on-chain. If a withdrawal would make the position unsafe,
                    the contract will reject it.
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No collateral positions found for this vault.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Manage Position</CardTitle>
              <CardDescription>Repay debt or withdraw collateral from the selected asset position.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="repay">Repay</TabsTrigger>
                  <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
                </TabsList>

                <TabsContent value="repay" className="space-y-4 pt-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      Repay Amount ({stablecoin.symbol})
                    </label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={repayAmount}
                      onChange={(event) => setRepayAmount(event.target.value)}
                      disabled={!selectedPosition || selectedPosition.debtShare === 0}
                    />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Outstanding debt for this asset:{" "}
                      {selectedPosition ? formatTokenAmount(selectedPosition.debtShare, STABLECOIN_DECIMALS) : "0"} {stablecoin.symbol}
                    </p>
                    <div className="mt-2 flex gap-2">
                      {[25, 50, 100].map((pct) => (
                        <Button
                          key={pct}
                          size="sm"
                          variant="outline"
                          disabled={!selectedPosition || selectedPosition.debtShare === 0}
                          onClick={() =>
                            selectedPosition &&
                            setRepayAmount(toHumanReadable(Math.floor((selectedPosition.debtShare * pct) / 100), STABLECOIN_DECIMALS).toString())
                          }
                        >
                          {pct}%
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleRepay}
                    disabled={!canRepay || actionState === "submitting" || actionState === "confirming"}
                    loading={activeTab === "repay" && (actionState === "submitting" || actionState === "confirming")}
                  >
                    Repay {stablecoin.symbol}
                  </Button>
                </TabsContent>

                <TabsContent value="withdraw" className="space-y-4 pt-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium">Withdraw Amount</label>
                    <Input
                      type="number"
                      min="0"
                      placeholder="0"
                      value={withdrawAmount}
                      onChange={(event) => setWithdrawAmount(event.target.value)}
                      disabled={!selectedPosition}
                    />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Available deposited collateral:{" "}
                      {selectedPosition ? formatTokenAmount(selectedPosition.amount, getCollateralDecimals(selectedPosition.asset), getCollateralDisplayDecimals(selectedPosition.asset)) : "0"}
                    </p>
                    <div className="mt-2 flex gap-2">
                      {[25, 50, 100].map((pct) => (
                        <Button
                          key={pct}
                          size="sm"
                          variant="outline"
                          disabled={!selectedPosition}
                          onClick={() =>
                            selectedPosition &&
                            setWithdrawAmount(toHumanReadable(Math.floor((selectedPosition.amount * pct) / 100), collateralDecimals).toString())
                          }
                        >
                          {pct}%
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    variant="outline"
                    onClick={handleWithdraw}
                    disabled={!canWithdraw || actionState === "submitting" || actionState === "confirming"}
                    loading={activeTab === "withdraw" && (actionState === "submitting" || actionState === "confirming")}
                  >
                    Withdraw Collateral
                  </Button>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {(actionState !== "idle" || actionError || latestTxId) && (
            <Card>
              <CardHeader>
                <CardTitle>Transaction Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {actionState === "submitting" && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Waiting for wallet approval for {lastActionLabel}...
                  </div>
                )}
                {actionState === "confirming" && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Transaction submitted. Waiting for on-chain confirmation...
                  </div>
                )}
                {actionState === "success" && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
                    {lastActionLabel} confirmed on-chain and vault data refreshed.
                  </div>
                )}
                {actionState === "error" && actionError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {actionError}
                  </div>
                )}
                {latestTxId && (
                  <a
                    href={getExplorerTxUrl(latestTxId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    View transaction <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>What To Watch</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 text-primary" />
                <p>Repay against the same collateral asset that currently holds the debt share.</p>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 text-primary" />
                <p>Withdrawals are constrained by the vault engine, so unhealthy withdrawals will fail on-chain.</p>
              </div>
              <div className="flex items-start gap-2 rounded-lg bg-muted/60 p-3">
                <Coins className="mt-0.5 h-4 w-4 text-primary" />
                <p>Use “Add Collateral / Mint” if you want to increase an existing vault position.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
