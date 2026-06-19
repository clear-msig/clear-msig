"use client";

// Per-wallet policy rules - the page that lists them. Inspired by
// Fordefi's policy-rule UI (https://docs.fordefi.com/user-guide/
// policies/create-a-policy-rule). Each rule layers conditions on
// top of the on-chain intent: when the conditions match a candidate
// proposal, the rule's action takes effect (deny / allow /
// require-extra-approvers / require-cooldown).
//
// Encrypted-via-Encrypt status is surfaced honestly: the frontend
// can call Encrypt's pre-alpha createInput endpoint when configured,
// but private on-chain enforcement still needs program #[encrypt_fn]
// handlers.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import clsx from "clsx";
import {
  ArrowRight,
  Eye,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { encryptStatus } from "@/lib/encrypt/client";
import {
  listPolicies,
  removePolicy,
  subscribePolicies,
} from "@/lib/policies/storage";
import type { PolicyRule, RuleCondition } from "@/lib/policies/types";
import { toDisplayName } from "@/lib/retail/walletNames";

export default function PoliciesPage() {
  const params = useParams<{ name: string }>();
  const reduce = useReducedMotion();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const [rules, setRules] = useState<PolicyRule[]>([]);
  useEffect(() => {
    const refresh = () => setRules(listPolicies(name));
    refresh();
    return subscribePolicies(refresh);
  }, [name]);

  const status = encryptStatus();
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  const summary =
    rules.length === 0
      ? "Add extra checks only when the basic protection is not enough."
      : `${rules.length} ${rules.length === 1 ? "rule" : "rules"} active on ${toDisplayName(name)}.`;

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
            Advanced checks
          </h1>
          <p className="text-xs text-text-soft sm:text-sm">{summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/app/wallet/${encodeURIComponent(name)}/policy`}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-[11px] font-medium text-text-soft",
              "transition-colors duration-base ease-out-soft hover:text-accent",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            )}
          >
            Protection
          </Link>
          <Link
            href="/privacy"
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-[11px] font-medium text-text-soft",
              "transition-colors duration-base ease-out-soft hover:text-accent",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            )}
          >
            <Lock className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
            {status.live ? "Encryption active" : "Encryption-ready · pre-alpha"}
          </Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/app/wallet/${encodeURIComponent(name)}/policies/new`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest sm:flex-none",
            "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
            "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <Plus size={13} aria-hidden="true" />
          <span>New check</span>
        </Link>
      </div>

      {rules.length === 0 ? (
        // Vertically center the empty state on mobile - same pattern
        // as Contacts. Desktop reverts to natural flow.
        <div className="flex min-h-[calc(100dvh-14rem)] flex-col justify-center md:min-h-0 md:block">
          <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
              <ShieldCheck className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <p className="mt-4 font-display text-base font-semibold text-text-strong">
              No advanced checks yet
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-text-soft">
              The wallet&rsquo;s Protection page is your baseline. Advanced checks
              add recipient, amount, review, and cooldown rules on top.
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rules.map((rule) => (
            <PolicyCard key={rule.id} rule={rule} walletName={name} />
          ))}
        </ul>
      )}
    </motion.div>
  );
}

