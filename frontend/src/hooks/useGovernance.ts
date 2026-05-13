"use client";

import { useCallback, useEffect, useState } from "react";
import { cvToValue, hexToCV } from "@stacks/transactions";
import { CONTRACTS } from "@/lib/constants";

const API_BASE = "/api/stacks";

export interface GovernanceState {
  admin: string | null;
  guardian: string | null;
  timelock: string | null;
  bootstrapLocked: boolean | null;
  delayBlocks: number | null;
}

async function read(
  contractName: string,
  fnName: string,
  args: string[] = []
): Promise<string | null> {
  const resp = await fetch(
    `${API_BASE}/v2/contracts/call-read/${CONTRACTS.DEPLOYER}/${contractName}/${fnName}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender: CONTRACTS.DEPLOYER, arguments: args }),
    }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.okay) return null;
  return data.result as string;
}

function unwrap(hex: string | null): unknown {
  if (!hex) return null;
  try {
    const parsed = cvToValue(hexToCV(hex)) as any;
    if (parsed && typeof parsed === "object" && "value" in parsed) {
      return parsed.value;
    }
    return parsed;
  } catch {
    return null;
  }
}

function asPrincipal(v: unknown): string | null {
  if (typeof v === "string") return v;
  return null;
}

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

export function useGovernanceState() {
  const [state, setState] = useState<GovernanceState>({
    admin: null,
    guardian: null,
    timelock: null,
    bootstrapLocked: null,
    delayBlocks: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [adminHex, guardianHex, timelockHex, lockedHex, delayHex] =
        await Promise.all([
          read(CONTRACTS.SSE_GOVERNANCE, "get-admin"),
          read(CONTRACTS.SSE_GOVERNANCE, "get-guardian"),
          read(CONTRACTS.SSE_GOVERNANCE, "get-timelock"),
          read(CONTRACTS.SSE_GOVERNANCE, "is-bootstrap-locked"),
          read(CONTRACTS.SSE_TIMELOCK, "get-delay"),
        ]);

      setState({
        admin: asPrincipal(unwrap(adminHex)),
        guardian: asPrincipal(unwrap(guardianHex)),
        timelock: asPrincipal(unwrap(timelockHex)),
        bootstrapLocked: asBool(unwrap(lockedHex)),
        delayBlocks: asNumber(unwrap(delayHex)),
      });
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { state, isLoading, error, refetch };
}

export interface QueuedAction {
  id: number;
  actionHash: string;
  target: number;
  fn: number;
  eta: number;
  executed: boolean;
  cancelled: boolean;
}

/**
 * Look up a single queued action by id.
 * Returns null when no action exists for that id.
 */
export function useQueuedAction(id: number | null) {
  const [action, setAction] = useState<QueuedAction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (id === null || !Number.isFinite(id) || id < 0) {
      setAction(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const idHex = "0x01" + id.toString(16).padStart(32, "0");
      const hex = await read(CONTRACTS.SSE_TIMELOCK, "get-action", [idHex]);
      if (!hex) {
        setAction(null);
        return;
      }
      const parsed = cvToValue(hexToCV(hex)) as any;
      // (some {...}) or none
      if (!parsed || parsed.type === "none") {
        setAction(null);
        return;
      }
      const inner = parsed.value ?? parsed;
      if (!inner || typeof inner !== "object") {
        setAction(null);
        return;
      }

      const f = (k: string) => {
        const v = inner[k];
        if (v && typeof v === "object" && "value" in v) return v.value;
        return v;
      };

      const ah = f("action-hash");
      const target = f("target");
      const fn = f("fn");
      const eta = f("eta");
      const executed = f("executed");
      const cancelled = f("cancelled");

      setAction({
        id,
        actionHash: typeof ah === "string" ? ah : "",
        target: asNumber(target) ?? 0,
        fn: asNumber(fn) ?? 0,
        eta: asNumber(eta) ?? 0,
        executed: Boolean(executed),
        cancelled: Boolean(cancelled),
      });
    } catch (err) {
      setError(err as Error);
      setAction(null);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { action, isLoading, error, refetch };
}
