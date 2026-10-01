import { Check } from "lucide-react";
import { ProposalStatus } from "@/lib/msig";
import type { proposalTimelineExecution } from "@/lib/clearsign/proposalExecution";

export function RequestTimeline({
  status,
  approvalsCollected,
  approvalThreshold,
  createdAgo,
  execution,
}: {
  status: ProposalStatus;
  approvalsCollected: number;
  approvalThreshold: number;
  createdAgo: string;
  execution: ReturnType<typeof proposalTimelineExecution>;
}) {
  const approvalsDone = approvalsCollected >= approvalThreshold;
  const stopped = status === ProposalStatus.Cancelled;
  const sent = status === ProposalStatus.Executed;
  const ready = status === ProposalStatus.Approved || sent;
  const steps = [
    {
      label: "Request created",
      detail: `Created ${createdAgo}`,
      state: "done" as const,
    },
    {
      label: "Collect approvals",
      detail: `${Math.min(approvalsCollected, approvalThreshold)} of ${approvalThreshold} approved`,
      state: stopped
        ? ("stopped" as const)
        : approvalsDone
          ? ("done" as const)
          : ("current" as const),
    },
    {
      label: execution.label,
      detail: sent
        ? execution.completedDetail
        : stopped
          ? "Request declined"
          : ready
            ? "Ready to finish"
            : "Starts after enough approvals",
      state: sent
        ? ("done" as const)
        : stopped
          ? ("stopped" as const)
          : ready
            ? ("current" as const)
            : ("next" as const),
    },
  ];

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        Request timeline
      </h2>
      <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li
            key={step.label}
            className="flex min-w-0 items-start gap-3 rounded-soft border border-border-soft bg-canvas p-3"
          >
            <span
              className={
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-numerals text-[11px] font-semibold tabular-nums " +
                (step.state === "done"
                  ? "bg-accent/15 text-accent"
                  : step.state === "current"
                    ? "bg-warning/15 text-warning"
                    : step.state === "stopped"
                      ? "bg-warning/10 text-warning"
                      : "bg-glass-soft text-text-soft")
              }
            >
              {step.state === "done" ? (
                <Check
                  className="h-3.5 w-3.5"
                  strokeWidth={3}
                  aria-hidden="true"
                />
              ) : (
                index + 1
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text-strong">
                {step.label}
              </p>
              <p className="mt-0.5 text-xs text-text-soft">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