function PolicyCard({
  rule,
  walletName,
}: {
  rule: PolicyRule;
  walletName: string;
}) {
  const summaries = rule.conditions.map(summariseCondition);
  return (
    <li className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          {rule.action === "deny" ? (
            <Trash2 className="h-4 w-4" strokeWidth={2} />
          ) : rule.action === "allow" ? (
            <ShieldCheck className="h-4 w-4" strokeWidth={2} />
          ) : (
            <Eye className="h-4 w-4" strokeWidth={2} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-text-strong">
              {rule.name}
            </p>
            {!rule.enabled && (
              <span className="inline-flex items-center rounded-full border border-border-soft bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-text-soft">
                Paused
              </span>
            )}
            <span
              className={
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium " +
                (rule.action === "deny"
                  ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-600"
                  : rule.action === "allow"
                    ? "border-accent/30 bg-accent/[0.08] text-accent"
                    : "border-warning/30 bg-warning/[0.08] text-warning")
              }
            >
              {actionLabel(rule.action)}
            </span>
          </div>
          {rule.description && (
            <p className="mt-1 text-xs text-text-soft">{rule.description}</p>
          )}
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {summaries.map((s, i) => (
              <li
                key={i}
                className="inline-flex items-center rounded-full border border-border-soft bg-canvas px-2 py-0.5 text-[11px] font-medium text-text-soft"
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/app/wallet/${encodeURIComponent(walletName)}/policies/${rule.id}`}
            className={
              "inline-flex min-h-tap items-center justify-center gap-1 rounded-full border border-border-soft bg-canvas px-3 py-2 text-[11px] font-medium text-text-soft " +
              "transition-[border-color,color,transform] duration-base ease-out-soft " +
              "hover:-translate-y-0.5 hover:text-accent"
            }
          >
            Edit
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete the "${rule.name}" rule?`)) {
                removePolicy(walletName, rule.id);
              }
            }}
            aria-label={`Delete ${rule.name}`}
            className="inline-flex h-tap w-tap items-center justify-center rounded-soft text-text-soft transition-colors hover:bg-canvas hover:text-rose-600"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  );
}

function actionLabel(a: PolicyRule["action"]): string {
  switch (a) {
    case "deny":
      return "Deny";
    case "allow":
      return "Allow";
    case "require-extra-approvers":
      return "Extra approvers";
    case "require-cooldown":
      return "Extra cooldown";
  }
}

function summariseCondition(c: RuleCondition): string {
  switch (c.kind) {
    case "asset":
      if (c.encryptedChainKind || c.encryptedTokenContract) {
        return "Encrypted asset filter";
      }
      if (c.chainKind === null) return "Any chain";
      return chainName(c.chainKind);
    case "recipient": {
      const count = c.encryptedAddresses?.length ?? c.addresses?.length ?? 0;
      return `${c.mode === "allowlist" ? "Allow" : "Block"} ${count} recipient${count === 1 ? "" : "s"}`;
    }
    case "amount":
      if (c.encryptedMinDisplay || c.encryptedMaxDisplay || c.encryptedTicker) {
        return "Encrypted amount range";
      }
      if (c.minDisplay && c.maxDisplay)
        return `Amount ${c.minDisplay}–${c.maxDisplay} ${c.ticker ?? ""}`.trim();
      if (c.minDisplay) return `Amount ≥ ${c.minDisplay} ${c.ticker ?? ""}`.trim();
      if (c.maxDisplay) return `Amount ≤ ${c.maxDisplay} ${c.ticker ?? ""}`.trim();
      return "Amount (any)";
    case "time-window":
      if (
        c.encryptedStartHour ||
        c.encryptedEndHour ||
        c.encryptedDaysOfWeek ||
        c.encryptedMatch
      ) {
        return "Encrypted time window";
      }
      return `${c.match === "inside" ? "Inside" : "Outside"} ${pad(c.startHour)}–${pad(c.endHour)}`;
    case "velocity":
      if (c.encryptedCapDisplay || c.encryptedTicker || c.encryptedWindowDays) {
        return "Encrypted velocity cap";
      }
      return `≤ ${c.capDisplay} ${c.ticker} per ${c.windowDays}d`;
  }
}

function pad(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

function chainName(k: number): string {
  switch (k) {
    case 0:
      return "Solana";
    case 1:
      return "Ethereum";
    case 2:
      return "Bitcoin";
    case 3:
      return "Zcash";
    case 4:
      return "Ethereum (ERC-20)";
    case 5:
      return "Hyperliquid";
    default:
      return `Chain ${k}`;
  }
}
