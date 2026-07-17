import type {
  AgentConnectionKit,
  AgentExecutionRecord,
  AgentOwnerApproval,
  AgentProfile,
  AgentSessionGrant,
  AgentTradeProposal,
  AgentVaultPolicy,
} from "@/lib/agents/types";

export type AgentMarketReadinessStatus = "ready" | "needs_work" | "blocked";
export type AgentMarketReadinessCheckStatus = "pass" | "todo" | "block";
export type AgentMarketReadinessPhaseId =
  | "controlled_paper"
  | "public_paper"
  | "live_capital";

export interface AgentMarketReadinessCheck {
  id: string;
  label: string;
  category: string;
  status: AgentMarketReadinessCheckStatus;
  message: string;
  requiredFor: AgentMarketReadinessPhaseId[];
  href?: string;
}

export interface AgentMarketReadinessPhase {
  id: AgentMarketReadinessPhaseId;
  label: string;
  status: AgentMarketReadinessStatus;
  score: number;
  headline: string;
  summary: string;
}

export interface AgentMarketReadiness {
  status: AgentMarketReadinessStatus;
  score: number;
  headline: string;
  summary: string;
  phases: AgentMarketReadinessPhase[];
  checks: AgentMarketReadinessCheck[];
}

export interface AgentMarketReadinessInput {
  agents: AgentProfile[];
  policy: AgentVaultPolicy;
  sessions: AgentSessionGrant[];
  executions: AgentExecutionRecord[];
  proposals: AgentTradeProposal[];
  approvals: AgentOwnerApproval[];
  connections: AgentConnectionKit[];
  backend: {
    state: "checking" | "synced" | "local";
    storage?: "redis" | "memory";
  };
  marketData: {
    openMarkets: number;
    pricedOpenMarkets: number;
    liveMarkets: number;
    hasFundingRates: boolean;
  };
  venue: {
    state: "checking" | "connected" | "needs_setup" | "unavailable";
  };
  operations?: AgentMarketOperationalControls;
  walletHref: string;
}

export interface AgentMarketOperationalControls {
  walletSignedMutations?: "none" | "partial" | "required";
  creatorRegistry?: "none" | "local_profiles" | "public_registry" | "verified_registry";
  creatorPayouts?: "not_started" | "designed" | "sandbox" | "live";
  externalVerification?: "none" | "signal_key" | "signed_decisions" | "verified_signing";
  marketIntelligence?: {
    news: boolean;
    macro: boolean;
    rateLimited: boolean;
  };
  leaderboardMode?: "mixed" | "paper_only" | "separated";
  compliance?: "none" | "draft" | "user_disclosures" | "reviewed";
  moderation?: "none" | "admin_review" | "active";
  abuseControls?: {
    sameOrigin: boolean;
    rateLimits: boolean;
    signalKeys: boolean;
    replayProtection: boolean;
    signedSignals: boolean;
  };
  venueReconciliation?: "none" | "requested" | "testnet_snapshots" | "verified_fills";
}

const ALL_PHASES: AgentMarketReadinessPhaseId[] = [
  "controlled_paper",
  "public_paper",
  "live_capital",
];

