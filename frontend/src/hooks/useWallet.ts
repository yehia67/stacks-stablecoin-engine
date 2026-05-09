"use client";

import { useContext } from "react";
import { WalletContext } from "@/components/providers/StacksProvider";

export type { WalletState } from "@/components/providers/StacksProvider";

export function useWallet() {
  return useContext(WalletContext);
}
