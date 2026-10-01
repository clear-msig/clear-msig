import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanonicalActionReview } from "@/components/review/CanonicalActionReview";
import type { CanonicalProposalReview } from "../proposalReview";
const review: CanonicalProposalReview = {
  reviewId: "synthetic",
  walletName: "Example",
  document: "Synthetic document",
  network: "Solana Devnet",
  payloadHash: "synthetic",
  headline: "Send 0.3 SOL",
  threshold: 2,
  timelockSeconds: 30,
  binding: {
    intent: "synthetic",
    index: 1n,
    actionKind: 1,
    policy: "synthetic",
    actionId: "synthetic",
    nonce: "synthetic",
    intentIndex: 0,
    approvalBitmap: 0,
    approvers: ["a", "b", "c"],
    wallet: "full-wallet-account",
  },
  proposalAddress: "full-request-account",
  expiresAt: 1784000000n,
  envelopeHash: "exact-envelope",
  sections: [
    {
      title: "DETAILS",
      text: "Amount: 0.3 SOL\nTo: full-destination\nNetwork: Solana Devnet",
    },
  ],
};
describe("production canonical action review rendering", () => {
  it("keeps exact account identities, threshold, expiry and every supplied action detail visible", () => {
    const html = renderToStaticMarkup(
      createElement(CanonicalActionReview, {
        review,
        loading: false,
        onRefresh: () => {},
      }),
    );
    for (const text of [
      "full-wallet-account",
      "full-request-account",
      "full-destination",
      "1784000000",
      "2 of 3",
      "30 seconds",
      "Fees are",
      "exact-envelope",
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("<details");
  });
  it.each([{ loading: true }, { loading: false, error: "Mismatch" }])(
    "does not display a stale successful document while blocked/loading %j",
    (state) => {
      const html = renderToStaticMarkup(
        createElement(CanonicalActionReview, {
          review,
          ...state,
          onRefresh: () => {},
        }),
      );
      expect(html).not.toContain("full-destination");
      expect(html).not.toContain("Send 0.3 SOL");
    },
  );
});