export function buildAgentMarketReadiness({
  agents,
  policy,
  sessions,
  executions,
  proposals,
  approvals,
  connections,
  backend,
  marketData,
  venue,
  operations = {},
  walletHref,
}: AgentMarketReadinessInput): AgentMarketReadiness {
  const activeAgents = agents.filter((agent) => agent.status === "active");
  const activeSessions = sessions.filter((session) => session.status === "active");
  const publishedAgents = agents.filter(
    (agent) => agent.publishing?.status === "published",
  );
  const externalAgents = agents.filter(
    (agent) => agent.kind === "api" || agent.kind === "hermes",
  );
  const signedApprovals = approvals.filter(
    (approval) =>
      approval.approvalMethod === "wallet_signature" && Boolean(approval.signature),
  );
  const testnetExecutions = executions.filter(
    (execution) => execution.executionMode === "testnet" || execution.venue === "hyperliquid_testnet",
  );
  const verifiedVenueExecutions = testnetExecutions.filter((execution) =>
    Boolean(execution.externalOrderId),
  );
  const walletSignedMutations =
    operations.walletSignedMutations ??
    (signedApprovals.length > 0 ? "partial" : "none");
  const creatorRegistry =
    operations.creatorRegistry ??
    (publishedAgents.length > 0 ? "local_profiles" : "none");
  const externalVerification =
    operations.externalVerification ??
    (connections.length > 0 ? "signal_key" : "none");
  const leaderboardMode =
    operations.leaderboardMode ??
    (testnetExecutions.length > 0 ? "mixed" : "paper_only");
  const abuseControls = operations.abuseControls ?? {
    sameOrigin: true,
    rateLimits: true,
    signalKeys: connections.length > 0,
    replayProtection: proposals.some((proposal) => Boolean(proposal.clientSignalId)),
    signedSignals: false,
  };
  const venueReconciliation =
    operations.venueReconciliation ??
    (venue.state === "connected" ? "testnet_snapshots" : "requested");
  const intelligence = operations.marketIntelligence ?? {
    news: false,
    macro: false,
    rateLimited: true,
  };

  const checks: AgentMarketReadinessCheck[] = [
    {
      id: "practice-loop",
      label: "Practice trading loop",
      category: "Core product",
      status:
        activeAgents.length > 0 &&
        activeSessions.length > 0 &&
        policy.enabled &&
        !policy.emergencyPaused
          ? "pass"
          : policy.emergencyPaused
            ? "block"
            : "todo",
      message:
        activeAgents.length > 0 && activeSessions.length > 0 && policy.enabled
          ? "At least one active trader has a bounded allowance under ClearSig rules."
          : "Choose a trader, set safety rules, and give it a small practice allowance.",
      requiredFor: ALL_PHASES,
      href: `${walletHref}/agents/start`,
    },
    {
      id: "production-persistence",
      label: "Production-grade persistence",
      category: "Infrastructure",
      status:
        backend.state === "synced" && backend.storage === "redis"
          ? "pass"
          : backend.state === "local"
            ? "block"
            : "todo",
      message:
        backend.state === "synced" && backend.storage === "redis"
          ? "Agent state is backed by Redis instead of browser or process memory."
          : backend.state === "synced"
            ? "Backend state is reachable, but public testing still needs Redis or database persistence."
            : backend.state === "checking"
              ? "ClearSig is checking the backend state store."
              : "Agent state is local-only; public testers would lose or split state.",
      requiredFor: ["public_paper", "live_capital"],
    },
    {
      id: "wallet-signed-permissions",
      label: "Wallet-signed permissions",
      category: "Security",
      status:
        walletSignedMutations === "required"
          ? "pass"
          : walletSignedMutations === "partial" || signedApprovals.length > 0
            ? "todo"
            : "block",
      message:
        walletSignedMutations === "required"
          ? "Agent state changes require owner wallet signatures."
          : walletSignedMutations === "partial" || signedApprovals.length > 0
            ? "Some sensitive actions are signed, but every fund-impacting mutation must require signatures."
            : "No wallet-signed owner approval has been recorded for agent permissions yet.",
      requiredFor: ["public_paper", "live_capital"],
      href: `${walletHref}/agents/approvals`,
    },
    {
      id: "venue-reconciliation",
      label: "Live exchange reconciliation",
      category: "Execution",
      status:
        venueReconciliation === "verified_fills" &&
        verifiedVenueExecutions.length === testnetExecutions.length
          ? "pass"
          : testnetExecutions.length > 0 &&
              verifiedVenueExecutions.length < testnetExecutions.length
            ? "block"
            : venueReconciliation === "testnet_snapshots"
              ? "todo"
              : "todo",
      message:
        venueReconciliation === "verified_fills"
          ? "Venue fills, positions, fees, and PnL can be reconciled against exchange artifacts."
          : testnetExecutions.length > 0 &&
              verifiedVenueExecutions.length < testnetExecutions.length
            ? "Some venue trades are missing verified exchange order identifiers."
            : "Testnet snapshots exist, but live launch needs verified fills, fees, positions, and closed PnL.",
      requiredFor: ["live_capital"],
      href: `${walletHref}/agents/hyperliquid`,
    },
    {
      id: "creator-marketplace",
      label: "Creator marketplace",
      category: "Marketplace",
      status:
        creatorRegistry === "verified_registry"
          ? "pass"
          : creatorRegistry === "public_registry"
            ? "todo"
            : "todo",
      message:
        creatorRegistry === "verified_registry"
          ? "Creators can publish verified agents into a moderated registry."
          : publishedAgents.length > 0
            ? `${publishedAgents.length} local published profile${publishedAgents.length === 1 ? "" : "s"} exist; the public registry is still needed.`
            : "Build the public registry before users can discover third-party agents safely.",
      requiredFor: ["public_paper", "live_capital"],
      href: `${walletHref}/agents/library`,
    },
    {
      id: "creator-payouts",
      label: "Creator payouts",
      category: "Marketplace",
      status:
        operations.creatorPayouts === "live"
          ? "pass"
          : operations.creatorPayouts === "sandbox"
            ? "todo"
            : "block",
      message:
        operations.creatorPayouts === "live"
          ? "Creator performance fees are live with accounting controls."
          : operations.creatorPayouts === "sandbox"
            ? "Payout accounting is sandboxed; legal, tax, and reconciliation review remain."
            : "Do not ship creator fees until high-water marks, disputes, legal, tax, and venue reconciliation are designed.",
      requiredFor: ["live_capital"],
    },
    {
      id: "external-agent-verification",
      label: "External agent verification",
      category: "Security",
      status:
        externalVerification === "verified_signing"
          ? "pass"
          : externalVerification === "signed_decisions"
            ? "todo"
            : externalVerification === "signal_key"
              ? "todo"
              : externalAgents.length > 0
                ? "block"
                : "todo",
      message:
        externalVerification === "verified_signing"
          ? "External agents use verified identities and signed decision payloads."
          : externalVerification === "signed_decisions"
            ? "Decision signing exists; creator identity verification and key rotation remain."
            : externalVerification === "signal_key"
              ? "Submit-only signal keys exist, but public agents still need signed decisions and key rotation."
              : "External agents need verified identity, signing keys, replay protection, and endpoint review.",
      requiredFor: ["public_paper", "live_capital"],
    },
    {
      id: "market-intelligence",
      label: "Real market, news, and macro data",
      category: "Data",
      status:
        marketData.liveMarkets > 0 &&
        marketData.hasFundingRates &&
        intelligence.news &&
        intelligence.macro &&
        intelligence.rateLimited
          ? "pass"
          : marketData.pricedOpenMarkets < marketData.openMarkets
            ? "block"
            : "todo",
      message:
        marketData.liveMarkets > 0 &&
        marketData.hasFundingRates &&
        intelligence.news &&
        intelligence.macro
          ? "Agents have live prices, funding, news, and macro context through a bounded provider layer."
          : "Price/funding data is started; news, macro, source timestamps, and provider quality controls are still needed.",
      requiredFor: ["public_paper", "live_capital"],
      href: `${walletHref}/agents/trades`,
    },
    {
      id: "leaderboard-separation",
      label: "Paper/live leaderboard separation",
      category: "Trust",
      status:
        leaderboardMode === "separated"
          ? "pass"
          : leaderboardMode === "paper_only"
            ? "todo"
            : "block",
      message:
        leaderboardMode === "separated"
          ? "Paper, testnet, and verified live records are separated."
          : leaderboardMode === "paper_only"
            ? "The current track record is paper-only; live rankings must be separated before real capital."
            : "Paper and venue records may mix; split them before public trust metrics matter.",
      requiredFor: ["public_paper", "live_capital"],
      href: `${walletHref}/agents/library`,
    },
    {
      id: "compliance-disclosures",
      label: "Compliance disclosures",
      category: "Legal",
      status:
        operations.compliance === "reviewed" ||
        operations.compliance === "user_disclosures"
          ? "pass"
          : operations.compliance === "draft"
            ? "todo"
            : "block",
      message:
        operations.compliance === "reviewed"
          ? "Risk, simulation, creator, and fee disclosures are reviewed."
          : operations.compliance === "user_disclosures"
            ? "User-facing disclosures exist; legal review is still recommended before real funds."
            : operations.compliance === "draft"
              ? "Disclosure copy is drafted but not accepted in the trading flow."
              : "Add clear risk, simulation, creator, automation, and fee disclosures before broad testing.",
      requiredFor: ["public_paper", "live_capital"],
    },
    {
      id: "admin-moderation",
      label: "Admin moderation",
      category: "Operations",
      status:
        operations.moderation === "active"
          ? "pass"
          : operations.moderation === "admin_review"
            ? "todo"
            : "block",
      message:
        operations.moderation === "active"
          ? "Published agents can be reviewed, paused, delisted, and investigated."
          : operations.moderation === "admin_review"
            ? "Admin review exists; add active pause/delist/audit workflows."
            : "A public marketplace needs admin review, takedown, abuse, and incident tooling.",
      requiredFor: ["public_paper", "live_capital"],
    },
    {
      id: "abuse-rate-limits",
      label: "Abuse and rate-limit controls",
      category: "Security",
      status:
        abuseControls.sameOrigin &&
        abuseControls.rateLimits &&
        abuseControls.signalKeys &&
        abuseControls.replayProtection &&
        abuseControls.signedSignals
          ? "pass"
          : abuseControls.sameOrigin &&
              abuseControls.rateLimits &&
              abuseControls.signalKeys &&
              abuseControls.replayProtection
            ? "todo"
            : "block",
      message:
        abuseControls.signedSignals
          ? "Agent APIs have origin checks, rate limits, signal keys, replay protection, and signed decisions."
          : "Origin checks, rate limits, signal keys, and freshness checks exist; public agents still need signed decision payloads.",
      requiredFor: ["controlled_paper", "public_paper", "live_capital"],
    },
  ];

  const phases = buildPhases(checks);
  const publicPhase = phases.find((phase) => phase.id === "public_paper") ?? phases[0];
  return {
    status: publicPhase.status,
    score: publicPhase.score,
    headline: publicPhase.headline,
    summary: publicPhase.summary,
    phases,
    checks,
  };
}

