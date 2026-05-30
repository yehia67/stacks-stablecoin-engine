# Oracle Staleness UX & Wallet Balance — Design

Date: 2026-05-30
Status: Approved (pending spec review)

## Problem

Oracle staleness/downtime correctly blocks mint operations (safety), but the UI
gives no explanation:

- Users perceive the protocol as broken.
- No visibility into oracle status or freshness.
- Mint attempts fail (or the button is silently disabled) with no actionable guidance.
- Separately: the deposit form does not show the user's wallet balance for the
  selected collateral, forcing users to open their wallet to check.

## Scope

**In scope (this deliverable): frontend UX only.**

1. Oracle status indicator/banner on vault pages, contextual to the selected collateral.
2. Clear explanation of why minting is paused when the oracle is stale/unavailable.
3. Freshness surfacing ("updated Xm ago" + the staleness window).
4. Wallet balance for the selected collateral in the deposit form, with a Max
   button and an insufficient-balance warning.

**Out of scope (separate project, spec'd later):**

- Off-chain keeper / heartbeat price updater.
- Monitoring / alerting stack.
- Reading staleness thresholds from on-chain config (we hardcode the threshold per
  user decision).

## Background (current behavior)

- DIA price oracles (`price-oracle-dia-btc-v2`, `price-oracle-dia-stx-v2`) expose a
  read-only `get-price` that returns:
  - `(ok price)` when fresh,
  - `(err u601)` `ERR_STALE_PRICE` when the price is older than the contract's
    `max-staleness` (default 3600s),
  - `(err u602)` `ERR_NO_PRICE` when there is no underlying data.
- The underlying price `timestamp` is available via the DIA adapter
  (`dia-oracle-adapter.get-value PAIR`).
- The constant vGLD oracle (`price-oracle-vgld-v1`) is a fixed $1 feed — always fresh.
- `useDiaOraclePrices` currently calls `get-price` and **swallows the error**,
  yielding `price = null`; the mint button is then silently disabled with no reason.
- The v8 engine routes pricing per-asset through the registry-stored oracle
  (`resolveAssetOracle` / `getOraclePrincipalForAsset`). The relevant oracle for a
  mint is the one for the **selected collateral asset**.
- Token contracts expose `get-balance(who)`, already read elsewhere via
  `readTokenContract` for TVL.

`useDiaOraclePrices` stays as-is (used by dashboard, my-stablecoins). New hooks are
added alongside it.

## Decisions

- **Hardcoded staleness threshold** — no on-chain `get-max-staleness` read.
- **Cache oracle reads** — BTC price changes little; an SWR module cache reduces RPC.

## Constants (in `src/lib/constants.ts`)

```ts
// UI staleness threshold (matches the DIA oracles' default max-staleness).
export const ORACLE_MAX_STALENESS_SECONDS = 3600; // 60 min
// How long a cached oracle read is served before a background revalidation.
export const ORACLE_CACHE_TTL_SECONDS = 60;
// How long a cached token balance is served before a background revalidation.
export const TOKEN_BALANCE_CACHE_TTL_SECONDS = 30;
```

## Component A — `useOracleStatus(oraclePrincipal: string | null)`

Location: `src/hooks/useContractRead.ts`.

State machine:

| state         | trigger                                                        |
|---------------|---------------------------------------------------------------|
| `loading`     | first fetch, nothing cached                                   |
| `live`        | `get-price` `ok` AND `age <= ORACLE_MAX_STALENESS_SECONDS`    |
| `stale`       | `get-price` `err u601`, OR `age > ORACLE_MAX_STALENESS_SECONDS` |
| `unavailable` | `get-price` `err u602`, fetch failure, or unparseable result  |

Behavior:

- **Module-level SWR cache** keyed by oracle principal (same pattern as the user-vaults
  cache): seed state from cache for instant render; revalidate in the background only
  when the cached entry is older than `ORACLE_CACHE_TTL_SECONDS`. Dedupes concurrent
  consumers of the same oracle. Survives in-session navigation; cleared on full reload.
- Fetch: call `<oracle>.get-price`. For age, fetch the price `timestamp` from the DIA
  adapter for known DIA oracles (BTC/STX); compute `ageSeconds = now - timestamp`.
- Constant oracles (vGLD): short-circuit to `live`, `ageSeconds = null`.
- `oraclePrincipal === null` → `loading`/no-op (nothing selected yet).
- Polls every `ORACLE_CACHE_TTL_SECONDS` while mounted; exposes `refetch`.

Returns: `{ state, priceUsd: number | null, ageSeconds: number | null, isValidating, refetch }`.

Fail-safe: any read failure resolves to `unavailable`, which blocks mint — the safe
default.

## Component B — `<OracleStatusBanner>`

Location: `src/components/` (new file, e.g. `OracleStatusBanner.tsx`).

Props: `{ state, symbol, ageSeconds, maxStalenessSeconds, onRefresh, isValidating }`.

Rendering:

- `live` → subtle green line: `● {symbol} price live · updated {age} ago`.
  (Omit age when `ageSeconds === null`, e.g. constant oracle: `● {symbol} price live`.)
- `stale` → amber banner: `⚠ {symbol} price is stale (last update {age} ago, must be
  < {threshold}m). Minting is paused until the oracle refreshes.` + Refresh button.
- `unavailable` → red banner: `✕ {symbol} price unavailable. Minting is paused.` + Refresh.
- `loading` → muted placeholder line.

Age formatting helper: seconds → `Xs` / `Xm` / `Xh Ym` (small inline util).

## Component C — `useTokenBalance(tokenPrincipal, userAddress)`

Location: `src/hooks/useContractRead.ts`.

- Calls token `get-balance(who)` via `readTokenContract`; parses to raw smallest-units `number`.
- **Module-level SWR cache** keyed by `${tokenPrincipal}:${userAddress}`, TTL
  `TOKEN_BALANCE_CACHE_TTL_SECONDS`; background revalidate; `refetch` exposed.
- Null inputs → `balance: null`, no fetch.
- Read failure → `balance: null` (UI shows "—"; does not block deposit — the chain
  post-condition still guards over-spend).

Returns: `{ balance: number | null, isLoading, isValidating, refetch }`.

## Integration — `vaults/new` (and `vaults/[stablecoinId]` for the banner)

The page already holds `selectedCollateralAsset`, its registry `oraclePrincipal`,
`collateralDecimals`, and `address`. Add:

- `useOracleStatus(oraclePrincipal)` → render `<OracleStatusBanner>` above the mint
  action; disable the mint button when `state !== 'live'`, with the banner as the
  visible reason. (Replaces today's silent null-price disable.)
- `useTokenBalance(selectedCollateralAsset, address)` for the deposit form:
  - Balance line under the deposit input: `Balance: {fmt} {symbol}` using
    `getCollateralDisplayDecimals` for precision.
  - **Max** button: fills the deposit input with the full human-readable balance.
  - **Insufficient-balance** inline warning + disable deposit/mint when
    `depositAmount > balance` (only when `balance !== null`).

The banner on `vaults/[stablecoinId]` covers the mint-against-existing-collateral flow
on the manage page; balance UX is deposit-form-specific (`vaults/new`).

## Error handling summary

- Oracle read fail → `unavailable` → mint blocked + banner explains + Refresh.
- Balance read fail → `null` → "—", deposit not blocked on read failure alone.
- Both hooks fail-soft; a thrown read degrades the UI, never crashes the page.

## Testing (manual — no hook test harness in repo)

1. Live oracle: green line shown, "updated Xm ago" reasonable, mint enabled.
2. Stale oracle (point at a stale feed or one past the threshold): amber banner,
   mint disabled, message names the age + threshold.
3. Unavailable (oracle read errors / err u602): red banner, mint disabled.
4. Balance: line matches wallet balance for the selected collateral; Max fills the
   input; entering more than balance shows the warning and disables deposit.
5. Caching: navigating away and back to `vaults/new` renders oracle status + balance
   instantly from cache, then revalidates.

## Files touched

- `src/lib/constants.ts` — new constants.
- `src/hooks/useContractRead.ts` — `useOracleStatus`, `useTokenBalance` (+ caches).
- `src/components/OracleStatusBanner.tsx` — new component.
- `src/app/vaults/new/page.tsx` — banner + mint gate + balance UX.
- `src/app/vaults/[stablecoinId]/page.tsx` — banner + mint gate.
