import { NextRequest, NextResponse } from "next/server";

const HIRO_MAINNET = "https://api.mainnet.hiro.so";
const HIRO_TESTNET = "https://api.testnet.hiro.so";
const ALLTHATNODE_TESTNET = process.env.ALLTHATNODE_TESTNET_API_BASE || "";

// QuickNode Stacks mainnet endpoint. Auth token is embedded in the URL path,
// so no API-key header is sent. Configured via env only (no hardcoded secret).
// Trailing slash stripped so `base + "/extended/..."` does not double up.
const QUICKNODE_MAINNET = (process.env.QUICKNODE_MAINNET_API_BASE || "").replace(/\/+$/, "");

const NETWORK = process.env.NEXT_PUBLIC_NETWORK === "mainnet" ? "mainnet" : "testnet";

type RpcProvider = {
  id: string;
  base: string;
  keyHeader: "x-api-key" | "api-key";
  key: string;
};

const PROVIDERS: RpcProvider[] = NETWORK === "mainnet"
  ? [
      { id: "quicknode-mainnet", base: QUICKNODE_MAINNET, keyHeader: "x-api-key", key: "" },
      { id: "hiro-mainnet-auth", base: HIRO_MAINNET, keyHeader: "x-api-key", key: process.env.HIRO_API_KEY || "" },
      { id: "hiro-mainnet-public", base: HIRO_MAINNET, keyHeader: "x-api-key", key: "" },
      {
        id: "nownodes-mainnet",
        base: process.env.NOWNODES_MAINNET_API_BASE || "",
        keyHeader: "api-key",
        key: process.env.NOWNODES_MAINNET_API_KEY || "",
      },
    ]
  : [
      { id: "hiro-testnet-auth", base: HIRO_TESTNET, keyHeader: "x-api-key", key: process.env.HIRO_API_KEY || "" },
      { id: "hiro-testnet-public", base: HIRO_TESTNET, keyHeader: "x-api-key", key: "" },
      {
        id: "allthatnode-testnet",
        base: ALLTHATNODE_TESTNET,
        keyHeader: "api-key",
        key: process.env.ALLTHATNODE_TESTNET_API_KEY || "",
      },
      {
        id: "nownodes-testnet",
        base: process.env.NOWNODES_TESTNET_API_BASE || "",
        keyHeader: "api-key",
        key: process.env.NOWNODES_TESTNET_API_KEY || "",
      },
    ];

const FILTERED_PROVIDERS = PROVIDERS.filter((p) => p.base);

type CircuitState = {
  failures: number;
  openUntil: number;
};

const circuitByProvider = new Map<string, CircuitState>();
const FAILURE_THRESHOLD = 3;
const OPEN_MS = 2 * 60 * 1000;

function getCircuitState(providerId: string): CircuitState {
  const current = circuitByProvider.get(providerId);
  if (current) return current;
  const initial = { failures: 0, openUntil: 0 };
  circuitByProvider.set(providerId, initial);
  return initial;
}

function isCircuitOpen(providerId: string): boolean {
  const state = getCircuitState(providerId);
  return state.openUntil > Date.now();
}

function markSuccess(providerId: string) {
  const state = getCircuitState(providerId);
  state.failures = 0;
  state.openUntil = 0;
}

