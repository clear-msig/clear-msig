import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WalletRuntimeLoading } from "./RuntimeStates";

const route = vi.hoisted(() => ({ pathname: "/security" as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

describe("loading presentation", () => {
  it("renders public navigation and an accessible status without wallet layout", () => {
    route.pathname = "/security";
    const html = renderToStaticMarkup(createElement(WalletRuntimeLoading));
    expect(html).toContain('class="public-brand-surface');
    expect(html).toContain('aria-label="Loading page"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="ClearSig home"');
    expect(html).not.toContain("<aside");
    expect(html).toContain("motion-safe:animate-pulse");
  });
  it.each(["/app/wallet", "/app/secure", null])("retains app skeleton for %s without forcing dark tokens", (pathname) => {
    route.pathname = pathname;
    const html = renderToStaticMarkup(createElement(WalletRuntimeLoading));
    expect(html).toContain('aria-label="Loading wallet"');
    expect(html).toContain("<aside");
    expect(html).not.toContain("public-brand-surface");
  });
});
