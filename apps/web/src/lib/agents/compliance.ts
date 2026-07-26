import type { TradingLaunchVenue } from "@/lib/agents/launchReadiness";

export type AgentComplianceDisclosureId =
  | "simulation"
  | "automation"
  | "leverage"
  | "creator_owned"
  | "data_limits"
  | "fees";

export interface AgentComplianceDisclosure {
  id: AgentComplianceDisclosureId;
  label: string;
  summary: string;
  requiredFor: TradingLaunchVenue[];
}

export interface AgentComplianceAcknowledgement {
  walletName: string;
  venue: TradingLaunchVenue;
  disclosureIds: AgentComplianceDisclosureId[];
  acknowledgedAt: number;
  version: 1;
}

export interface AgentComplianceReadiness {
  accepted: boolean;
  acknowledgement: AgentComplianceAcknowledgement | null;
  required: AgentComplianceDisclosure[];
  missing: AgentComplianceDisclosure[];
}

const STORAGE_KEY = "clear.agent-compliance.v1";

export const AGENT_COMPLIANCE_DISCLOSURES: readonly AgentComplianceDisclosure[] = [
  {
    id: "simulation",
    label: "Practice results are not live results",
    summary:
      "Built-in practice is simulated, and testnet trades use practice funds. Neither proves real-money performance.",
    requiredFor: ["mock_perps", "hyperliquid_testnet"],
  },
  {
    id: "automation",
    label: "Automatic trading can act without asking each time",
    summary:
      "After you turn it on, ClearSig may accept allowed agent ideas inside the current allowance and safety rules.",
    requiredFor: ["mock_perps", "hyperliquid_testnet"],
  },
  {
    id: "leverage",
    label: "Leverage can increase losses",
    summary:
      "Even in practice, leverage and poor stops can create large losses. Keep allowances small while testing.",
    requiredFor: ["mock_perps", "hyperliquid_testnet"],
  },
  {
    id: "creator_owned",
    label: "Creator agents are externally operated",
    summary:
      "Published creator agents may use their own models, data, and hosting. ClearSig checks decisions, but does not train or guarantee them.",
    requiredFor: ["mock_perps", "hyperliquid_testnet"],
  },
  {
    id: "data_limits",
    label: "Market data can be delayed or incomplete",
    summary:
      "Agent decisions depend on available data. News, macro context, funding, prices, and exchange state may be missing or stale.",
    requiredFor: ["mock_perps", "hyperliquid_testnet"],
  },
  {
    id: "fees",
    label: "Creator payouts are not live yet",
    summary:
      "Future creator fees require verified live performance, legal review, fee accounting, and venue reconciliation.",
    requiredFor: ["mock_perps", "hyperliquid_testnet"],
  },
] as const;

export function buildAgentComplianceReadiness(
  walletName: string,
  venue: TradingLaunchVenue,
): AgentComplianceReadiness {
  const acknowledgement = getAgentComplianceAcknowledgement(walletName, venue);
  const required = requiredAgentComplianceDisclosures(venue);
  const accepted = new Set(acknowledgement?.disclosureIds ?? []);
  const missing = required.filter((item) => !accepted.has(item.id));
  return {
    accepted: missing.length === 0,
    acknowledgement,
    required,
    missing,
  };
}

export function requiredAgentComplianceDisclosures(
  venue: TradingLaunchVenue,
): AgentComplianceDisclosure[] {
  return AGENT_COMPLIANCE_DISCLOSURES.filter((item) =>
    item.requiredFor.includes(venue),
  );
}

export function hasAgentComplianceAcknowledgement(
  walletName: string,
  venue: TradingLaunchVenue,
): boolean {
  return buildAgentComplianceReadiness(walletName, venue).accepted;
}

export function acknowledgeAgentComplianceDisclosures({
  walletName,
  venue,
  now = Date.now(),
}: {
  walletName: string;
  venue: TradingLaunchVenue;
  now?: number;
}): AgentComplianceAcknowledgement {
  const shape = readAll();
  shape[walletName] ??= {};
  const acknowledgement: AgentComplianceAcknowledgement = {
    walletName,
    venue,
    disclosureIds: requiredAgentComplianceDisclosures(venue).map((item) => item.id),
    acknowledgedAt: now,
    version: 1,
  };
  shape[walletName][venue] = acknowledgement;
  writeAll(shape);
  return acknowledgement;
}

export function getAgentComplianceAcknowledgement(
  walletName: string,
  venue: TradingLaunchVenue,
): AgentComplianceAcknowledgement | null {
  return readAll()[walletName]?.[venue] ?? null;
}

type StoredShape = Partial<
  Record<string, Partial<Record<TradingLaunchVenue, AgentComplianceAcknowledgement>>>
>;

function readAll(): StoredShape {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StoredShape) : {};
  } catch {
    return {};
  }
}

function writeAll(shape: StoredShape): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
  } catch {
    /* localStorage failures should not break the page */
  }
}
