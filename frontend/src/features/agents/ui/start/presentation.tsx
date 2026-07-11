"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { decodeRouteParam as decodeParam, formatSignedUsd, formatUsd, venueLabel, type AgentExecutionRecord, type AgentMarketDataSnapshot, type AgentProfile, type AgentSessionGrant, type AgentVaultPolicy, type TradingLaunchStep, type TradingLaunchVenue } from "@/features/agents/domain";

export { decodeParam, formatSignedUsd, formatUsd, venueLabel };

export function StepLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={STEP_BUTTON_CLASS}>
      {label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}
export function ownerLabel(owner: TradingLaunchStep["owner"]): string {
  switch (owner) {
    case "you":
      return "You";
    case "trader":
      return "Trader";
    case "host":
      return "ClearSig";
    case "clearsig":
      return "ClearSig";
  }
}
export function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}
export function mergeById<T extends { id: string; updatedAt?: number }>(
  local: T[],
  saved: T[],
): T[] {
  const merged = new Map<string, T>();
  for (const item of [...local, ...saved]) {
    const existing = merged.get(item.id);
    if (!existing || (item.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      merged.set(item.id, item);
    }
  }
  return [...merged.values()];
}
export function sessionAllowsVenue(
  session: AgentSessionGrant,
  venue: TradingLaunchVenue,
  policy: AgentVaultPolicy,
): boolean {
  return session.allowedVenues?.length
    ? session.allowedVenues.includes(venue)
    : policy.allowedVenues.includes(venue);
}
export async function loadStartMarketData({
  agent,
  venue,
}: {
  agent: AgentProfile;
  venue: TradingLaunchVenue;
}): Promise<{ snapshot: AgentMarketDataSnapshot | null; message: string }> {
  const market = agent.strategy?.allowedMarkets[0] ?? "BTC-PERP";
  const providers = venue === "hyperliquid_testnet" ? ["hyperliquid"] : ["hyperliquid", "mock"];
  for (const provider of providers) {
    try {
      const response = await fetch(
        `/api/agent-market-data/${provider}?market=${encodeURIComponent(market)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        snapshot?: AgentMarketDataSnapshot;
        error?: string;
      };
      if (response.ok && payload.ok && payload.snapshot) {
        return {
          snapshot: payload.snapshot,
          message:
            payload.snapshot.source === "live"
              ? "Live market data is ready."
              : "Practice market data is ready.",
        };
      }
    } catch {
      // Try the next provider. The UI shows the fallback status below.
    }
  }
  return {
    snapshot: null,
    message: "Market data is not available yet. The trader can still use its practice plan.",
  };
}
export function venueRequestStatusLabel(status: string): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "waiting_for_setup":
      return "Waiting for setup";
    case "adapter_not_connected":
      return "Connection pending";
    case "adapter_error":
      return "Executor error";
    case "rejected":
      return "Stopped";
    default:
      return status.replaceAll("_", " ");
  }
}
export function formatCompactUsd(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(parsed)}`;
}
export const STEP_BUTTON_CLASS =
  "inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto";
export const CONTROL_BUTTON_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60";
export const DANGER_BUTTON_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-rose-500/30 px-3 py-2 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/[0.08] disabled:cursor-not-allowed disabled:opacity-60";
