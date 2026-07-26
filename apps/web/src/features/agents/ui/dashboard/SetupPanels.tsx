"use client";

import clsx from "clsx";
import Link from "next/link";
import { AlertTriangle, Bell, Bot, BrainCircuit, Check, ChevronDown, ClipboardList, Database, KeyRound, Plug, ShieldCheck, Sparkles, Trophy, type LucideIcon } from "lucide-react";
import { type AgentProfile, type AgentMarketDataSnapshot, type AgentMarketIntelligenceSnapshot, type AgentScoutReport, type AgentTradingReadiness } from "@/features/agents/domain";
import { formatUsd, readinessSort } from "@/features/agents/ui/dashboard/MetaPanels";
import { ReadinessRow } from "@/features/agents/ui/dashboard/OperationsPanels";

const agentPrimaryActionClass = clsx(
  "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-text-on-accent shadow-accent-rest sm:flex-none",
  "transition-[background-color,box-shadow,transform] duration-base ease-out-soft hover:-translate-y-0.5 hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
);
const agentToolClass = clsx(
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong",
  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
);
type GettingStartedStep = {
  id: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  done: boolean;
  href: string;
  actionLabel: string;
};

export function DeskStatus({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "accent" | "soft" | "warn";
}) {
  return (
    <div
      className={clsx(
        "rounded-soft border px-3 py-2",
        tone === "accent"
          ? "border-accent/25 bg-accent/[0.06]"
          : tone === "warn"
            ? "border-warning/30 bg-warning/[0.06]"
            : "border-white/10 bg-white/[0.03]",
      )}
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-soft">
        {label}
      </p>
      <p
        className={clsx(
          "mt-1 font-numerals text-sm font-semibold tabular-nums",
          tone === "warn" ? "text-warning" : tone === "accent" ? "text-accent" : "text-text-strong",
        )}
      >
        {value}
      </p>
    </div>
  );
}
export function GettingStartedPanel({
  steps,
  walletEncoded,
}: {
  steps: GettingStartedStep[];
  walletEncoded: string;
}) {
  const currentIndex = steps.findIndex((step) => !step.done);
  const currentStep = currentIndex === -1 ? steps.length - 1 : currentIndex;
  const completed = steps.filter((step) => step.done).length;
  const next = steps[currentStep];
  const NextIcon = next.Icon;

  return (
    <section className="rounded-card border border-accent/25 bg-surface-raised p-4 shadow-card-rest sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-strong">
            {completed === steps.length ? "Trading desk ready" : "Finish setup"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">
            Trader, budget, safety, then practice.
          </p>
        </div>
        <Link href={next.href} className={agentPrimaryActionClass}>
          <NextIcon size={15} aria-hidden="true" />
          {next.actionLabel}
        </Link>
      </div>

      <ol className="mt-4 grid gap-2">
        {steps.map((step, index) => {
          const current = index === currentStep && !step.done;
          const StepIcon = step.Icon;
          return (
            <li
              key={step.id}
              className={clsx(
                "flex items-center gap-3 rounded-soft border px-3 py-2.5",
                current
                  ? "border-accent/40 bg-accent/[0.06]"
                  : "border-border-soft bg-canvas",
              )}
            >
              <span
                className={clsx(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                  step.done
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : current
                      ? "border-accent bg-accent text-text-on-accent"
                      : "border-border-soft text-text-muted",
                )}
              >
                {step.done ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <StepIcon className="h-4 w-4" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text-strong">{step.label}</p>
                <p className="mt-0.5 truncate text-[11px] text-text-soft">
                  {step.done ? "Done" : current ? step.description : "Waiting"}
                </p>
              </div>
              <span className="text-[11px] font-medium text-text-soft">
                {step.done ? "Done" : current ? "Next" : ""}
              </span>
            </li>
          );
        })}
      </ol>

      <details className="group mt-4 rounded-soft border border-border-soft bg-canvas px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-text-strong">
          <span>Advanced</span>
          <ChevronDown
            className="h-3.5 w-3.5 text-text-soft transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/app/wallet/${walletEncoded}/agents/hyperliquid`}
            className={agentToolClass}
          >
            <Plug size={15} aria-hidden="true" />
            <span>Practice account</span>
          </Link>
          <Link
            href={`/app/wallet/${walletEncoded}/agents/solana`}
            className={agentToolClass}
          >
            <KeyRound size={15} aria-hidden="true" />
            <span>Solana delegation</span>
          </Link>
          <Link
            href={`/app/wallet/${walletEncoded}/agents/approvals`}
            className={agentToolClass}
          >
            <ClipboardList size={15} aria-hidden="true" />
            <span>Approvals</span>
          </Link>
        </div>
      </details>
    </section>
  );
}
export function FeatureAccessPanel({
  walletEncoded,
  agents,
  notifications,
  marketSnapshots,
  intelligenceSnapshots,
  pending,
  onStartDemo,
}: {
  walletEncoded: string;
  agents: AgentProfile[];
  notifications: number;
  marketSnapshots: AgentMarketDataSnapshot[];
  intelligenceSnapshots: AgentMarketIntelligenceSnapshot[];
  pending: boolean;
  onStartDemo: () => void;
}) {
  const publishedAgents = agents.filter((agent) => agent.publishing?.status === "published");
  const newsConnected = intelligenceSnapshots.some((snapshot) => snapshot.coverage.news);
  const macroConnected = intelligenceSnapshots.some((snapshot) => snapshot.coverage.macro);
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-strong">Practice tools</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
            Create sample activity, browse traders, or open a public profile.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={onStartDemo}
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Create sample activity
        </button>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <FeatureAccessCard
          title="Marketplace"
          body="Browse approved public agents and separated track records."
          status="Open"
          href="/agents"
          Icon={Trophy}
        />
        <FeatureAccessCard
          title="Public profiles"
          body={
            publishedAgents.length > 0
              ? `${publishedAgents.length} published profile${publishedAgents.length === 1 ? "" : "s"} in this wallet.`
              : "Publish and approve an agent to make its public profile visible."
          }
          status={publishedAgents.length > 0 ? "Ready" : "Needs published agent"}
          href={
            publishedAgents[0]?.publishing
              ? `/agents/${walletEncoded}/${encodeURIComponent(publishedAgents[0].publishing.slug)}`
              : `/app/wallet/${walletEncoded}/agents/library`
          }
          Icon={ShieldCheck}
        />
        <FeatureAccessCard
          title="Market intelligence"
          body={`${marketSnapshots.length} priced market${marketSnapshots.length === 1 ? "" : "s"} · news ${newsConnected ? "on" : "not connected"} · macro ${macroConnected ? "on" : "not connected"}.`}
          status={marketSnapshots.length > 0 ? "Visible in scout" : "Needs active trader"}
          href={`/app/wallet/${walletEncoded}/agents/start`}
          Icon={Database}
        />
        <FeatureAccessCard
          title="Notifications"
          body={
            notifications > 0
              ? `${notifications} current trading notice${notifications === 1 ? "" : "s"}.`
              : "No active trading notices yet. Demo setup can create testable state."
          }
          status={notifications > 0 ? "Ready" : "Empty"}
          href={`/app/wallet/${walletEncoded}/agents`}
          Icon={Bell}
        />
      </div>
    </section>
  );
}
export function FeatureAccessCard({
  title,
  body,
  status,
  href,
  Icon,
}: {
  title: string;
  body: string;
  status: string;
  href: string;
  Icon: typeof Bot;
}) {
  return (
    <Link
      href={href}
      className="rounded-soft border border-border-soft bg-canvas p-3 transition-colors hover:border-accent/50"
    >
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-text-strong">{title}</p>
            <span className="rounded-full border border-border-soft px-1.5 py-0.5 text-[10px] font-medium text-text-soft">
              {status}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">{body}</p>
        </div>
      </div>
    </Link>
  );
}
export function ReadinessPanel({
  readiness,
  agents,
  walletEncoded,
  readyAgents,
}: {
  readiness: AgentTradingReadiness[];
  agents: AgentProfile[];
  walletEncoded: string;
  readyAgents: number;
}) {
  const topItems = [...readiness].sort(readinessSort).slice(0, 3);
  const blocked = readiness.filter((item) => item.status === "blocked").length;
  const setup = readiness.filter((item) => item.status === "needs_setup").length;
  const headline =
    readyAgents > 0
      ? `${readyAgents} trader${readyAgents === 1 ? "" : "s"} ready`
      : blocked > 0
        ? "Trading has stopped"
        : "A few steps remain";
  const summary =
    readyAgents > 0
      ? "Ready for guarded trades."
      : blocked > 0
        ? "Open the trader below."
        : "Finish setup first.";

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                readyAgents > 0
                  ? "bg-accent/10 text-accent"
                  : blocked > 0
                    ? "bg-rose-500/[0.08] text-rose-300"
                    : "bg-warning/[0.08] text-warning",
              )}
            >
              {readyAgents > 0 ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-strong">
                Ready to trade?
              </h2>
              <p className="mt-0.5 text-xs text-text-soft">{headline}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-text-soft">{summary}</p>
        </div>
        <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
          {setup} to finish · {blocked} stopped
        </span>
      </div>
      <div className="mt-4 grid gap-2">
        {topItems.map((item) => {
          const agent = agents.find((entry) => entry.id === item.agentId);
          return (
            <ReadinessRow
              key={item.agentId}
              agent={agent}
              readiness={item}
              walletEncoded={walletEncoded}
            />
          );
        })}
      </div>
    </section>
  );
}
export function ScoutPanel({
  reports,
  pending,
  onPrepare,
}: {
  reports: AgentScoutReport[];
  pending: boolean;
  onPrepare: (report: AgentScoutReport) => void;
}) {
  const ready = reports.filter((report) => report.status === "ready").length;
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <BrainCircuit className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-strong">
                Agent scout
              </h2>
              <p className="mt-0.5 text-xs text-text-soft">
                {ready} ready · {reports.length} watching
              </p>
            </div>
          </div>
        </div>
        <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
          Scout · Analyze · Gate
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {reports.map((report) => (
          <ScoutCard
            key={report.id}
            report={report}
            pending={pending}
            onPrepare={onPrepare}
          />
        ))}
      </div>
    </section>
  );
}
export function MarketIntelligencePanel({
  snapshots,
}: {
  snapshots: AgentMarketIntelligenceSnapshot[];
}) {
  const connectedNews = snapshots.filter((snapshot) => snapshot.coverage.news).length;
  const connectedMacro = snapshots.filter((snapshot) => snapshot.coverage.macro).length;
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Database className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-strong">
                Market intelligence
              </h2>
              <p className="mt-0.5 text-xs text-text-soft">
                {snapshots.length} market{snapshots.length === 1 ? "" : "s"} · news {connectedNews > 0 ? "connected" : "not connected"} · macro {connectedMacro > 0 ? "connected" : "not connected"}
              </p>
            </div>
          </div>
        </div>
        <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
          Price · Funding · News · Macro
        </span>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {snapshots.slice(0, 4).map((snapshot) => (
          <article
            key={snapshot.market}
            className="rounded-soft border border-border-soft bg-canvas p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-text-strong">
                  {snapshot.market}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-text-soft">
                  {snapshot.summary}
                </p>
              </div>
              <span
                className={clsx(
                  "rounded-full border px-2 py-1 text-[10px] font-medium",
                  snapshot.freshnessWarnings.length > 0
                    ? "border-warning/30 bg-warning/[0.08] text-warning"
                    : "border-accent/30 bg-accent/[0.08] text-accent",
                )}
              >
                {snapshot.marketData.source === "live" ? "Live market" : "Practice market"}
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <ScoutMiniMetric
                label="Mark"
                value={formatUsd(snapshot.marketData.markPriceUsd)}
              />
              <ScoutMiniMetric
                label="Funding"
                value={
                  snapshot.marketData.fundingRatePct == null
                    ? "Unknown"
                    : `${snapshot.marketData.fundingRatePct}%`
                }
              />
              <ScoutMiniMetric label="Items" value={String(snapshot.items.length)} />
            </div>
            <div className="mt-3 grid gap-2">
              {snapshot.items.slice(0, 5).map((item) => (
                <div
                  key={`${item.kind}:${item.id}`}
                  className="rounded-soft border border-border-soft bg-surface-raised px-2 py-1.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={clsx(
                        "rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize",
                        item.source === "coverage-gap"
                          ? "border-warning/30 bg-warning/[0.08] text-warning"
                          : item.impact === "bullish"
                            ? "border-accent/30 bg-accent/[0.08] text-accent"
                            : item.impact === "bearish"
                              ? "border-danger/30 bg-danger/[0.06] text-danger"
                              : "border-border-soft bg-canvas text-text-soft",
                      )}
                    >
                      {item.kind.replace("_", " ")}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text-strong">
                      {item.label}
                    </p>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-soft">
                    {item.summary}
                  </p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
export function ScoutCard({
  report,
  pending,
  onPrepare,
}: {
  report: AgentScoutReport;
  pending: boolean;
  onPrepare: (report: AgentScoutReport) => void;
}) {
  return (
    <article className="rounded-soft border border-border-soft bg-canvas p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-strong">
            {report.market} · {report.side}
          </p>
          <p className="mt-0.5 text-xs text-text-soft">{report.agentName}</p>
        </div>
        <ScoutStatusPill status={report.status} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <ScoutMiniMetric label="Score" value={`${report.score}/100`} />
        <ScoutMiniMetric
          label="Mark"
          value={report.snapshot ? formatUsd(report.snapshot.markPriceUsd) : "Waiting"}
        />
        <ScoutMiniMetric
          label="Funding"
          value={
            report.snapshot?.fundingRatePct == null
              ? "Unknown"
              : `${report.snapshot.fundingRatePct}%`
          }
        />
      </div>
      <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-text-soft">
        {report.thesis}
      </p>
      <div className="mt-3 grid gap-2">
        <ScoutMiniReason label="News" value={report.newsSummary} />
        <ScoutMiniReason label="Macro" value={report.fundamentalSummary} />
        <ScoutMiniReason label="Risk" value={report.riskPlan} />
        <ScoutMiniReason label="Gate" value={report.policySummary} />
      </div>
      <button
        type="button"
        disabled={pending || report.status === "blocked"}
        onClick={() => onPrepare(report)}
        className={clsx(
          "mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-soft px-3 py-2 text-xs font-medium",
          "transition-colors duration-base ease-out-soft",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          "disabled:cursor-not-allowed disabled:opacity-60",
          report.status === "ready"
            ? "bg-accent text-text-on-accent hover:bg-accent-hover"
            : "border border-border-soft text-text-strong hover:border-accent/60 hover:text-accent",
        )}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        {report.status === "ready" ? "Prepare and open" : "Prepare idea"}
      </button>
    </article>
  );
}
export function ScoutStatusPill({ status }: { status: AgentScoutReport["status"] }) {
  const label =
    status === "ready"
      ? "Ready"
      : status === "needs_approval"
        ? "Approval"
        : status === "blocked"
          ? "Stopped"
          : "Watching";
  return (
    <span
      className={clsx(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
        status === "ready" && "border-accent/30 bg-accent/[0.08] text-accent",
        status === "needs_approval" && "border-warning/30 bg-warning/[0.08] text-warning",
        status === "blocked" && "border-rose-500/30 bg-rose-500/[0.08] text-rose-300",
        status === "watching" && "border-border-soft bg-surface-raised text-text-soft",
      )}
    >
      {label}
    </span>
  );
}
export function ScoutMiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-surface-raised px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className="mt-0.5 truncate text-[11px] font-semibold text-text-strong">
        {value}
      </p>
    </div>
  );
}
export function ScoutMiniReason({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-surface-raised px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-text-strong">
        {value}
      </p>
    </div>
  );
}
