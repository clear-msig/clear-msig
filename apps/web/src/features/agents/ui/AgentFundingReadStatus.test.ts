import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentFundingReadStatus } from "./AgentFundingReadStatus";
function render(
  props: Partial<Parameters<typeof AgentFundingReadStatus>[0]> = {},
) {
  return renderToStaticMarkup(
    createElement(AgentFundingReadStatus, {
      address: null,
      loadingAddress: false,
      addressError: false,
      loadingSources: false,
      sourcesError: false,
      connected: true,
      sourceCount: 0,
      refreshing: false,
      onRefresh() {},
      ...props,
    }),
  );
}
describe("funding read states", () => {
  it("ends loading for a resolved missing address and offers read-only refresh", () => {
    const html = render();
    expect(html).toContain("No deposit address was found");
    expect(html).toContain("Refresh funding details");
    expect(html).not.toContain("Loading deposit address");
    expect(html).not.toContain("animate-pulse");
  });
  it("hides a stale address after its verification request fails", () => {
    const html = render({ address: "STALE_ADDRESS", addressError: true });
    expect(html).not.toContain("STALE_ADDRESS");
    expect(html).toContain("Could not verify");
  });
  it("does not confuse failed treasury reads with empty membership", () => {
    const html = render({ sourcesError: true });
    expect(html).toContain("Could not load source treasuries");
    expect(html).not.toContain("No eligible Pro treasury");
  });
  it("explains disconnected and loading states separately", () => {
    expect(render({ connected: false })).toContain("Connect your wallet");
    expect(render({ loadingAddress: true, loadingSources: true })).toContain(
      "Loading deposit address",
    );
    expect(render({ address: "EXACT_ADDRESS" })).toContain("EXACT_ADDRESS");
  });
  it("disables repeated retry while fetching", () => {
    expect(render({ refreshing: true })).toMatch(/<button[^>]*disabled/);
  });
});
