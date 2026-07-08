export type AgentCreatorType = "clearsig_prepared" | "external";
export type AgentCreatorRegistryStatus = "ready" | "needs_review" | "blocked";
export type AgentCreatorRegistryCheckStatus = "pass" | "todo" | "block";

export interface AgentCreatorRegistryCheck {
  id: string;
  label: string;
  status: AgentCreatorRegistryCheckStatus;
  message: string;
}

export interface AgentCreatorRegistryReadiness {
  status: AgentCreatorRegistryStatus;
  score: number;
  headline: string;
  summary: string;
  checks: AgentCreatorRegistryCheck[];
}

export interface AgentCreatorRegistryLaneInput {
  hasHistory: boolean;
}

export interface AgentCreatorRegistryDecisionInput {
  summary?: string;
  riskPlan?: string;
  exitPlan?: string;
  evidence: Array<unknown>;
}

export interface AgentCreatorRegistryReadinessInput {
  creatorType: AgentCreatorType;
  name: string;
  summary: string;
  allowedMarkets: string[];
  supportedVenues: string[];
  identityPubkey?: string;
  reviewedAt?: number;
  lanes: AgentCreatorRegistryLaneInput[];
  recentDecisions: AgentCreatorRegistryDecisionInput[];
  disclosures: string[];
}

export function buildAgentCreatorRegistryReadiness({
  creatorType,
  name,
  summary,
  allowedMarkets,
  supportedVenues,
  identityPubkey,
  reviewedAt,
  lanes,
  recentDecisions,
  disclosures,
}: AgentCreatorRegistryReadinessInput): AgentCreatorRegistryReadiness {
  const profileComplete = Boolean(name.trim()) && Boolean(summary.trim());
  const supportsMarkets = allowedMarkets.length > 0 && supportedVenues.length > 0;
  const identityVerified =
    creatorType === "clearsig_prepared" || Boolean(identityPubkey?.trim());
  const hasObservedPerformance = lanes.some((lane) => lane.hasHistory);
  const hasDecisionEvidence = recentDecisions.some(
    (decision) =>
      Boolean(decision.summary?.trim()) &&
      Boolean(decision.riskPlan?.trim()) &&
      Boolean(decision.exitPlan?.trim()) &&
      decision.evidence.length > 0,
  );
  const hasDisclosures = disclosures.length >= 4;

  const checks: AgentCreatorRegistryCheck[] = [
    {
      id: "creator-profile",
      label: "Creator profile",
      status: profileComplete ? "pass" : "block",
      message: profileComplete
        ? "Public name and summary are available."
        : "Add a public name and clear creator summary before listing.",
    },
    {
      id: "supported-markets",
      label: "Supported markets",
      status: supportsMarkets ? "pass" : "block",
      message: supportsMarkets
        ? `${allowedMarkets.length} market${allowedMarkets.length === 1 ? "" : "s"} across ${supportedVenues.length} venue${supportedVenues.length === 1 ? "" : "s"}.`
        : "Publish at least one supported market and venue.",
    },
    {
      id: "signing-identity",
      label: "Signing identity",
      status: identityVerified ? "pass" : "block",
      message: identityVerified
        ? creatorType === "clearsig_prepared"
          ? "ClearSig prepared agent identity is managed by the app."
          : "External signing identity is present for submitted decisions."
        : "External agents need a public signing key before marketplace listing.",
    },
    {
      id: "observed-performance",
      label: "Observed performance",
      status: hasObservedPerformance ? "pass" : "block",
      message: hasObservedPerformance
        ? "Marketplace performance comes from ClearSig-observed lanes."
        : "Record at least one ClearSig-observed paper, testnet, or verified live result.",
    },
    {
      id: "decision-evidence",
      label: "Decision evidence",
      status: hasDecisionEvidence ? "pass" : "todo",
      message: hasDecisionEvidence
        ? "Recent decisions include rationale, risk, exit plan, and evidence."
        : "Add decision journals with rationale, risk, exit plan, and evidence links.",
    },
    {
      id: "user-disclosures",
      label: "User disclosures",
      status: hasDisclosures ? "pass" : "todo",
      message: hasDisclosures
        ? "User-facing marketplace disclosures are attached."
        : "Attach user-facing disclosures for custody, execution, and performance risk.",
    },
    {
      id: "registry-review",
      label: "Registry review",
      status: reviewedAt ? "pass" : "todo",
      message: reviewedAt
        ? "A marketplace reviewer approved this profile."
        : "Record marketplace review metadata before public promotion.",
    },
  ];

  const passed = checks.filter((check) => check.status === "pass").length;
  const status = checks.some((check) => check.status === "block")
    ? "blocked"
    : checks.some((check) => check.status === "todo")
      ? "needs_review"
      : "ready";

  return {
    status,
    score: Math.round((passed / checks.length) * 100),
    headline:
      status === "ready"
        ? "Ready for the public agent registry"
        : status === "needs_review"
          ? "Needs registry review"
          : "Blocked from public registry promotion",
    summary:
      status === "ready"
        ? "This profile has creator identity, market coverage, observed performance, evidence, disclosures, and review metadata."
        : status === "needs_review"
          ? "The profile is visible but still has review or disclosure work before it should be promoted broadly."
          : "The profile is missing required creator, signing, market, or observed-performance evidence.",
    checks,
  };
}

export function creatorRegistryStatusLabel(status: AgentCreatorRegistryStatus): string {
  switch (status) {
    case "ready":
      return "Registry ready";
    case "needs_review":
      return "Review needed";
    case "blocked":
      return "Registry blocked";
  }
}
