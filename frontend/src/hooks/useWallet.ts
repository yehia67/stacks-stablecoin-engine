"use client";

import { useCallback, useEffect, useState } from "react";
import { connectWallet, disconnectWallet, isConnected, getUserAddress } from "@/lib/stacks";

export interface WalletState {
  isConnected: boolean;
  isConnecting: boolean;
  address: string | null;
}

export function useWallet() {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<WalletState>({
    isConnected: false,
    isConnecting: false,
    address: null,
  });

  // Check connection status on mount
  useEffect(() => {
    setMounted(true);
    if (isConnected()) {
      setState({
        isConnected: true,
        isConnecting: false,
        address: getUserAddress(),
      });
    }
  }, []);

  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, isConnecting: true }));
    try {
      await connectWallet();
      setState({
        isConnected: true,
        isConnecting: false,
        address: getUserAddress(),
      });
    } catch {
      setState((prev) => ({ ...prev, isConnecting: false }));
    }
  }, []);

  const disconnect = useCallback(() => {
    disconnectWallet();
    setState({
      isConnected: false,
      isConnecting: false,
      address: null,
    });
  }, []);

  return {
    ...state,
    mounted,
    connect,
    disconnect,
  };
}
