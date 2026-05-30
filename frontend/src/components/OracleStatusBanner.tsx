"use client";

import { RefreshCw, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAge } from "@/lib/utils";
import { ORACLE_MAX_STALENESS_SECONDS } from "@/lib/constants";
import type { OracleState } from "@/hooks/useContractRead";

interface OracleStatusBannerProps {
  state: OracleState;
  symbol: string;
  ageSeconds: number | null;
  isValidating: boolean;
  onRefresh: () => void;
}

const thresholdMinutes = Math.round(ORACLE_MAX_STALENESS_SECONDS / 60);

export function OracleStatusBanner({
  state,
  symbol,
  ageSeconds,
  isValidating,
  onRefresh,
}: OracleStatusBannerProps) {
  const ageText = ageSeconds != null ? formatAge(ageSeconds) : null;

  if (state === "loading") {
    return (
      <p className="text-sm text-muted-foreground">Checking {symbol} oracle status…</p>
    );
  }

  if (state === "live") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-green-600">
        <CheckCircle className="h-3.5 w-3.5" />
        {symbol} price live{ageText ? ` · updated ${ageText} ago` : ""}
      </p>
    );
  }

  const isStale = state === "stale";
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-md border p-3 ${
        isStale
          ? "border-yellow-500/40 bg-yellow-500/10"
          : "border-red-500/40 bg-red-500/10"
      }`}
    >
      <div className="space-y-1">
        <div
          className={`flex items-center gap-1.5 text-sm font-medium ${
            isStale ? "text-yellow-600" : "text-red-600"
          }`}
        >
          {isStale ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          {isStale ? `${symbol} price is stale` : `${symbol} price unavailable`}
        </div>
        <p className="text-xs text-muted-foreground">
          {isStale
            ? `Last update ${ageText ?? "unknown"} ago (must be < ${thresholdMinutes}m). Minting is paused until the oracle refreshes.`
            : "The price feed is not responding. Minting is paused until it recovers."}
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onRefresh}
        disabled={isValidating}
        className="shrink-0"
      >
        <RefreshCw className={`mr-1 h-3 w-3 ${isValidating ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </div>
  );
}
