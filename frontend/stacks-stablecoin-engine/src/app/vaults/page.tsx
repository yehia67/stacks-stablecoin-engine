"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search, Filter, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "@/hooks/useWallet";
import { formatSTX, getHealthFactorColor } from "@/lib/utils";

interface Vault {
  id: number;
  collateralType: string;
  collateralAmount: number;
  debtAmount: number;
  healthFactor: number;
  status: "healthy" | "warning" | "danger";
}

export default function VaultsPage() {
  const { isConnected } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // TODO: Fetch vaults from contract
  const [vaults, setVaults] = useState<Vault[]>([]);

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
      vault.collateralType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vault.id.toString().includes(searchQuery)
  );

  const healthyVaults = filteredVaults.filter((v) => v.status === "healthy");
  const warningVaults = filteredVaults.filter((v) => v.status === "warning");
  const dangerVaults = filteredVaults.filter((v) => v.status === "danger");

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
        <Button asChild>
          <Link href="/vaults/new">
            <Plus className="mr-2 h-4 w-4" />
            Open New Vault
          </Link>
        </Button>
      </div>

      {/* Search and Filter */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by vault ID or collateral type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline">
          <Filter className="mr-2 h-4 w-4" />
          Filter
        </Button>
      </div>

      {/* Vault Tabs */}
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
    </div>
  );
}

function VaultList({ vaults }: { vaults: Vault[] }) {
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
      {vaults.map((vault) => (
        <Card key={vault.id} className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <span className="text-sm font-bold text-primary">
                    {vault.collateralType.charAt(0)}
                  </span>
                </div>
                <div>
                  <CardTitle className="text-lg">Vault #{vault.id}</CardTitle>
                  <CardDescription>{vault.collateralType}</CardDescription>
                </div>
              </div>
              <Badge
                variant={
                  vault.status === "healthy" ? "success" :
                  vault.status === "warning" ? "warning" : "destructive"
                }
              >
                {vault.healthFactor}%
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
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
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" asChild>
                <Link href={`/vaults/${vault.id}`}>Manage</Link>
              </Button>
              <Button variant="outline" size="sm" className="flex-1">
                Repay
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
