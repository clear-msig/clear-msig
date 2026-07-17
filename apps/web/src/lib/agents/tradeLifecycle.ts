import type { HyperliquidTestnetAccountSnapshot } from "@/lib/agents/serverHyperliquidTestnet";
import type {
  AgentExecutionRecord,
  AgentTradeProposal,
  TradingVenue,
} from "@/lib/agents/types";

export type AgentTradeLifecycleStepId =
  | "signal"
  | "policy"
  | "owner_approval"
  | "execution"
  | "venue_reconciliation";

export type AgentTradeLifecycleStepStatus =
  | "done"
  | "current"
  | "waiting"
  | "blocked"
  | "warning";

export type AgentTradeLifecycleStatus =
  | "draft"
  | "needs_approval"
  | "blocked"
  | "approved"
  | "submitted"
  | "open"
  | "closed"
  | "warning";

export type AgentTradeLifecycleTone =
  | "default"
  | "warning"
  | "danger"
  | "success";

export interface AgentTradeLifecycleStep {
  id: AgentTradeLifecycleStepId;
  label: string;
  status: AgentTradeLifecycleStepStatus;
  detail: string;
}

export interface AgentTradeLifecycle {
  status: AgentTradeLifecycleStatus;
  label: string;
  tone: AgentTradeLifecycleTone;
  steps: AgentTradeLifecycleStep[];
}

export interface AgentTradeLifecycleSummary {
  total: number;
  open: number;
  submitted: number;
  closed: number;
  needsApproval: number;
  blocked: number;
  warnings: number;
  actionable: number;
  label: string;
  tone: AgentTradeLifecycleTone;
}

export interface AgentTradeVenueRequestLike {
  status: string;
  message?: string;
  artifact?: {
    orderId?: string;
    status?: string;
  };
  request: {
    venue: TradingVenue;
    market?: string;
    side?: AgentTradeProposal["side"];
  };
}

export function buildAgentTradeLifecycle({
  proposal,
  execution,
  venueRequest,
  accountSnapshot,
}: {
  proposal: AgentTradeProposal;
  execution?: AgentExecutionRecord | null;
  venueRequest?: AgentTradeVenueRequestLike | null;
  accountSnapshot?: HyperliquidTestnetAccountSnapshot | null;
}): AgentTradeLifecycle {
  const steps: AgentTradeLifecycleStep[] = [
    {
      id: "signal",
      label: "Signal",
      status: "done",
      detail: proposal.clientSignalId ? "Imported signal" : "Trade idea saved",
    },
    buildPolicyStep(proposal),
    buildApprovalStep(proposal),
    buildExecutionStep(proposal, execution, venueRequest),
  ];

  if (proposal.venue === "hyperliquid_testnet") {
    steps.push(buildVenueStep(proposal, venueRequest, accountSnapshot));
  }

  const blockingStep = steps.find((step) => step.status === "blocked");
  const warningStep = steps.find((step) => step.status === "warning");
  if (blockingStep) {
    return {
      status: "blocked",
      label: blockingStep.label,
      tone: "danger",
      steps,
    };
  }
  if (warningStep) {
    return {
      status: "warning",
      label: warningStep.label,
      tone: "warning",
      steps,
    };
  }
  if (execution?.status === "closed") {
    return { status: "closed", label: "Closed", tone: "default", steps };
  }
  if (execution?.status === "open" || requestMatchesOpenPosition(venueRequest, accountSnapshot)) {
    return { status: "open", label: "Open", tone: "success", steps };
  }
  if (venueRequest?.status === "submitted") {
    return { status: "submitted", label: "Submitted", tone: "success", steps };
  }
  if (proposal.status === "approved" || proposal.status === "executed") {
    return { status: "approved", label: "Approved", tone: "success", steps };
  }
  if (proposal.status === "needs_approval") {
    return {
      status: "needs_approval",
      label: "Needs approval",
      tone: "warning",
      steps,
    };
  }
  return { status: "draft", label: "Draft", tone: "default", steps };
}

export function summarizeAgentTradeLifecycles(
  lifecycles: AgentTradeLifecycle[],
): AgentTradeLifecycleSummary {
  const total = lifecycles.length;
  const open = lifecycles.filter((item) => item.status === "open").length;
  const submitted = lifecycles.filter((item) => item.status === "submitted").length;
  const closed = lifecycles.filter((item) => item.status === "closed").length;
  const needsApproval = lifecycles.filter(
    (item) => item.status === "needs_approval",
  ).length;
  const blocked = lifecycles.filter((item) => item.status === "blocked").length;
  const warnings = lifecycles.filter((item) => item.status === "warning").length;
  const actionable = needsApproval + blocked + warnings;

  if (total === 0) {
    return {
      total,
      open,
      submitted,
      closed,
      needsApproval,
      blocked,
      warnings,
      actionable,
      label: "No decisions",
      tone: "default",
    };
  }
  if (blocked > 0) {
    return {
      total,
      open,
      submitted,
      closed,
      needsApproval,
      blocked,
      warnings,
      actionable,
      label: "Blocked",
      tone: "danger",
    };
  }
  if (warnings > 0) {
    return {
      total,
      open,
      submitted,
      closed,
      needsApproval,
      blocked,
      warnings,
      actionable,
      label: "Needs review",
      tone: "warning",
    };
  }
  if (needsApproval > 0) {
    return {
      total,
      open,
      submitted,
      closed,
      needsApproval,
      blocked,
      warnings,
      actionable,
      label: "Approval needed",
      tone: "warning",
    };
  }
  if (open + submitted > 0) {
    return {
      total,
      open,
      submitted,
      closed,
      needsApproval,
      blocked,
      warnings,
      actionable,
      label: "Trading",
      tone: "success",
    };
  }
  return {
    total,
    open,
    submitted,
    closed,
    needsApproval,
    blocked,
    warnings,
    actionable,
    label: "Clear",
    tone: "default",
  };
}

