import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducedMotion } from "../useReducedMotion";

function Example() {
  const reduce = useReducedMotion();
  return createElement("section", { "data-motion": reduce ? "still" : "animated" }, "Approval details");
}

afterEach(() => vi.unstubAllGlobals());

describe("motion hydration baseline", () => {
  it("renders visible still content on the server", () => {
    expect(renderToString(createElement(Example))).toContain('data-motion="still"');
  });
  it("does not branch server markup on browser-only preferences", () => {
    const matchMedia = vi.fn(() => { throw new Error("must not read during SSR"); });
    vi.stubGlobal("window", { matchMedia });
    expect(renderToString(createElement(Example))).toContain("Approval details");
    expect(matchMedia).not.toHaveBeenCalled();
  });
});
