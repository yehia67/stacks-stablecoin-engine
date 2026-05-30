# Oracle Staleness UX & Wallet Balance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make oracle staleness visible and explained on vault pages (banner + freshness + blocked-mint reason), and show the user's wallet balance for the selected collateral in the deposit form (with Max + insufficient-balance warning).

**Architecture:** Two new SWR-cached read hooks (`useOracleStatus`, `useTokenBalance`) in `useContractRead.ts`, a presentational `<OracleStatusBanner>`, and integration into `vaults/new` + `vaults/[stablecoinId]`. Oracle state derives from the on-chain `get-price` result; freshness age comes from the DIA adapter timestamp; the staleness threshold is a hardcoded constant.

**Tech Stack:** Next.js (App Router), React, TypeScript, `@stacks/transactions` (Clarity hex decode), Stacks call-read API via the existing `/api/stacks` proxy.

**Verification note:** This repo has **no test runner** (no jest/vitest/RTL, zero test files). Adding one is out of scope. Each task is verified with the real project loop: `npx tsc --noEmit`, `npm run lint`, `npm run build`, plus a stated manual browser check. Run all commands from `frontend/`.

---

## File Structure

- `frontend/src/lib/constants.ts` — **modify**: add staleness/cache constants, DIA pair map, constant-oracle set.
- `frontend/src/lib/utils.ts` — **modify**: add `formatAge(seconds)`.
- `frontend/src/hooks/useContractRead.ts` — **modify**: add module-level `callReadOnlyAt`, `useOracleStatus` (+ cache + `OracleState` type), `useTokenBalance` (+ cache).
- `frontend/src/components/OracleStatusBanner.tsx` — **create**: presentational banner.
- `frontend/src/app/vaults/new/page.tsx` — **modify**: banner + mint gate + balance line + Max + insufficient warning.
- `frontend/src/app/vaults/[stablecoinId]/page.tsx` — **modify**: banner + mint gate for the selected collateral.

---

## Task 1: Constants

**Files:**
- Modify: `frontend/src/lib/constants.ts`

- [ ] **Step 1: Add constants**

Append near the other exported constants (e.g. just after `STABLECOIN_DECIMALS`):

```ts
// --- Oracle staleness UX -------------------------------------------------
// Hardcoded UI staleness threshold. Matches the DIA oracles' on-chain default
// max-staleness (3600s); we intentionally do NOT read get-max-staleness on-chain.
export const ORACLE_MAX_STALENESS_SECONDS = 3600; // 60 min
// How long a cached oracle status is served before a background revalidation.
export const ORACLE_CACHE_TTL_SECONDS = 60;
// How long a cached token balance is served before a background revalidation.
export const TOKEN_BALANCE_CACHE_TTL_SECONDS = 30;

// Price-oracle contract name -> DIA adapter pair, used to read the price
// timestamp for "updated Xm ago". Oracles absent here have no DIA timestamp.
export const ORACLE_DIA_PAIRS: Record<string, string> = {
  "price-oracle-dia-btc-v2": "BTC/USD",
  "price-oracle-dia-stx-v2": "STX/USD",
};

// Oracle contract names that are constant / always-fresh feeds (no staleness).
export const CONSTANT_ORACLE_NAMES = new Set<string>(["price-oracle-vgld-v1"]);
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/constants.ts
git commit -m "feat: add oracle staleness + cache constants"
```

---

## Task 2: `formatAge` util

**Files:**
- Modify: `frontend/src/lib/utils.ts`

- [ ] **Step 1: Add helper**

Append to `frontend/src/lib/utils.ts`:

```ts
/**
 * Human-friendly elapsed-time label for oracle freshness.
 * 45 -> "45s", 78*60 -> "1h 18m", 600 -> "10m".
 */
export function formatAge(seconds: number): string {
  const s = seconds < 0 ? 0 : Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins ? `${hrs}h ${remMins}m` : `${hrs}h`;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/utils.ts
git commit -m "feat: add formatAge util for oracle freshness"
```

---

## Task 3: Generalized arbitrary-principal read helper

**Files:**
- Modify: `frontend/src/hooks/useContractRead.ts`

Context: the existing module-level `readContract` hardcodes the address to
`CONTRACTS.DEPLOYER`, so it cannot read oracle/token contracts deployed under a
different principal. Add a sibling that accepts a full principal.

