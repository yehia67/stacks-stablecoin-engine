"use client";

import { useState } from "react";
import {
  Shield,
  ShieldAlert,
  Clock,
  Lock,
  Unlock,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Search,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CONTRACTS,
  TIMELOCK_TARGETS,
  TIMELOCK_FNS,
  getContractId,
  getExplorerAddressUrl,
} from "@/lib/constants";
import { formatAddress } from "@/lib/utils";
import { useGovernanceState, useQueuedAction } from "@/hooks/useGovernance";

const TARGET_NAMES: Record<number, string> = {
  [TIMELOCK_TARGETS.FACTORY]: "Stablecoin Factory",
  [TIMELOCK_TARGETS.COLLATERAL]: "Collateral Registry",
  [TIMELOCK_TARGETS.BRIDGE]: "Bridge Registry",
  [TIMELOCK_TARGETS.XRESERVE]: "xReserve Adapter",
  [TIMELOCK_TARGETS.VAULT]: "Vault Engine",
  [TIMELOCK_TARGETS.SELF]: "Timelock / Governance",
};

const FN_NAMES: Record<number, Record<number, string>> = {
  [TIMELOCK_TARGETS.FACTORY]: {
    [TIMELOCK_FNS.factory.SET_FEE]: "set-registration-fee",
    [TIMELOCK_FNS.factory.SET_TREASURY]: "set-treasury-address",
  },
  [TIMELOCK_TARGETS.COLLATERAL]: {
    [TIMELOCK_FNS.collateral.ADD]: "add-collateral-type",
    [TIMELOCK_FNS.collateral.UPDATE]: "update-collateral-params",
    [TIMELOCK_FNS.collateral.SET_ENABLED]: "set-collateral-enabled",
    [TIMELOCK_FNS.collateral.UPDATE_ORACLE]: "update-oracle",
    [TIMELOCK_FNS.collateral.SET_VAULT_AUTH]: "set-vault-engine-authorized",
  },
  [TIMELOCK_TARGETS.BRIDGE]: {
    [TIMELOCK_FNS.bridge.ADD_CHAIN]: "add-chain",
    [TIMELOCK_FNS.bridge.DISABLE_CHAIN]: "disable-chain",
    [TIMELOCK_FNS.bridge.REGISTER_TOKEN]: "register-token",
    [TIMELOCK_FNS.bridge.UPDATE_ADAPTER]: "update-token-adapter",
    [TIMELOCK_FNS.bridge.SET_TOKEN_ENABLED]: "set-token-enabled",
    [TIMELOCK_FNS.bridge.CONFIG_CHAIN]: "configure-token-chain",
  },
  [TIMELOCK_TARGETS.XRESERVE]: {
    [TIMELOCK_FNS.xreserve.SET_ATTEST]: "set-attestation-service",
    [TIMELOCK_FNS.xreserve.SET_TOKEN]: "set-bridged-token",
    [TIMELOCK_FNS.xreserve.SET_PAUSED]: "set-paused",
    [TIMELOCK_FNS.xreserve.ADD_CHAIN]: "add-supported-chain",
    [TIMELOCK_FNS.xreserve.REMOVE_CHAIN]: "remove-supported-chain",
  },
  [TIMELOCK_TARGETS.VAULT]: {
    [TIMELOCK_FNS.vault.REGISTER_ORACLE]: "register-asset-oracle",
  },
  [TIMELOCK_TARGETS.SELF]: {
    [TIMELOCK_FNS.self.SET_DELAY]: "set-delay",
    [TIMELOCK_FNS.self.SET_EMERGENCY]: "set-emergency-whitelist",
    [TIMELOCK_FNS.self.ROTATE_ADMIN]: "rotate-admin",
    [TIMELOCK_FNS.self.ROTATE_GUARDIAN]: "rotate-guardian",
  },
};

