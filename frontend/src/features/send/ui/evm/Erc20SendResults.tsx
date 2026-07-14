"use client";

import Link from "next/link";
import { ArrowRight, List as ListIcon, ShieldAlert } from "lucide-react";
import { Button } from "@/components/retail/Button";
import { SendReceipt, type ReceiptDetail } from "@/components/retail/SendReceipt";

// ─── Sent stage ──────────────────────────────────────────────────

export function SentStage({
  amount,
  symbol,
  to,
  explorerUrl,
  explorerLabel,
  walletName,
  walletDisplay,
  reduce,
  pending,
  proposal,
}: {
  amount: string;
  symbol: string;
  to: string;
  explorerUrl: string | null;
  explorerLabel: string;
  walletName: string;
  walletDisplay: string;
  reduce: boolean;
  pending: boolean;
  proposal: string | null;
}) {
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Network", value: "Sepolia" },
    { label: "Token", value: symbol },
  ];
  if (proposal) {
    details.push({
      label: "Proposal",
      value: `${proposal.slice(0, 8)}...${proposal.slice(-6)}`,
      mono: true,
      copyText: proposal,
    });
  }
  return (
    <SendReceipt
      status={pending ? "pending" : "confirmed"}
      statusLabel={
        pending ? "Waiting for remaining approvals" : "Confirmed on Sepolia"
      }
      amount={amount}
      ticker={symbol}
      recipientLabel={to}
      details={details}
      explorerHref={explorerUrl}
      explorerLabel={explorerLabel}
      actions={[
        {
          label: "Send another token",
          hint: "Same wallet, pick a different token.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/send/erc20`,
          primary: true,
          icon: ArrowRight,
        },
        {
          label: "View activity",
          hint: "See approvals coming in.",
          href: `/app/wallet/${encodeURIComponent(walletName)}`,
          icon: ListIcon,
        },
      ]}
      reduce={reduce}
    />
  );
}

// ─── Pre-flight bounce card ──────────────────────────────────────

export function PreFlightCard({
  title,
  body,
  cta,
}: {
  title: string;
  body?: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-gutter py-10">
      <div className="w-full max-w-md rounded-card border border-warning/30 bg-warning/5 p-6 text-center shadow-card-rest">
        <div className="flex justify-center text-warning">
          <ShieldAlert className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 className="mt-3 font-display text-display-xs text-text-strong">
          {title}
        </h2>
        {body ? <p className="mt-2 text-sm text-text-soft">{body}</p> : null}
        <Link href={cta.href} className="mt-4 inline-block">
          <Button size="md">
            {cta.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
