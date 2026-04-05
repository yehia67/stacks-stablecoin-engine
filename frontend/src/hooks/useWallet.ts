"use client";

import { useCallback, useEffect, useState } from "react";
import { showConnect } from "@stacks/connect";
import { userSession } from "@/lib/stacks";
import { APP_CONFIG, IS_MAINNET } from "@/lib/constants";

export interface WalletState {
  isConnected: boolean;
  isConnecting: boolean;
  address: string | null;
  mainnetAddress: string | null;
  testnetAddress: string | null;
}

export function useWallet() {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    isConnecting: false,
    address: null,
    mainnetAddress: null,
    testnetAddress: null,
  });

  // Check connection status on mount
  useEffect(() => {
    setMounted(true);
    if (userSession.isUserSignedIn()) {
      const userData = userSession.loadUserData();
      setState({
        isConnected: true,
        isConnecting: false,
        address: IS_MAINNET
          ? userData.profile.stxAddress.mainnet
          : userData.profile.stxAddress.testnet,
        mainnetAddress: userData.profile.stxAddress.mainnet,
        testnetAddress: userData.profile.stxAddress.testnet,
      });
    }
  }, []);

  const connect = useCallback(() => {
    setState((prev) => ({ ...prev, isConnecting: true }));

    showConnect({
      appDetails: {
        name: APP_CONFIG.name,
        icon: typeof window !== "undefined" ? window.location.origin + APP_CONFIG.icon : APP_CONFIG.icon,
      },
      redirectTo: "/",
      onFinish: () => {
        const userData = userSession.loadUserData();
        setState({
          isConnected: true,
          isConnecting: false,
          address: IS_MAINNET
            ? userData.profile.stxAddress.mainnet
            : userData.profile.stxAddress.testnet,
          mainnetAddress: userData.profile.stxAddress.mainnet,
          testnetAddress: userData.profile.stxAddress.testnet,
        });
      },
      onCancel: () => {
        setState((prev) => ({ ...prev, isConnecting: false }));
      },
      userSession,
    });
  }, []);

  const disconnect = useCallback(() => {
    userSession.signUserOut("/");
    setState({
      isConnected: false,
      isConnecting: false,
      address: null,
      mainnetAddress: null,
      testnetAddress: null,
    });
  }, []);

  return {
    ...state,
    mounted,
    connect,
    disconnect,
  };
}
