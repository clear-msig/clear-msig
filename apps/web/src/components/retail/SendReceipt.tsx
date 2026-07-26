"use client";

// Receipt card shown at the end of every retail send flow (SOL, ETH,
// ERC-20, BTC). Replaces the older one-off SentStage hero designs:
// each chain page used to render a giant 80px disc + headline + free
// text + an explorer pill + a NextStepCard + a tiny "dismiss this and
// stay here" link. The result was visually noisy and inconsistent
// across chains.
//
// One component, one composed receipt per send. Each row is explicit
// (From / Network / Reference) instead of buried in prose, so a user
// reviewing a confirmation can read it the way they'd read a bank
// receipt - top to bottom, no decoder ring.
//
// Status drives the eyebrow and the disc treatment:
//   confirmed → solid accent disc, "Send confirmed"
//   pending   → ringed accent disc, "Request created"
//
// Actions render as a 1- or 2-col footer grid. At most one primary.
// Page-level back navigation lives in the global HeaderBar - this
// component never adds a "Back to wallet" button.

import Link from "next/link";
import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";

export interface ReceiptDetail {
  label: string;
  /// Plain string (mono / sans depending on `mono`).
  value: string;
  mono?: boolean;
  /// When set, a copy button is rendered next to the value. The
  /// rendered `value` is what the user sees (likely truncated); the
  /// `copyText` is what lands on the clipboard.
  copyText?: string;
}

export interface ReceiptAction {
  label: string;
  hint?: string;
  href?: string;
  onClick?: () => void;
  icon?: LucideIcon;
  primary?: boolean;
}

export interface SendReceiptProps {
  /// Drives the eyebrow + disc treatment. "confirmed" = signed +
  /// broadcast; "pending" = proposal landed but still needs other
  /// signers.
  status: "confirmed" | "pending";
  /// Eyebrow caption, e.g. "Confirmed on Solana", "Awaiting approvals",
  /// "Broadcast on Sepolia".
  statusLabel: string;
  /// Big amount headline (digits part).
  amount: string;
  /// Currency ticker rendered as a small caps suffix.
  ticker: string;
  /// Recipient display name. The receipt shows this as "to <bold>".
  recipientLabel: string;
  /// Optional short / mono address rendered next to the recipient
  /// label as a secondary identifier.
  recipientAddress?: string;
  /// Detail rows rendered in a divider'd dl. Common rows: From wallet,
  /// Network, Reference.
  details?: ReceiptDetail[];
  /// Optional explorer pill rendered inside the receipt card.
  explorerHref?: string | null;
  explorerLabel?: string;
  /// 1-3 next-step buttons rendered below the receipt card. At most
  /// one primary.
  actions?: ReceiptAction[];
  reduce?: boolean;
}

