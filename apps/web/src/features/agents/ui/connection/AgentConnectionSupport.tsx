import clsx from "clsx";
import { AlertTriangle, Copy } from "lucide-react";
import type { AgentPolicyEvaluation, AgentProposalStatus, AgentSignalInboxItem } from "@/features/agents/domain/runtime";

export function InboxSignalRow({
  item,
  preview,
  pending,
  onImport,
}: {
  item: AgentSignalInboxItem;
  preview?: AgentPolicyEvaluation;
  pending: boolean;
  onImport: (item: AgentSignalInboxItem) => void;
}) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">
              {item.payload.market} · {item.payload.side}
            </p>
            <span className="rounded-full border border-border-soft px-1.5 py-0.5 text-[10px] font-medium text-text-soft">
              {item.payload.venue}
            </span>
            <RiskBadge preview={preview} />
          </div>
          <p className="mt-1 text-xs text-text-soft">
            ${item.payload.notionalUsd} · {item.payload.leverage}x · Arrived{" "}
            {new Date(item.receivedAt).toLocaleString()}
          </p>
          {item.payload.thesis ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-soft">
              {item.payload.thesis}
            </p>
          ) : null}
          {preview?.violations[0] ? (
            <p className="mt-2 text-xs leading-relaxed text-rose-300">
              {preview.violations[0].message}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => onImport(item)}
          className={BUTTON_CLASS}
        >
          Review idea
        </button>
      </div>
    </div>
  );
}

export function RiskBadge({ preview }: { preview?: AgentPolicyEvaluation }) {
  if (!preview) {
    return (
      <span className="rounded-full border border-border-soft bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-text-soft">
        Checking
      </span>
    );
  }
  const tone =
    preview.decision === "blocked"
      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
      : preview.decision === "allowed"
        ? "border-accent/30 bg-accent/[0.08] text-accent"
        : "border-warning/30 bg-warning/[0.08] text-warning";
  return (
    <span className={clsx("rounded-full border px-1.5 py-0.5 text-[10px] font-medium", tone)}>
      {preview.decision === "blocked"
        ? "Stopped"
        : preview.decision === "allowed"
          ? "Safe to try"
          : "Needs you"}
    </span>
  );
}

export function InfoBox({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-text-soft">{label}</p>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex h-7 w-7 items-center justify-center rounded-soft border border-border-soft text-text-soft transition-colors hover:border-accent/60 hover:text-accent"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">Copy {label}</span>
        </button>
      </div>
      <p className="mt-2 break-all font-mono text-xs text-text-strong">{value}</p>
    </div>
  );
}

export function ErrorList({ errors }: { errors: string[] }) {
  return (
    <div className="rounded-soft border border-rose-500/25 bg-rose-500/[0.08] p-3 text-xs text-rose-200">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        This idea needs changes
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
    </div>
  );
}

export function DecisionPreview({ preview }: { preview: AgentPolicyEvaluation }) {
  const blocked = preview.decision === "blocked";
  return (
    <div
      className={clsx(
        "rounded-soft border p-3 text-xs",
        blocked
          ? "border-rose-500/25 bg-rose-500/[0.08] text-rose-200"
          : "border-accent/25 bg-accent/[0.08] text-text-strong",
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        {blocked
          ? "Stopped by your safety rules"
          : preview.decision === "allowed"
            ? "Fits the current budget"
            : "Ready for your approval"}
      </div>
      {preview.violations.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-text-soft">
          {preview.violations.map((violation) => (
            <li key={`${violation.code}:${violation.message}`}>
              {violation.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function statusForDecision(decision: AgentPolicyEvaluation): AgentProposalStatus {
  if (decision.decision === "blocked") return "blocked";
  if (decision.decision === "allowed") return "approved";
  return "needs_approval";
}

export function decodeParam(value: string | undefined): string {
  const raw = value ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function apiPath(walletName: string, agentId: string): string {
  return `/api/agent-signals/${encodeURIComponent(walletName)}/${encodeURIComponent(agentId)}`;
}

export async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

export const INPUT_CLASS = clsx(
  "w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong",
  "placeholder:text-text-muted",
  "transition-[border-color,box-shadow] duration-base ease-out-soft",
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
);

export const BUTTON_CLASS = clsx(
  "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-soft bg-accent px-4 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest",
  "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
  "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

export const SECONDARY_BUTTON_CLASS = clsx(
  "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-strong",
  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
  "disabled:cursor-not-allowed disabled:opacity-60",
);
