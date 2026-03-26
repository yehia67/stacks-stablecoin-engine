"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  Plus, 
  ArrowUpRight,
  AlertTriangle,
  CheckCircle,
  Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useWallet } from "@/hooks/useWallet";
import { formatNumber, formatSTX, getHealthFactorColor, getHealthFactorStatus } from "@/lib/utils";

interface VaultData {
  id: number;
  collateralType: string;
  collateralAmount: number;
  debtAmount: number;
  healthFactor: number;
}

interface ProtocolStats {
  tvl: number;
  totalDebt: number;
  activeVaults: number;
  collateralRatio: number;
}

export default function DashboardPage() {
  const { isConnected, address } = useWallet();
  const [mounted, setMounted] = useState(false);
  
  // TODO: Fetch from contracts
  const [userVaults, setUserVaults] = useState<VaultData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [protocolStats, setProtocolStats] = useState<ProtocolStats | null>(null);

  const [userStats, setUserStats] = useState<{
    totalCollateral: number;
    totalDebt: number;
    availableToBorrow: number;
    healthFactor: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
    // TODO: Fetch data from contracts here
    setIsLoading(false);
  }, []);

  if (!mounted) return null;

  if (!isConnected) {
    return (
      <div className="container flex flex-col items-center justify-center px-4 py-24">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Wallet className="mx-auto h-12 w-12 text-muted-foreground" />
            <CardTitle className="mt-4">Connect Your Wallet</CardTitle>
            <CardDescription>
              Connect your Stacks wallet to view your dashboard and manage your vaults.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your positions and protocol stats
          </p>
        </div>
        <Button asChild>
          <Link href="/vaults/new">
            <Plus className="mr-2 h-4 w-4" />
            Open New Vault
          </Link>
        </Button>
      </div>

      {/* Protocol Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Value Locked
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {protocolStats ? `$${formatNumber(protocolStats.tvl, 0)}` : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              Protocol TVL
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Debt
            </CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {protocolStats ? `$${formatNumber(protocolStats.totalDebt, 0)}` : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              Across all stablecoins
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Active Vaults
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {protocolStats ? formatNumber(protocolStats.activeVaults, 0) : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              Total vaults
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Collateral Ratio
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {protocolStats ? `${protocolStats.collateralRatio}%` : "—"}
            </div>
            <p className="text-xs text-muted-foreground">
              Protocol health
            </p>
          </CardContent>
        </Card>
      </div>

      {/* User Position Summary */}
      <div className="mb-8 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Your Position Summary</CardTitle>
            <CardDescription>Overview of your collateral and debt</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Total Collateral</p>
                <p className="text-2xl font-bold">{userStats ? `$${formatNumber(userStats.totalCollateral)}` : "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Debt</p>
                <p className="text-2xl font-bold">{userStats ? `$${formatNumber(userStats.totalDebt)}` : "—"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Available to Borrow</p>
                <p className="text-2xl font-bold text-success">{userStats ? `$${formatNumber(userStats.availableToBorrow)}` : "—"}</p>
              </div>
            </div>
            {userStats && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Health Factor</span>
                  <span className={`font-semibold ${getHealthFactorColor(userStats.healthFactor)}`}>
                    {userStats.healthFactor}% - {getHealthFactorStatus(userStats.healthFactor)}
                  </span>
                </div>
                <Progress 
                  value={Math.min(userStats.healthFactor, 100)} 
                  className="h-2"
                  indicatorClassName={
                    userStats.healthFactor >= 200 ? "bg-green-500" :
                    userStats.healthFactor >= 150 ? "bg-yellow-500" : "bg-red-500"
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common operations</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <Button variant="outline" className="justify-start" asChild>
              <Link href="/vaults/new">
                <Plus className="mr-2 h-4 w-4" />
                Open New Vault
              </Link>
            </Button>
            <Button variant="outline" className="justify-start" asChild>
              <Link href="/factory">
                <ArrowUpRight className="mr-2 h-4 w-4" />
                Create Stablecoin
              </Link>
            </Button>
            <Button variant="outline" className="justify-start" asChild>
              <Link href="/pool">
                <TrendingUp className="mr-2 h-4 w-4" />
                Deposit to Pool
              </Link>
            </Button>
            <Button variant="outline" className="justify-start" asChild>
              <Link href="/liquidations">
                <AlertTriangle className="mr-2 h-4 w-4" />
                View Liquidations
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* User Vaults */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Your Vaults</CardTitle>
            <CardDescription>Manage your active vault positions</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/vaults">View All</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {userVaults.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Wallet className="h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">No vaults yet</p>
              <Button className="mt-4" asChild>
                <Link href="/vaults/new">Open Your First Vault</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {userVaults.map((vault) => (
                <div
                  key={vault.id}
                  className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <span className="text-sm font-bold text-primary">
                        {vault.collateralType.charAt(0)}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium">Vault #{vault.id}</p>
                      <p className="text-sm text-muted-foreground">
                        {vault.collateralType} Collateral
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm sm:gap-8">
                    <div>
                      <p className="text-muted-foreground">Collateral</p>
                      <p className="font-medium">{formatSTX(vault.collateralAmount)} {vault.collateralType}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Debt</p>
                      <p className="font-medium">{formatSTX(vault.debtAmount)} sUSD</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Health</p>
                      <Badge
                        variant={
                          vault.healthFactor >= 200 ? "success" :
                          vault.healthFactor >= 150 ? "warning" : "destructive"
                        }
                      >
                        {vault.healthFactor}%
                      </Badge>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/vaults/${vault.id}`}>Manage</Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
