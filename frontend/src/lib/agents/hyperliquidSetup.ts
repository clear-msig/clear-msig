import type { AgentVenueReadiness } from "@/lib/agents/clientExecution";

const STORAGE_KEY = "clear.agents.hyperliquidSetup.v1";

export interface AgentHyperliquidSetupSettings {
  accountAddress: string;
  agentWalletAddress: string;
  updatedAt: number;
  version: 1;
}

export type AgentHyperliquidSetupStepStatus = "ready" | "todo" | "blocked";

export interface AgentHyperliquidSetupStep {
  id: "account" | "funding" | "agent_wallet" | "connection";
  label: string;
  status: AgentHyperliquidSetupStepStatus;
  message: string;
}

export interface AgentHyperliquidSetupSummary {
  status: "ready" | "needs_setup" | "blocked";
  headline: string;
  steps: AgentHyperliquidSetupStep[];
}

export function getAgentHyperliquidSetupSettings(
  walletName: string,
): AgentHyperliquidSetupSettings {
  const all = readAll();
  const existing = all[walletName];
  if (existing) return existing;
  return {
    accountAddress: "",
    agentWalletAddress: "",
    updatedAt: 0,
    version: 1,
  };
}

export function saveAgentHyperliquidSetupSettings(
  walletName: string,
  settings: Pick<AgentHyperliquidSetupSettings, "accountAddress"> &
    Partial<Pick<AgentHyperliquidSetupSettings, "agentWalletAddress">>,
): AgentHyperliquidSetupSettings {
  const accountAddress = settings.accountAddress.trim().toLowerCase();
  const agentWalletAddress = (settings.agentWalletAddress ?? "").trim().toLowerCase();
  if (accountAddress && !isEvmAddress(accountAddress)) {
    throw new Error("Enter a valid 0x Hyperliquid testnet account address.");
  }
  if (agentWalletAddress && !isEvmAddress(agentWalletAddress)) {
    throw new Error("Enter a valid 0x Hyperliquid API wallet address.");
  }
  if (accountAddress && agentWalletAddress && accountAddress === agentWalletAddress) {
    throw new Error("Use a separate API wallet address from the funded account.");
  }
  const all = readAll();
  const updated: AgentHyperliquidSetupSettings = {
    accountAddress,
    agentWalletAddress,
    updatedAt: Date.now(),
    version: 1,
  };
  all[walletName] = updated;
  writeAll(all);
  return updated;
}

export function buildAgentHyperliquidSetupSummary(
  readiness: AgentVenueReadiness | null,
  settings: AgentHyperliquidSetupSettings,
): AgentHyperliquidSetupSummary {
  const accountAddress =
    readiness?.accountProbe?.accountAddress ?? settings.accountAddress;
  const accountReady = Boolean(accountAddress);
  const funded = readiness?.accountProbe?.state === "funded";
  const agentWalletReady = Boolean(settings.agentWalletAddress);
  const connectionReady =
    readiness?.state === "ready" &&
    readiness.executorProbe?.state === "ready" &&
    Boolean(readiness.executorProbe.agentWalletAddress);
  const connectionBlocked =
    readiness?.state === "not_configured" ||
    readiness?.executorProbe?.state === "not_configured";
  const steps: AgentHyperliquidSetupStep[] = [
    {
      id: "account",
      label: "Practice account",
      status: accountReady ? "ready" : "todo",
      message: accountReady
        ? `Using ${shortAddress(accountAddress)}.`
        : "Paste the public address for a dedicated Hyperliquid testnet account.",
    },
    {
      id: "funding",
      label: "Practice funds",
      status: funded ? "ready" : accountReady ? "todo" : "blocked",
      message: funded
        ? "The practice account has testnet collateral."
        : accountReady
          ? readiness?.accountProbe?.message ??
            "Add testnet collateral to this practice account."
          : "Add a practice account before checking funds.",
    },
    {
      id: "agent_wallet",
      label: "Approved API wallet",
      status: agentWalletReady ? "ready" : accountReady ? "todo" : "blocked",
      message: agentWalletReady
        ? `Delegated signer ${shortAddress(settings.agentWalletAddress)} is recorded.`
        : accountReady
          ? "Approve a separate Hyperliquid API wallet public address for this account, then paste it here."
          : "Add the funded practice account before recording its delegated signer.",
    },
    {
      id: "connection",
      label: "Protected executor",
      status: connectionReady ? "ready" : connectionBlocked ? "blocked" : "todo",
      message: connectionReady
        ? "The server-side executor is reachable and reports the approved API wallet."
        : connectionBlocked
          ? "The protected executor is missing the account, API wallet, URL, token, or private signing key."
          : readiness?.executorProbe?.message ??
            readiness?.message ??
            "ClearSig is checking the server-side executor.",
    },
  ];
  const blocked = steps.some((step) => step.status === "blocked");
  const ready = steps.every((step) => step.status === "ready");
  return {
    status: ready ? "ready" : blocked ? "blocked" : "needs_setup",
    headline: ready
      ? "Hyperliquid practice is ready"
      : blocked
        ? "Protected connection pending"
        : "Finish Hyperliquid practice setup",
    steps,
  };
}

function readAll(): Record<string, AgentHyperliquidSetupSettings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([key, value]) => [key, normalizeSettings(value)] as const)
        .filter((entry): entry is readonly [string, AgentHyperliquidSetupSettings] =>
          Boolean(entry[1]),
        ),
    );
  } catch {
    return {};
  }
}

function writeAll(settings: Record<string, AgentHyperliquidSetupSettings>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function normalizeSettings(input: unknown): AgentHyperliquidSetupSettings | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const item = input as Record<string, unknown>;
  if (
    typeof item.accountAddress !== "string" ||
    typeof item.updatedAt !== "number" ||
    item.version !== 1
  ) {
    return null;
  }
  return {
    accountAddress: item.accountAddress,
    agentWalletAddress:
      typeof item.agentWalletAddress === "string" ? item.agentWalletAddress : "",
    updatedAt: item.updatedAt,
    version: 1,
  };
}

function isEvmAddress(value: string): boolean {
  return /^0x[a-f0-9]{40}$/.test(value);
}

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}
