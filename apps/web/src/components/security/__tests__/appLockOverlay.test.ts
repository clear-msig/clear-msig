import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppLockOverlay } from "../AppLockOverlay";

describe("app lock initial render", () => {
  it("does not expose protected content before device lock state is known", () => {
    const markup = renderToStaticMarkup(createElement(AppLockOverlay, null,
      createElement("div", null, "Private treasury balance"),
    ));
    expect(markup).toContain("Checking app lock");
    expect(markup).not.toContain("Private treasury balance");
  });

  it("does not mount protected hooks or components before the lock check", () => {
    const protectedRender = vi.fn();
    function ProtectedWallet() {
      protectedRender();
      return createElement("div", null, "Pending approvals");
    }
    renderToStaticMarkup(createElement(AppLockOverlay, null, createElement(ProtectedWallet)));
    expect(protectedRender).not.toHaveBeenCalled();
  });
});
