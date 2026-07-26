import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  LineChart,
  ShieldCheck,
  Sparkles,
  Trophy,
} from "lucide-react";
import {
  buildAgentPublicProfile,
  type AgentPublicProfile,
  type AgentPublicProfileDecision,
  type AgentPublicProfileLane,
  type AgentPublicProfileTrade,
} from "@/lib/agents/publicProfile";
import {
  AgentServerStatePersistenceError,
  getAgentServerWalletState,
} from "@/features/agents/server/serverState";
import {
  creatorRegistryStatusLabel,
  type AgentCreatorRegistryReadiness,
} from "@/lib/agents/creatorRegistry";
import { createPageMetadata } from "@/lib/metadata/site";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ name: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const route = await params;
  const profile = await loadProfile(Promise.resolve(route));
  const path = `/agents/${encodeURIComponent(decodeRouteParam(route.name))}/${encodeURIComponent(decodeRouteParam(route.slug))}` as const;
  if (!profile.ok) {
    return createPageMetadata({
      title: "Agent profile unavailable",
      description: "This ClearSig agent profile is not currently available.",
      path,
      index: false,
    });
  }
  return createPageMetadata({
    title: `${profile.value.name} Agent`,
    description: profile.value.summary,
    path,
    type: "profile",
  });
}

