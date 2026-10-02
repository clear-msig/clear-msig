import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const wallet = vi.hoisted(() => ({ isLedger: false, isMobile: false }));
vi.mock("@/lib/wallet", () => ({ useWallet: () => wallet }));
import { WalletPopupNarration } from "../WalletPopupNarration";

describe("signing handoff trust limits", () => {
  it.each(["desktop", "mobile", "ledger"])("does not normalize blind approval on %s", (mode) => {
    wallet.isLedger = mode === "ledger"; wallet.isMobile = mode === "mobile";
    for (const compact of [true, false]) {
      const html = renderToStaticMarkup(createElement(WalletPopupNarration, { action: "send 1 SOL", popups: 2, compact }));
      expect(html).toContain("not independent verification");
      expect(html).toContain("cancel");
      expect(html).toContain("Review each prompt");
      expect(html).not.toContain("Tap Approve");
      expect(html).not.toContain("It is normal");
      expect(html).not.toContain("Nothing leaves your account");
      expect(html).not.toContain("displays the exact message");
    }
  });
});
