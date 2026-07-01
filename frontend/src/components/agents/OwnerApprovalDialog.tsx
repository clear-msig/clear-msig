"use client";

import { ShieldCheck, X } from "lucide-react";
import type { AgentOwnerApprovalInput } from "@/lib/agents/client";

interface OwnerApprovalDialogProps {
  request: AgentOwnerApprovalInput | null;
  approveLabel?: string;
  approvalMode?: "wallet" | "browser";
  busy?: boolean;
  onCancel: () => void;
  onApprove: () => void;
}

export function OwnerApprovalDialog({
  request,
  approveLabel = "Approve",
  approvalMode = "browser",
  busy = false,
  onCancel,
  onApprove,
}: OwnerApprovalDialogProps) {
  if (!request) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6">
      <section className="w-full max-w-md rounded-card bg-surface-raised p-5 shadow-card-rest">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent">
              Owner approval
            </p>
            <h2 className="mt-1 text-base font-semibold text-text-strong">
              {request.summary}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-text-soft">
              {approvalMode === "wallet"
                ? "Review this action. Your wallet will ask you to sign before ClearSig changes the trader."
                : "Review this action before ClearSig changes the trader."}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border-soft text-text-soft transition-colors hover:border-accent/60 hover:text-accent"
            aria-label="Cancel approval"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        {request.details?.length ? (
          <dl className="mt-4 grid gap-2">
            {request.details.map((detail) => (
              <div
                key={`${detail.label}:${detail.value}`}
                className="flex items-start justify-between gap-3 rounded-soft border border-border-soft bg-canvas px-3 py-2"
              >
                <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-soft">
                  {detail.label}
                </dt>
                <dd className="max-w-[60%] text-right text-xs font-semibold text-text-strong">
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-accent/40 bg-accent px-3 py-2 text-xs font-semibold text-text-on-accent transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? "Approving..." : approveLabel}
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}
