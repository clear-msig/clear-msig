"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ClipboardList, KeyRound, ShieldCheck } from "lucide-react";
import {
  listAgentOwnerApprovals,
  listAgents,
  subscribeAgents,
  type AgentOwnerApproval,
  type AgentProfile,
} from "@/lib/agents/client";
import { toDisplayName } from "@/lib/retail/walletNames";

type ApprovalFilter = "all" | "wallet_signature" | "browser_confirm";

export default function AgentApprovalsPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const encoded = encodeURIComponent(name);
  const display = toDisplayName(name);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [approvals, setApprovals] = useState<AgentOwnerApproval[]>([]);
  const [filter, setFilter] = useState<ApprovalFilter>("all");

  useEffect(() => {
    const refresh = () => {
      setAgents(listAgents(name));
      setApprovals(listAgentOwnerApprovals(name));
    };
    refresh();
    return subscribeAgents(refresh);
  }, [name]);

  const visible = approvals.filter((approval) =>
    filter === "all" ? true : approval.approvalMethod === filter,
  );
  const signed = approvals.filter(
    (approval) => approval.approvalMethod === "wallet_signature",
  ).length;
  const browser = approvals.filter(
    (approval) => approval.approvalMethod === "browser_confirm",
  ).length;
  const automatic = approvals.filter(
    (approval) => approval.action === "start_automatic_trading",
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href={`/app/wallet/${encoded}/agents`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Trading
        </Link>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Owner Approvals · {display}
          </p>
          <h1 className="mt-1 font-display text-lg leading-tight text-text-strong md:text-display-xs">
            Approvals
          </h1>
        </div>
      </header>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Total" value={String(approvals.length)} />
        <Metric label="Wallet-signed" value={String(signed)} />
        <Metric label="Browser-confirmed" value={String(browser)} />
        <Metric label="Automatic trading" value={String(automatic)} />
      </section>

      <section className="rounded-card bg-surface-raised p-4 shadow-card-rest">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-text-strong">
                Authorization log
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
                These approvals authorize agent actions inside ClearSig policy. They do not give agents raw wallet custody.
              </p>
            </div>
          </div>
          <div className="inline-flex rounded-soft border border-border-soft bg-canvas p-1">
            {(["all", "wallet_signature", "browser_confirm"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={clsx(
                  "min-h-8 rounded-[6px] px-2.5 text-[11px] font-medium transition-colors",
                  filter === item
                    ? "bg-surface-raised text-text-strong shadow-card-rest"
                    : "text-text-soft hover:text-text-strong",
                )}
              >
                {filterLabel(item)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3">
        {visible.length > 0 ? (
          visible.map((approval) => (
            <ApprovalRow
              key={approval.id}
              approval={approval}
              agent={agents.find((item) => item.id === approval.agentId)}
            />
          ))
        ) : (
          <div className="rounded-card bg-surface-raised p-6 text-sm text-text-soft">
            No approvals match this view.
          </div>
        )}
      </section>
    </div>
  );
}

function ApprovalRow({
  approval,
  agent,
}: {
  approval: AgentOwnerApproval;
  agent?: AgentProfile;
}) {
  const signed = approval.approvalMethod === "wallet_signature";
  return (
    <article className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">
              {approval.summary}
            </p>
            <Badge tone={signed ? "success" : "default"}>
              {signed ? "Wallet-signed" : "Browser-confirmed"}
            </Badge>
            <Badge>{actionLabel(approval.action)}</Badge>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {agent?.name ?? approval.agentId ?? "Vault"} · {new Date(approval.createdAt).toLocaleString()}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-canvas px-2 py-1 text-[11px] font-medium text-text-soft">
          {signed ? <KeyRound className="h-3 w-3" aria-hidden="true" /> : <ClipboardList className="h-3 w-3" aria-hidden="true" />}
          {approval.approvalHash.slice(0, 12)}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Info label="Target" value={approval.targetType && approval.targetId ? `${approval.targetType}/${approval.targetId}` : "Vault"} />
        <Info label="Approved by" value={approval.approvedBy ?? "Local owner"} />
        <Info label="Signature" value={approval.signature ? `${approval.signature.slice(0, 16)}...` : "None"} />
        <Info label="Hash" value={approval.approvalHash} />
      </div>
      {approval.details.length > 0 ? (
        <div className="mt-3 grid gap-2 border-t border-border-soft pt-3 sm:grid-cols-2">
          {approval.details.map((detail) => (
            <Info key={`${detail.label}-${detail.value}`} label={detail.label} value={detail.value} />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card bg-surface-raised p-3 shadow-card-rest">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-soft">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-text-strong">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className="mt-1 break-words text-xs font-semibold text-text-strong">{value}</p>
    </div>
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
        tone === "success"
          ? "border-accent/30 bg-accent/[0.08] text-accent"
          : "border-border-soft bg-canvas text-text-soft",
      )}
    >
      {children}
    </span>
  );
}

function decodeParam(value: string | undefined): string {
  const raw = value ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function filterLabel(filter: ApprovalFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "wallet_signature":
      return "Wallet";
    case "browser_confirm":
      return "Browser";
  }
}

function actionLabel(action: AgentOwnerApproval["action"]): string {
  switch (action) {
    case "grant_allowance":
      return "Budget";
    case "start_automatic_trading":
      return "Automatic trading";
    case "submit_venue_trade":
      return "Practice handoff";
    case "pause_agent":
      return "Pause agent";
    case "pause_all_trading":
      return "Kill switch";
    case "close_practice_trade":
      return "Close trade";
    case "close_all_practice_trades":
      return "Close all";
  }
}