- [ ] **Step 1: Add `callReadOnlyAt` next to `readContract`**

Place immediately after the `readContract` function (around line 894):

```ts
/**
 * Read-only call against an ARBITRARY contract principal (vs `readContract`,
 * which is pinned to CONTRACTS.DEPLOYER). Accepts either a full principal
 * ("SP….contract-name") or a bare contract name (assumed under DEPLOYER).
 * Returns the raw Clarity result hex, or null on any failure.
 */
async function callReadOnlyAt(
  principal: string,
  functionName: string,
  args: string[]
): Promise<string | null> {
  const [addr, name] = principal.includes(".")
    ? [principal.split(".")[0], principal.split(".").slice(1).join(".")]
    : [CONTRACTS.DEPLOYER, principal];
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (API_KEY) headers["x-api-key"] = API_KEY;
    const resp = await fetch(
      `${API_BASE}/v2/contracts/call-read/${addr}/${name}/${functionName}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ sender: CONTRACTS.DEPLOYER, arguments: args }),
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.okay) return null;
    return data.result as string;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS (function is currently unused — that's fine; next task uses it).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useContractRead.ts
git commit -m "feat: add arbitrary-principal read-only helper"
```

---

## Task 4: `useOracleStatus` hook

**Files:**
- Modify: `frontend/src/hooks/useContractRead.ts`

Imports: ensure `stringAsciiCV` is imported from `@stacks/transactions` (it is
already imported in this file — confirm; if not, add it). Also ensure
`ORACLE_MAX_STALENESS_SECONDS`, `ORACLE_CACHE_TTL_SECONDS`, `ORACLE_DIA_PAIRS`,
`CONSTANT_ORACLE_NAMES`, and `CONTRACTS` are imported from `@/lib/constants`.

- [ ] **Step 1: Add the hook, its cache, and helpers**

Add near the other oracle code (after `useDiaOraclePrices`). `parseOkUint` and
`hexToCV`/`cvToValue` are already available in this module.

```ts
export type OracleState = "loading" | "live" | "stale" | "unavailable";

export interface OracleStatus {
  state: OracleState;
  priceUsd: number | null;
  ageSeconds: number | null;
  isValidating: boolean;
  refetch: () => Promise<void>;
}

interface OracleStatusCacheEntry {
  state: OracleState;
  priceUsd: number | null;
  ageSeconds: number | null;
  fetchedAt: number; // ms epoch
}

// SWR cache keyed by oracle principal. Survives in-session navigation; cleared
// on full reload. BTC barely moves, so a 60s TTL avoids redundant reads.
const oracleStatusCache = new Map<string, OracleStatusCacheEntry>();

function oracleContractName(principal: string): string {
  return principal.includes(".") ? principal.split(".").slice(1).join(".") : principal;
}

// Classify a get-price (response uint uint) result hex.
function classifyGetPrice(hex: string | null): { ok: boolean; price?: number; errCode?: number } {
  if (!hex) return { ok: false };
  // 0x07 = (ok ...), 0x08 = (err ...) — established hex-prefix convention in this file.
  if (hex.startsWith("0x07")) {
    const price = parseOkUint(hex);
    return { ok: true, price: price ?? undefined };
  }
  if (hex.startsWith("0x08")) {
    try {
      const parsed = cvToValue(hexToCV(hex)) as any;
      const inner = parsed?.value;
      const code =
        typeof inner === "bigint" ? Number(inner)
        : typeof inner === "number" ? inner
        : inner && typeof inner === "object" && inner.value !== undefined ? Number(inner.value)
        : NaN;
      return { ok: false, errCode: Number.isNaN(code) ? undefined : code };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

// Read the DIA adapter timestamp (ms) for a pair; returns age in seconds or null.
async function fetchOracleAgeSeconds(pair: string): Promise<number | null> {
  const adapterPrincipal = getContractId(CONTRACTS.DIA_ORACLE_ADAPTER);
  const hex = await callReadOnlyAt(adapterPrincipal, "get-value", [
    cvToHex(stringAsciiCV(pair)),
  ]);
  if (!hex || hex.startsWith("0x09") /* none */) return null;
  try {
    const parsed = cvToValue(hexToCV(hex)) as any;
    // (ok { value: uint, timestamp: uint }) — tolerate ok-wrapped or bare tuple.
    const tuple = parsed?.type === "ok" ? parsed.value : parsed;
    const tsField = tuple?.timestamp ?? tuple?.value?.timestamp;
    const tsMs =
      typeof tsField === "bigint" ? Number(tsField)
      : typeof tsField === "number" ? tsField
      : tsField && typeof tsField === "object" && tsField.value !== undefined ? Number(tsField.value)
      : NaN;
    if (Number.isNaN(tsMs) || tsMs <= 0) return null;
    const ageSec = Math.floor(Date.now() / 1000 - tsMs / 1000);
    return ageSec < 0 ? 0 : ageSec;
  } catch {
    return null;
  }
}

async function loadOracleStatus(oraclePrincipal: string): Promise<OracleStatusCacheEntry> {
  const name = oracleContractName(oraclePrincipal);
  const now = Date.now();

  // Constant feed (e.g. vGLD $1): always live.
  if (CONSTANT_ORACLE_NAMES.has(name)) {
    const hex = await callReadOnlyAt(oraclePrincipal, "get-price", []);
    const cls = classifyGetPrice(hex);
    return {
      state: "live",
      priceUsd: cls.ok && cls.price != null ? cls.price / 1e8 : null,
      ageSeconds: null,
      fetchedAt: now,
    };
  }

  const priceHex = await callReadOnlyAt(oraclePrincipal, "get-price", []);
  const cls = classifyGetPrice(priceHex);

  const pair = ORACLE_DIA_PAIRS[name];
  const ageSeconds = pair ? await fetchOracleAgeSeconds(pair) : null;

  // err u602 (no price) or unreadable -> unavailable.
  if (!cls.ok && (cls.errCode === 602 || cls.errCode === undefined)) {
    return { state: "unavailable", priceUsd: null, ageSeconds, fetchedAt: now };
  }
  // err u601 (contract says stale) OR age beyond hardcoded threshold -> stale.
  const ageStale = ageSeconds != null && ageSeconds > ORACLE_MAX_STALENESS_SECONDS;
  if ((!cls.ok && cls.errCode === 601) || ageStale) {
    return {
      state: "stale",
      priceUsd: cls.ok && cls.price != null ? cls.price / 1e8 : null,
      ageSeconds,
      fetchedAt: now,
    };
  }
  // ok and fresh.
  return {
    state: "live",
    priceUsd: cls.price != null ? cls.price / 1e8 : null,
    ageSeconds,
    fetchedAt: now,
  };
}

export function useOracleStatus(oraclePrincipal: string | null): OracleStatus {
  const seed = oraclePrincipal ? oracleStatusCache.get(oraclePrincipal) : undefined;
  const [entry, setEntry] = useState<OracleStatusCacheEntry | null>(seed ?? null);
  const [isValidating, setIsValidating] = useState(false);

  const refetch = useCallback(async () => {
    if (!oraclePrincipal) return;
    setIsValidating(true);
    try {
      const next = await loadOracleStatus(oraclePrincipal);
      oracleStatusCache.set(oraclePrincipal, next);
      setEntry(next);
    } finally {
      setIsValidating(false);
    }
  }, [oraclePrincipal]);

  useEffect(() => {
    if (!oraclePrincipal) {
      setEntry(null);
      return;
    }
    const cached = oracleStatusCache.get(oraclePrincipal);
    if (cached) {
      setEntry(cached);
      const fresh = Date.now() - cached.fetchedAt < ORACLE_CACHE_TTL_SECONDS * 1000;
      if (fresh) return; // serve cache, skip fetch
    }
    refetch();
    const interval = setInterval(refetch, ORACLE_CACHE_TTL_SECONDS * 1000);
    return () => clearInterval(interval);
  }, [oraclePrincipal, refetch]);

  return {
    state: oraclePrincipal ? (entry?.state ?? "loading") : "loading",
    priceUsd: entry?.priceUsd ?? null,
    ageSeconds: entry?.ageSeconds ?? null,
    isValidating,
    refetch,
  };
}
```

- [ ] **Step 2: Confirm imports**

Ensure the top-of-file import from `@stacks/transactions` includes `stringAsciiCV`
and the `@/lib/constants` import includes `getContractId`, `CONTRACTS`,
`ORACLE_MAX_STALENESS_SECONDS`, `ORACLE_CACHE_TTL_SECONDS`, `ORACLE_DIA_PAIRS`,
`CONSTANT_ORACLE_NAMES`. Add any missing names to the existing import statements.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useContractRead.ts
git commit -m "feat: add useOracleStatus hook with SWR cache"
```

---

## Task 5: `<OracleStatusBanner>` component

**Files:**
- Create: `frontend/src/components/OracleStatusBanner.tsx`

- [ ] **Step 1: Create the component**

```tsx
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
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/OracleStatusBanner.tsx
git commit -m "feat: add OracleStatusBanner component"
```

---

## Task 6: `useTokenBalance` hook

**Files:**
- Modify: `frontend/src/hooks/useContractRead.ts`

Imports: ensure `TOKEN_BALANCE_CACHE_TTL_SECONDS` is imported from `@/lib/constants`,
and `principalCV` + `cvToHex` from `@stacks/transactions` (both already imported).

- [ ] **Step 1: Add the hook + cache**

```ts
interface TokenBalanceCacheEntry {
  balance: number | null; // raw smallest units
  fetchedAt: number;
}

const tokenBalanceCache = new Map<string, TokenBalanceCacheEntry>();

export interface TokenBalanceResult {
  balance: number | null;
  isLoading: boolean;
  isValidating: boolean;
  refetch: () => Promise<void>;
}

async function loadTokenBalance(
  tokenPrincipal: string,
  userAddress: string
): Promise<number | null> {
  const hex = await callReadOnlyAt(tokenPrincipal, "get-balance", [
    cvToHex(principalCV(userAddress)),
  ]);
  if (!hex) return null;
  return parseOkUint(hex); // (ok uint) -> number | null
}

export function useTokenBalance(
  tokenPrincipal: string | null,
  userAddress: string | null
): TokenBalanceResult {
  const key = tokenPrincipal && userAddress ? `${tokenPrincipal}:${userAddress}` : null;
  const seed = key ? tokenBalanceCache.get(key) : undefined;
  const [balance, setBalance] = useState<number | null>(seed?.balance ?? null);
  const [isLoading, setIsLoading] = useState(!!key && !seed);
  const [isValidating, setIsValidating] = useState(false);

  const refetch = useCallback(async () => {
    if (!tokenPrincipal || !userAddress || !key) return;
    const hasCache = tokenBalanceCache.has(key);
    if (hasCache) setIsValidating(true);
    else setIsLoading(true);
    try {
      const next = await loadTokenBalance(tokenPrincipal, userAddress);
      tokenBalanceCache.set(key, { balance: next, fetchedAt: Date.now() });
      setBalance(next);
    } finally {
      setIsLoading(false);
      setIsValidating(false);
    }
  }, [tokenPrincipal, userAddress, key]);

  useEffect(() => {
    if (!key) {
      setBalance(null);
      setIsLoading(false);
      return;
    }
    const cached = tokenBalanceCache.get(key);
    if (cached) {
      setBalance(cached.balance);
      setIsLoading(false);
      const fresh = Date.now() - cached.fetchedAt < TOKEN_BALANCE_CACHE_TTL_SECONDS * 1000;
      if (fresh) return;
    }
    refetch();
  }, [key, refetch]);

  return { balance, isLoading, isValidating, refetch };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useContractRead.ts
git commit -m "feat: add useTokenBalance hook with SWR cache"
```

---

## Task 7: Integrate into `vaults/new`

**Files:**
- Modify: `frontend/src/app/vaults/new/page.tsx`

Existing in-scope identifiers: `selectedCollateralAsset`, `address`,
`collateralTypes`, `collateralAmount`/`setCollateralAmount`, `collateralDecimals`,
`isValidPosition` (line ~249), the deposit `<Input>` (line ~591), and the
mt-2 info `<div>` after it (line ~599). `getOraclePrincipalForAsset` is exported
from `@/lib/oracles`; `getCollateralSymbol` + `getCollateralDisplayDecimals` from
`@/lib/constants`; `toHumanReadable` from `@/lib/utils`.

- [ ] **Step 1: Add imports**

Add to the existing import lines:

```ts
import { OracleStatusBanner } from "@/components/OracleStatusBanner";
import { useOracleStatus, useTokenBalance } from "@/hooks/useContractRead";
import { getOraclePrincipalForAsset } from "@/lib/oracles"; // if not already imported
import { getCollateralSymbol, getCollateralDisplayDecimals } from "@/lib/constants"; // merge into existing constants import
import { toHumanReadable } from "@/lib/utils"; // merge into existing utils import
```

(Merge names into the file's existing `@/lib/constants` and `@/lib/utils` import
statements rather than adding duplicate import lines.)

- [ ] **Step 2: Derive oracle + balance state**

Add after the `collateralDecimals` line (~66):

```ts
  const selectedOraclePrincipal = useMemo(
    () =>
      selectedCollateralAsset
        ? getOraclePrincipalForAsset(selectedCollateralAsset, collateralTypes)
        : null,
    [selectedCollateralAsset, collateralTypes]
  );
  const oracleStatus = useOracleStatus(selectedOraclePrincipal);
  const isOracleLive = oracleStatus.state === "live";

  const { balance: collateralBalanceRaw } = useTokenBalance(
    selectedCollateralAsset,
    address
  );
  const collateralBalanceHuman =
    collateralBalanceRaw != null && collateralDecimals != null
      ? toHumanReadable(collateralBalanceRaw, collateralDecimals)
      : null;
  const collateralSymbol = selectedCollateralAsset
    ? getCollateralSymbol(selectedCollateralAsset)
    : "";
  const insufficientBalance =
    collateralBalanceHuman != null &&
    parseFloat(collateralAmount || "0") > collateralBalanceHuman;
```

- [ ] **Step 3: Gate `isValidPosition` on live oracle + sufficient balance**

Change the `isValidPosition` expression (~249) to add two conditions:

```ts
  const isValidPosition =
    !!selectedStablecoin &&
    !!selectedCollateral &&
    effectiveCollateralUnits > 0 &&
    borrowUnits > 0 &&
    !isBelowDebtFloor &&
    isOracleLive &&
    !insufficientBalance &&
    (oraclePrice == null || previewHealthFactor >= minRatio);
```

- [ ] **Step 4: Render the banner above the deposit input**

Immediately before the `<label>` at ~588 (the "Deposit Amount" label), insert:

```tsx
                        {selectedOraclePrincipal && (
                          <div className="mb-3">
                            <OracleStatusBanner
                              state={oracleStatus.state}
                              symbol={symbol}
                              ageSeconds={oracleStatus.ageSeconds}
                              isValidating={oracleStatus.isValidating}
                              onRefresh={oracleStatus.refetch}
                            />
                          </div>
                        )}
```

(`symbol` is the collateral symbol already in scope inside this IIFE block. If not
in scope at the insertion point, use `collateralSymbol`.)

- [ ] **Step 5: Add balance line + Max button**

Inside the `<div className="mt-2 space-y-1">` block (~599), add at the top of it:

```tsx
                          {collateralBalanceHuman != null && (
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">
                                Balance:{" "}
                                <span className="font-medium text-foreground">
                                  {formatTokenAmount(
                                    collateralBalanceRaw!,
                                    collateralDecimals!,
                                    getCollateralDisplayDecimals(selectedCollateralAsset!)
                                  )}{" "}
                                  {collateralSymbol}
                                </span>
                              </span>
                              <button
                                type="button"
                                className="text-xs font-medium text-primary hover:underline"
                                onClick={() =>
                                  setCollateralAmount(String(collateralBalanceHuman))
                                }
                              >
                                Max
                              </button>
                            </div>
                          )}
                          {insufficientBalance && (
                            <p className="text-sm text-red-500">
                              Insufficient balance — you have {String(collateralBalanceHuman)}{" "}
                              {collateralSymbol}.
                            </p>
                          )}
```

Ensure `formatTokenAmount` is imported in this file (it is used elsewhere on the
page; if missing, add it to the `@/lib/utils` import).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS (no type errors, no new lint errors).

- [ ] **Step 7: Manual check**

Run: `npm run dev`. Open `/vaults/new`, pick a stablecoin + sBTC collateral.
Expected: green "sBTC price live · updated Xm ago" line; "Balance: … sBTC" with a
Max button; typing more than balance shows the red warning and blocks advancing to
Confirm; Max fills the full balance.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/vaults/new/page.tsx
git commit -m "feat: oracle banner + wallet balance + mint gating on new-vault flow"
```

---

## Task 8: Integrate banner + mint gate into `vaults/[stablecoinId]`

**Files:**
- Modify: `frontend/src/app/vaults/[stablecoinId]/page.tsx`

Context: this page already computes `selectedPosition` (its `.asset`) and imports
`getCollateralSymbol` + `useContractRead` helpers. It already resolves the oracle
for mint via the collateral types. Use the selected position's asset for the banner.

- [ ] **Step 1: Add imports**

```ts
import { OracleStatusBanner } from "@/components/OracleStatusBanner";
import { useOracleStatus } from "@/hooks/useContractRead";
import { getOraclePrincipalForAsset } from "@/lib/oracles"; // if not already imported
```

(`useCollateralTypes` is already used on this page to resolve oracles; reuse its
`collateralTypes`. If the page does not already have `collateralTypes` in scope,
add `const { collateralTypes } = useCollateralTypes();` near the other hooks — the
hook is already imported/used elsewhere in this file.)

- [ ] **Step 2: Derive oracle status for the selected position**

Near the other derived state for `selectedPosition`:

```ts
  const mintOraclePrincipal = selectedPosition
    ? getOraclePrincipalForAsset(selectedPosition.asset, collateralTypes)
    : null;
  const mintOracleStatus = useOracleStatus(mintOraclePrincipal);
  const isMintOracleLive = mintOracleStatus.state === "live";
```

- [ ] **Step 3: Render the banner above the mint action**

Locate the mint section/button for the selected collateral (the "Mint" tab/card).
Immediately above the mint amount input or mint button, insert:

```tsx
              {mintOraclePrincipal && (
                <div className="mb-3">
                  <OracleStatusBanner
                    state={mintOracleStatus.state}
                    symbol={getCollateralSymbol(selectedPosition!.asset)}
                    ageSeconds={mintOracleStatus.ageSeconds}
                    isValidating={mintOracleStatus.isValidating}
                    onRefresh={mintOracleStatus.refetch}
                  />
                </div>
              )}
```

- [ ] **Step 4: Disable the mint button when the oracle is not live**

Find the mint submit `<Button>` for this page and add `!isMintOracleLive` to its
`disabled` expression, e.g.:

```tsx
                disabled={/* existing conditions */ || !isMintOracleLive}
```

(Withdraw/repay/deposit buttons are NOT gated — only mint depends on a live price.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 6: Manual check**

Run: `npm run dev`. Open a vault with an sBTC position, go to the Mint action.
Expected: banner reflects sBTC oracle state; when live, mint enabled; when the
banner shows stale/unavailable, the mint button is disabled.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/vaults/[stablecoinId]/page.tsx
git commit -m "feat: oracle status banner + mint gating on manage-vault page"
```

---

## Task 9: Final full-build verification

- [ ] **Step 1: Type + lint + production build**

Run (from `frontend/`):
```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: all PASS, `next build` completes with no errors.

- [ ] **Step 2: Manual regression sweep**

`npm run dev`, then confirm:
1. `/vaults/new`: live oracle → green line + mint reachable; balance line + Max + over-balance warning behave.
2. `/vaults/[id]`: mint banner + gating present; withdraw/repay/deposit unaffected.
3. Navigate away from `/vaults/new` and back → oracle status + balance render instantly from cache, then revalidate.
4. Pool/dashboard pages (which use `useDiaOraclePrices`) still render prices — confirm no regression from the new hooks.

- [ ] **Step 3: Commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore: oracle staleness UX final verification fixups"
```

---

## Notes / Risks

- **DIA result shapes:** `classifyGetPrice` and `fetchOracleAgeSeconds` tolerate
  multiple `cvToValue` shapes and fall back to hex-prefix checks (`0x07` ok,
  `0x08` err, `0x09` none) — the convention already used in this file. If a live
  read decodes unexpectedly, log the raw hex and adjust the decoder; do not relax
  the fail-safe (unknown → `unavailable` → mint blocked).
- **New DIA assets:** add their `<contract-name> -> PAIR` entry to
  `ORACLE_DIA_PAIRS`. Without it, state still resolves from `get-price` but no
  "updated Xm ago" age is shown.
- **Fail-safe direction:** every oracle read failure resolves to `unavailable`,
  which blocks mint — never the reverse.
