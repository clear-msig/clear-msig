import type { AgentServerExecutionRecord } from "@/lib/agents/serverExecutionRequests";
import type { HyperliquidTestnetAccountSnapshot } from "@/lib/agents/serverHyperliquidTestnet";
import type { TradingVenue } from "@/lib/agents/types";

export type AgentVenueReconciliationStatus = "healthy" | "warning" | "blocked";
export type AgentVenueReconciliationIssueSeverity = "warning" | "block";

export interface AgentVenueReconciliationIssue {
  id: string;
  severity: AgentVenueReconciliationIssueSeverity;
  label: string;
  message: string;
}

export interface AgentVenueReconciliationSummary {
  venue: TradingVenue;
  status: AgentVenueReconciliationStatus;
  label: string;
  message: string;
  totalRequests: number;
  submittedRequests: number;
  pendingRequests: number;
  rejectedRequests: number;
  adapterErrors: number;
  openRequests: number;
  exchangeOpenPositions: number;
  missingOrderIds: number;
  unmatchedPositions: number;
  staleSnapshot: boolean;
  checkedAt: number;
  issues: AgentVenueReconciliationIssue[];
}

const DEFAULT_SNAPSHOT_MAX_AGE_MS = 5 * 60_000;

export function buildAgentVenueReconciliationSummary({
  venue,
  requests,
  accountSnapshot,
  now = Date.now(),
  maxSnapshotAgeMs = DEFAULT_SNAPSHOT_MAX_AGE_MS,
}: {
  venue: TradingVenue;
  requests: AgentServerExecutionRecord[];
  accountSnapshot?: HyperliquidTestnetAccountSnapshot | null;
  now?: number;
  maxSnapshotAgeMs?: number;
}): AgentVenueReconciliationSummary {
  const submittedRequests = requests.filter((request) => request.status === "submitted");
  const pendingRequests = requests.filter(
    (request) =>
      request.status === "waiting_for_setup" ||
      request.status === "adapter_not_connected",
  );
  const rejectedRequests = requests.filter((request) => request.status === "rejected");
  const adapterErrors = requests.filter((request) => request.status === "adapter_error");
  const openSubmittedRequests = submittedRequests.filter((request) =>
    requestMatchesAnyPosition(request, accountSnapshot),
  );
  const missingOrderIds = submittedRequests.filter(
    (request) => !request.artifact?.orderId?.trim(),
  ).length;
  const unmatchedPositions =
    accountSnapshot?.positions.filter(
      (position) =>
        !submittedRequests.some((request) => requestMatchesPosition(request, position)),
    ).length ?? 0;
  const staleSnapshot =
    Boolean(accountSnapshot) && accountSnapshot!.observedAt < now - maxSnapshotAgeMs;
  const issues: AgentVenueReconciliationIssue[] = [];

  if (venue !== "hyperliquid_testnet") {
    issues.push({
      id: "reconciliation_not_available",
      severity: "warning",
      label: "Venue check unavailable",
      message: "Live reconciliation is currently available for Hyperliquid testnet.",
    });
  } else if (!accountSnapshot || accountSnapshot.state === "missing_address") {
    issues.push({
      id: "missing_account_snapshot",
      severity: "warning",
      label: "Account not connected",
      message: "Add a practice account before trusting venue-level fill checks.",
    });
  } else if (accountSnapshot.state === "unavailable") {
    issues.push({
      id: "account_snapshot_unavailable",
      severity: "block",
      label: "Venue state unavailable",
      message: "ClearSig could not verify open positions from the venue right now.",
    });
  }
  if (staleSnapshot) {
    issues.push({
      id: "stale_account_snapshot",
      severity: "warning",
      label: "Stale venue data",
      message: "The latest account snapshot is older than the freshness window.",
    });
  }
  if (missingOrderIds > 0) {
    issues.push({
      id: "missing_order_ids",
      severity: "warning",
      label: "Missing order IDs",
      message: `${missingOrderIds} submitted request${missingOrderIds === 1 ? "" : "s"} did not return an exchange order ID.`,
    });
  }
  if (unmatchedPositions > 0) {
    issues.push({
      id: "unmatched_exchange_positions",
      severity: "warning",
      label: "Unmatched open positions",
      message: `${unmatchedPositions} open venue position${unmatchedPositions === 1 ? "" : "s"} do not match a ClearSig submitted request.`,
    });
  }
  if (adapterErrors.length > 0) {
    issues.push({
      id: "adapter_errors",
      severity: "block",
      label: "Executor errors",
      message: `${adapterErrors.length} venue request${adapterErrors.length === 1 ? "" : "s"} failed in the protected executor.`,
    });
  }
  if (rejectedRequests.length > 0) {
    issues.push({
      id: "rejected_requests",
      severity: "warning",
      label: "Rejected requests",
      message: `${rejectedRequests.length} venue request${rejectedRequests.length === 1 ? "" : "s"} were stopped by ClearSig checks.`,
    });
  }

  const status = issues.some((issue) => issue.severity === "block")
    ? "blocked"
    : issues.length > 0
      ? "warning"
      : "healthy";
  return {
    venue,
    status,
    label:
      status === "healthy"
        ? "Reconciled"
        : status === "blocked"
          ? "Venue check blocked"
          : "Needs review",
    message:
      status === "healthy"
        ? "Submitted requests match the latest venue state."
        : issues[0]?.message ?? "Venue reconciliation needs review.",
    totalRequests: requests.length,
    submittedRequests: submittedRequests.length,
    pendingRequests: pendingRequests.length,
    rejectedRequests: rejectedRequests.length,
    adapterErrors: adapterErrors.length,
    openRequests: openSubmittedRequests.length,
    exchangeOpenPositions: accountSnapshot?.positions.length ?? 0,
    missingOrderIds,
    unmatchedPositions,
    staleSnapshot,
    checkedAt: now,
    issues,
  };
}

function requestMatchesAnyPosition(
  request: AgentServerExecutionRecord,
  accountSnapshot?: HyperliquidTestnetAccountSnapshot | null,
): boolean {
  return Boolean(
    accountSnapshot?.positions.some((position) => requestMatchesPosition(request, position)),
  );
}

function requestMatchesPosition(
  request: AgentServerExecutionRecord,
  position: HyperliquidTestnetAccountSnapshot["positions"][number],
): boolean {
  return (
    request.request.market?.toUpperCase() === position.market.toUpperCase() &&
    (!request.request.side || request.request.side === position.side)
  );
}
