import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const sendReviewOwners = [
  [
    "src/features/send/routes/SolanaSendPage.tsx",
    ["src/features/send/ui/solana/solanaSendPreview.ts"],
  ],
  [
    "src/features/send/routes/EthSendPage.tsx",
    ["src/features/send/ui/evm/EvmNativeSendStages.tsx"],
  ],
  [
    "src/features/send/routes/Erc20SendPage.tsx",
    ["src/features/send/ui/evm/Erc20SendStages.tsx"],
  ],
  [
    "src/features/send/routes/BtcSendPage.tsx",
    ["src/features/send/ui/bitcoin/bitcoinPreview.ts"],
  ],
  [
    "src/features/send/routes/ZecSendPage.tsx",
    ["src/features/send/ui/zcash/ZcashSendStages.tsx"],
  ],
  [
    "src/features/send/routes/BatchSendPage.tsx",
    ["src/features/send/routes/BatchSendPage.tsx"],
  ],
] as const;

function sources(paths: readonly string[]): string {
  return paths.map(source).join("\n");
}

describe("transaction review contract", () => {
  it.each(sendReviewOwners)(
    "shows quorum and timing on %s",
    (_route, owners) => {
      const review = sources(owners);
      expect(review).toContain('label: "Approval threshold"');
      expect(review).toContain('label: "Timelock"');
    },
  );

  it.each(sendReviewOwners)(
    "shows network fee information on %s",
    (_route, owners) => {
      const review = sources(owners);
      expect(review).toMatch(/label: "(Network fee|Gas reserve)"/);
    },
  );

  it("keeps all supplied signing details visible without a disclosure", () => {
    const review = source("src/components/retail/SignPayloadPreview.tsx");
    expect(review).toContain('aria-label="Review transaction"');
    expect(review).toContain("primaryDetails.map");
    expect(review).not.toContain("<details");
    expect(review).not.toContain("isTechnicalDetail");
  });

  it("does not call created approval requests sent", () => {
    const batch = sources([
      "src/features/send/routes/BatchSendPage.tsx",
      "src/features/send/ui/batch/BatchDoneStage.tsx",
      "src/features/send/ui/batch/batchPresentation.ts",
    ]);
    expect(batch).toContain("Batch request created");
    expect(batch).toContain("recipients in one batch request");
    expect(batch).toContain("Batch execution submitted");
    expect(batch).toContain("Check Activity before retrying");
    expect(batch).not.toContain("of {progress.total} sent");
  });

  it.each([
    [
      "src/features/send/routes/EthSendPage.tsx",
      "src/features/send/ui/evm/EvmNativeSendResults.tsx",
    ],
    [
      "src/features/send/routes/Erc20SendPage.tsx",
      "src/features/send/ui/evm/Erc20SendResults.tsx",
    ],
  ])(
    "renders an under-approved remote send as pending on %s",
    (path, result) => {
      const page = sources([path, result]);
      expect(page).toMatch(/waitForProposalApproval\(\s*connection,\s*proposal,?\s*\)/);
      expect(page).toContain("Waiting for remaining approvals");
      expect(page).toContain('status={pending ? "pending" : "submitted"}');
    },
  );
});