const EMERGENCY_DEFAULTS: { target: number; fn: number; label: string }[] = [
  { target: TIMELOCK_TARGETS.COLLATERAL, fn: TIMELOCK_FNS.collateral.SET_ENABLED, label: "Collateral Registry · set-collateral-enabled" },
  { target: TIMELOCK_TARGETS.BRIDGE, fn: TIMELOCK_FNS.bridge.SET_TOKEN_ENABLED, label: "Bridge Registry · set-token-enabled" },
  { target: TIMELOCK_TARGETS.XRESERVE, fn: TIMELOCK_FNS.xreserve.SET_PAUSED, label: "xReserve Adapter · set-paused" },
];

const GOVERNED_CONTRACTS: { label: string; key: keyof typeof CONTRACTS }[] = [
  { label: "Stablecoin Factory", key: "STABLECOIN_FACTORY" },
  { label: "Collateral Registry", key: "COLLATERAL_REGISTRY" },
  { label: "Bridge Registry", key: "BRIDGE_REGISTRY" },
  { label: "xReserve Adapter", key: "XRESERVE_ADAPTER" },
  { label: "Multi-Asset Vault Engine", key: "MULTI_ASSET_VAULT_ENGINE" },
];

const MULTISIG_DASHBOARDS: { network: "Testnet" | "Mainnet"; url: string }[] = [
  {
    network: "Testnet",
    url: "https://stx.asigna.io/vault/SN32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8K3EJAEF/dashboard",
  },
  {
    network: "Mainnet",
    url: "https://stx.asigna.io/vault/SM32SVN2P08XVZ6FT0WRRJKJNQ49KQ1EB8HF1YTDX/dashboard",
  },
];

