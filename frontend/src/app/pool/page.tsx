"use client";

import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown, Wallet, Info, Gift, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useWallet } from "@/hooks/useWallet";
import { useContract } from "@/hooks/useContract";
import { useRegisteredStablecoins } from "@/hooks/useContractRead";
import { formatNumber } from "@/lib/utils";

export default function PoolPage() {
  const { isConnected } = useWallet();
  const { depositToPool, withdrawFromPool, setLiquidationRewardPct, claimCollateralReward } = useContract();
  const { stablecoins, isLoading: stablecoinsLoading } = useRegisteredStablecoins();

  const [selectedStablecoinId, setSelectedStablecoinId] = useState<number | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [rewardPct, setRewardPct] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Only show stablecoins that have a linked token contract
  const linkedStablecoins = useMemo(
    () => stablecoins.filter((coin) => coin.tokenContract !== null),
    [stablecoins]
  );

  const selectedStablecoin = linkedStablecoins.find((coin) => coin.id === selectedStablecoinId) ?? null;

  // TODO: Fetch from contracts using balance-of-for-stablecoin / get-total-deposits
  const [poolStats, setPoolStats] = useState<{
    totalDeposits: number;
    userDeposit: number;
    userShare: number;
    pendingRewards: number;
    apy: number;
    utilizationRate: number;
  } | null>(null);

  const handleDeposit = async () => {
    if (!depositAmount || !selectedStablecoin || !selectedStablecoin.tokenContract) return;
    setIsLoading(true);
    try {
      await depositToPool(
        selectedStablecoin.id,
        selectedStablecoin.tokenContract,
        parseFloat(depositAmount) * 1000000,
        (txId) => {
          console.log("Deposit successful:", txId);
          setDepositAmount("");
          setIsLoading(false);
        },
        (error) => {
          console.error("Deposit failed:", error);
          setIsLoading(false);
        }
      );
    } catch (error) {
      console.error(error);
      setIsLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawAmount || !selectedStablecoin || !selectedStablecoin.tokenContract) return;
    setIsLoading(true);
    try {
      await withdrawFromPool(
        selectedStablecoin.id,
        selectedStablecoin.tokenContract,
        parseFloat(withdrawAmount) * 1000000,
        (txId) => {
          console.log("Withdrawal successful:", txId);
          setWithdrawAmount("");
          setIsLoading(false);
        },
        (error) => {
          console.error("Withdrawal failed:", error);
          setIsLoading(false);
        }
      );
    } catch (error) {
      console.error(error);
      setIsLoading(false);
    }
  };

  const handleSetRewardPct = async () => {
    if (!rewardPct || !selectedStablecoin) return;
    setIsLoading(true);
    try {
      const basisPoints = Math.round(parseFloat(rewardPct) * 100);
      await setLiquidationRewardPct(
        selectedStablecoin.id,
        basisPoints,
        (txId) => {
          console.log("Reward pct set:", txId);
          setRewardPct("");
          setIsLoading(false);
        },
        (error) => {
          console.error("Set reward pct failed:", error);
          setIsLoading(false);
        }
      );
    } catch (error) {
      console.error(error);
      setIsLoading(false);
    }
  };

  const handleClaimReward = async (assetPrincipal: string) => {
    if (!selectedStablecoin) return;
    setIsLoading(true);
    try {
      await claimCollateralReward(
        selectedStablecoin.id,
        assetPrincipal,
        (txId) => {
          console.log("Reward claimed:", txId);
          setIsLoading(false);
        },
        (error) => {
          console.error("Claim failed:", error);
          setIsLoading(false);
        }
      );
    } catch (error) {
      console.error(error);
      setIsLoading(false);
    }
  };

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
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Stability Pool</h1>
        <p className="text-muted-foreground">
          Deposit stablecoins to earn liquidation rewards and help stabilize the protocol
        </p>
      </div>

      {/* Stablecoin Selection */}
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

      {/* Pool Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Pool Deposits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {poolStats ? `$${formatNumber(poolStats.totalDeposits)}` : "—"}
            </div>
            <p className="text-xs text-muted-foreground">stablecoins</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Current APY
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-green-500">
                {poolStats ? `${poolStats.apy}%` : "—"}
              </span>
              <TrendingUp className="h-5 w-5 text-green-500" />
            </div>
            <p className="text-xs text-muted-foreground">From liquidations</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Your Deposit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {poolStats ? `$${formatNumber(poolStats.userDeposit)}` : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              {poolStats ? `${poolStats.userShare}% of pool` : "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Rewards
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {poolStats ? `$${formatNumber(poolStats.pendingRewards)}` : "—"}
            </div>
            <p className="text-xs text-muted-foreground">Claimable now</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Deposit/Withdraw Card */}
        <Card>
          <CardHeader>
            <CardTitle>Manage Position</CardTitle>
            <CardDescription>Deposit or withdraw from the stability pool</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="deposit">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="deposit">Deposit</TabsTrigger>
                <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
              </TabsList>

              <TabsContent value="deposit" className="space-y-4 pt-4">
                <div>
                  <label className="mb-2 block text-sm font-medium">
                    Amount to Deposit
                  </label>
                  <div className="relative">
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      className="pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      stablecoins
                    </span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    {[25, 50, 75, 100].map((pct) => (
                      <Button
                        key={pct}
                        variant="outline"
                        size="sm"
                        onClick={() => setDepositAmount((10000 * pct / 100).toString())}
                      >
                        {pct}%
                      </Button>
                    ))}
                  </div>
                </div>
                <Button
                  className="w-full"
                  onClick={handleDeposit}
                  disabled={!selectedStablecoin || !depositAmount || parseFloat(depositAmount) <= 0}
                  loading={isLoading}
                >
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Deposit stablecoins
                </Button>
              </TabsContent>

              <TabsContent value="withdraw" className="space-y-4 pt-4">
                <div>
                  <label className="mb-2 block text-sm font-medium">
                    Amount to Withdraw
                  </label>
                  <div className="relative">
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      className="pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      stablecoins
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Available: {poolStats ? formatNumber(poolStats.userDeposit) : "—"} stablecoins
                  </p>
                  <div className="mt-2 flex gap-2">
                    {[25, 50, 75, 100].map((pct) => (
                      <Button
                        key={pct}
                        variant="outline"
                        size="sm"
                        onClick={() => poolStats && setWithdrawAmount((poolStats.userDeposit * pct / 100).toString())}
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
                  disabled={!selectedStablecoin || !withdrawAmount || parseFloat(withdrawAmount) <= 0}
                  loading={isLoading}
                >
                  <TrendingDown className="mr-2 h-4 w-4" />
                  Withdraw stablecoins
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Rewards & Settings Card */}
        <div className="space-y-6">
          {/* Claim Rewards */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="h-5 w-5" />
                Collateral Rewards
              </CardTitle>
              <CardDescription>Claim collateral earned from liquidations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                When vaults are liquidated, your pool deposit absorbs bad debt and you receive
                the seized collateral (including the liquidation reward bonus) proportionally.
              </p>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => handleClaimReward(`${process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS}.sbtc-token-v3`)}
                disabled={!selectedStablecoin || isLoading}
              >
                <Gift className="mr-2 h-4 w-4" />
                Claim sBTC Rewards
              </Button>
            </CardContent>
          </Card>

          {/* Reward Config (Creator Only) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Reward Configuration
              </CardTitle>
              <CardDescription>Set liquidation reward percentage (stablecoin creator only)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Reward Percentage
                </label>
                <div className="relative">
                  <Input
                    type="number"
                    placeholder="e.g. 10 for 10%"
                    value={rewardPct}
                    onChange={(e) => setRewardPct(e.target.value)}
                    className="pr-8"
                    min="0"
                    max="50"
                    step="0.01"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    %
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Max 50%. This is the bonus collateral depositors receive on liquidations.
                </p>
              </div>
              <Button
                className="w-full"
                onClick={handleSetRewardPct}
                disabled={!selectedStablecoin || !rewardPct || parseFloat(rewardPct) < 0 || parseFloat(rewardPct) > 50}
                loading={isLoading}
              >
                <Settings className="mr-2 h-4 w-4" />
                Set Reward %
              </Button>
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card>
            <CardHeader>
              <CardTitle>How It Works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg bg-muted p-4">
                <Info className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Earn Liquidation Rewards</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    When vaults are liquidated, stability pool depositors receive 
                    the liquidated collateral at a discount.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg bg-muted p-4">
                <Info className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">No Lock-up Period</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Withdraw your funds at any time. No minimum deposit or lock-up.
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
