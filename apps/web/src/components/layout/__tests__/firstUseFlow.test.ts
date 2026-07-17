import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("first-use wallet creation", () => {
  const walletHome = source("src/features/wallet/routes/WalletHomePage.tsx");
  const walletDashboard = source(
    "src/features/wallet/ui/home/WalletDashboardSections.tsx",
  );
  const newWallet = source("src/app/app/wallet/new/page.tsx");
  const chooser = source("src/app/choose/page.tsx");
  const sidebar = source("src/components/layout/WorkspaceSidebar.tsx");

  it("opens wallet creation directly from the empty state", () => {
    expect(walletDashboard).toContain("Create your first wallet");
    expect(walletDashboard).toContain('href="/app/wallet/new"');
    expect(walletDashboard).not.toContain("Choose your ClearSig product");
  });

  it("defaults creation to Personal and keeps advanced purposes inline", () => {
    expect(newWallet).toContain('requestedSurface ?? "personal"');
    expect(newWallet).toContain('aria-label="Wallet purpose"');
    expect(newWallet).toContain('label: "Personal"');
    expect(newWallet).toContain('label: "Team"');
    expect(newWallet).toContain('label: "Agent"');
    expect(newWallet).not.toContain("function ProductChoiceCard");
  });

  it("renders the public product chooser before sign-in", () => {
    expect(chooser).toContain("<ProductChooser />");
    expect(chooser).not.toContain("redirect(");
  });

  it("keeps wallet creation available in desktop wallet-scoped navigation", () => {
    const scopedStart = sidebar.indexOf("function WalletScopedSidebar");
    expect(scopedStart).toBeGreaterThan(0);
    expect(sidebar.slice(scopedStart)).toContain('href="/app/wallet/new"');
    expect(sidebar.slice(scopedStart)).toContain("New wallet");
  });
});
