"use client";

interface StacksProviderProps {
  children: React.ReactNode;
}

export function StacksProvider({ children }: StacksProviderProps) {
  return <>{children}</>;
}
