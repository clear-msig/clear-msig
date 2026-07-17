import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routePath = resolve(
  process.cwd(),
  "src/app/app/wallet/[name]/page.tsx",
);
const routeSource = readFileSync(routePath, "utf8");
const manageSource = readFileSync(
  resolve(process.cwd(), "src/components/wallet/detail/ManagePanel.tsx"),
  "utf8",
);
const proSource = readFileSync(
  resolve(process.cwd(), "src/components/wallet/detail/ProTreasuryPanel.tsx"),
  "utf8",
);
const rulesSource = readFileSync(
  resolve(process.cwd(), "src/app/app/wallet/[name]/rules/page.tsx"),
  "utf8",
);

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

  it("keeps Personal protection compact and spending limits persistent", () => {
    expect(manageSource).toContain("Spending limits");
    expect(manageSource).toContain('href={`/app/wallet/${encoded}/budget`}');
    expect(manageSource).not.toContain("A shared wallet normal people can trust");
    expect(manageSource).not.toContain("function PersonalSafetyLink");
  });

  it("keeps Agent Vault separate from Pro and makes command selection stable", () => {
    expect(proSource).not.toContain('label: "Automation"');
    expect(proSource).not.toContain('title="Agent vaults"');
    expect(proSource).not.toContain('activePanel === "automation"');
    expect(proSource).toContain("onClick={() => setActivePanel(key)}");
  });

  it("does not let the opening click dismiss the timelock dialog", () => {
    expect(rulesSource).toContain("const [backdropArmed, setBackdropArmed]");
    expect(rulesSource).toContain("setBackdropArmed(true), 350");
    expect(rulesSource).toContain("if (backdropArmed && !update.isPending) onClose()");
  });
});
