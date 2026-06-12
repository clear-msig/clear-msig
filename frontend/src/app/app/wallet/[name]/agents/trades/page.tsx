"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, Clock, X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import {
  closeAgentExecutionRecord,
  closeMockAgentExecution,
  closeOpenMockAgentExecutions,
  estimateAgentOpenTradePerformance,
  listAgentExecutions,
  listAgentProposals,
  listAgents,
  subscribeAgents,
  summarizeAgentTradePerformance,
  syncAgentExecution,
  type AgentExecutionRecord,
  type AgentMarketDataSnapshot,
  type AgentProfile,
  type AgentTradeProposal,
} from "@/lib/agents";
import { loadAgentMarketDataSnapshots } from "@/lib/agents/clientMarketData";
import { toDisplayName } from "@/lib/retail/walletNames";

type TradeFilter = "open" | "closed" | "all";

export default function AgentTradesPage() {
  const params = useParams<{ name: string }>();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const encoded = encodeURIComponent(name);
  const display = toDisplayName(name);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [executions, setExecutions] = useState<AgentExecutionRecord[]>([]);
  const [proposals, setProposals] = useState<AgentTradeProposal[]>([]);
  const [marketByMarket, setMarketByMarket] = useState<Record<string, AgentMarketDataSnapshot>>({});
  const [filter, setFilter] = useState<TradeFilter>("open");
  const [agentFilter, setAgentFilter] = useState("all");

  useEffect(() => {
    const refresh = () => {
      setAgents(listAgents(name));
      setExecutions(listAgentExecutions(name));
      setProposals(listAgentProposals(name));
    };
    refresh();
    return subscribeAgents(refresh);
  }, [name]);

  const openMarketKey = useMemo(
    () =>
      executions
        .filter((execution) => execution.status === "open")
        .map((execution) => execution.market.trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join("|"),
    [executions],
  );

  useEffect(() => {
    const markets = openMarketKey ? openMarketKey.split("|") : [];
    if (markets.length === 0) {
      setMarketByMarket({});
      return;
    }
    let cancelled = false;
    void loadAgentMarketDataSnapshots(markets).then((snapshots) => {
      if (!cancelled) setMarketByMarket(snapshots);
    });
    return () => {
      cancelled = true;
    };
  }, [openMarketKey]);

  const filtered = executions.filter((execution) => {
    const statusOk = filter === "all" ? true : execution.status === filter;
    const agentOk = agentFilter === "all" ? true : execution.agentId === agentFilter;
    return statusOk && agentOk;
  });
  const summary = summarizeAgentTradePerformance(executions, marketByMarket);

  const closeTrade = (id: string, pnlUsd: string) => {
    startTransition(() => {
      const local = closeMockAgentExecution(name, id, pnlUsd);
      const execution = executions.find((item) => item.id === id);
      const proposal = proposals.find((item) => item.id === execution?.proposalId);
      const updated = local ?? (execution
        ? closeAgentExecutionRecord({ execution, proposal, realizedPnlUsd: pnlUsd })
        : null);
      if (!updated) {
        toast.error("Practice trade not found");
        return;
      }
      if (!local) {
        setExecutions((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
      toast.success("Practice trade closed");
      void syncAgentExecution(updated).then((synced) => {
        if (!synced.ok) {
          toast.info("Practice trade closed locally; backend sync is pending", {
            details: synced.message,
          });
        }
      });
    });
  };

  const closeAllOpen = () => {
    startTransition(() => {
      const localClosed = closeOpenMockAgentExecutions({ walletName: name });
      const localClosedIds = new Set(localClosed.map((execution) => execution.id));
      const fallbackClosed = executions
        .filter(
          (execution) =>
            execution.status === "open" && !localClosedIds.has(execution.id),
        )
        .map((execution) =>
          closeAgentExecutionRecord({
            execution,
            proposal: proposals.find((item) => item.id === execution.proposalId),
            realizedPnlUsd: "0",
          }),
        );
      const closed = [...localClosed, ...fallbackClosed];
      if (closed.length === 0) {
        toast.error("No open trades to close");
        return;
      }
      if (fallbackClosed.length > 0) {
        setExecutions((current) =>
          current.map(
            (execution) =>
              fallbackClosed.find((closedExecution) => closedExecution.id === execution.id) ??
              execution,
          ),
        );
      }
      toast.success(`${closed.length} open practice trade${closed.length === 1 ? "" : "s"} closed`);
      void Promise.all(closed.map((execution) => syncAgentExecution(execution))).then(
        (results) => {
          if (!results.every((result) => result.ok)) {
            toast.info("Practice trades closed locally; backend sync is pending");
          }
        },
      );
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href={`/app/wallet/${encoded}/agents`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Trading
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Trade Performance · {display}
            </p>
            <h1 className="mt-1 font-display text-lg leading-tight text-text-strong md:text-display-xs">
              Trades
            </h1>
          </div>
          <button
            type="button"
            disabled={pending || summary.openTrades === 0}
            onClick={closeAllOpen}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-rose-500/30 px-3 py-2 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Close all open
          </button>
        </div>
      </header>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Metric label="Open" value={String(summary.openTrades)} />
        <Metric label="Closed" value={String(summary.closedTrades)} />
        <Metric label="Priced open" value={`${summary.pricedOpenTrades}/${summary.openTrades}`} />
        <Metric label="Open P/L" value={formatSignedUsd(summary.estimatedOpenPnlUsd)} />
        <Metric label="Realized P/L" value={formatSignedUsd(summary.realizedPnlUsd)} />
        <Metric label="Combined P/L" value={formatSignedUsd(summary.combinedPnlUsd)} />
      </section>

      <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-strong">
              Trade evidence
            </h2>
          </div>
          <Badge tone="warning">Practice/Testnet</Badge>
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 border-y border-border-soft py-3">
        <div className="inline-flex rounded-soft border border-border-soft bg-canvas p-1">
          {(["open", "closed", "all"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={clsx(
                "min-h-8 rounded-[6px] px-2.5 text-[11px] font-medium capitalize transition-colors",
                filter === item
                  ? "bg-surface-raised text-text-strong shadow-card-rest"
                  : "text-text-soft hover:text-text-strong",
              )}
            >
              {item}
            </button>
          ))}
        </div>
        <select
          value={agentFilter}
          onChange={(event) => setAgentFilter(event.target.value)}
          className="min-h-10 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        >
          <option value="all">All agents</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </section>

      <section className="grid gap-3">
        {filtered.length > 0 ? (
          filtered.map((execution) => (
            <TradeRow
              key={execution.id}
              execution={execution}
              agent={agents.find((item) => item.id === execution.agentId)}
              proposal={proposals.find((item) => item.id === execution.proposalId)}
              marketSnapshot={marketByMarket[execution.market.trim().toUpperCase()] ?? null}
              pending={pending}
              onClose={closeTrade}
            />
          ))
        ) : (
          <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-6 text-sm text-text-soft">
            No trades match this view.
          </div>
        )}
      </section>
    </div>
  );
}

function TradeRow({
  execution,
  agent,
  proposal,
  marketSnapshot,
  pending,
  onClose,
}: {
  execution: AgentExecutionRecord;
  agent?: AgentProfile;
  proposal?: AgentTradeProposal;
  marketSnapshot: AgentMarketDataSnapshot | null;
  pending: boolean;
  onClose: (id: string, pnlUsd: string) => void;
}) {
  const [pnlUsd, setPnlUsd] = useState("");
  const open = execution.status === "open";
  const performance = estimateAgentOpenTradePerformance(execution, marketSnapshot);
  const closeValue = pnlUsd || performance?.unrealizedPnlUsd || "0";
  return (
    <article className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">
              {execution.market} · {execution.side}
            </p>
            <Badge tone={open ? "success" : "default"}>{open ? "Open" : "Closed"}</Badge>
            <Badge>{venueLabel(execution.venue)}</Badge>
            <Badge tone={execution.venue === "hyperliquid_testnet" ? "warning" : "default"}>
              {execution.venue === "hyperliquid_testnet" ? "Testnet evidence" : "Paper evidence"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {agent?.name ?? "Unknown agent"} · {formatUsd(execution.notionalUsd)} · {execution.leverage}x
          </p>
        </div>
        <div className="grid min-w-[16rem] gap-2 sm:grid-cols-4">
          <Metric label="Entry" value={formatUsd(execution.entryPrice ?? "0")} compact />
          <Metric label="Mark" value={performance ? formatUsd(performance.markPriceUsd) : open ? "Waiting" : "-"} compact />
          <Metric
            label={open ? "Est. P/L" : "Realized P/L"}
            value={open ? (performance ? formatSignedUsd(performance.unrealizedPnlUsd) : "Unknown") : formatSignedUsd(execution.realizedPnlUsd)}
            compact
          />
          <Metric label="Move" value={performance ? `${formatNumber(performance.movePct)}%` : "-"} compact />
        </div>
      </div>
      {proposal?.decisionJournal ? (
        <div className="mt-3 rounded-soft border border-border-soft bg-canvas p-3">
          <p className="text-[11px] font-semibold text-text-strong">
            Why it entered
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">
            {proposal.decisionJournal.summary}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <MiniReason label="Risk" value={proposal.decisionJournal.riskPlan} />
            <MiniReason label="Exit" value={proposal.decisionJournal.exitPlan} />
            <MiniReason
              label="Rules"
              value={proposal.decisionJournal.policySummary}
            />
          </div>
        </div>
      ) : null}
      {execution.postTradeReview ? (
        <PostTradeReview review={execution.postTradeReview} />
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border-soft pt-3">
        <div className="flex flex-wrap gap-3 text-[11px] text-text-soft">
          <span>Opened {new Date(execution.openedAt).toLocaleString()}</span>
          {execution.closedAt ? (
            <span>Closed {new Date(execution.closedAt).toLocaleString()}</span>
          ) : null}
        </div>
        {open ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={pnlUsd}
              onChange={(event) => setPnlUsd(event.target.value)}
              inputMode="decimal"
              placeholder="P/L USD"
              className="min-h-8 w-28 rounded-soft border border-border-soft bg-canvas px-2 py-1 text-xs text-text-strong placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => onClose(execution.id, closeValue)}
              className="inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              Close
            </button>
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-text-soft">
            <Clock className="h-3 w-3" aria-hidden="true" />
            Closed
          </span>
        )}
      </div>
    </article>
  );
}

function PostTradeReview({
  review,
}: {
  review: NonNullable<AgentExecutionRecord["postTradeReview"]>;
}) {
  return (
    <div className="mt-3 rounded-soft border border-border-soft bg-canvas p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-text-strong">
          Post-trade review
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={postTradeOutcomeTone(review.outcome)}>
            {postTradeOutcomeLabel(review.outcome)}
          </Badge>
          <Badge>{postTradeVerdictLabel(review.thesisVerdict)}</Badge>
        </div>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-text-soft">
        {review.summary}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <MiniReason label="Risk review" value={review.riskReview} />
        <MiniReason label="Lesson" value={review.lesson} />
      </div>
    </div>
  );
}

function MiniReason({ label, value }: { label: string; value: string }) {
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

function Metric({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className={clsx("rounded-card border border-border-soft bg-surface-raised shadow-card-rest", compact ? "px-2 py-1.5" : "p-3")}>
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-soft">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-text-strong">{value}</p>
    </div>
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "danger" | "warning";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        tone === "success" && "border-accent/30 bg-accent/[0.08] text-accent",
        tone === "danger" && "border-danger/30 bg-danger/[0.06] text-danger",
        tone === "warning" && "border-warning/30 bg-warning/[0.08] text-warning",
        tone === "default" && "border-border-soft bg-canvas text-text-soft",
      )}
    >
      {children}
    </span>
  );
}

function postTradeOutcomeTone(
  outcome: NonNullable<AgentExecutionRecord["postTradeReview"]>["outcome"],
): "success" | "danger" | "warning" {
  if (outcome === "win") return "success";
  if (outcome === "loss") return "danger";
  return "warning";
}

function postTradeOutcomeLabel(
  outcome: NonNullable<AgentExecutionRecord["postTradeReview"]>["outcome"],
): string {
  if (outcome === "win") return "Win";
  if (outcome === "loss") return "Loss";
  return "Flat";
}

function postTradeVerdictLabel(
  verdict: NonNullable<AgentExecutionRecord["postTradeReview"]>["thesisVerdict"],
): string {
  if (verdict === "confirmed") return "Thesis held";
  if (verdict === "invalidated") return "Thesis missed";
  return "Inconclusive";
}

function decodeParam(value: string | undefined): string {
  const raw = value ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function venueLabel(venue: AgentExecutionRecord["venue"]): string {
  switch (venue) {
    case "mock_perps":
      return "Paper";
    case "bulktrade_mock":
      return "Bulk paper";
    case "hyperliquid_testnet":
      return "Hyperliquid testnet";
  }
}

function formatUsd(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatSignedUsd(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "$0";
  return `${parsed > 0 ? "+" : "-"}$${Math.abs(parsed).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "0";
}
