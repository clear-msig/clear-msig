import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("application accessibility contract", () => {
  const appLayout = source("src/app/app/layout.tsx");
  const globals = source("src/app/globals.css");
  const button = source("src/components/retail/Button.tsx");
  const eslint = source("eslint.config.mjs");

  it("provides one focusable main landmark and a skip link", () => {
    expect(appLayout).toContain('href="#main-content"');
    expect(appLayout).toContain('id="main-content"');
    expect(appLayout).toContain("tabIndex={-1}");
    expect(appLayout).toContain("<RouteAccessibility");
  });

  it("keeps connected app pages out of nested main landmarks", () => {
    const nestedMainPages = [
      "src/app/app/wallet/[name]/chains/add/page.tsx",
      "src/features/treasury/routes/EscrowPage.tsx",
      "src/features/send/routes/BtcSendPage.tsx",
      "src/app/app/wallet/[name]/setup/erc20/page.tsx",
      "src/app/app/wallet/[name]/setup/page.tsx",
    ];
    for (const path of nestedMainPages) {
      expect(source(path)).not.toMatch(/<\/?main\b/);
    }
  });

  it("preserves visible focus and 44px shared touch targets", () => {
    expect(globals).toContain("outline: 2px solid var(--clear-accent)");
    expect(globals).not.toContain("input:focus-visible,\ntextarea:focus-visible,\nselect:focus-visible {\n  outline: none");
    expect(button).toContain('sm: "min-h-tap');
  });

  it("enforces critical JSX accessibility rules in lint", () => {
    expect(eslint).toContain('"jsx-a11y/control-has-associated-label": "error"');
    expect(eslint).toContain('"jsx-a11y/click-events-have-key-events": "error"');
    expect(eslint).toContain('"jsx-a11y/no-static-element-interactions": "error"');
  });

  it("traps and restores focus in custom modal surfaces", () => {
    const approval = source("src/components/agents/OwnerApprovalDialog.tsx");
    const tour = source("src/components/onboarding/WalletTourModal.tsx");
    const walletHub = source("src/features/wallet/routes/WalletHomePage.tsx");

    for (const modal of [approval, tour, walletHub]) {
      expect(modal).toContain("useFocusTrap(");
      expect(modal).toContain('aria-modal="true"');
      expect(modal).toContain("data-dialog-initial-focus");
    }
  });

  it("keeps theme text and primary actions at AA contrast", () => {
    expect(globals).toContain("--clear-text-soft: rgba(235, 235, 235, 0.6)");
    expect(globals).toContain("--clear-text-soft: rgba(10, 14, 22, 0.62)");
    expect(globals).toContain("--clear-accent: #ccff00");
    expect(globals).toContain("--clear-accent: #4d7c0f");
    expect(contrast("#929292", "#0c0c0c")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#64676c", "#f6f7f9")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#000000", "#ccff00")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", "#4d7c0f")).toBeGreaterThanOrEqual(4.5);
  });
});

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) =>
    Number.parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}
