"use client";

import clsx from "clsx";
import { Play, ShieldCheck } from "lucide-react";
import { reconcileAgentVenueRequest, type AgentProfile, type AgentTradeProposal, type TradingLaunchStep, type TradingLaunchVenue, type AgentVenueReadiness } from "@/features/agents/domain";
import { STEP_BUTTON_CLASS, StepLink, formatUsd, venueRequestStatusLabel } from "@/features/agents/ui/start/presentation";

export function VenueRequestRow({
  request,
  accountSnapshot,
  onSettle,
  settling = false,
}: {
  request: NonNullable<AgentVenueReadiness["requests"]>[number];
  accountSnapshot: AgentVenueReadiness["accountSnapshot"] | null;
  onSettle?: () => void;
  settling?: boolean;
}) {
  const submitted = request.status === "submitted";
  const rejected = request.status === "rejected" || request.status === "adapter_error";
  const reconciliation = reconcileAgentVenueRequest(request, accountSnapshot);
  const market = request.request.market ?? "Trade";
  const size = request.request.notionalUsd ? formatUsd(request.request.notionalUsd) : "Size unknown";
  const settled = request.settlementProposalStatus === "executed";
  return (
    <div className="min-w-0 rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-xs font-semibold text-text-strong">
            {market} {request.request.side ?? ""}
          </p>
          <p className="mt-1 break-words text-[11px] text-text-soft">
            {size}
            {typeof request.request.leverage === "number" ? ` · ${request.request.leverage}x` : ""}
            {request.artifact?.orderId ? ` · Order ${request.artifact.orderId}` : ""}
          </p>
        </div>
        <span
          className={clsx(
            "rounded-full border px-2 py-1 text-[10px] font-medium",
            submitted
              ? "border-accent/30 bg-accent/[0.08] text-accent"
              : rejected
                ? "border-warning/30 bg-warning/[0.08] text-warning"
                : "border-border-soft text-text-soft",
          )}
        >
          {venueRequestStatusLabel(request.status)}
        </span>
      </div>
      {submitted ? (
        <div
          className={clsx(
            "mt-2 rounded-soft border px-2 py-1.5 text-xs leading-relaxed",
            reconciliation.state === "open_on_venue"
              ? "border-accent/25 bg-accent/[0.08] text-text-strong"
              : reconciliation.state === "not_found" ||
                reconciliation.state === "executor_error"
                ? "border-warning/30 bg-warning/[0.08] text-warning"
                : "border-border-soft text-text-soft",
          )}
        >
          <span className="font-semibold">{reconciliation.label}:</span>{" "}
          {reconciliation.message}
        </div>
      ) : null}
      {request.message ? (
        <p className="mt-2 break-words text-xs leading-relaxed text-text-soft">
          {request.message}
        </p>
      ) : null}
      {request.updatedAt ? (
        <p className="mt-1 text-[11px] text-text-muted">
          {new Date(request.updatedAt).toLocaleString()}
        </p>
      ) : null}
      {submitted && onSettle ? (
        <button
          type="button"
          disabled={settling || settled}
          onClick={onSettle}
          className={`${STEP_BUTTON_CLASS} mt-2`}
        >
          {settled
            ? "Settled on chain"
            : request.settlementProposalAddress
              ? "Continue settlement"
              : settling
                ? "Settling..."
                : "Close and settle"}
        </button>
      ) : null}
    </div>
  );
}
export function ControlStat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className={clsx("mt-1 break-words text-xs font-semibold", highlight ? "text-accent" : "text-text-strong")}>
        {value}
      </p>
    </div>
  );
}
export function EmptyControlLine({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words rounded-soft border border-dashed border-border-soft bg-canvas px-3 py-3 text-xs text-text-soft">
      {text}
    </div>
  );
}
export function CheckStat({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div className="min-w-0 rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <p className="text-[11px] font-medium text-text-soft">{label}</p>
      <p className={clsx("mt-1 break-words text-xs font-semibold", ready ? "text-accent" : "text-warning")}>
        {value}
      </p>
    </div>
  );
}
export function actionForStep({
  step,
  walletEncoded,
  agent,
  venue,
  approvedOutsideIdea,
  placeFirstOutsideTrade,
  acceptDisclosures,
  enableAutomaticTrading,
  askBuiltInTraderForIdea,
  pending,
  automaticTradingBusy,
}: {
  step: TradingLaunchStep;
  walletEncoded: string;
  agent: AgentProfile | null;
  venue: TradingLaunchVenue;
  approvedOutsideIdea?: AgentTradeProposal;
  placeFirstOutsideTrade: (proposal: AgentTradeProposal) => void;
  acceptDisclosures: () => void;
  enableAutomaticTrading: () => void;
  askBuiltInTraderForIdea: () => void;
  pending: boolean;
  automaticTradingBusy: boolean;
}): React.ReactNode {
  const base = `/app/wallet/${walletEncoded}/agents`;
  switch (step.id) {
    case "trader":
      return <StepLink href={`${base}/library`} label="Choose trader" />;
    case "plan":
      return (
        <StepLink
          href={agent ? `${base}/${encodeURIComponent(agent.id)}/strategy` : `${base}/library`}
          label="Review style"
        />
      );
    case "safety":
      return (
        <StepLink
          href={`${base}/policy?venue=${venue}&agent=${encodeURIComponent(agent?.id ?? "")}`}
          label="Set max loss"
        />
      );
    case "allowance":
      return (
        <StepLink
          href={`${base}/sessions/new?agent=${encodeURIComponent(agent?.id ?? "")}&venue=${venue}`}
          label="Set budget"
        />
      );
    case "disclosures":
      return (
        <button
          type="button"
          disabled={pending}
          onClick={acceptDisclosures}
          className={STEP_BUTTON_CLASS}
        >
          Accept disclosures
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      );
    case "automatic":
      return (
        <button
          type="button"
          disabled={pending || automaticTradingBusy || !agent}
          onClick={enableAutomaticTrading}
          className={STEP_BUTTON_CLASS}
        >
          {automaticTradingBusy ? "Turning on..." : "Start practice"}
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      );
    case "account":
    case "funding":
    case "protected_connection":
      return (
        <StepLink href={`${base}/hyperliquid`} label="Connect practice account" />
      );
    case "first_idea":
      if (agent?.kind === "mock") {
        return (
          <button
            type="button"
            disabled={pending}
            onClick={askBuiltInTraderForIdea}
            className={STEP_BUTTON_CLASS}
          >
            Ask for a practice idea
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      }
      return (
        <StepLink
          href={
            agent
              ? `${base}/${encodeURIComponent(agent.id)}/connection?venue=${venue}`
              : `${base}/library`
          }
          label="Connect trader"
        />
      );
    case "first_trade":
      if (venue === "hyperliquid_testnet" && approvedOutsideIdea) {
        return (
          <button
            type="button"
            disabled={pending}
            onClick={() => placeFirstOutsideTrade(approvedOutsideIdea)}
            className={STEP_BUTTON_CLASS}
          >
            Place first practice trade
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      }
      if (venue === "mock_perps" && agent?.kind === "mock") {
        return <StepLink href={base} label="Review practice idea" />;
      }
      return (
        <StepLink
          href={
            agent
              ? `${base}/${encodeURIComponent(agent.id)}/connection?venue=${venue}`
              : `${base}/library`
          }
          label="Review first idea"
        />
      );
  }
}