function blocksToHuman(blocks: number | null): string {
  if (blocks === null) return "—";
  // Stacks block time: ~10 minutes
  const minutes = blocks * 10;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 24) return `${hours}h ${remMin}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
}

export default function GovernancePage() {
  const { state, isLoading } = useGovernanceState();
  const [lookupIdInput, setLookupIdInput] = useState("");
  const [lookupId, setLookupId] = useState<number | null>(null);
  const { action, isLoading: actionLoading } = useQueuedAction(lookupId);

  const adminUrl = state.admin ? getExplorerAddressUrl(state.admin) : null;
  const guardianUrl = state.guardian ? getExplorerAddressUrl(state.guardian) : null;
  const timelockExpected = getContractId(CONTRACTS.SSE_TIMELOCK);
  const timelockMatchesExpected = state.timelock === timelockExpected;

  return (
    <div className="container px-4 py-8">
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Shield className="h-7 w-7 text-primary" />
          Governance
        </h1>
        <p className="text-muted-foreground">
          Read-only inspector for the SSE governance + timelock surface. All admin actions on the
          governed contracts must be queued from the multisig admin and executed via the timelock
          after the delay.
        </p>
      </div>

      {/* Roles */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Admin
              <Badge variant="outline">Asigna multisig</Badge>
            </CardTitle>
            <CardDescription>Can queue, execute, and trigger emergency fast-paths.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <span className="text-muted-foreground">Loading…</span>
            ) : state.admin ? (
              <a
                href={adminUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 break-all font-mono text-sm text-primary hover:underline"
              >
                {formatAddress(state.admin)}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-destructive">unset</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Guardian
              <Badge variant="outline">cancel-only</Badge>
            </CardTitle>
            <CardDescription>Can cancel queued actions during the delay window.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <span className="text-muted-foreground">Loading…</span>
            ) : state.guardian ? (
              <a
                href={guardianUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 break-all font-mono text-sm text-primary hover:underline"
              >
                {formatAddress(state.guardian)}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-destructive">unset</span>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Timelock Delay
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardTitle>
            <CardDescription>Minimum blocks between queue and execute.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading ? "…" : state.delayBlocks ?? "—"} blocks
            </div>
            <p className="text-xs text-muted-foreground">
              ≈ {blocksToHuman(state.delayBlocks)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Multisignature dashboard</CardTitle>
          <CardDescription>
            Direct links to the Asigna vault dashboards used for SSE governance operations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {MULTISIG_DASHBOARDS.map((dashboard) => (
              <div
                key={dashboard.network}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <span className="font-medium">{dashboard.network}</span>
                <a
                  href={dashboard.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  Open dashboard <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Status banner */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {state.bootstrapLocked ? (
              <>
                <Lock className="h-4 w-4 text-green-600" />
                Bootstrap locked
              </>
            ) : (
              <>
                <Unlock className="h-4 w-4 text-amber-600" />
                Bootstrap unlocked
              </>
            )}
            {state.bootstrapLocked === false && (
              <Badge variant="destructive">deployer can still override</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {state.bootstrapLocked
              ? "All admin paths go through the timelock. The deployer can no longer bypass governance."
              : "Deployer is still allowed to call admin functions directly until bootstrap is locked."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Timelock pinned at:</span>
            <code className="rounded bg-muted px-2 py-1 font-mono text-xs">
              {state.timelock ? formatAddress(state.timelock) : "—"}
            </code>
            {state.timelock &&
              (timelockMatchesExpected ? (
                <Badge variant="outline" className="gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-600" /> UI matches timelock
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" /> mismatch — expected {formatAddress(timelockExpected)}
                </Badge>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Governed surface */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Governed contracts</CardTitle>
          <CardDescription>
            Each of these contracts has a one-shot bootstrap that pinned its governance principal to
            the timelock. After lock-bootstrap, admin functions only accept calls from the timelock.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {GOVERNED_CONTRACTS.map((c) => {
              const name = CONTRACTS[c.key] as string;
              const fqn = getContractId(name);
              return (
                <div
                  key={c.key}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <div className="font-medium">{c.label}</div>
                    <code className="text-xs text-muted-foreground">{name}</code>
                  </div>
                  <a
                    href={getExplorerAddressUrl(fqn)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    explorer <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Emergency whitelist */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            Emergency whitelist (default seed)
          </CardTitle>
          <CardDescription>
            Admin can call these functions through the timelock with <strong>no delay</strong>.
            Only pause-style switches are seeded by default; mutations to the whitelist itself go
            through the normal queue/execute flow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {EMERGENCY_DEFAULTS.map((e) => (
              <li key={`${e.target}-${e.fn}`} className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  T{e.target} · F{e.fn}
                </Badge>
                <span>{e.label}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Action inspector */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" />
            Queued action inspector
          </CardTitle>
          <CardDescription>
            Look up a queued action by its caller-chosen id (see the <code>queued</code> event on the
            multisig tx).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(lookupIdInput);
              setLookupId(Number.isFinite(n) && n >= 0 ? n : null);
            }}
          >
            <Input
              type="number"
              min={0}
              placeholder="Enter action id"
              value={lookupIdInput}
              onChange={(e) => setLookupIdInput(e.target.value)}
            />
            <Button type="submit">Look up</Button>
          </form>

          {lookupId !== null && (
            <div className="mt-4">
              {actionLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : action ? (
                <div className="space-y-2 rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    {action.executed ? (
                      <Badge variant="outline" className="gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-600" /> executed
                      </Badge>
                    ) : action.cancelled ? (
                      <Badge variant="destructive" className="gap-1">
                        <XCircle className="h-3 w-3" /> cancelled
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="gap-1">
                        <Clock className="h-3 w-3 text-amber-600" /> queued
                      </Badge>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Target</span>
                    <span>
                      {TARGET_NAMES[action.target] || `unknown (${action.target})`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Function</span>
                    <code className="text-xs">
                      {FN_NAMES[action.target]?.[action.fn] || `fn-${action.fn}`}
                    </code>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Eta (block)</span>
                    <span>{action.eta}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Action hash</span>
                    <code className="mt-1 block break-all rounded bg-muted p-2 text-xs">
                      {action.actionHash}
                    </code>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No action found for id {lookupId}.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
