import { expect, it, vi } from "vitest";
import { buildBatchRiskSummary } from "./batchRisk";
vi.mock("@/lib/retail/priceConversion", () => ({ quotePerWhole: () => ({ usdPerWhole: 100 }), formatUsd: (n: number) => `$${n}` }));
it("keeps chain, wallet and velocity breaches visible together", () => {
  const risk = buildBatchRiskSummary(1, 3, { budget: { weeklyUsd: 50, velocityPerDay: 2 } as never, perChain: [{ ticker: "SOL", cap: 40, spentUsd: 0 } as never], spentUsd: 0, sendsLast24h: 1 });
  expect(risk?.body).toContain("Solana limit"); expect(risk?.body).toContain("treasury limit"); expect(risk?.body).toContain("4 sends");
});
