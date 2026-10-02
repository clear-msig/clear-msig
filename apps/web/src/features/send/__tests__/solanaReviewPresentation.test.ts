import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildSendPreviewDetails } from "../ui/solana/solanaSendPreview";
import { RecipientStatus } from "../ui/solana/SolanaRecipientFields";
import { SolanaSigningReview } from "../ui/solana/SolanaSigningReview";
import type { ResolvedSolanaRecipient } from "../domain/solanaSend";

const address = "So11111111111111111111111111111111111111112";
describe("actual SOL send review callers", () => {
  it.each([
    { kind: "address", address },
    { kind: "contact", contact: { name: "Operations", address } },
    { kind: "sns", name: "operations.sol", address },
  ])("retains the complete $kind destination in both compose surfaces", (recipient) => {
    const resolved = recipient as ResolvedSolanaRecipient;
    const details = buildSendPreviewDetails({ walletName: "Treasury", amount: "1", amountValid: true, resolved, pendingUsd: 0, budgetUsage: { perChain: [], budget: null } as never, approvalThreshold: 2, timelockSeconds: 0, feeReserveLamports: 5000n });
    expect(details.find(row => row.label === "Recipient address")?.value).toBe(address);
    const html = renderToStaticMarkup(createElement(RecipientStatus, { resolved, savedNewContact: false, onSaveContact: () => {} }));
    expect(html).toContain(address);
    expect(html).not.toContain("So111…");
    expect(html).toContain("break-all");
  });
  it("shows one-lamport amounts and the exact fee reserve without rounding to zero", () => {
    const details = buildSendPreviewDetails({ walletName: "Treasury", amount: "0.000000001", amountValid: true, resolved: { kind: "address", address }, pendingUsd: 0, budgetUsage: { perChain: [], budget: null } as never, approvalThreshold: 1, timelockSeconds: 0, feeReserveLamports: 5000n });
    expect(details.find(row => row.label === "Amount")?.value).toBe("0.000000001 SOL");
    expect(details.find(row => row.label === "Network fee")?.value).toBe("0.000005 SOL reserved");
  });
  it("renders the exact prepared document and separates app review from independent proof", () => {
    const html = renderToStaticMarkup(createElement(SolanaSigningReview, { review: { document: "ACTION\nSend 0.000000001 SOL\nAPPROVAL\nDecision: PROPOSE", destination: address, amount: "0.000000001" }, onConfirm: () => {}, onCancel: () => {} }));
    expect(html).toContain("ACTION\nSend 0.000000001 SOL\nAPPROVAL\nDecision: PROPOSE");
    expect(html).toContain(address);
    expect(html).toContain("not independent verification");
    expect(html).toContain("may also count as your approval");
    expect(html).toContain("Continue to wallet");
    expect(html).toContain("Cancel review");
  });
});
