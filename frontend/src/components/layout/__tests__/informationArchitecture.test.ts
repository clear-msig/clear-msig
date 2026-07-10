import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("wallet-first information architecture", () => {
  const sidebar = source("src/components/layout/WorkspaceSidebar.tsx");
  const walletHome = source("src/app/app/wallet/page.tsx");

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
    expect(walletHome).toContain("Your wallets");
    expect(walletHome).toContain("ordered.map((membership)");
    expect(walletHome).not.toContain("const grouped = useMemo");
    expect(walletHome).not.toContain("Choose workspace");
  });
});
