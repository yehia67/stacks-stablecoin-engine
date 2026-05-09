"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, Info, Loader2, Settings, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/hooks/useWallet";
import { useContract } from "@/hooks/useContract";
import { useRegisteredStablecoins, useStabilityPoolState } from "@/hooks/useContractRead";
import { formatNumber, formatTokenAmount, toSmallestUnits, toHumanReadable } from "@/lib/utils";
import { getExplorerTxUrl, IS_MAINNET, STABLECOIN_DECIMALS, getCollateralDecimals } from "@/lib/constants";

const API_BASE = IS_MAINNET ? "https://api.mainnet.hiro.so" : "https://api.testnet.hiro.so";

function formatAssetName(asset: string) {
  const [, contractName] = asset.split(".");
  return contractName || asset;
}

export default function PoolPage() {
  const { isConnected, address } = useWallet();
  const {
    depositToPool,
    withdrawFromPool,
    setLiquidationRewardPct,
    claimCollateralReward,
  } = useContract();
  const { stablecoins, isLoading: stablecoinsLoading } = useRegisteredStablecoins();

  const [selectedStablecoinId, setSelectedStablecoinId] = useState<number | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [rewardPct, setRewardPct] = useState("");
  const [activeTab, setActiveTab] = useState("deposit");
  const [actionState, setActionState] = useState<"idle" | "submitting" | "confirming" | "success" | "error">("idle");
  const [actionError, setActionError] = useState<string | null>(null);
  const [latestTxId, setLatestTxId] = useState<string | null>(null);
  const [lastActionLabel, setLastActionLabel] = useState<string | null>(null);

  const linkedStablecoins = useMemo(
    () => stablecoins.filter((coin) => coin.tokenContract !== null),
    [stablecoins]
  );

  useEffect(() => {
    if (selectedStablecoinId !== null || linkedStablecoins.length === 0) return;
    setSelectedStablecoinId(linkedStablecoins[0].id);
  }, [linkedStablecoins, selectedStablecoinId]);

  useEffect(() => {
    setDepositAmount("");
    setWithdrawAmount("");
    setRewardPct("");
    setActionState("idle");
    setActionError(null);
    setLatestTxId(null);
    setLastActionLabel(null);
  }, [selectedStablecoinId]);

  const selectedStablecoin = linkedStablecoins.find((coin) => coin.id === selectedStablecoinId) ?? null;
  const {
    poolState,
    isLoading: poolStateLoading,
    error: poolStateError,
    refetch: refetchPoolState,
  } = useStabilityPoolState(address, selectedStablecoinId);

  // Human-readable input → on-chain smallest units
  const depositHuman = parseFloat(depositAmount || "0");
  const withdrawHuman = parseFloat(withdrawAmount || "0");
  const depositUnits = toSmallestUnits(depositHuman, STABLECOIN_DECIMALS);
  const withdrawUnits = toSmallestUnits(withdrawHuman, STABLECOIN_DECIMALS);

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
        headers: {
          "x-api-key": process.env.NEXT_PUBLIC_HIRO_API_KEY || "",
        },
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

  const executePoolAction = useCallback(
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
        await refetchPoolState();
        setActionState("success");
      } catch (error: any) {
        setActionState("error");
        setActionError(error?.message || `${label} failed`);
      }
    },
    [pollTx, refetchPoolState]
  );

  const handleDeposit = useCallback(async () => {
    if (!selectedStablecoin || !selectedStablecoin.tokenContract || depositUnits <= 0) return;

    await executePoolAction(`Deposit ${selectedStablecoin.symbol}`, () =>
      callAsPromise(
        depositToPool,
        selectedStablecoin.id,
        selectedStablecoin.tokenContract,
        depositUnits
      )
    );

    setDepositAmount("");
  }, [callAsPromise, depositToPool, depositUnits, executePoolAction, selectedStablecoin]);

  const handleWithdraw = useCallback(async () => {
    if (!selectedStablecoin || !selectedStablecoin.tokenContract || withdrawUnits <= 0) return;

    await executePoolAction(`Withdraw ${selectedStablecoin.symbol}`, () =>
      callAsPromise(
        withdrawFromPool,
        selectedStablecoin.id,
        selectedStablecoin.tokenContract,
        withdrawUnits
      )
    );

    setWithdrawAmount("");
  }, [callAsPromise, executePoolAction, selectedStablecoin, withdrawFromPool, withdrawUnits]);

  const handleSetRewardPct = useCallback(async () => {
    if (!selectedStablecoin || rewardPct === "") return;

    const parsedPct = Number(rewardPct);
    if (!Number.isFinite(parsedPct) || parsedPct < 0 || parsedPct > 50) return;

    await executePoolAction(`Update reward bonus for ${selectedStablecoin.symbol}`, () =>
      callAsPromise(
        setLiquidationRewardPct,
        selectedStablecoin.id,
        Math.round(parsedPct * 100)
      )
    );

    setRewardPct("");
  }, [callAsPromise, executePoolAction, rewardPct, selectedStablecoin, setLiquidationRewardPct]);

  const handleClaimReward = useCallback(
    async (asset: string) => {
      if (!selectedStablecoin) return;

      await executePoolAction(`Claim ${formatAssetName(asset)} reward`, () =>
        callAsPromise(claimCollateralReward, selectedStablecoin.id, asset)
      );
    },
    [callAsPromise, claimCollateralReward, executePoolAction, selectedStablecoin]
  );

  if (!isConnected) {
    return (
      <div className="container flex flex-col items-center justify-center px-4 py-24">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <Wallet className="mx-auto h-12 w-12 text-muted-foreground" />
            <CardTitle className="mt-4">Connect Wallet</CardTitle>
            <CardDescription>
              Connect your wallet to participate in the stability pool.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Stability Pool</h1>
        <p className="text-muted-foreground">
          Deposit stablecoins to absorb bad debt and claim collateral seized during liquidations.
        </p>
      </div>

      <div className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Select Stablecoin Pool</h2>
        {stablecoinsLoading ? (
          <p className="text-sm text-muted-foreground">Loading stablecoins...</p>
        ) : linkedStablecoins.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No stablecoins with linked token contracts found. Register and link a token in the Factory first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {linkedStablecoins.map((coin) => (
              <button
                key={coin.id}
                onClick={() => setSelectedStablecoinId(coin.id)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted ${
                  selectedStablecoinId === coin.id ? "border-primary bg-primary/5" : ""
                }`}
              >
                {coin.name} ({coin.symbol})
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Pool Deposits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {poolStateLoading ? "..." : poolState ? formatTokenAmount(poolState.totalDeposits, STABLECOIN_DECIMALS) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedStablecoin ? selectedStablecoin.symbol : "Stablecoin"} deposited
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Your Deposit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {poolStateLoading ? "..." : poolState ? formatTokenAmount(poolState.userDeposit, STABLECOIN_DECIMALS) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">Effective balance after liquidations</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Your Share</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {poolStateLoading ? "..." : poolState ? `${formatNumber(poolState.userShare)}%` : "—"}
            </div>
            <p className="text-xs text-muted-foreground">Portion of current pool deposits</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Reward Bonus</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {poolStateLoading ? "..." : poolState ? `${formatNumber(poolState.liquidationRewardPct / 100)}%` : "—"}
            </div>
            <p className="text-xs text-muted-foreground">Creator-configured liquidation bonus</p>
          </CardContent>
        </Card>
      </div>

      {poolStateError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {poolStateError.message}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Manage Position</CardTitle>
            <CardDescription>Deposit into or withdraw from the selected stability pool.</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="deposit">Deposit</TabsTrigger>
                <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
              </TabsList>

              <TabsContent value="deposit" className="space-y-4 pt-4">
                <div>
                  <label className="mb-2 block text-sm font-medium">Amount to Deposit</label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={depositAmount}
                    onChange={(event) => setDepositAmount(event.target.value)}
                    disabled={!selectedStablecoin}
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Deposits transfer the stablecoin into pool custody and earn proportional liquidation rewards.
                  </p>
                </div>
                <Button
                  className="w-full"
                  onClick={handleDeposit}
                  disabled={!selectedStablecoin || depositUnits <= 0 || actionState === "submitting" || actionState === "confirming"}
                  loading={activeTab === "deposit" && (actionState === "submitting" || actionState === "confirming")}
                >
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Deposit into Pool
                </Button>
              </TabsContent>

              <TabsContent value="withdraw" className="space-y-4 pt-4">
                <div>
                  <label className="mb-2 block text-sm font-medium">Amount to Withdraw</label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={withdrawAmount}
                    onChange={(event) => setWithdrawAmount(event.target.value)}
                    disabled={!selectedStablecoin}
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Available effective balance: {poolState ? formatTokenAmount(poolState.userDeposit, STABLECOIN_DECIMALS) : "—"}
                  </p>
                  <div className="mt-2 flex gap-2">
                    {[25, 50, 100].map((pct) => (
                      <Button
                        key={pct}
                        size="sm"
                        variant="outline"
                        disabled={!poolState}
                        onClick={() =>
                          poolState &&
                          setWithdrawAmount(toHumanReadable(Math.floor((poolState.userDeposit * pct) / 100), STABLECOIN_DECIMALS).toString())
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
                  disabled={
                    !selectedStablecoin ||
                    !poolState ||
                    withdrawUnits <= 0 ||
                    withdrawUnits > poolState.userDeposit ||
                    actionState === "submitting" ||
                    actionState === "confirming"
                  }
                  loading={activeTab === "withdraw" && (actionState === "submitting" || actionState === "confirming")}
                >
                  <TrendingDown className="mr-2 h-4 w-4" />
                  Withdraw from Pool
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="h-5 w-5" />
                Claimable Collateral Rewards
              </CardTitle>
              <CardDescription>Rewards are tracked per collateral asset and update from on-chain reads.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!poolState || poolState.rewards.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No configured collateral assets found for this stablecoin pool yet.
                </p>
              ) : (
                poolState.rewards.map((reward) => (
                  <div
                    key={reward.asset}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">{formatAssetName(reward.asset)}</p>
                      <p className="text-xs text-muted-foreground">{reward.asset}</p>
                      {!reward.enabled && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          This collateral is disabled for new vault activity but rewards remain claimable.
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-medium">{formatTokenAmount(reward.claimableAmount, getCollateralDecimals(reward.asset))}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        disabled={reward.claimableAmount <= 0 || actionState === "submitting" || actionState === "confirming"}
                        onClick={() => handleClaimReward(reward.asset)}
                      >
                        Claim
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Reward Configuration
              </CardTitle>
              <CardDescription>Only the stablecoin creator can update the liquidation reward bonus.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg bg-muted/60 p-3 text-sm">
                Current reward bonus:{" "}
                <span className="font-medium">
                  {poolState ? `${formatNumber(poolState.liquidationRewardPct / 100)}%` : "—"}
                </span>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Set Reward Percentage</label>
                <Input
                  type="number"
                  min="0"
                  max="50"
                  step="0.01"
                  placeholder="e.g. 10"
                  value={rewardPct}
                  onChange={(event) => setRewardPct(event.target.value)}
                  disabled={!selectedStablecoin}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Maximum 50%. This value is stored on-chain in basis points.
                </p>
              </div>
              <Button
                className="w-full"
                onClick={handleSetRewardPct}
                disabled={
                  !selectedStablecoin ||
                  rewardPct === "" ||
                  Number(rewardPct) < 0 ||
                  Number(rewardPct) > 50 ||
                  actionState === "submitting" ||
                  actionState === "confirming"
                }
                loading={lastActionLabel?.includes("reward bonus") && (actionState === "submitting" || actionState === "confirming")}
              >
                <Settings className="mr-2 h-4 w-4" />
                Update Reward Bonus
              </Button>
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
                    {lastActionLabel} confirmed on-chain and pool data refreshed.
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
                    View transaction
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>How It Works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-muted p-4">
                <Info className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Deposits Shrink During Liquidations</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The pool offsets bad debt, so your effective deposit can decrease when liquidations are distributed.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg bg-muted p-4">
                <Info className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Rewards Accrue Per Collateral Asset</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Claimable collateral is tracked separately for each supported asset using on-chain reward-per-token accounting.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
