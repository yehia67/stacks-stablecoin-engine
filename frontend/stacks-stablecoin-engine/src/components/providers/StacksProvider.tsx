"use client";

import { Connect } from "@stacks/connect-react";
import { userSession } from "@/lib/stacks";
import { APP_CONFIG } from "@/lib/constants";

interface StacksProviderProps {
  children: React.ReactNode;
}

export function StacksProvider({ children }: StacksProviderProps) {
  return (
    <Connect
      authOptions={{
        appDetails: {
          name: APP_CONFIG.name,
          icon: typeof window !== "undefined" 
            ? window.location.origin + APP_CONFIG.icon 
            : APP_CONFIG.icon,
        },
        redirectTo: "/",
        onFinish: () => {
          window.location.reload();
        },
        userSession,
      }}
    >
      {children}
    </Connect>
  );
}
