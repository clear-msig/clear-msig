import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/retail/Button";
import type { useBatchSend } from "@/lib/hooks/useBatchSend";
import { toDisplayName } from "@/lib/retail/walletNames";
import { batchResultCopy } from "./batchPresentation";

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
  const copy = batchResultCopy(progress);
  const ResultIcon = copy.successful ? Check : AlertTriangle;
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full " +
              (copy.successful
                ? "bg-accent text-text-on-accent shadow-accent-rest"
                : "bg-warning/10 text-warning ring-1 ring-warning/30")
            }
          >
            <ResultIcon className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              {copy.heading}
            </p>
            <p className="mt-0.5 truncate text-xs text-text-soft">
              From {walletDisplay}
            </p>
          </div>
        </div>

        <p className="mt-5 text-base font-semibold text-text-strong">
          {copy.summary}
        </p>
        <p className="mt-1.5 text-sm text-text-soft">{copy.description}</p>

        {progress.proposalPdas?.map((proposal) => (
          <Link
            key={proposal}
            className="mt-4 flex min-h-tap flex-col justify-center gap-1 rounded-soft border border-border-soft p-3 text-sm text-text-strong"
            href={`/app/proposals/${encodeURIComponent(proposal)}`}
          >
            <strong>Open existing request</strong>
            <span className="break-all font-mono text-xs">{proposal}</span>
          </Link>
        ))}
        {progress.executionTxid && (
          <div className="mt-4 text-sm">
            <p className="font-semibold">
              Submitted transaction · confirmation pending
            </p>
            <p className="break-all font-mono text-xs">
              {progress.executionTxid}
            </p>
          </div>
        )}

        {progress.outcome !== "cancelled" &&
          !copy.successful &&
          progress.failures.length > 0 && (
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

      <Link
        href={`/app/wallet/${encodeURIComponent(walletName)}/activity`}
        className="inline-flex min-h-tap items-center justify-center gap-2 rounded-soft border border-border-soft px-4 text-sm font-semibold text-text-strong"
      >
        Check Activity
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
      {copy.canRestart && (
        <Button size="lg" fullWidth variant="ghost" onClick={onSendAnother}>
          {copy.restartLabel}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
