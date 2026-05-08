import { connect, disconnect, isConnected, getLocalStorage } from "@stacks/connect";
import { STACKS_MAINNET, STACKS_TESTNET } from "@stacks/network";
import { IS_MAINNET } from "./constants";

// Network instance
export const stacksNetwork = IS_MAINNET ? STACKS_MAINNET : STACKS_TESTNET;

// Network name for request() calls
export const networkName = IS_MAINNET ? "mainnet" : "testnet";

// Re-export v8 wallet primitives
export { connect as connectWallet, disconnect as disconnectWallet, isConnected };

// Get user's STX address from local storage (v8 pattern)
export function getUserAddress(): string | null {
  const data = getLocalStorage();
  if (!data?.addresses?.stx?.[0]) return null;
  return data.addresses.stx[0].address;
}

// Check if user is signed in
export function isSignedIn(): boolean {
  return isConnected();
}

// Get user data (v8 compat shim)
export function getUserData() {
  const data = getLocalStorage();
  if (!data?.addresses?.stx?.[0]) return null;
  return data;
}
