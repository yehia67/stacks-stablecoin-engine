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

async function proxy(request: NextRequest, method: "GET" | "POST", path: string, search: string) {
  let bodyText = "";
  if (method === "POST") {
    bodyText = await request.text();
  }

  let lastError: unknown = null;
  let fallbackResponse: Response | null = null;
  for (const provider of FILTERED_PROVIDERS) {
    if (isCircuitOpen(provider.id)) {
      continue;
    }

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (provider.key) headers[provider.keyHeader] = provider.key;

      const upstream = await fetch(`${provider.base}${path}${search}`, {
        method,
        headers,
        body: method === "POST" ? bodyText : undefined,
        cache: "no-store",
      });

      if (upstream.ok) {
        markSuccess(provider.id);
        const text = await upstream.text();
        return new NextResponse(text, {
          status: upstream.status,
          headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
        });
      }

      if (isRetryableStatus(upstream.status)) {
        markFailure(provider.id);
        lastError = new Error(`Retryable status ${upstream.status}`);
        continue;
      }

      // Keep non-retryable response as fallback, but still try other providers.
      // This avoids provider-specific 404/401 responses short-circuiting the entire request.
      markFailure(provider.id);
      if (!fallbackResponse) {
        fallbackResponse = upstream;
      }
    } catch (err) {
      markFailure(provider.id);
      lastError = err;
    }
  }

  if (fallbackResponse) {
    const text = await fallbackResponse.text();
    return new NextResponse(text, {
      status: fallbackResponse.status,
      headers: { "content-type": fallbackResponse.headers.get("content-type") || "application/json" },
    });
  }

  return NextResponse.json(
    {
      error: "All RPC providers failed",
      details: lastError instanceof Error ? lastError.message : "unknown error",
    },
    { status: 502 }
  );
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
