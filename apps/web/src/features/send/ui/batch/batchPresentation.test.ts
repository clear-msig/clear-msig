import { describe, expect, it } from "vitest";
import { batchResultCopy, formatBatchLamports } from "./batchPresentation";
import type { BatchSendOutcome, BatchSendProgress } from "@/lib/hooks/useBatchSend";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DoneStage } from "./BatchDoneStage";

describe("reviewed batch amounts", () => {
  it.each([
    [9007199254740993n, "9,007,199.254740993"],
    ["1", "0.000000001"],
    [1_000_000_000n, "1"],
    [1234567891n, "1.234567891"],
    [0n, "0"],
  ])("displays every lamport in %s", (value, expected) => {
    expect(formatBatchLamports(value)).toBe(expected);
  });
});

describe("batch outcome UI", () => {
  function progress(outcome: BatchSendOutcome): BatchSendProgress {
    return { total: 2, succeeded: outcome === "created" || outcome === "executed" ? 2 : 0, failed: outcome === "failed" ? 2 : 0, failures: [], done: true, outcome };
  }

  it("does not mistake an unknown submission for success or invite duplicate retry", () => {
    const result = progress("submission_unknown");
    expect(batchResultCopy(result)).toMatchObject({ successful: false, canRestart: false });
    const markup = renderToStaticMarkup(createElement(DoneStage, { walletName: "treasury", progress: result, onSendAnother: () => {} }));
    expect(markup).toContain("Check batch status");
    expect(markup).toContain("Check Activity before retrying");
    expect(markup).not.toContain("Send another batch");
    expect(markup).not.toContain("Edit batch");
    expect(markup).not.toContain("awaiting treasury approvals");
  });

  it.each(["cancelled", "failed"] as const)("allows editing the preserved draft after %s", (outcome) => {
    expect(batchResultCopy(progress(outcome))).toMatchObject({ successful: false, canRestart: true, restartLabel: "Edit batch" });
  });

  it("distinguishes a created request from submitted execution", () => {
    expect(batchResultCopy(progress("created")).heading).toBe("Batch request created");
    expect(batchResultCopy(progress("executed")).heading).toBe("Batch execution submitted");
    expect(batchResultCopy(progress("executed")).description).toContain("execution status");
  });

  it("preserves the operation's more specific reconciliation message", () => {
    expect(batchResultCopy({ ...progress("created"), message: "Stopped after submission. Existing request remains." }).description).toBe("Stopped after submission. Existing request remains.");
  });
});
