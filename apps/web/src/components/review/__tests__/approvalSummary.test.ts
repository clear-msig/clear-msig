import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CanonicalActionReview } from "../CanonicalActionReview";
import type { CanonicalProposalReview } from "@/lib/clearsign/proposalReview";

const MARA = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const review: CanonicalProposalReview = {
  reviewId: "r",
  walletName: "Ops",
  document: "doc",
  network: "Solana Devnet",
  payloadHash: "p",
  headline: "Send 0.3 SOL",
  threshold: 2,
  timelockSeconds: 0,
  binding: {
    intent: "i", index: 1n, actionKind: 1, policy: "p", actionId: "a", nonce: "n",
    intentIndex: 0, approvalBitmap: 0, approvers: ["a", "b", "c"], wallet: "WALLET_ACCT",
  },
  proposalAddress: "REQUEST_ACCT",
  expiresAt: BigInt(NOW / 1000 + 3600),
  envelopeHash: "ENVELOPE_HASH",
  sections: [
    { title: "DETAILS", text: `Amount: 0.3 SOL\nTo: ${MARA}\nNetwork: Solana Devnet` },
  ],
};
const render = (ctx: object) =>
  renderToStaticMarkup(
    createElement(CanonicalActionReview, {
      review,
      loading: false,
      onRefresh: () => {},
      summaryContext: {
        contacts: [],
        recentRecipients: [],
        vaultLamports: 12_400_000_000n,
        nowMs: NOW,
        ...ctx,
      },
    }),
  );

describe("approval summary inside the canonical review", () => {
  it("shows the consequences and still shows every exact field", () => {
    const html = render({});
    for (const text of [
      "You are approving",
      "First time sending here",
      "12.4 SOL",
      "12.1 SOL",
      "Expires in 1 hour",
      "No delay",
      // exact document and identities remain visible and uncollapsed
      "WALLET_ACCT",
      "REQUEST_ACCT",
      "ENVELOPE_HASH",
      MARA,
    ])
      expect(html).toContain(text);
    expect(html).not.toContain("<details");
  });
  it("names a saved contact", () => {
    expect(render({ contacts: [{ name: "Mara", address: MARA }] })).toContain("Saved contact");
  });
  it("omits the balance row when the balance is unknown", () => {
    expect(render({ vaultLamports: null })).not.toContain("Vault balance");
  });
  it("renders nothing extra without a summary context", () => {
    const html = renderToStaticMarkup(
      createElement(CanonicalActionReview, { review, loading: false, onRefresh: () => {} }),
    );
    expect(html).not.toContain("You are approving");
  });
});
