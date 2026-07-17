import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("wallet-first information architecture", () => {
  const sidebar = source("src/components/layout/WorkspaceSidebar.tsx");
  const walletHome = source("src/features/wallet/routes/WalletHomePage.tsx");
  const walletSwitcher = source(
    "src/features/wallet/ui/home/MobileWalletSwitchModal.tsx",
  );

  it("uses wallets, not product workspaces, as primary navigation", () => {
    expect(sidebar).toContain('label="Wallets"');
    expect(sidebar).not.toContain('label="Workspaces"');
    expect(sidebar).not.toContain("productWorkspaceLabel(surface)");
  });

  it("shows all wallets unless a product filter is explicitly requested", () => {
    expect(walletHome).toContain(
      "const selectedSurface = requestedAll ? null : requestedSurface",
    );
    expect(walletHome).not.toContain("requestedSurface ?? storedSurface");
  });

  it("keeps the wallet switcher flat and capability-neutral", () => {
    expect(walletSwitcher).toContain("Your wallets");
    expect(walletSwitcher).toContain("ordered.map((membership)");
    expect(walletSwitcher).not.toContain("const grouped = useMemo");
    expect(walletSwitcher).not.toContain("Choose workspace");
  });
});
