"use client";
import Link from "next/link";
import { Bell, Bot, Database, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import type { AgentProfile, AgentMarketDataSnapshot, AgentMarketIntelligenceSnapshot } from "@/features/agents/domain";
export default function FeatureAccessPanel({
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
