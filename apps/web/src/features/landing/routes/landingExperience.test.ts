import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import HomePage from "./LandingPage";
import { LandingReveal } from "@/components/landing/LandingReveal";

describe("readable approval landing experience", () => {
  it("keeps core content visible in server-rendered/no-JavaScript HTML", () => {
    const html = renderToStaticMarkup(createElement(HomePage));
    expect(html).toContain("Sign intents.");
    expect(html).toContain("Know what");
    expect(html).toContain("Illustrative demo");
    expect(html).toContain("External execution gated");
    expect(html).toContain("Your recovery plan");
    expect(html).toContain("Devnet preview");
    expect(html).not.toContain('data-reveal="pending"');
    expect(html).not.toContain("opacity:0");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
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
