"use client";

import clsx from "clsx";
import type {
  AgentMarketDataSnapshot,
  AgentProfile,
  AgentVenueReadiness,
  TradingLaunchVenue,
} from "@/features/agents/domain";

export function LaunchRiskPanel({
  venue,
  agent,
  policyPaused,
  marketSnapshot,
  marketStatus,
  readiness,
  venueRequests,
}: {
  venue: TradingLaunchVenue;
  agent: AgentProfile | null;
  policyPaused: boolean;
  marketSnapshot: AgentMarketDataSnapshot | null;
  marketStatus: string;
  readiness: AgentVenueReadiness | null;
  venueRequests: NonNullable<AgentVenueReadiness["requests"]>;
}) {
  const notices: Array<{
    id: string;
    tone: "warning" | "danger" | "default";
    title: string;
    detail: string;
  }> = [];
  if (policyPaused) {
    notices.push({
      id: "policy_paused",
      tone: "danger",
      title: "All agent trading is paused",
      detail: "ClearSig will not open new trades until the vault pause is lifted.",
    });
  }
  if (agent?.status === "paused") {
    notices.push({
      id: "agent_paused",
      tone: "warning",
      title: "Selected trader is paused",
      detail: "This trader cannot open new trades until it is reactivated.",
    });
  }
  if (!marketSnapshot) {
    notices.push({
      id: "market_data",
      tone: "warning",
      title: "Market data not confirmed",
      detail: marketStatus,
    });
  }
  const reconciliation = readiness?.reconciliation;
  if (venue === "hyperliquid_testnet" && reconciliation) {
    if (reconciliation.adapterErrors > 0) {
      notices.push({
        id: "adapter_errors",
        tone: "danger",
        title: "Trading connection needs attention",
        detail: reconciliation.message,
      });
    } else if (reconciliation.status !== "healthy") {
      notices.push({
        id: "reconciliation",
        tone: "warning",
        title: "Practice account needs review",
        detail: reconciliation.message,
      });
    }
    if (reconciliation.pendingRequests > 0) {
      notices.push({
        id: "pending_requests",
        tone: "warning",
        title: "Practice requests are waiting",
        detail: `${reconciliation.pendingRequests} request${reconciliation.pendingRequests === 1 ? "" : "s"} need attention before trading continues.`,
      });
    }
  } else if (
    venue === "hyperliquid_testnet" &&
    venueRequests.some((request) => request.status === "adapter_error")
  ) {
    notices.push({
      id: "adapter_errors_fallback",
      tone: "danger",
      title: "Trading connection needs attention",
      detail: "At least one practice request could not be completed.",
    });
  }

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-strong">Safety checks</h2>
        </div>
        <span
          className={clsx(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            notices.some((notice) => notice.tone === "danger")
              ? "border-danger/30 bg-danger/[0.06] text-danger"
              : notices.length > 0
                ? "border-warning/30 bg-warning/[0.08] text-warning"
                : "border-accent/30 bg-accent/[0.08] text-accent",
          )}
        >
          {notices.length === 0
            ? "Clear"
            : `${notices.length} notice${notices.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        {notices.length > 0 ? (
          notices.map((notice) => (
            <div
              key={notice.id}
              className={clsx(
                "rounded-soft border px-3 py-2",
                notice.tone === "danger"
                  ? "border-danger/30 bg-danger/[0.06]"
                  : notice.tone === "warning"
                    ? "border-warning/30 bg-warning/[0.08]"
                    : "border-border-soft bg-canvas",
              )}
            >
              <p
                className={clsx(
                  "text-xs font-semibold",
                  notice.tone === "danger"
                    ? "text-danger"
                    : notice.tone === "warning"
                      ? "text-warning"
                      : "text-text-strong",
                )}
              >
                {notice.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-text-soft">
                {notice.detail}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-soft border border-accent/25 bg-accent/[0.05] px-3 py-2 text-xs leading-relaxed text-text-soft">
            No blocker is visible right now.
          </div>
        )}
      </div>
    </section>
  );
}