export function SendReceipt({
  status,
  statusLabel,
  amount,
  ticker,
  recipientLabel,
  recipientAddress,
  details,
  explorerHref,
  explorerLabel,
  actions,
  reduce,
}: SendReceiptProps) {
  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
      };
  const heading = status === "confirmed" ? "Send confirmed" : "Request created";
  const rows = details ?? [];
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-4"
    >
      <div className="clear-receipt-card rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
        <div className="flex items-center gap-3">
          <motion.span
            initial={reduce ? false : { scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              type: "spring",
              damping: 18,
              stiffness: 240,
              delay: 0.05,
            }}
            className={
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full " +
              (status === "confirmed"
                ? "bg-accent text-text-on-accent shadow-accent-rest"
                : "bg-accent/10 text-accent ring-1 ring-accent/30")
            }
          >
            <Check className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
          </motion.span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              {heading}
            </p>
            <p className="mt-0.5 truncate text-xs text-text-soft">
              {statusLabel}
            </p>
          </div>
        </div>

        <p className="mt-5 inline-flex items-baseline gap-2">
          <span className="font-numerals text-3xl font-semibold leading-none text-text-strong tabular-nums sm:text-4xl">
            {amount}
          </span>
          <span className="font-display text-base font-semibold uppercase tracking-[0.18em] text-text-soft">
            {ticker}
          </span>
        </p>
        <p className="mt-1.5 text-sm text-text-soft">
          to{" "}
          <span className="font-medium text-text-strong">{recipientLabel}</span>
          {recipientAddress && (
            <>
              {" · "}
              <span className="font-mono text-text-soft">
                {recipientAddress}
              </span>
            </>
          )}
        </p>

        {rows.length > 0 && (
          <dl className="mt-5 divide-y divide-border-soft border-y border-border-soft">
            {rows.map((d, i) => (
              <ReceiptRow key={i} detail={d} />
            ))}
          </dl>
        )}

        {explorerHref && (
          <a
            href={explorerHref}
            target="_blank"
            rel="noopener noreferrer"
            className={
              "mt-5 inline-flex items-center gap-1.5 rounded-soft border border-border-soft bg-canvas px-3.5 py-2 text-xs font-medium text-text-strong " +
              "transition-[border-color,color,transform] duration-base ease-out-soft " +
              "hover:-translate-y-0.5 hover:border-accent/40 hover:text-accent " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            }
          >
            View on {explorerLabel ?? "explorer"}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>

      {actions && actions.length > 0 && (
        <div
          className={
            actions.length > 1
              ? "grid grid-cols-1 gap-2 sm:grid-cols-2"
              : "flex"
          }
        >
          {actions.map((action, i) => (
            <ReceiptActionButton key={i} {...action} />
          ))}
        </div>
      )}
    </motion.section>
  );
}

function ReceiptRow({ detail }: { detail: ReceiptDetail }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!detail.copyText) return;
    try {
      await navigator.clipboard.writeText(detail.copyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard rejection - ignore */
    }
  };
  return (
    <div className="clear-receipt-row flex items-center justify-between gap-3 px-2 py-2.5">
      <dt className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
        {detail.label}
      </dt>
      <dd className="flex min-w-0 items-center gap-2">
        <span
          className={
            (detail.mono ? "font-mono text-xs " : "text-sm ") +
            "truncate font-medium text-text-strong"
          }
        >
          {detail.value}
        </span>
        {detail.copyText && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label={
              copied ? "Copied" : `Copy ${detail.label.toLowerCase()}`
            }
            className={
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-text-soft " +
              "transition-colors duration-base ease-out-soft hover:bg-canvas hover:text-text-strong " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            }
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        )}
      </dd>
    </div>
  );
}

function ReceiptActionButton({
  label,
  hint,
  href,
  onClick,
  icon: Icon,
  primary,
}: ReceiptAction) {
  const base =
    "group flex w-full items-center gap-3 rounded-card px-4 py-3 text-left " +
    "transition-[border-color,background-color,transform,box-shadow] duration-base ease-out-soft " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas";
  const variant = primary
    ? "border border-accent/40 bg-accent/[0.06] text-text-strong shadow-card-rest hover:-translate-y-0.5 hover:shadow-card-raised"
    : "border border-border-soft bg-surface-raised text-text-strong hover:border-accent/30";
  const inner = (
    <>
      {Icon && (
        <span
          className={
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
            (primary
              ? "bg-accent text-text-on-accent"
              : "bg-accent/10 text-accent")
          }
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="mt-0.5 text-xs text-text-soft">{hint}</span>}
      </span>
      <ArrowRight
        className={
          "h-4 w-4 shrink-0 transition-transform duration-base group-hover:translate-x-0.5 " +
          (primary ? "text-accent" : "text-text-soft group-hover:text-accent")
        }
        aria-hidden="true"
      />
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={base + " " + variant}>
        {inner}
      </button>
    );
  }
  return (
    <Link href={href ?? "#"} className={base + " " + variant}>
      {inner}
    </Link>
  );
}
