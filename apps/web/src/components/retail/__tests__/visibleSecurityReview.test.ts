import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SignPayloadPreview } from "../SignPayloadPreview";
import { RequestOverview } from "@/components/review/RequestOverview";

describe("security review presentation", () => {
  it("keeps source, destination, contract, fee and permission visible even for legacy collapse callers", () => {
    const html = renderToStaticMarkup(
      createElement(SignPayloadPreview, {
        action: "Review transfer",
        collapsibleDetails: true,
        details: [
          {
            label: "Recipient address",
            value: "FULL_DESTINATION_123",
            emphasis: "mono",
          },
          { label: "From address", value: "FULL_SOURCE_456", emphasis: "mono" },
          { label: "Contract", value: "EXACT_CONTRACT_789", emphasis: "mono" },
          { label: "Network fee", value: "Unknown — review before signing" },
          { label: "Permissions", value: "No ongoing allowance" },
        ],
        warning: "Irreversible transfer",
      }),
    );
    for (const text of [
      "FULL_DESTINATION_123",
      "FULL_SOURCE_456",
      "EXACT_CONTRACT_789",
      "Unknown",
      "No ongoing allowance",
      "Irreversible transfer",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("<details");
    expect(html).not.toContain("truncate");
  });
  it("distinguishes the required threshold from membership and exposes the full request identity", () => {
    const html = renderToStaticMarkup(
      createElement(RequestOverview, {
        title: "Send 5 SOL",
        walletName: "Operations",
        walletHref: "/app/wallet/Operations",
        status: "Awaiting approval",
        created: "Created by Sam",
        collected: 1,
        threshold: 2,
        members: 3,
        proposalAddress: "FULL_REQUEST_ACCOUNT_123",
      }),
    );
    expect(html).toContain("1 of 2 required approvals");
    expect(html).toContain("3 eligible members");
    expect(html).toContain("1 more needed");
    expect(html).toContain("FULL_REQUEST_ACCOUNT_123");
    expect(html).toContain("<h1");
    expect(html).not.toContain('class="hidden');
  });
});
