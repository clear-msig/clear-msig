import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ExternalLink,
  Filter,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { AgentMarketplaceEntry } from "@/lib/agents/marketplaceRegistry";
import {
  loadAgentMarketplaceRegistry,
  marketplaceWalletsFromSearch,
} from "@/lib/agents/serverMarketplaceRegistry";
import { creatorRegistryStatusLabel } from "@/lib/agents/creatorRegistry";
import { AgentServerStatePersistenceError } from "@/features/agents/server/serverState";
import type { AgentTrackRecordSource } from "@/lib/agents/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ClearSig Agent Marketplace · Clear",
  description:
    "Browse approved ClearSig trading agents with separated paper, testnet, and verified live track records.",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AgentMarketplacePage({ searchParams }: PageProps) {
  const resolved = await searchParams;
  const source = sourceFilter(firstParam(resolved.source));
  const market = firstParam(resolved.market)?.trim().toUpperCase() || "all";
  const wallets = marketplaceWalletsFromSearch(firstParam(resolved.wallets) ?? null);

  try {
    const result = await loadAgentMarketplaceRegistry({ queryWallets: wallets });
    const entries = result.registry.entries.filter((entry) => {
      const sourceMatch = source === "all" || entry.primarySource === source;
      const marketMatch = market === "all" || entry.markets.includes(market);
      return sourceMatch && marketMatch;
    });

    return (
      <main className="min-h-screen bg-canvas text-text-strong">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </Link>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-1 text-xs font-medium text-text-soft">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              Approved agents only
            </span>
          </header>

          <section className="border-b border-border-soft pb-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Search className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase text-text-soft">
                  ClearSig Marketplace
                </p>
                <h1 className="text-3xl font-semibold tracking-normal text-text-strong sm:text-5xl">
                  Agent registry
                </h1>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-text-soft">
              Compare approved trading agents by ClearSig-observed behavior. Paper,
              testnet, and verified live results stay separated so users know what
              kind of evidence they are looking at.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              <MetricCard
                label="Approved agents"
                value={String(result.registry.entries.length)}
                Icon={Bot}
              />
              <MetricCard
                label="Registry wallets"
                value={String(result.wallets.length)}
                Icon={ShieldCheck}
              />
              <MetricCard
                label="Visible now"
                value={String(entries.length)}
                Icon={Filter}
              />
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-text-strong">Filters</h2>
                <p className="mt-1 text-xs leading-relaxed text-text-soft">
                  Registry source: {sourceLabel(result.source)}.
                </p>
              </div>
              <Link
                href="/agents"
                className="inline-flex items-center gap-1.5 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-soft transition-colors hover:text-accent"
              >
                Clear filters
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              <FilterLink label="All records" href={filterHref({ market })} active={source === "all"} />
              <FilterLink label="Paper" href={filterHref({ market, source: "paper" })} active={source === "paper"} />
              <FilterLink label="Testnet" href={filterHref({ market, source: "testnet" })} active={source === "testnet"} />
              <FilterLink label="Verified live" href={filterHref({ market, source: "verified_live" })} active={source === "verified_live"} />
            </div>
            {result.registry.filters.markets.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                <FilterLink label="All markets" href={filterHref({ source })} active={market === "all"} />
                {result.registry.filters.markets.slice(0, 12).map((item) => (
                  <FilterLink
                    key={item}
                    label={item}
                    href={filterHref({ source, market: item })}
                    active={market === item}
                  />
                ))}
              </div>
            ) : null}
          </section>

          <section className="grid gap-4">
            {entries.length > 0 ? (
              entries.map((entry) => <MarketplaceCard key={`${entry.walletName}:${entry.agentId}`} entry={entry} />)
            ) : (
              <EmptyMarketplace configured={result.wallets.length > 0} />
            )}
          </section>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft py-5 text-xs text-text-soft">
            <span>{result.registry.message}</span>
            <span>Generated {formatDate(result.registry.generatedAt)}</span>
          </footer>
        </div>
      </main>
    );
  } catch (error) {
    if (error instanceof AgentServerStatePersistenceError) {
      return <UnavailableMarketplace message={error.message} />;
    }
    throw error;
  }
}

