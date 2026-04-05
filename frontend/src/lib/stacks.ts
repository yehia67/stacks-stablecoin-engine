import { AppConfig, UserSession } from "@stacks/connect";
import { STACKS_MAINNET, STACKS_TESTNET } from "@stacks/network";
import { IS_MAINNET } from "./constants";

// App configuration for wallet connection
export const appConfig = new AppConfig(["store_write", "publish_data"]);

// User session singleton
export const userSession = new UserSession({ appConfig });

// Network instance
export const stacksNetwork = IS_MAINNET ? STACKS_MAINNET : STACKS_TESTNET;

// Get user's STX address based on network
export function getUserAddress(): string | null {
  if (!userSession.isUserSignedIn()) return null;
  const userData = userSession.loadUserData();
  return IS_MAINNET
    ? userData.profile.stxAddress.mainnet
    : userData.profile.stxAddress.testnet;
}

// Check if user is signed in
export function isSignedIn(): boolean {
  return userSession.isUserSignedIn();
}

// Get user data
export function getUserData() {
  if (!userSession.isUserSignedIn()) return null;
  return userSession.loadUserData();
}
