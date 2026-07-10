import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const sendPages = [
  "src/features/send/routes/SolanaSendPage.tsx",
  "src/features/send/routes/EthSendPage.tsx",
  "src/features/send/routes/Erc20SendPage.tsx",
  "src/features/send/routes/BtcSendPage.tsx",
  "src/features/send/routes/ZecSendPage.tsx",
  "src/features/send/routes/BatchSendPage.tsx",
];

describe("transaction review contract", () => {
  it.each(sendPages)("shows quorum and timing on %s", (path) => {
    const page = source(path);
    expect(page).toContain('label: "Approval threshold"');
    expect(page).toContain('label: "Timelock"');
  });

  it.each(sendPages)("shows network fee information on %s", (path) => {
    const page = source(path);
    expect(page).toMatch(/label: "(Network fee|Gas reserve)"/);
  });

  it("keeps review details visible at the signing decision", () => {
    const review = source("src/components/retail/SignPayloadPreview.tsx");
    expect(review).toContain('aria-label="Review transaction"');
    expect(review).toContain("const showInline = hasDetails");
    expect(review).not.toContain("showInTip");
  });

  it("does not call created approval requests sent", () => {
    const batch = source("src/features/send/routes/BatchSendPage.tsx");
    expect(batch).toContain("Requests created");
    expect(batch).toContain("of {progress.total} created");
    expect(batch).not.toContain("of {progress.total} sent");
  });

  it.each([
    "src/features/send/routes/EthSendPage.tsx",
    "src/features/send/routes/Erc20SendPage.tsx",
  ])("renders an under-approved remote send as pending on %s", (path) => {
    const page = source(path);
    expect(page).toContain("waitForProposalApproval(connection, proposal)");
    expect(page).toContain("Waiting for remaining approvals");
    expect(page).toContain('status={pending ? "pending" : "confirmed"}');
  });
});
