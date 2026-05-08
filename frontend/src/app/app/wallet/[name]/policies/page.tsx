"use client";

// Per-wallet policy rules — the page that lists them. Inspired by
// Fordefi's policy-rule UI (https://docs.fordefi.com/user-guide/
// policies/create-a-policy-rule). Each rule layers conditions on
// top of the on-chain intent: when the conditions match a candidate
// proposal, the rule's action takes effect (deny / allow /
// require-extra-approvers / require-cooldown).
//
// Encrypted-via-Encrypt status is surfaced honestly: the Encrypt
// scaffolding (lib/encrypt/client.ts) routes condition values
// through the local pass-through stub today; the actual FHE
// network ships when @encrypt.xyz/pre-alpha-solana-client lands on
// npm + the program gets #[encrypt_fn] handlers.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { Button } from "@/components/retail/Button";
import { encryptStatus } from "@/lib/encrypt/client";
import {
  listPolicies,
  removePolicy,
  subscribePolicies,
} from "@/lib/policies/storage";
import type { PolicyRule, RuleCondition } from "@/lib/policies/types";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";

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

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            {
              label: toDisplayName(name),
              href: `/app/wallet/${encodeURIComponent(name)}`,
            },
            { label: "Policies" },
          ]}
        />
      </StickyTopBar>
      {/* Mobile-only back chip — see /send for rationale. */}
      <div className="px-gutter pt-2 md:hidden">
        <BackToWallets />
      </div>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-card border border-border-soft bg-surface-raised p-6 text-center shadow-card-rest sm:p-8"
      >
        <span aria-hidden="true" className="mx-auto block h-px w-10 bg-accent" />
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          Policy rules
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Add a guardrail to{" "}
          <span className="text-accent">{toHeadingName(name)}</span>
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-soft">
          Layer extra checks on top of this wallet&rsquo;s spending rule —
          recipient allowlists, per-period caps, time windows. Conditions
          encrypt through Encrypt&rsquo;s confidential-policy network.
        </p>

        <Link
          href="/privacy"
          className={
            "mt-4 inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-xs font-medium text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:border-accent hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          <Lock className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
          {status.live
            ? "Encryption active"
            : "Encryption-ready · pre-alpha"}
        </Link>
      </motion.section>

      <Link
        href={`/app/wallet/${encodeURIComponent(name)}/policies/new`}
        className="block w-full"
      >
        <Button size="lg" fullWidth>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New policy rule
        </Button>
      </Link>

      {rules.length === 0 ? (
        <motion.section
          {...motionProps}
          transition={{ duration: 0.2 }}
          className="rounded-card border border-dashed border-border-soft bg-canvas p-6 text-center"
        >
          <p className="text-sm font-medium text-text-strong">
            No policy rules yet
          </p>
          <p className="mt-1 text-xs text-text-soft">
            The wallet&rsquo;s on-chain intent (the spending rule from{" "}
            <Link
              href={`/app/wallet/${encodeURIComponent(name)}/rules`}
              className="font-medium text-accent hover:text-accent-hover"
            >
              Rules
            </Link>
            ) is your baseline. Policy rules add conditions on top.
          </p>
        </motion.section>
      ) : (
        <ul className="flex flex-col gap-3">
          {rules.map((rule) => (
            <PolicyCard key={rule.id} rule={rule} walletName={name} />
          ))}
        </ul>
      )}

      <Link
        href={`/app/wallet/${encodeURIComponent(name)}`}
        className={
          "self-start inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-xs text-text-soft " +
          "transition-colors duration-base ease-out-soft hover:text-text-strong " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <ArrowLeft className="h-3 w-3" aria-hidden="true" />
        Back to wallet
      </Link>
    </div>
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
              "inline-flex items-center gap-1 rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft " +
              "transition-[border-color,color,transform] duration-base ease-out-soft " +
              "hover:-translate-y-0.5 hover:border-accent hover:text-accent"
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
            className="rounded-soft p-1.5 text-text-soft transition-colors hover:bg-canvas hover:text-rose-600"
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
      if (c.chainKind === null) return "Any chain";
      return chainName(c.chainKind);
    case "recipient": {
      const count = c.encryptedAddresses?.length ?? c.addresses?.length ?? 0;
      return `${c.mode === "allowlist" ? "Allow" : "Block"} ${count} recipient${count === 1 ? "" : "s"}`;
    }
    case "amount":
      if (c.minDisplay && c.maxDisplay)
        return `Amount ${c.minDisplay}–${c.maxDisplay} ${c.ticker ?? ""}`.trim();
      if (c.minDisplay) return `Amount ≥ ${c.minDisplay} ${c.ticker ?? ""}`.trim();
      if (c.maxDisplay) return `Amount ≤ ${c.maxDisplay} ${c.ticker ?? ""}`.trim();
      return "Amount (any)";
    case "time-window":
      return `${c.match === "inside" ? "Inside" : "Outside"} ${pad(c.startHour)}–${pad(c.endHour)}`;
    case "velocity":
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
    default:
      return `Chain ${k}`;
  }
}
