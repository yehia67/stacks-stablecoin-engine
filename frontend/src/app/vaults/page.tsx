"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, Wallet, Loader2, RefreshCw, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/hooks/useWallet";
import { useUserVaults, UserVault, CollateralPosition } from "@/hooks/useContractRead";
import { formatTokenAmount } from "@/lib/utils";
import { STABLECOIN_DECIMALS, getCollateralDecimals } from "@/lib/constants";

const ZERO_DEBT_SENTINEL = 1000000;

function getPositionStatus(hf: number, debtShare: number): "healthy" | "warning" | "danger" | "no-debt" {
  if (debtShare === 0) return "no-debt";
  if (hf >= ZERO_DEBT_SENTINEL) return "no-debt";
  if (hf >= 200) return "healthy";
  if (hf >= 150) return "warning";
  return "danger";
}

function getVaultOverallStatus(vault: UserVault): "healthy" | "warning" | "danger" | "no-debt" {
  if (vault.positions.length === 0) return "no-debt";
  const statuses = vault.positions.map((p) => getPositionStatus(p.healthFactor, p.debtShare));
  if (statuses.includes("danger")) return "danger";
  if (statuses.includes("warning")) return "warning";
  if (statuses.every((s) => s === "no-debt")) return "no-debt";
  return "healthy";
}

function formatAssetName(asset: string) {
  const [, contractName] = asset.split(".");
  return contractName || asset;
}

export default function VaultsPage() {
  const { isConnected, address } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { vaults, isLoading, refetch } = useUserVaults(address ?? null);

  useEffect(() => {
    setMounted(true);
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
              Connect your Stacks wallet to view and manage your vaults.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const filteredVaults = vaults.filter(
    (vault) =>
      vault.stablecoinName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vault.stablecoinSymbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vault.stablecoinId.toString().includes(searchQuery)
  );

  const healthyVaults = filteredVaults.filter((v) => getVaultOverallStatus(v) === "healthy");
  const warningVaults = filteredVaults.filter((v) => getVaultOverallStatus(v) === "warning");
  const dangerVaults = filteredVaults.filter((v) => getVaultOverallStatus(v) === "danger");

  return (
    <div className="container px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Vaults</h1>
          <p className="text-muted-foreground">
            Manage your collateralized debt positions
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button asChild>
            <Link href="/vaults/new">
              <Plus className="mr-2 h-4 w-4" />
              Open New Vault
            </Link>
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by stablecoin name, symbol, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">Loading vaults from chain...</span>
        </div>
      ) : (
        <Tabs defaultValue="all" className="space-y-6">
          <TabsList>
            <TabsTrigger value="all">
              All ({filteredVaults.length})
            </TabsTrigger>
            <TabsTrigger value="healthy">
              Healthy ({healthyVaults.length})
            </TabsTrigger>
            <TabsTrigger value="warning">
              Warning ({warningVaults.length})
            </TabsTrigger>
            <TabsTrigger value="danger">
              At Risk ({dangerVaults.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all">
            <VaultList vaults={filteredVaults} />
          </TabsContent>
          <TabsContent value="healthy">
            <VaultList vaults={healthyVaults} />
          </TabsContent>
          <TabsContent value="warning">
            <VaultList vaults={warningVaults} />
          </TabsContent>
          <TabsContent value="danger">
            <VaultList vaults={dangerVaults} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function VaultList({ vaults }: { vaults: UserVault[] }) {
  if (vaults.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Wallet className="h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">No vaults found</p>
          <Button className="mt-4" asChild>
            <Link href="/vaults/new">Open Your First Vault</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {vaults.map((vault) => {
        const status = getVaultOverallStatus(vault);
        return (
          <Card key={vault.stablecoinId} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <Coins className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{vault.stablecoinName}</CardTitle>
                    <CardDescription>{vault.stablecoinSymbol} · ID {vault.stablecoinId}</CardDescription>
                  </div>
                </div>
                <Badge
                  variant={
                    status === "healthy" ? "default" :
                    status === "warning" ? "secondary" :
                    status === "danger" ? "destructive" : "outline"
                  }
                >
                  {status === "no-debt" ? "No debt" : status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Debt</span>
                  <span className="font-medium">{formatTokenAmount(vault.totalDebt, STABLECOIN_DECIMALS)} {vault.stablecoinSymbol}</span>
                </div>
              </div>

              {vault.positions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Collateral Positions</p>
                  {vault.positions.map((pos) => {
                    const posStatus = getPositionStatus(pos.healthFactor, pos.debtShare);
                    return (
                      <div key={pos.asset} className="flex items-center justify-between rounded-lg bg-muted/50 p-2 text-sm">
                        <div>
                          <p className="font-medium">{formatAssetName(pos.asset)}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatTokenAmount(pos.amount, getCollateralDecimals(pos.asset))} deposited · {formatTokenAmount(pos.debtShare, STABLECOIN_DECIMALS)} debt
                          </p>
                        </div>
                        <span className={`text-xs font-medium ${
                          posStatus === "healthy" ? "text-green-500" :
                          posStatus === "warning" ? "text-yellow-500" :
                          posStatus === "danger" ? "text-red-500" : "text-muted-foreground"
                        }`}>
                          {posStatus === "no-debt" ? "-" : `${pos.healthFactor}%`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-2">
                <Button size="sm" className="flex-1" asChild>
                  <Link href={`/vaults/${vault.stablecoinId}`}>Manage</Link>
                </Button>
                <Button variant="outline" size="sm" className="flex-1" asChild>
                  <Link href={`/vaults/new?stablecoinId=${vault.stablecoinId}`}>Add / Mint</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
