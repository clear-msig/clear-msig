import type { BatchSendProgress } from "@/lib/hooks/useBatchSend";

export function formatBatchLamports(value: bigint | string): string {
  const lamports = BigInt(value);
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  const grouped = whole.toLocaleString("en-US");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function batchResultCopy(progress: BatchSendProgress) {
  const outcome =
    progress.outcome ?? (progress.failed > 0 ? "failed" : "created");
  switch (outcome) {
    case "execution_unknown":
      return {
        heading: "Check batch execution status",
        description:
          progress.message ??
          "Execution may have been submitted. Check the existing request before retrying.",
        summary: `${progress.succeeded} recipients in the saved request · execution outcome unknown`,
        successful: false,
        canRestart: false,
        restartLabel: "",
      };
    case "submission_unknown":
      return {
        heading: "Check batch status",
        description:
          progress.message ??
          "The batch request may have been submitted. Check Activity before retrying.",
        summary: `${progress.total} recipients · submission status unknown`,
        successful: false,
        canRestart: false,
        restartLabel: "",
      };
    case "cancelled":
      return {
        heading: "Batch stopped",
        description:
          progress.message ?? "Stopped before submitting the batch request.",
        summary: "No batch request submitted",
        successful: false,
        canRestart: true,
        restartLabel: "Edit batch",
      };
    case "execution_submitted":
    case "created":
      return {
        heading:
          outcome === "execution_submitted"
            ? "Batch execution submitted"
            : "Batch request created",
        description:
          progress.message ??
          "Check Activity for approvals and execution status.",
        summary: `${progress.succeeded} recipients in one batch request`,
        successful: true,
        canRestart: true,
        restartLabel: "Send another batch",
      };
    default:
      return {
        heading:
          outcome === "empty"
            ? "No recipients submitted"
            : "Batch could not be created",
        description:
          progress.message ?? "Review the issue below before trying again.",
        summary: "No batch request created",
        successful: false,
        canRestart: true,
        restartLabel: "Edit batch",
      };
  }
}
