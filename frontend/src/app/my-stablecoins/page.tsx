"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Wallet,
  Plus,
  Coins,
  Users,
  TrendingDown,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useWallet } from "@/hooks/useWallet";
import {
  useCreatorStablecoins,
  useTokenTotalSupply,
  useTokenHolders,
  useTokenDecimals,
  useStablecoinMetrics,
  useCollateralTypes,
  Stablecoin,
  CollateralType,
} from "@/hooks/useContractRead";
import { formatAddress, formatNumber, toHumanReadable } from "@/lib/utils";
import { getCollateralSymbol } from "@/lib/constants";

function formatAssetName(asset: string) {
  // Kept for compatibility (full contract-name display); prefer
  // getCollateralSymbol(asset) for chip-style labels.
  const [, contractName] = asset.split(".");
  return contractName || asset;
}

function formatUsd(value: number | null, decimals = 2): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `$${formatNumber(value, decimals)}`;
}

function StablecoinCard({
  coin,
  priceByAsset,
}: {
  coin: Stablecoin;
  priceByAsset: Record<string, number | null>;
}) {
  const { decimals } = useTokenDecimals(coin.tokenContract);
  const { totalSupply } = useTokenTotalSupply(coin.tokenContract);
  const { holders } = useTokenHolders(coin.tokenContract);
  const { metrics, isLoading: metricsLoading } = useStablecoinMetrics(coin.id, priceByAsset);

  const supplyDecimals = decimals ?? 6;
  const supplyHuman =
    totalSupply !== null ? toHumanReadable(totalSupply, supplyDecimals) : null;
  const totalDebtHuman =
    metrics && supplyDecimals > 0
      ? toHumanReadable(metrics.totalDebt, supplyDecimals)
      : null;
  const totalRequiredCollateral = metrics?.totalRequiredCollateralUsd ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <span className="text-sm font-bold text-primary">
                {coin.symbol.charAt(0)}
              </span>
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                {coin.name}
                <span className="font-mono text-sm text-muted-foreground">
                  {coin.symbol}
                </span>
              </CardTitle>
              <CardDescription>
                ID #{coin.id} · Registered at block {coin.registeredAt}
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {coin.tokenContract ? (
              <Badge variant="success">Token linked</Badge>
            ) : (
              <Badge variant="warning">Token not deployed</Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Total Supply
              </p>
              <Coins className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-xl font-bold">
              {supplyHuman !== null ? formatNumber(supplyHuman, 2) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {coin.symbol} minted
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Holders
              </p>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-xl font-bold">
              {holders ? formatNumber(holders.total, 0) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {holders && holders.total > 0 ? "Unique addresses" : "Awaiting indexing"}
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Outstanding Debt
              </p>
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-xl font-bold">
              {totalDebtHuman !== null ? formatNumber(totalDebtHuman, 2) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {coin.symbol} debt across loans
            </p>
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Required Collateral
              </p>
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-2 text-xl font-bold">
              {totalRequiredCollateral !== null
                ? formatUsd(toHumanReadable(totalRequiredCollateral, supplyDecimals), 0)
                : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Floor at min-ratio
            </p>
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Loan exposure by collateral</p>
              <p className="text-xs text-muted-foreground">
                Aggregated debt and capacity per collateral asset. Per-borrower
                enumeration is not available on-chain.
              </p>
            </div>
          </div>

          {metricsLoading && !metrics ? (
            <div className="flex items-center gap-2 rounded-md border p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading collateral exposure…
            </div>
          ) : !metrics || metrics.perAsset.length === 0 ? (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No collaterals configured for this stablecoin yet.{" "}
              <Link
                href="/factory"
                className="text-primary underline-offset-4 hover:underline"
              >
                Configure collaterals
              </Link>
              .
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Asset</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Oracle</th>
                    <th className="px-3 py-2 font-medium">Min ratio</th>
                    <th className="px-3 py-2 font-medium">Debt</th>
                    <th className="px-3 py-2 font-medium">Utilization</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.perAsset.map((row) => {
                    const assetDebtHuman =
                      supplyDecimals > 0
                        ? toHumanReadable(row.debtOutstanding, supplyDecimals)
                        : row.debtOutstanding;
                    const debtCeilingHuman =
                      supplyDecimals > 0
                        ? toHumanReadable(row.debtCeiling, supplyDecimals)
                        : row.debtCeiling;
                    const utilClamped = Math.max(0, Math.min(row.utilization, 100));
                    return (
                      <tr key={row.asset} className="border-t">
                        <td className="px-3 py-2 font-medium">
                          {getCollateralSymbol(row.asset)}
                          <p className="font-mono text-xs text-muted-foreground">
                            {formatAddress(row.asset.split(".")[0] ?? "", 4)}
                          </p>
                        </td>
                        <td className="px-3 py-2">
                          {row.enabled ? (
                            <Badge variant="success">Enabled</Badge>
                          ) : (
                            <Badge variant="secondary">Disabled</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.oraclePrice !== null
                            ? formatUsd(row.oraclePrice, 2)
                            : "—"}
                        </td>
                        <td className="px-3 py-2">{row.minCollateralRatio}%</td>
                        <td className="px-3 py-2">
                          {formatNumber(assetDebtHuman, 2)} / {formatNumber(debtCeilingHuman, 0)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Progress value={utilClamped} className="h-2 w-24" />
                            <span className="text-xs text-muted-foreground">
                              {row.utilization.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {holders && holders.topHolders.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold">Top holders</p>
            <div className="flex flex-wrap gap-2">
              {holders.topHolders.map((h) => {
                const balanceHuman =
                  supplyDecimals > 0
                    ? toHumanReadable(Number(h.balance), supplyDecimals)
                    : Number(h.balance);
                return (
                  <Badge key={h.address} variant="secondary" className="font-mono">
                    {formatAddress(h.address, 4)} · {formatNumber(balanceHuman, 2)}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button variant="outline" size="sm" asChild>
            <Link href="/factory">
              <ShieldCheck className="mr-2 h-4 w-4" />
              Manage collaterals
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/liquidations">
              <AlertTriangle className="mr-2 h-4 w-4" />
              View liquidations
            </Link>
          </Button>
          {!coin.tokenContract && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/factory">
                <ExternalLink className="mr-2 h-4 w-4" />
                Deploy token
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MyStablecoinsPage() {
  const { isConnected, address } = useWallet();
  const [mounted, setMounted] = useState(false);

  const { stablecoins, isLoading, refetch } = useCreatorStablecoins(address ?? null);
  const { collateralTypes } = useCollateralTypes();

  const priceByAsset = useMemo(() => {
    const map: Record<string, number | null> = {};
    collateralTypes.forEach((c: CollateralType) => {
      map[c.asset] = c.oraclePrice;
    });
    return map;
  }, [collateralTypes]);

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
              Connect your Stacks wallet to view the stablecoins you have
              created.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container px-4 py-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">My Stablecoins</h1>
          <p className="text-muted-foreground">
            Supply, holders, and loan exposure for stablecoins you have issued.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refetch} disabled={isLoading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button asChild>
            <Link href="/factory">
              <Plus className="mr-2 h-4 w-4" />
              Create Stablecoin
            </Link>
          </Button>
        </div>
      </div>

      {isLoading && stablecoins.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading your stablecoins…</span>
          </CardContent>
        </Card>
      ) : stablecoins.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Coins className="h-12 w-12 text-muted-foreground" />
            <p className="mt-4 font-medium">No stablecoins yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You haven&apos;t created any stablecoins with this address.
            </p>
            <Button className="mt-4" asChild>
              <Link href="/factory">
                <Plus className="mr-2 h-4 w-4" />
                Create Your First Stablecoin
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {stablecoins.map((coin) => (
            <StablecoinCard
              key={coin.id}
              coin={coin}
              priceByAsset={priceByAsset}
            />
          ))}
        </div>
      )}
    </div>
  );
}
