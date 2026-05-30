// Stacks wallet provider detection + selection.
//
// Why this exists
// ---------------
// `@stacks/connect` resolves the active wallet via `window.StacksProvider`.
// Multiple wallet extensions all try to claim that global on page load, which
// produces a race the dapp cannot influence after the fact. When a wallet
// other than the user's intended one wins, contract calls succeed but
// contract DEPLOYS can mangle the Clarity source on the way to the chain
// (e.g. JWT-wrapping the body when an extension's wallet-standard layer
// intercepts the deploy handler). Users see `(err none)` on-chain and burn
// the deploy fee with no contract published.
//
// Fix: detect the installed providers explicitly and pin the user's chosen
// one via `setSelectedProviderId`. After that, every `request("stx_*", ...)`
// and the legacy `openContractDeploy` wrapper route to THAT provider's
// implementation directly, regardless of who won the StacksProvider race.
//
// This module:
//   - Lists known Stacks wallet providers with their `window.*` IDs
//   - Detects which ones are installed in the current browser
//   - Lets callers pin one (typically the same wallet the user connected
//     with) and read the current selection
//
// Add new wallets by appending to KNOWN_WALLETS.

// `@stacks/connect` re-exports selection helpers but NOT `getInstalledProviders`
// or `getProviderFromId`. Import those directly from `@stacks/connect-ui`,
// which is `@stacks/connect`'s own peer (already in the dependency tree).
import {
  setSelectedProviderId,
  getSelectedProviderId,
  clearSelectedProviderId,
} from "@stacks/connect";
import {
  getInstalledProviders,
  getProviderFromId,
} from "@stacks/connect-ui";

export interface WalletProvider {
  /** Path on `window` where the provider injects itself (e.g. "LeatherProvider"). */
  id: string;
  /** User-facing display name. */
  name: string;
  /** Short URL where users can install the wallet, if missing. */
  installUrl: string;
}

/** Stacks-compatible wallets we explicitly support. Order = picker order. */
export const KNOWN_WALLETS: WalletProvider[] = [
  {
    id: "LeatherProvider",
    name: "Leather",
    installUrl: "https://leather.io/install-extension",
  },
  {
    id: "XverseProviders.StacksProvider",
    name: "Xverse",
    installUrl: "https://www.xverse.app/download",
  },
];

/** Returns the subset of KNOWN_WALLETS whose providers are present on `window`. */
export function getInstalledStacksWallets(): WalletProvider[] {
  if (typeof window === "undefined") return [];
  // @stacks/connect's helper checks both `window[id]` and the WBIP registry.
  const installed = getInstalledProviders(KNOWN_WALLETS);
  // Restrict the result to providers we know how to handle. (`getInstalledProviders`
  // can surface auto-registered providers we haven't audited.)
  return KNOWN_WALLETS.filter((w) => installed.some((p: any) => p.id === w.id));
}

/**
 * Returns the wallet provider that is currently bound to `window.StacksProvider`,
 * i.e. the one actively answering dapp queries this session. This is what
 * `@stacks/connect`'s `request(...)` ultimately routes through when no
 * explicit `setSelectedProviderId` has been called.
 *
 * Why this matters: `getInstalledStacksWallets()` returns *every* known
 * provider whose object exists on `window`. A user may have Leather AND
 * Xverse installed even though only one is "the wallet they connected
 * with". Comparing object references against `window.StacksProvider` picks
 * out the right one.
 */
export function getActiveStacksWallet(): WalletProvider | null {
  if (typeof window === "undefined") return null;
  const active = (window as any).StacksProvider;
  if (!active) return null;
  for (const w of KNOWN_WALLETS) {
    const candidate = getProviderFromId(w.id);
    if (candidate && candidate === active) return w;
  }
  return null;
}

/**
 * Returns the raw provider object for a wallet id, which exposes the
 * SIP-030 `request(method, params)` method. Used to dispatch RPC calls
 * directly to a specific wallet, bypassing `window.StacksProvider` (which
 * may be claimed by a different extension than the one the user wants to
 * sign with).
 *
 * Returns `null` if the provider isn't installed.
 */
export function getProviderObjectForWallet(id: string): {
  request: (method: string, params?: any) => Promise<any>;
} | null {
  const provider = getProviderFromId(id);
  if (!provider || typeof provider.request !== "function") return null;
  return provider;
}

/** Pin a specific wallet provider for subsequent @stacks/connect calls. */
export function selectStacksWallet(id: string): void {
  // Validate the provider is actually present before pinning, otherwise
  // subsequent request() calls hang waiting for a response from nothing.
  const provider = getProviderFromId(id);
  if (!provider) {
    throw new Error(
      `Wallet provider "${id}" is not installed. Available: ${getInstalledStacksWallets().map((w) => w.id).join(", ") || "none"}`
    );
  }
  setSelectedProviderId(id);
}

/** Returns the currently-pinned wallet, or null if none. */
export function getSelectedStacksWallet(): WalletProvider | null {
  const id = getSelectedProviderId();
  if (!id) return null;
  return KNOWN_WALLETS.find((w) => w.id === id) ?? null;
}

/** Clear the pinned provider (e.g. on disconnect / wallet switch). */
export function clearStacksWalletSelection(): void {
  clearSelectedProviderId();
}

/**
 * Resolve the wallet to use for the next signed action.
 *
 * Selection priority (each step falls through if it yields nothing):
 *   1. An explicit selection pinned earlier via `selectStacksWallet`.
 *   2. The wallet currently bound to `window.StacksProvider` -- the one
 *      actually answering dapp queries this session. Most users have only
 *      one Stacks wallet active even when multiple extensions are
 *      installed, so this is the right default the moment they've clicked
 *      "Connect" anywhere on the site.
 *   3. If exactly one of our KNOWN_WALLETS is installed at all, pin it.
 *   4. Otherwise throw with a useful error.
 *
 * The function is idempotent: calling it before every action is safe and
 * cheap. Once a wallet is pinned, subsequent calls return the cached
 * selection without re-probing the window.
 */
export function assertWalletSelected(): WalletProvider {
  const already = getSelectedStacksWallet();
  if (already) return already;

  // (2) The active provider answering dapp queries. This handles the common
  // case: user has Leather (and maybe Xverse) installed; Leather is the
  // wallet they connected with; `window.StacksProvider === window.LeatherProvider`.
  const active = getActiveStacksWallet();
  if (active) {
    selectStacksWallet(active.id);
    return active;
  }

  const installed = getInstalledStacksWallets();
  if (installed.length === 0) {
    throw new Error(
      "No supported Stacks wallet installed. Install Leather or Xverse and retry."
    );
  }
  // Multi-wallet case with no active match: auto-pin the first installed
  // wallet (KNOWN_WALLETS is ordered Leather first because that's the path
  // we've verified end-to-end). Users can override by calling
  // `selectStacksWallet(id)` from the wallet picker UI or by setting the
  // localStorage key `"@stacks/connect/connect.selectedProviderId"` to
  // e.g. `"XverseProviders.StacksProvider"` and reloading.
  const fallback = installed[0];
  console.warn(
    `[SSE] Multiple wallets installed (${installed.map((w) => w.name).join(", ")}); ` +
      `auto-pinning ${fallback.name}. To use a different wallet, call ` +
      `selectStacksWallet("<id>") or reconnect through the picker.`
  );
  selectStacksWallet(fallback.id);
  return fallback;
}
