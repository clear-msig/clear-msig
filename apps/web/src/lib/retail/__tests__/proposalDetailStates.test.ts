import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
const fixtures = vi.hoisted(() => ({
  queryIndex: 0,
  proposalError: false,
  contextError: false,
  missing: false,
  status: 0,
  actionKind: 1,
  approvals: 0,
  cancellations: 0,
  executionPending: false,
}));
const member = new PublicKey(new Uint8Array(32).fill(2)).toBase58();
vi.mock("next/navigation", () => ({
  useParams: () => ({ proposal: "11111111111111111111111111111111" }),
}));
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children),
  },
  useReducedMotion: () => true,
}));
vi.mock("@/lib/wallet", () => ({
  useConnection: () => ({ connection: { rpcEndpoint: "fixture" } }),
  useWallet: () => ({
    publicKey: new PublicKey(new Uint8Array(32).fill(1)),
    pickSigner: (members: readonly string[]) =>
      members.includes(member) ? new PublicKey(member) : null,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({
    isLoading: false,
    isFetching: false,
    isError: fixtures.proposalError || fixtures.contextError,
    refetch: vi.fn(),
    data: fixtures.missing
      ? null
      : {
          proposal: {
            typed: true,
            wallet: member,
            intent: member,
            proposer: member,
            actionKind: fixtures.actionKind,
            status: fixtures.status,
            approvalBitmap: fixtures.approvals,
            cancellationBitmap: fixtures.cancellations,
            proposedAt: 1780000000n,
          },
          wallet: { name: "Fixture wallet" },
          intent: {
            approvers: [member, "11111111111111111111111111111111"],
            approvalThreshold: 2,
            cancellationThreshold: 2,
            chainKind: 0,
          },
        },
  }),
}));
vi.mock("@/lib/hooks/useProposalSubscription", () => ({
  useProposalSubscription: () => {},
}));
vi.mock("@/lib/hooks/useProposalWorkflow", () => ({
  useProposalWorkflow: () => ({
    reviewQuery: {
      data: { reviewId: "fixture" },
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    },
    approveMutation: { isPending: false },
    cancelMutation: { isPending: false },
    executeMutation: { isPending: false },
    checkExecutionMutation: { isPending: false },
    executionAttempt: fixtures.executionPending
      ? { phase: "execution", outcome: "unknown" }
      : undefined,
  }),
}));
vi.mock("@/components/review/CanonicalActionReview", () => ({
  CanonicalActionReview: () =>
    React.createElement("div", null, "Canonical fixture review"),
}));
vi.mock("@/lib/hooks/useContacts", () => ({
  useContacts: () => ({ contacts: [] }),
}));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
import RequestDetailPage from "@/app/app/proposals/[proposal]/page";
function render() {
  return renderToStaticMarkup(React.createElement(RequestDetailPage));
}
beforeEach(() =>
  Object.assign(fixtures, {
    queryIndex: 0,
    proposalError: false,
    contextError: false,
    missing: false,
    status: 0,
    actionKind: 1,
    approvals: 0,
    cancellations: 0,
    executionPending: false,
  }),
);
describe("production proposal detail with synthetic account and provider boundaries", () => {
  it("describes exact-request voting rather than claiming to enable protection", () => {
    const html = render();
    expect(html).toContain("records your approval vote");
    expect(html).not.toContain("turns on sending protection");
  });
  it("provides read-only execution recovery without permitting blind resend", () => {
    fixtures.status = 1;
    fixtures.actionKind = 3;
    fixtures.executionPending = true;
    const html = render();
    expect(html).toContain("Execution verification pending");
    expect(html).toContain("Check execution status");
    expect(html).toContain("needs reconciliation");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Execute action/);
  });
  it("shows approval and cancellation actions for an eligible secondary wallet", () => {
    const html = render();
    expect(html).toContain(">Approve</button>");
    expect(html).toContain("Vote to cancel");
    expect(html).not.toContain("You&#x27;re watching");
    expect(html).toContain(member);
  });
  it("allows a member who approved to replace that vote with cancellation", () => {
    fixtures.approvals = 1;
    const html = render();
    expect(html).not.toContain(">Approve</button>");
    expect(html).toContain("Vote to cancel");
    expect(html).toContain("replaces this member");
  });
  it("allows cancellation while approved and keeps execution a separate action", () => {
    fixtures.status = 1;
    fixtures.actionKind = 3;
    fixtures.approvals = 3;
    const html = render();
    expect(html).toContain("Vote to cancel");
    expect(html).toContain("Finish");
  });
  it("labels a cancellation vote below quorum without claiming the request is cancelled", () => {
    fixtures.cancellations = 1;
    const html = render();
    expect(html).toContain("1 of 2 required cancellation votes");
    expect(html).toContain("Voted to cancel");
    expect(html).toContain("already voted to cancel");
    expect(html).not.toContain("Vote to cancel</button>");
    expect(html).toContain(">Approve</button>");
  });
  it.each(["proposalError", "contextError"] as const)(
    "renders retry for %s rather than inventing not-found",
    (key) => {
      fixtures[key] = true;
      const html = render();
      expect(html).toContain("Request could not be loaded");
      expect(html).toContain(">Retry</button>");
      expect(html).not.toContain("find that request");
      expect(html).not.toContain(">Approve</button>");
    },
  );
  it("distinguishes an actual absent account", () => {
    fixtures.missing = true;
    const html = render();
    expect(html).toContain("find that request");
    expect(html).toContain("configured network");
    expect(html).not.toContain("not be a member");
  });
  it("shows known unsupported execution as unavailable before any click while preserving cancellation", () => {
    fixtures.status = 1;
    fixtures.actionKind = 9;
    const html = render();
    expect(html).toContain("Execution unavailable here");
    expect(html).toContain("action-specific recovery executor");
    expect(html).not.toContain(">Execute action");
    expect(html).toContain("Vote to cancel");
  });
  it("does not offer new votes on a terminal request", () => {
    fixtures.status = 2;
    const html = render();
    expect(html).not.toContain("Vote to cancel");
    expect(html).not.toContain(">Approve</button>");
  });
});