function markFailure(providerId: string) {
  const state = getCircuitState(providerId);
  state.failures += 1;
  if (state.failures >= FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + OPEN_MS;
    state.failures = 0;
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

// --- Read caching + request coalescing ----------------------------------
//
// All client RPC funnels through this proxy, so it's the one place to cut
// duplicate upstream load that triggers Hiro 429s. Two mechanisms:
//   1. Coalescing: identical reads firing concurrently (e.g. on page mount)
//      share a single in-flight upstream request.
//   2. Short-TTL cache: identical reads within the TTL window are served from
//      memory instead of hitting upstream again.
//
// SAFETY: only idempotent, read-only requests are eligible (allowlist below).
// Broadcasts (POST /v2/transactions), nonce reads (/v2/accounts/...) and tx
// status (/extended/v1/tx/...) are NEVER cached or coalesced — caching those
// would risk replayed transactions, wrong nonces, or a stuck "pending" view.
//
// SCOPE: these Maps are module-scoped, i.e. per warm serverless instance. On a
// horizontally-scaled host (Netlify/Lambda) each instance keeps its own cache,
// so dedup is per-instance, not global — it reduces duplicate upstream load but
// does not eliminate 429s across many cold instances. The durable fix for high
// concurrency is a shared store (e.g. Upstash Redis) behind the same allowlist;
// the in-memory layer here is the cheap first line that covers the common case.

type CacheEntry = { status: number; text: string; contentType: string; expires: number };

const CACHE_TTL_MS = 15_000;
const CACHE_MAX_ENTRIES = 500;
const responseCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ProxyResult>>();

/** TTL in ms for a cacheable request, or 0 if it must always hit upstream. */
function cacheTtlMs(method: "GET" | "POST", path: string): number {
  // Read-only contract calls: the dominant traffic, change only per block.
  if (method === "POST" && path.startsWith("/v2/contracts/call-read/")) return CACHE_TTL_MS;
  // Wallet balances are intentionally NOT cached: after a deposit/mint/repay/
  // withdraw the UI refetches balances immediately and must see post-tx values,
  // not a stale pre-tx snapshot. (Nonce at /v2/accounts/... is excluded too so
  // signing always sees a fresh nonce.)
  return 0;
}

function pruneCache() {
  const now = Date.now();
  responseCache.forEach((entry, key) => {
    if (entry.expires <= now) responseCache.delete(key);
  });
  // Hard cap: drop oldest insertions if still over budget (Map preserves order).
  while (responseCache.size > CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest === undefined) break;
    responseCache.delete(oldest);
  }
}

type ProxyResult = { status: number; text: string; contentType: string };

/** Run the request against the provider chain. Throws only if all providers fail. */
async function fetchFromProviders(
  method: "GET" | "POST",
  path: string,
  search: string,
  bodyText: string
): Promise<ProxyResult> {
  let lastError: unknown = null;
  let fallback: ProxyResult | null = null;

  for (const provider of FILTERED_PROVIDERS) {
    if (isCircuitOpen(provider.id)) continue;

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (provider.key) headers[provider.keyHeader] = provider.key;

      const upstream = await fetch(`${provider.base}${path}${search}`, {
        method,
        headers,
        body: method === "POST" ? bodyText : undefined,
        cache: "no-store",
      });

      const result: ProxyResult = {
        status: upstream.status,
        text: await upstream.text(),
        contentType: upstream.headers.get("content-type") || "application/json",
      };

      if (upstream.ok) {
        markSuccess(provider.id);
        return result;
      }

      if (isRetryableStatus(upstream.status)) {
        // Only retryable failures (429/5xx/timeout) count against the provider's
        // circuit breaker. A non-retryable 4xx (e.g. 404 for a not-yet-indexed
        // tx during status polling) is a valid upstream answer, not a provider
        // fault — penalizing it would wrongly open the circuit and pile load on
        // the remaining providers, causing the very 429s we're avoiding.
        markFailure(provider.id);
        lastError = new Error(`Retryable status ${upstream.status}`);
        continue;
      }
      // Keep non-retryable response as fallback, but still try other providers
      // so provider-specific 404/401 don't short-circuit the whole request.
      if (!fallback) fallback = result;
    } catch (err) {
      markFailure(provider.id);
      lastError = err;
    }
  }

  if (fallback) return fallback;
  throw new Error(lastError instanceof Error ? lastError.message : "unknown error");
}

function toResponse(result: ProxyResult): NextResponse {
  return new NextResponse(result.text, {
    status: result.status,
    headers: { "content-type": result.contentType },
  });
}

async function proxy(request: NextRequest, method: "GET" | "POST", path: string, search: string) {
  const bodyText = method === "POST" ? await request.text() : "";
  const ttl = cacheTtlMs(method, path);

  // Non-cacheable (broadcasts, nonce, tx status, ...): straight passthrough.
  if (ttl === 0) {
    try {
      return toResponse(await fetchFromProviders(method, path, search, bodyText));
    } catch (err) {
      return NextResponse.json(
        { error: "All RPC providers failed", details: err instanceof Error ? err.message : "unknown error" },
        { status: 502 }
      );
    }
  }

  const key = `${method} ${path}${search}\n${bodyText}`;
  const now = Date.now();

  const cached = responseCache.get(key);
  if (cached && cached.expires > now) return toResponse(cached);

  // Coalesce concurrent identical reads onto one upstream request.
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchFromProviders(method, path, search, bodyText)
      .then((result) => {
        // Only cache successful reads; never persist an error/429/5xx. Hiro's
        // call-read returns HTTP 200 even on a logical failure ({"okay":false}),
        // so exclude those too — otherwise a transient read failure is replayed
        // for the whole TTL window.
        if (result.status === 200 && !result.text.includes('"okay":false')) {
          // delete+set so a refreshed (hot) key moves to the newest position;
          // pruneCache evicts oldest-inserted first under the hard cap.
          responseCache.delete(key);
          responseCache.set(key, { ...result, expires: Date.now() + ttl });
          pruneCache();
        }
        return result;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }

  try {
    return toResponse(await pending);
  } catch (err) {
    return NextResponse.json(
      { error: "All RPC providers failed", details: err instanceof Error ? err.message : "unknown error" },
      { status: 502 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  const path = `/${params.path.join("/")}`;
  const search = request.nextUrl.search || "";
  return proxy(request, "GET", path, search);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> }
) {
  const params = await context.params;
  const path = `/${params.path.join("/")}`;
  const search = request.nextUrl.search || "";
  return proxy(request, "POST", path, search);
}
