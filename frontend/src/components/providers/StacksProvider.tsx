"use client";

import { createContext, useCallback, useEffect, useState } from "react";
import { connectWallet, disconnectWallet, isConnected, getUserAddress } from "@/lib/stacks";

export interface WalletState {
  isConnected: boolean;
  isConnecting: boolean;
  address: string | null;
  mounted: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const defaultState: WalletState = {
  isConnected: false,
  isConnecting: false,
  address: null,
  mounted: false,
  connect: async () => {},
  disconnect: () => {},
};

export const WalletContext = createContext<WalletState>(defaultState);

interface StacksProviderProps {
  children: React.ReactNode;
}

export function StacksProvider({ children }: StacksProviderProps) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState({
    isConnected: false,
    isConnecting: false,
    address: null as string | null,
  });

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

  return (
    <WalletContext.Provider value={{ ...state, mounted, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}
