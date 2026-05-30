"use client";

import { createContext, useCallback, useEffect, useState } from "react";
import { connectWallet, disconnectWallet, isConnected, getUserAddress } from "@/lib/stacks";
import { getActiveStacksWallet, getInstalledStacksWallets, getSelectedStacksWallet, selectStacksWallet } from "@/lib/walletProvider";

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
      // Restore session. Also ensure a wallet provider is pinned: a returning
      // user has an address in localStorage but @stacks/connect doesn't
      // always persist setSelectedProviderId across sessions, so subsequent
      // signing actions (deploy especially) would otherwise hit
      // "No wallet selected". If there's exactly one installed wallet,
      // pin it now so every later request() routes deterministically.
      if (!getSelectedStacksWallet()) {
        // Prefer whichever wallet `window.StacksProvider` actually points
        // at -- that's the wallet answering this session's RPC calls
        // regardless of how many extensions are installed.
        const active = getActiveStacksWallet();
        if (active) {
          selectStacksWallet(active.id);
        } else {
          const installed = getInstalledStacksWallets();
          if (installed.length === 1) selectStacksWallet(installed[0].id);
        }
      }
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
      // @stacks/connect's `connect()` shows its own picker for multi-wallet
      // setups and pins the choice. For single-wallet setups it may skip
      // the picker and leave the pinned provider unset, which breaks later
      // signing actions. Pin the only installed wallet as a fallback.
      if (!getSelectedStacksWallet()) {
        // Prefer whichever wallet `window.StacksProvider` actually points
        // at -- that's the wallet answering this session's RPC calls
        // regardless of how many extensions are installed.
        const active = getActiveStacksWallet();
        if (active) {
          selectStacksWallet(active.id);
        } else {
          const installed = getInstalledStacksWallets();
          if (installed.length === 1) selectStacksWallet(installed[0].id);
        }
      }
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