function buildPhases(
  checks: AgentMarketReadinessCheck[],
): AgentMarketReadinessPhase[] {
  return [
    buildPhase(checks, "controlled_paper", "Controlled paper beta"),
    buildPhase(checks, "public_paper", "Public paper beta"),
    buildPhase(checks, "live_capital", "Live capital"),
  ];
}

function buildPhase(
  checks: AgentMarketReadinessCheck[],
  id: AgentMarketReadinessPhaseId,
  label: string,
): AgentMarketReadinessPhase {
  const required = checks.filter((check) => check.requiredFor.includes(id));
  const passed = required.filter((check) => check.status === "pass").length;
  const blocked = required.filter((check) => check.status === "block");
  const todos = required.filter((check) => check.status === "todo");
  const status =
    blocked.length > 0 ? "blocked" : todos.length > 0 ? "needs_work" : "ready";
  return {
    id,
    label,
    status,
    score: required.length === 0 ? 100 : Math.round((passed / required.length) * 100),
    headline:
      status === "ready"
        ? `${label} ready`
        : status === "blocked"
          ? `${label} blocked`
          : `${label} needs work`,
    summary:
      status === "ready"
        ? "Every required gate for this phase is passing."
        : blocked[0]?.message ?? todos[0]?.message ?? "A required gate needs attention.",
  };
}
