import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routePath = resolve(
  process.cwd(),
  "src/app/app/wallet/[name]/page.tsx",
);
const routeSource = readFileSync(routePath, "utf8");

describe("wallet detail architecture", () => {
  it("keeps the route as a coordinator", () => {
    expect(routeSource.split("\n").length).toBeLessThan(700);
    expect(routeSource).not.toContain("function ProOperationsPanel");
    expect(routeSource).not.toContain("function ActivitySection");
    expect(routeSource).not.toContain("function NativeHoldingsSection");
  });

  it("loads low-frequency tabs through separate chunks", () => {
    expect(routeSource).toContain(
      'import("@/components/wallet/detail/ActivityPanel")',
    );
    expect(routeSource).toContain(
      'import("@/components/wallet/detail/ManagePanel")',
    );
  });

  it("does not pull inactive chain history or Pro modules into the route", () => {
    expect(routeSource).not.toContain('from "@/lib/hooks/useChainTxHistory"');
    expect(routeSource).not.toContain('from "@/lib/pro/treasury"');
    expect(routeSource).not.toContain('from "@/lib/agents/');
  });
});
