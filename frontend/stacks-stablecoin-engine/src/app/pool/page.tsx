"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown, Wallet, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useWallet } from "@/hooks/useWallet";
import { useContract } from "@/hooks/useContract";
import { formatNumber } from "@/lib/utils";

export default function PoolPage() {
  const { isConnected } = useWallet();
  const { depositToPool, withdrawFromPool } = useContract();

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // TODO: Fetch from contracts
  const [poolStats, setPoolStats] = useState<{
    totalDeposits: number;
    userDeposit: number;
    userShare: number;
    pendingRewards: number;
    apy: number;
    utilizationRate: number;
  } | null>(null);

  const handleDeposit = async () => {
    if (!depositAmount) return;
    setIsLoading(true);
    try {
      await depositToPool(
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
    if (!withdrawAmount) return;
    setIsLoading(true);
    try {
      await withdrawFromPool(
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
          Deposit sUSD to earn liquidation rewards and help stabilize the protocol
        </p>
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
            <p className="text-xs text-muted-foreground">sUSD</p>
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
                      sUSD
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
                  disabled={!depositAmount || parseFloat(depositAmount) <= 0}
                  loading={isLoading}
                >
                  <TrendingUp className="mr-2 h-4 w-4" />
                  Deposit sUSD
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
                      sUSD
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Available: {poolStats ? formatNumber(poolStats.userDeposit) : "—"} sUSD
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
                  disabled={!withdrawAmount || parseFloat(withdrawAmount) <= 0}
                  loading={isLoading}
                >
                  <TrendingDown className="mr-2 h-4 w-4" />
                  Withdraw sUSD
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Pool Info Card */}
        <Card>
          <CardHeader>
            <CardTitle>Pool Information</CardTitle>
            <CardDescription>How the stability pool works</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span>Pool Utilization</span>
                <span className="font-medium">{poolStats ? `${poolStats.utilizationRate}%` : "—"}</span>
              </div>
              <Progress value={poolStats?.utilizationRate ?? 0} className="h-2" />
            </div>

            <div className="space-y-4">
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
                    Withdraw your funds at any time. There are no minimum 
                    deposit requirements or lock-up periods.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg bg-muted p-4">
                <Info className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Protocol Stability</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your deposits help maintain protocol health by providing 
                    liquidity for liquidations.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
