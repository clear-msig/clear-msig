import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/wallet", () => ({ useConnection: vi.fn() }));
import { VoteEvidenceList, voteBlockTime } from "./ProposalVoteHistory";
import type { ProposalVoteHistoryResult } from "@/lib/clearsign/proposalVoteHistory";
const empty: ProposalVoteHistoryResult = {
  rows: [],
  scannedTransactions: 0,
  unavailableTransactions: 0,
  failedTransactions: 0,
  innerVoteInstructions: 0,
  stoppedAtLimit: false,
  scanError: false,
  chainIdentity: "synthetic-genesis",
};
describe("vote evidence presentation", () => {
  it("does not mistake an empty bounded archive for no current votes", () => {
    const html = renderToStaticMarkup(
      createElement(VoteEvidenceList, { result: empty }),
    );
    expect(html).toContain("Current votes may still exist");
    expect(html).toContain("not a complete vote history");
    expect(html).toContain("RPC archive coverage is unverified");
  });
  it("shows full verified identity/signature, missing time and incomplete scan", () => {
    const html = renderToStaticMarkup(
      createElement(VoteEvidenceList, {
        result: {
          ...empty,
          stoppedAtLimit: true,
          scanError: true,
          rows: [
            {
              transaction: "full-synthetic-signature",
              instructionIndex: 2,
              slot: 99,
              blockTime: null,
              vote: "cancel",
              memberIndex: 0,
              signer: "full-synthetic-signer",
              attribution: "Detached signature verified",
            },
          ],
        },
      }),
    );
    for (const text of [
      "Scan limit reached",
      "Block time unavailable",
      "full-synthetic-signature",
      "full-synthetic-signer",
      "Cancellation vote instruction succeeded",
      "could not be verified or read",
    ])
      expect(html).toContain(text);
  });
  it("keeps unknown signer distinct from a verified signer", () => {
    const html = renderToStaticMarkup(
      createElement(VoteEvidenceList, {
        result: {
          ...empty,
          rows: [
            {
              transaction: "synthetic",
              instructionIndex: 0,
              slot: 99,
              blockTime: 1700000000,
              vote: "approve",
              memberIndex: 1,
              signer: null,
              attribution: "Signature unsupported",
            },
          ],
        },
      }),
    );
    expect(html).toContain("Signer unavailable");
    expect(html).not.toContain("Verified signer");
    expect(voteBlockTime(null)).toBe("Block time unavailable");
    expect(voteBlockTime(1700000000)).toBe("2023-11-14 22:13:20 UTC");
  });
});
