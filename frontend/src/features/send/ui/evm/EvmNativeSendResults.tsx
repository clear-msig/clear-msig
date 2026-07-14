"use client";

import Link from "next/link";
import { ArrowRight, List as ListIcon, ShieldAlert } from "lucide-react";
import { Button } from "@/components/retail/Button";
import { SendReceipt, type ReceiptDetail } from "@/components/retail/SendReceipt";

interface SentStageProps {
  amount: string;
  to: string;
  explorerUrl: string | null;
  explorerLabel: string;
  walletName: string;
  walletDisplay: string;
  ticker: string;
  networkLabel: string;
  reduce: boolean;
  pending: boolean;
  proposal: string | null;
}

export function SentStage({
  amount,
  to,
  explorerUrl,
  explorerLabel,
  walletName,
  walletDisplay,
  ticker,
  networkLabel,
  reduce,
  pending,
  proposal,
}: SentStageProps) {
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Network", value: networkLabel },
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
        pending ? "Waiting for remaining approvals" : `Confirmed on ${networkLabel}`
      }
      amount={amount}
      ticker={ticker}
      recipientLabel={to}
      details={details}
      explorerHref={explorerUrl}
      explorerLabel={explorerLabel}
      actions={[
        {
          label: "Send another",
          hint: "Same wallet, different recipient.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/send/eth${networkLabel === "Hyperliquid" ? "?network=hyperliquid" : ""}`,
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

// ─── Pre-flight cards (binding / intent missing) ──────────────────

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