function MarketplaceCard({ entry }: { entry: AgentMarketplaceEntry }) {
  return (
    <article className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="break-words text-xl font-semibold text-text-strong">
              {entry.name}
            </h2>
            <SourceTrustBadge source={entry.primarySource} />
            <RegistryStatusBadge status={entry.registryReadiness.status} />
            {entry.identityVerified ? <Badge>Signed identity</Badge> : null}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-soft">{entry.summary}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge>{entry.creatorLabel}</Badge>
            {entry.markets.slice(0, 4).map((market) => (
              <Badge key={market}>{market}</Badge>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href={entry.url}
              className="inline-flex items-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-semibold text-text-on-accent transition-colors hover:bg-accent-hover"
            >
              View profile
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <SmallMetric label="Score" value={entry.primaryScore == null ? "New" : String(entry.primaryScore)} />
          <SmallMetric label="P/L" value={formatSignedUsd(entry.realizedPnlUsd)} />
          <SmallMetric label="Closed" value={entry.closedTrades == null ? "Hidden" : String(entry.closedTrades)} />
          <SmallMetric label="Open" value={entry.openTrades == null ? "Hidden" : String(entry.openTrades)} />
          <SmallMetric label="Win rate" value={entry.winRatePct == null ? "New" : `${entry.winRatePct}%`} />
          <SmallMetric label="Stops" value={entry.ruleViolations == null ? "Hidden" : String(entry.ruleViolations)} />
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {entry.laneSummaries.map((lane) => (
          <div key={lane.source} className="rounded-soft border border-border-soft bg-canvas p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-text-strong">{lane.label}</p>
              {lane.source === entry.primarySource ? <Badge>Primary</Badge> : null}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <SmallMetric label="Score" value={lane.score == null ? "Hidden" : String(lane.score)} />
              <SmallMetric label="Trades" value={lane.closedTrades == null ? "Hidden" : String(lane.closedTrades)} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-text-soft">
              {sourceTrustSummary(lane.source)}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}

function MetricCard({
  label,
  value,
  Icon,
}: {
  label: string;
  value: string;
  Icon: LucideIcon;
}) {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-text-soft">{label}</span>
        <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold text-text-strong">{value}</p>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft bg-canvas px-3 py-2">
      <p className="text-[11px] font-medium text-text-soft">{label}</p>
      <p className="mt-0.5 break-words font-mono text-sm font-semibold text-text-strong">
        {value}
      </p>
    </div>
  );
}

function FilterLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "inline-flex rounded-soft border border-accent/30 bg-accent/[0.10] px-3 py-2 text-xs font-semibold text-accent"
          : "inline-flex rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-soft transition-colors hover:text-accent"
      }
    >
      {label}
    </Link>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-border-soft bg-canvas px-2 py-1 text-[11px] font-medium capitalize text-text-soft">
      {children}
    </span>
  );
}

function SourceTrustBadge({ source }: { source: AgentTrackRecordSource }) {
  const tone =
    source === "verified_live"
      ? "border-accent/30 bg-accent/[0.08] text-accent"
      : source === "testnet"
        ? "border-warning/30 bg-warning/[0.08] text-warning"
        : "border-border-soft bg-canvas text-text-soft";
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${tone}`}>
      {sourceTrustLabel(source)}
    </span>
  );
}

function RegistryStatusBadge({
  status,
}: {
  status: AgentMarketplaceEntry["registryReadiness"]["status"];
}) {
  const tone =
    status === "ready"
      ? "border-accent/30 bg-accent/[0.08] text-accent"
      : status === "needs_review"
        ? "border-warning/30 bg-warning/[0.08] text-warning"
        : "border-danger/30 bg-danger/[0.08] text-danger";
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${tone}`}>
      {creatorRegistryStatusLabel(status)}
    </span>
  );
}

function sourceTrustLabel(source: AgentTrackRecordSource): string {
  switch (source) {
    case "paper":
      return "Paper evidence";
    case "testnet":
      return "Testnet evidence";
    case "verified_live":
      return "Verified live evidence";
  }
}

function sourceTrustSummary(source: AgentTrackRecordSource): string {
  switch (source) {
    case "paper":
      return "Simulated practice results; useful for behavior, not real-money proof.";
    case "testnet":
      return "Exchange practice results; useful for execution checks, not real capital.";
    case "verified_live":
      return "Live-capital results only after venue reconciliation and review.";
  }
}

function EmptyMarketplace({ configured }: { configured: boolean }) {
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <h2 className="text-base font-semibold text-text-strong">
            {configured ? "No approved agents match this view" : "Marketplace is waiting for approved agents"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-soft">
            {configured
              ? "Try another market or track-record lane."
              : "Creator profiles appear here only after they are published, reviewed, and approved."}
          </p>
        </div>
      </div>
    </section>
  );
}

function UnavailableMarketplace({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10 text-text-strong">
      <section className="w-full max-w-lg rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Marketplace is not available</h1>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-text-soft">{message}</p>
        <div className="mt-4 flex gap-2 text-xs text-text-soft">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <span>Public beta marketplaces require durable backend state.</span>
        </div>
      </section>
    </main>
  );
}

function filterHref({
  source = "all",
  market = "all",
}: {
  source?: AgentTrackRecordSource | "all";
  market?: string;
}): string {
  const params = new URLSearchParams();
  if (source !== "all") params.set("source", source);
  if (market !== "all") params.set("market", market);
  const query = params.toString();
  return query ? `/agents?${query}` : "/agents";
}

function sourceFilter(value: string | undefined): AgentTrackRecordSource | "all" {
  return value === "paper" || value === "testnet" || value === "verified_live"
    ? value
    : "all";
}

function sourceLabel(source: "config" | "query" | "empty"): string {
  switch (source) {
    case "config":
      return "configured registry";
    case "query":
      return "test registry";
    case "empty":
      return "not configured";
  }
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatSignedUsd(value: string | number | null | undefined): string {
  if (value == null) return "Hidden";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0";
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Math.abs(parsed));
  if (parsed > 0) return `+${formatted}`;
  if (parsed < 0) return `-${formatted}`;
  return formatted;
}

function formatDate(value: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
