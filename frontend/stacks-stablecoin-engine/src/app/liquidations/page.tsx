"use client";

import { useState } from "react";
import { AlertTriangle, Search, Wallet, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/hooks/useWallet";
import { useContract } from "@/hooks/useContract";
import { formatNumber, formatSTX, formatAddress } from "@/lib/utils";

interface LiquidatableVault {
  id: number;
  owner: string;
  collateralType: string;
  collateralAmount: number;
  debtAmount: number;
  healthFactor: number;
  liquidationBonus: number;
}

export default function LiquidationsPage() {
  const { isConnected } = useWallet();
  const { liquidate } = useContract();

  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState<number | null>(null);

  // TODO: Fetch from contracts
  const [liquidatableVaults] = useState<LiquidatableVault[]>([]);

  const stats = {
    totalLiquidatable: liquidatableVaults.length,
    totalCollateralAtRisk: liquidatableVaults.reduce((sum, v) => sum + v.collateralAmount, 0),
    totalDebtAtRisk: liquidatableVaults.reduce((sum, v) => sum + v.debtAmount, 0),
    avgBonus: liquidatableVaults.length > 0 
      ? liquidatableVaults.reduce((sum, v) => sum + v.liquidationBonus, 0) / liquidatableVaults.length 
      : 0,
  };

  const handleLiquidate = async (vault: LiquidatableVault) => {
    setIsLoading(vault.id);
    try {
      await liquidate(
        vault.owner,
        (txId) => {
          console.log("Liquidation successful:", txId);
          setIsLoading(null);
        },
        (error) => {
          console.error("Liquidation failed:", error);
          setIsLoading(null);
        }
      );
    } catch (error) {
      console.error(error);
      setIsLoading(null);
    }
  };

  const filteredVaults = liquidatableVaults.filter(
    (vault) =>
      vault.owner.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vault.collateralType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vault.id.toString().includes(searchQuery)
  );

  if (!isConnected) {
    return (
      <div className="container flex flex-col items-center justify-center px-4 py-24">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <Wallet className="mx-auto h-12 w-12 text-muted-foreground" />
            <CardTitle className="mt-4">Connect Wallet</CardTitle>
            <CardDescription>
              Connect your wallet to view and execute liquidations.
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
        <h1 className="text-3xl font-bold">Liquidations</h1>
        <p className="text-muted-foreground">
          Monitor and liquidate undercollateralized vaults to earn rewards
        </p>
      </div>

      {/* Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Liquidatable Vaults
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <span className="text-2xl font-bold">{stats.totalLiquidatable}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Collateral at Risk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${formatNumber(stats.totalCollateralAtRisk / 1000000 * 0.5)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Debt at Risk
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${formatNumber(stats.totalDebtAtRisk / 1000000)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Liquidation Bonus
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {stats.avgBonus}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by vault ID, owner, or collateral type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Liquidatable Vaults */}
      <Card>
        <CardHeader>
          <CardTitle>Liquidatable Vaults</CardTitle>
          <CardDescription>
            Vaults below the minimum collateral ratio that can be liquidated
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredVaults.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertTriangle className="h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-lg font-medium">No Liquidatable Vaults</p>
              <p className="mt-2 text-muted-foreground">
                All vaults are currently healthy. Check back later.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredVaults.map((vault) => (
                <div
                  key={vault.id}
                  className="flex flex-col gap-4 rounded-lg border border-destructive/50 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
                      <AlertTriangle className="h-6 w-6 text-destructive" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">Vault #{vault.id}</p>
                        <Badge variant="destructive">{vault.healthFactor}%</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Owner: {formatAddress(vault.owner)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4 text-sm sm:gap-8">
                    <div>
                      <p className="text-muted-foreground">Collateral</p>
                      <p className="font-medium">
                        {formatSTX(vault.collateralAmount)} {vault.collateralType}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Debt</p>
                      <p className="font-medium">{formatSTX(vault.debtAmount)} sUSD</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Bonus</p>
                      <p className="font-medium text-green-500">+{vault.liquidationBonus}%</p>
                    </div>
                  </div>

                  <Button
                    variant="destructive"
                    onClick={() => handleLiquidate(vault)}
                    disabled={isLoading === vault.id}
                    loading={isLoading === vault.id}
                  >
                    <Zap className="mr-2 h-4 w-4" />
                    Liquidate
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Section */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>How Liquidations Work</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <h3 className="font-semibold">1. Monitor Vaults</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Watch for vaults that fall below the minimum collateral ratio 
                (typically 120-150% depending on collateral type).
              </p>
            </div>
            <div>
              <h3 className="font-semibold">2. Execute Liquidation</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Repay the vault's debt using sUSD from the stability pool or 
                your own balance to claim the collateral.
              </p>
            </div>
            <div>
              <h3 className="font-semibold">3. Earn Rewards</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Receive the collateral at a discount (liquidation bonus) as a 
                reward for helping maintain protocol health.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
