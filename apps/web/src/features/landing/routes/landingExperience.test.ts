import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import HomePage from "./LandingPage";
import { LandingReveal } from "@/components/landing/LandingReveal";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("readable approval landing experience", () => {
  it("keeps core content visible in server-rendered/no-JavaScript HTML", () => {
    const html = renderToStaticMarkup(createElement(HomePage));
    expect(html).toContain("Sign intents.");
    expect(html).toContain("Follow the decision.");
    expect(html).toContain("Keep the whole picture.");
    expect(html).toContain("No signing or transaction.");
    expect(html).toContain("1 of 2 approvals");
    expect(html).toContain("3 owners · one more needed");
    expect(html).not.toContain("of 3 approvals");
    expect(html).toContain("local, interactive explanation");
    expect(html).toContain("External execution gated");
    expect(html).toContain("Your recovery plan");
    expect(html).toContain("Devnet preview");
    expect(html).not.toContain('data-reveal="pending"');
    expect(html).not.toContain("opacity:0");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    for (const id of ["story-request", "story-rules", "story-people", "products", "resources"]) {
      expect(html.match(new RegExp(`id="${id}"`, "g"))).toHaveLength(1);
      expect(html).toContain(`href="#${id}"`);
    }
    expect(html).toContain('aria-label="Approval story navigation"');
    expect(html).toContain("Skip story");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="All destinations"');
    expect(html).toContain("Interactive examples need JavaScript");
    expect(html).toContain("single mock signer, not production distributed MPC");
    expect(html).toContain("Pause network animation");
    for (const name of ["Bitcoin", "Ethereum", "Hyperliquid", "Solana", "Zcash"]) expect(html).toContain(name);
    expect(html).toContain("Availability varies by product.");
  });

  it("uses neutral receipt surfaces rather than a full-color green panel", () => {
    const receipt = readFileSync(
      resolve(
        process.cwd(),
        "src/features/landing/routes/LandingPage.module.css",
      ),
      "utf8",
    );
    expect(receipt).toContain("background: #131316");
    expect(receipt).toContain("--accent: #ccff00");
    expect(receipt).not.toContain("shadow-[");
  });

  it("makes scroll reveals progressive and supports reduced motion and keyboard focus", () => {
    const html = renderToStaticMarkup(
      createElement(
        LandingReveal,
        null,
        createElement("p", null, "Readable content"),
      ),
    );
    expect(html).toContain('data-reveal="visible"');
    const reveal = readFileSync(
      resolve(process.cwd(), "src/components/landing/LandingReveal.tsx"),
      "utf8",
    );
    const css = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    expect(reveal).toContain("IntersectionObserver");
    expect(reveal).toContain("useReducedMotion");
    expect(reveal).toContain("onFocusCapture");
    expect(css).toContain(".landing-reveal:focus-within");
    expect(css).toContain("@media print");
  });
});