export default async function PublicAgentProfilePage({ params }: PageProps) {
  const profile = await loadProfile(params);
  if (profile.status === "not_found") notFound();
  if (profile.status === "unavailable") {
    return <UnavailableProfile message={profile.message} />;
  }

  const data = profile.value;
  const primaryLane =
    data.lanes.find((lane) => lane.source === data.primarySource) ?? data.lanes[0];

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
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/[0.08] px-3 py-1 text-xs font-semibold text-accent">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Marketplace approved
          </span>
        </header>

        <section className="grid gap-5 border-b border-border-soft pb-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
                <Bot className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase text-text-soft">
                  {data.creatorLabel}
                </p>
                <h1 className="break-words text-3xl font-semibold tracking-normal text-text-strong sm:text-5xl">
                  {data.name}
                </h1>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-text-soft">
              {data.summary}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge>{data.status}</Badge>
              <Badge>{data.kind === "api" ? "External API" : data.kind}</Badge>
              <Badge>{data.primarySource.replace("_", " ")}</Badge>
              <RegistryStatusBadge status={data.registryReadiness.status} />
              {data.identityPubkey ? <Badge>Signed identity</Badge> : <Badge>No public key</Badge>}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <MetricCard
              label="Primary score"
              value={primaryLane?.score == null ? "New" : String(primaryLane.score)}
              Icon={Trophy}
            />
            <MetricCard
              label="Realized P/L"
              value={formatSignedUsd(primaryLane?.realizedPnlUsd)}
              Icon={LineChart}
            />
            <MetricCard
              label="Closed trades"
              value={primaryLane?.closedTrades == null ? "Hidden" : String(primaryLane.closedTrades)}
              Icon={Activity}
            />
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          {data.lanes.map((lane) => (
            <LaneCard key={lane.source} lane={lane} primary={lane.source === data.primarySource} />
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-5">
            <Panel title="Why This Agent Trades" Icon={ClipboardList}>
              {data.strategySummary ? (
                <p className="text-sm leading-relaxed text-text-soft">{data.strategySummary}</p>
              ) : (
                <p className="text-sm leading-relaxed text-text-soft">
                  This profile has not published a strategy summary yet. ClearSig still
                  shows observed trade decisions and risk-gated results.
                </p>
              )}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <MiniList title="Markets" items={data.allowedMarkets} empty="No public markets" />
                <MiniList
                  title="Venues"
                  items={data.supportedVenues.map((venue) => venue.replaceAll("_", " "))}
                  empty="No public venues"
                />
              </div>
            </Panel>

            <Panel title="Decision Journal" Icon={Sparkles}>
              <div className="grid gap-3">
                {data.recentDecisions.length > 0 ? (
                  data.recentDecisions.map((decision) => (
                    <DecisionRow key={`${decision.createdAt}-${decision.market}`} decision={decision} />
                  ))
                ) : (
                  <EmptyState message="No public trade decisions have been recorded for this agent yet." />
                )}
              </div>
            </Panel>
          </div>

          <aside className="flex flex-col gap-5">
            <Panel title="Registry Readiness" Icon={ShieldCheck}>
              <div className="rounded-soft border border-border-soft bg-canvas p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-text-strong">
                      {data.registryReadiness.headline}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-text-soft">
                      {data.registryReadiness.summary}
                    </p>
                  </div>
                  <span className="font-mono text-lg font-semibold text-text-strong">
                    {data.registryReadiness.score}%
                  </span>
                </div>
              </div>
              <ul className="mt-3 grid gap-2">
                {data.registryReadiness.checks.map((check) => (
                  <li key={check.id} className="flex gap-2 text-xs leading-relaxed text-text-soft">
                    <CheckCircle2
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                        check.status === "pass"
                          ? "text-accent"
                          : check.status === "todo"
                            ? "text-warning"
                            : "text-danger"
                      }`}
                      aria-hidden="true"
                    />
                    <span>
                      <span className="font-medium text-text-strong">{check.label}:</span>{" "}
                      {check.message}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Recent Trades" Icon={Activity}>
              <div className="grid gap-3">
                {data.recentTrades.length > 0 ? (
                  data.recentTrades.map((trade) => (
                    <TradeRow key={`${trade.openedAt}-${trade.market}`} trade={trade} />
                  ))
                ) : (
                  <EmptyState message="No public trade history yet." />
                )}
              </div>
            </Panel>

            <Panel title="ClearSig Disclosures" Icon={AlertTriangle}>
              <ul className="grid gap-2">
                {data.disclosures.map((item) => (
                  <li key={item} className="flex gap-2 text-xs leading-relaxed text-text-soft">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </aside>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-soft py-5 text-xs text-text-soft">
          <span>Updated {formatDate(data.updatedAt)}</span>
          <Link
            href="/app"
            className="inline-flex items-center gap-1.5 font-medium text-accent transition-colors hover:text-accent-hover"
          >
            Open ClearSig
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </footer>
      </div>
    </main>
  );
}

async function loadProfile(params: PageProps["params"]): Promise<
  | { ok: true; status: "ready"; value: AgentPublicProfile }
  | { ok: false; status: "not_found" }
  | { ok: false; status: "unavailable"; message: string }
> {
  const { name, slug } = await params;
  try {
    const state = await getAgentServerWalletState(decodeRouteParam(name));
    const profile = buildAgentPublicProfile({
      state,
      slug: decodeRouteParam(slug),
    });
    if (!profile) return { ok: false, status: "not_found" };
    return { ok: true, status: "ready", value: profile };
  } catch (error) {
    if (error instanceof AgentServerStatePersistenceError) {
      return { ok: false, status: "unavailable", message: error.message };
    }
    throw error;
  }
}

function Panel({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon: typeof Bot;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text-strong">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  label,
  value,
  Icon,
}: {
  label: string;
  value: string;
  Icon: typeof Bot;
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

function LaneCard({ lane, primary }: { lane: AgentPublicProfileLane; primary: boolean }) {
  return (
    <article className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-strong">{lane.label}</h2>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">{lane.summary}</p>
        </div>
        {primary ? <Badge>Primary</Badge> : null}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <SmallMetric label="Rank" value={lane.rank == null ? "Unranked" : `#${lane.rank}`} />
        <SmallMetric label="Score" value={lane.score == null ? "Hidden" : String(lane.score)} />
        <SmallMetric label="P/L" value={formatSignedUsd(lane.realizedPnlUsd)} />
        <SmallMetric label="Win rate" value={lane.winRatePct == null ? "New" : `${lane.winRatePct}%`} />
        <SmallMetric label="Open" value={lane.openTrades == null ? "Hidden" : String(lane.openTrades)} />
        <SmallMetric label="Stops" value={lane.ruleViolations == null ? "Hidden" : String(lane.ruleViolations)} />
      </div>
    </article>
  );
}

function DecisionRow({ decision }: { decision: AgentPublicProfileDecision }) {
  return (
    <article className="rounded-soft border border-border-soft bg-canvas p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{decision.source.replace("_", " ")}</Badge>
          <span className="text-sm font-semibold text-text-strong">
            {decision.side.toUpperCase()} {decision.market}
          </span>
        </div>
        <span className="text-xs text-text-soft">{decision.confidence}% confidence</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-text-soft">{decision.summary}</p>
      {decision.policySummary ? (
        <p className="mt-2 text-xs leading-relaxed text-text-soft">
          {decision.policySummary}
        </p>
      ) : null}
      {decision.evidence.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {decision.evidence.map((item) => (
            <div key={`${decision.createdAt}-${item.label}`} className="rounded-soft bg-glass-soft px-3 py-2">
              <p className="text-xs font-semibold text-text-strong">{item.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-text-soft">{item.summary}</p>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function TradeRow({ trade }: { trade: AgentPublicProfileTrade }) {
  return (
    <article className="rounded-soft border border-border-soft bg-canvas p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-text-strong">
            {trade.side.toUpperCase()} {trade.market}
          </p>
          <p className="text-xs text-text-soft">
            {trade.source.replace("_", " ")} · {trade.leverage}x · {formatDate(trade.openedAt)}
          </p>
        </div>
        <Badge>{trade.status}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SmallMetric label="Size" value={formatUsd(trade.notionalUsd)} />
        <SmallMetric label="P/L" value={formatSignedUsd(trade.realizedPnlUsd)} />
      </div>
      {trade.postTradeSummary ? (
        <p className="mt-2 text-xs leading-relaxed text-text-soft">{trade.postTradeSummary}</p>
      ) : null}
    </article>
  );
}

function MiniList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas p-3">
      <p className="text-xs font-semibold text-text-strong">{title}</p>
      <p className="mt-1 text-sm text-text-soft">
        {items.length > 0 ? items.slice(0, 8).join(", ") : empty}
      </p>
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

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-border-soft bg-canvas px-2 py-1 text-[11px] font-medium capitalize text-text-soft">
      {children}
    </span>
  );
}

function RegistryStatusBadge({
  status,
}: {
  status: AgentCreatorRegistryReadiness["status"];
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-soft border border-dashed border-border-soft bg-canvas p-4 text-sm text-text-soft">
      {message}
    </div>
  );
}

function UnavailableProfile({ message }: { message: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10 text-text-strong">
      <section className="w-full max-w-lg rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
          <h1 className="text-lg font-semibold">Agent profiles are not available</h1>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-text-soft">{message}</p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Clear
        </Link>
      </section>
    </main>
  );
}

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function formatUsd(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(parsed);
}

function formatSignedUsd(value: string | number | null | undefined): string {
  if (value == null) return "Hidden";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0";
  const formatted = formatUsd(Math.abs(parsed));
  if (parsed > 0) return `+${formatted}`;
  if (parsed < 0) return `-${formatted}`;
  return formatted;
}

function formatDate(value: number | null | undefined): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
