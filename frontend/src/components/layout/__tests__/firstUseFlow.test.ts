import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("first-use wallet creation", () => {
  const walletHome = source("src/features/wallet/routes/WalletHomePage.tsx");
  const newWallet = source("src/app/app/wallet/new/page.tsx");
  const chooser = source("src/app/choose/page.tsx");

  it("opens wallet creation directly from the empty state", () => {
    expect(walletHome).toContain("Create your first wallet");
    expect(walletHome).toContain('href="/app/wallet/new"');
    expect(walletHome).not.toContain("Choose your ClearSig product");
  });

  it("defaults creation to Personal and keeps advanced purposes inline", () => {
    expect(newWallet).toContain('requestedSurface ?? "personal"');
    expect(newWallet).toContain('aria-label="Wallet purpose"');
    expect(newWallet).toContain('label: "Personal"');
    expect(newWallet).toContain('label: "Team"');
    expect(newWallet).toContain('label: "Agent"');
    expect(newWallet).not.toContain("function ProductChoiceCard");
  });

  it("retires the standalone product chooser", () => {
    expect(chooser).toContain('redirect("/app/wallet/new")');
    expect(chooser).not.toContain("ProductChooserPage");
  });
});
