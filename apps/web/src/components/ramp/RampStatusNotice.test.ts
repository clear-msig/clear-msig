import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RampStatusNotice } from "./RampStatusNotice";

function render(reason: string, refreshing = false) {
  return renderToStaticMarkup(
    createElement(RampStatusNotice, {
      reason,
      intentId: "payment-123",
      refreshing,
      onRefresh() {},
    }),
  );
}

describe("payment uncertainty and operator review", () => {
  it("never equates a status read failure with failed or completed settlement", () => {
    const html = render("status_unavailable");
    expect(html).toContain("Payment status unavailable");
    expect(html).toContain("does not mean your payment failed");
    expect(html).toContain("Do not pay or send crypto again");
    expect(html).toContain("payment-123");
    expect(html).toContain("Refresh payment status");
    expect(html).not.toContain("Bank payout in progress");
  });
  it("explains manual review without encouraging a duplicate funded transfer", () => {
    const html = render("manual_review_required");
    expect(html).toContain("Payment needs review");
    expect(html).toContain("Funds may already have moved");
    expect(html).toContain("Do not start another payment");
    expect(html).not.toContain("Something went wrong");
  });
  it.each(["expired", "cancelled", "failed"])(
    "keeps %s payment uncertainty and reference visible",
    (reason) => {
      const html = render(reason);
      expect(html).toContain(
        "does not confirm whether funds were received or refunded",
      );
      expect(html).toContain("contact support before trying again");
      expect(html).toContain("payment-123");
    },
  );
  it("disables repeated refresh while checking, without adding a financial action", () => {
    const html = render("status_unavailable", true);
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain("Checking status…");
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});
