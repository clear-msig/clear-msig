import type { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";
import { formatUsd, quotePerWhole } from "@/lib/retail/priceConversion";

export interface BatchRiskSummary {
  title: string;
  body: string;
}

type BudgetUsage = Pick<
  ReturnType<typeof useWalletBudgetUsage>,
  "budget" | "perChain" | "sendsLast24h" | "spentUsd"
>;

export function buildBatchRiskSummary(
  totalSol: number,
  rowCount: number,
  budgetUsage: BudgetUsage,
): BatchRiskSummary | null {
  if (rowCount <= 0 || totalSol <= 0) return null;
  const quote = quotePerWhole("SOL");
  const pendingUsd = quote ? totalSol * quote.usdPerWhole : 0;
  const solCap = budgetUsage.perChain.find((row) => row.ticker === "SOL");
  if (solCap && solCap.cap !== null && pendingUsd > 0) {
    const after = solCap.spentUsd + pendingUsd;
    if (after > solCap.cap) {
      return {
        title: "Above Solana limit",
        body: `${formatUsd(after)} would be used this week, above the saved ${formatUsd(solCap.cap)} Solana limit.`,
      };
    }
  }

  const weeklyCap = budgetUsage.budget?.weeklyUsd ?? null;
  if (weeklyCap !== null && weeklyCap > 0 && pendingUsd > 0) {
    const after = budgetUsage.spentUsd + pendingUsd;
    if (after > weeklyCap) {
      return {
        title: "Above weekly limit",
        body: `${formatUsd(after)} would be used this week, above the saved ${formatUsd(weeklyCap)} treasury limit.`,
      };
    }
  }

  const velocityCap = budgetUsage.budget?.velocityPerDay ?? null;
  if (velocityCap && budgetUsage.sendsLast24h + rowCount > velocityCap) {
    return {
      title: "Above daily send limit",
      body: `${budgetUsage.sendsLast24h + rowCount} sends would count in the last 24 hours, above the saved limit of ${velocityCap}.`,
    };
  }

  return null;
}
