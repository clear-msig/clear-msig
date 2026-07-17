import { useEffect } from "react";
import { BrandMark } from "@/components/retail/BrandMark";
import { formatChainBalance } from "@/lib/balances";
import { useWalletPortfolio, type WalletPortfolio } from "@/lib/hooks/useWalletPortfolio";
import { chainByKind, chainDisplayRank } from "@/lib/retail/chains";

export function WalletDashboardShell() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="hidden h-10 w-52 rounded-full border border-border-soft bg-surface-raised md:block" />
        <div className="h-4 w-36 rounded-full bg-border-soft/70" />
      </div>
      <div className="rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest">
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-11 rounded-soft border border-border-soft bg-canvas/60"
            />
          ))}
        </div>
      </div>
      <div className="relative h-52 overflow-hidden rounded-card border border-border-soft bg-[#090908] p-4 shadow-card-rest">
        <div className="absolute inset-x-8 top-3 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        <div className="flex h-full items-center justify-center rounded-[1.1rem] border border-white/[0.08] bg-[radial-gradient(circle_at_50%_0%,rgba(204,255,0,0.08),transparent_42%),linear-gradient(180deg,#151511,#090909)]">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border border-accent/25 bg-accent/[0.07]">
            <BrandMark size={36} />
          </div>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ Hero â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Compact left-aligned page header. Replaces the previous centered
// "Welcome back" block - same identity cue (small kicker + title)
// but reclaims the vertical room for the stats and action-needed
// blocks below. The dynamic summary line ("3 wallets - 2 need your
// approval") gives a returning user a useful one-line status before
// any cards have rendered.

export type PortfolioSnapshot = Pick<
  WalletPortfolio,
  "breakdown" | "totalUsd" | "isLoading"
>;

export interface AggregateChainBalance {
  kind: number;
  ticker: string;
  amount: string;
  raw: bigint;
}

export interface AggregatePortfolio {
  totalUsd: number;
  chains: AggregateChainBalance[];
}

export function WalletPortfolioReporter({
  walletName,
  onChange,
}: {
  walletName: string;
  onChange: (walletName: string, snapshot: PortfolioSnapshot | null) => void;
}) {
  const portfolio = useWalletPortfolio(walletName);
  useEffect(() => {
    onChange(walletName, {
      breakdown: portfolio.breakdown,
      totalUsd: portfolio.totalUsd,
      isLoading: portfolio.isLoading,
    });
    return () => onChange(walletName, null);
  }, [
    walletName,
    portfolio.breakdown,
    portfolio.totalUsd,
    portfolio.isLoading,
    onChange,
  ]);
  return null;
}

export function aggregatePortfolio(snapshots: PortfolioSnapshot[]): AggregatePortfolio {
  const byKind = new Map<number, { raw: bigint; ticker: string }>();
  let totalUsd = 0;
  for (const snapshot of snapshots) {
    totalUsd += snapshot.totalUsd;
    for (const chain of snapshot.breakdown) {
      if (chain.raw === null || chain.raw === 0n) continue;
      const existing = byKind.get(chain.kind);
      byKind.set(chain.kind, {
        raw: (existing?.raw ?? 0n) + chain.raw,
        ticker: existing?.ticker ?? chain.ticker,
      });
    }
  }
  const chains = Array.from(byKind.entries())
    .sort(([a], [b]) => chainDisplayRank(a) - chainDisplayRank(b))
    .map(([kind, value]) => {
      const meta = chainByKind(kind);
      const amount = meta
        ? formatChainBalance(
            value.raw,
            meta.smallestPerWhole,
            meta.displayDecimals,
          )
        : value.raw.toString();
      return {
        kind,
        ticker: meta?.ticker ?? value.ticker,
        amount: amount ?? "0",
        raw: value.raw,
      };
    });
  return { totalUsd, chains };
}