function buildPolicyStep(proposal: AgentTradeProposal): AgentTradeLifecycleStep {
  if (proposal.status === "blocked") {
    return {
      id: "policy",
      label: "Policy",
      status: "blocked",
      detail: proposal.policyViolations?.[0]?.message ?? "Stopped by guardrails",
    };
  }
  if (proposal.status === "draft") {
    return {
      id: "policy",
      label: "Policy",
      status: "current",
      detail: "Safety check pending",
    };
  }
  return {
    id: "policy",
    label: "Policy",
    status: "done",
    detail: proposal.policyHash ? "Rules matched" : "Safety checked",
  };
}

function buildApprovalStep(proposal: AgentTradeProposal): AgentTradeLifecycleStep {
  if (proposal.status === "needs_approval") {
    return {
      id: "owner_approval",
      label: "Approval",
      status: "current",
      detail: "Owner approval required",
    };
  }
  if (proposal.status === "rejected") {
    return {
      id: "owner_approval",
      label: "Approval",
      status: "blocked",
      detail: "Owner declined",
    };
  }
  if (proposal.status === "blocked") {
    return {
      id: "owner_approval",
      label: "Approval",
      status: "waiting",
      detail: "Waiting on policy",
    };
  }
  if (proposal.status === "approved" || proposal.status === "executed") {
    return {
      id: "owner_approval",
      label: "Approval",
      status: "done",
      detail: "Owner approved",
    };
  }
  return {
    id: "owner_approval",
    label: "Approval",
    status: "waiting",
    detail: "Not requested",
  };
}

function buildExecutionStep(
  proposal: AgentTradeProposal,
  execution?: AgentExecutionRecord | null,
  venueRequest?: AgentTradeVenueRequestLike | null,
): AgentTradeLifecycleStep {
  if (execution?.status === "closed") {
    return {
      id: "execution",
      label: "Execution",
      status: "done",
      detail: "Trade closed",
    };
  }
  if (execution?.status === "open") {
    return {
      id: "execution",
      label: "Execution",
      status: "done",
      detail: "Practice trade open",
    };
  }
  if (venueRequest?.status === "submitted") {
    return {
      id: "execution",
      label: "Execution",
      status: "done",
      detail: venueRequest.artifact?.orderId ? "Venue accepted" : "Submitted to venue",
    };
  }
  if (venueRequest?.status === "adapter_error") {
    return {
      id: "execution",
      label: "Execution",
      status: "blocked",
      detail: venueRequest.message ?? "Protected executor failed",
    };
  }
  if (venueRequest?.status === "rejected") {
    return {
      id: "execution",
      label: "Execution",
      status: "blocked",
      detail: venueRequest.message ?? "Venue request rejected",
    };
  }
  if (
    venueRequest?.status === "waiting_for_setup" ||
    venueRequest?.status === "adapter_not_connected"
  ) {
    return {
      id: "execution",
      label: "Execution",
      status: "current",
      detail: venueRequest.message ?? "Venue setup required",
    };
  }
  if (proposal.status === "executed") {
    return {
      id: "execution",
      label: "Execution",
      status: "warning",
      detail: "Marked opened, missing execution record",
    };
  }
  if (proposal.status === "approved") {
    return {
      id: "execution",
      label: "Execution",
      status: "current",
      detail:
        proposal.venue === "hyperliquid_testnet"
          ? "Ready for venue"
          : "Ready to open",
    };
  }
  return {
    id: "execution",
    label: "Execution",
    status: "waiting",
    detail: "Waiting",
  };
}

function buildVenueStep(
  proposal: AgentTradeProposal,
  venueRequest?: AgentTradeVenueRequestLike | null,
  accountSnapshot?: HyperliquidTestnetAccountSnapshot | null,
): AgentTradeLifecycleStep {
  if (!venueRequest) {
    return {
      id: "venue_reconciliation",
      label: "Venue",
      status: proposal.status === "approved" ? "current" : "waiting",
      detail: proposal.status === "approved" ? "Ready to submit" : "No venue request",
    };
  }
  if (venueRequest.status !== "submitted") {
    return {
      id: "venue_reconciliation",
      label: "Venue",
      status: venueRequest.status === "adapter_error" ? "blocked" : "waiting",
      detail: venueRequest.message ?? "Not on venue",
    };
  }
  if (
    !accountSnapshot ||
    accountSnapshot.state === "missing_address" ||
    accountSnapshot.state === "unavailable"
  ) {
    return {
      id: "venue_reconciliation",
      label: "Venue",
      status: "current",
      detail: accountSnapshot?.message ?? "Checking venue",
    };
  }
  if (requestMatchesOpenPosition(venueRequest, accountSnapshot)) {
    return {
      id: "venue_reconciliation",
      label: "Venue",
      status: "done",
      detail: "Open on Hyperliquid",
    };
  }
  return {
    id: "venue_reconciliation",
    label: "Venue",
    status: "warning",
    detail: "Submitted, not open now",
  };
}

function requestMatchesOpenPosition(
  request?: AgentTradeVenueRequestLike | null,
  accountSnapshot?: HyperliquidTestnetAccountSnapshot | null,
): boolean {
  if (!request || request.status !== "submitted" || !accountSnapshot) return false;
  const market = request.request.market?.trim().toUpperCase();
  if (!market) return false;
  return accountSnapshot.positions.some(
    (position) =>
      position.market.trim().toUpperCase() === market &&
      (!request.request.side || position.side === request.request.side),
  );
}
