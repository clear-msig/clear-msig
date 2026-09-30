import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";
import config from "../../../../tailwind.config";

describe("semantic theme CSS", () => {
  it("actually emits opacity variants for tinted surfaces and navigation", async () => {
    const result = await postcss([tailwindcss({
      ...config,
      content: [{ raw: '<div class="bg-accent/10 bg-canvas/95 bg-surface-raised/95 border-border-soft/50 text-text-soft/70 bg-glass-soft text-text-strong"></div>', extension: "html" }],
    })]).process("@tailwind utilities;", { from: undefined });
    for (const selector of [".bg-accent\\/10", ".bg-canvas\\/95", ".bg-surface-raised\\/95", ".border-border-soft\\/50", ".text-text-soft\\/70"]) {
      expect(result.css).toContain(selector);
    }
    expect(result.css).toContain("rgb(var(--clear-accent-rgb, 163 190 140) / 0.1)");
    expect(result.css).toContain("rgb(var(--clear-canvas-rgb, 12 12 12) / 0.95)");
    expect(result.css).toContain("calc(0.08 * 0.5)");
    expect(result.css).toContain("calc(var(--clear-text-soft-opacity, 0.6) * 0.7)");
  });
});
