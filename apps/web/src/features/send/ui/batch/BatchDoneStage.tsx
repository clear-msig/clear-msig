import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/retail/Button";
import type { useBatchSend } from "@/lib/hooks/useBatchSend";
import { toDisplayName } from "@/lib/retail/walletNames";

export function DoneStage({
  walletName,
  progress,
  onSendAnother,
}: {
  walletName: string;
  progress: ReturnType<typeof useBatchSend>["progress"];
  onSendAnother: () => void;
}) {
  const walletDisplay = toDisplayName(walletName);
  if (!progress) return null;
  const allSucceeded = progress.failed === 0;
  const heading = allSucceeded
    ? "Requests created"
    : "Batch finished with issues";
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full " +
              (allSucceeded
                ? "bg-accent text-text-on-accent shadow-accent-rest"
                : "bg-warning/10 text-warning ring-1 ring-warning/30")
            }
          >
            <Check className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              {heading}
            </p>
            <p className="mt-0.5 truncate text-xs text-text-soft">
              From {walletDisplay} · awaiting treasury approvals
            </p>
          </div>
        </div>

        <p className="mt-5 inline-flex items-baseline gap-2">
          <span className="font-numerals text-3xl font-semibold leading-none text-text-strong tabular-nums sm:text-4xl">
            {progress.succeeded}
          </span>
          <span className="font-display text-base font-semibold uppercase tracking-[0.18em] text-text-soft">
            of {progress.total} created
          </span>
        </p>
        <p className="mt-1.5 text-sm text-text-soft">
          {allSucceeded
            ? "Every request is ready for approver review."
            : `${progress.failed} row${progress.failed === 1 ? "" : "s"} didn't go through. Review the list below and retry just those.`}
        </p>

        {!allSucceeded && progress.failures.length > 0 && (
          <ul className="mt-5 divide-y divide-border-soft rounded-soft border border-border-soft bg-canvas text-left">
            {progress.failures.map((f, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-strong">
                    {f.row.label}
                  </p>
                  <p className="truncate text-xs text-text-soft">
                    {f.message}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-warning">
                  Failed
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button size="lg" fullWidth variant="ghost" onClick={onSendAnother}>
        Send another batch
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
