"use client";

import Link from "next/link";
import { ArrowRight, List as ListIcon } from "lucide-react";
import {
  SendReceipt,
  type ReceiptDetail,
} from "@/components/retail/SendReceipt";
import { shortAddress } from "@/lib/retail/contacts";
import { txUrl as solanaTxUrl } from "@/lib/explorer";
import { toDisplayName } from "@/lib/retail/walletNames";
import { formatUsd } from "@/lib/retail/priceConversion";
import { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";

interface SentStageProps {
  amountDisplay: string;
  recipientDisplay: string;
  walletName: string;
  walletDisplay: string;
  /// Solana tx signature when the proposal was executed inline
  /// (auto-approve or sole-approver path). When null, the proposal
  /// is on chain awaiting other signers - the receipt's status pill
  /// + copy reflect the distinction so users don't think their
  /// friends already moved money when they didn't.
  executedTxid: string | null;
  reduce: boolean;
}

export function SentStage({
  amountDisplay,
  recipientDisplay,
  walletName,
  walletDisplay,
  executedTxid,
  reduce,
}: SentStageProps) {
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Network", value: "Solana" },
  ];
  if (executedTxid) {
    details.push({
      label: "Reference",
      value: shortAddress(executedTxid),
      mono: true,
      copyText: executedTxid,
    });
  }
  return (
    <SendReceipt
      status={executedTxid ? "confirmed" : "pending"}
      statusLabel={
        executedTxid
          ? "Broadcast on Solana"
          : `Awaiting approvals in ${walletDisplay}`
      }
      amount={amountDisplay}
      ticker="SOL"
      recipientLabel={recipientDisplay}
      details={details}
      explorerHref={executedTxid ? solanaTxUrl(executedTxid) : null}
      explorerLabel="Solana Explorer"
      actions={[
        {
          label: "Send another",
          hint: "Same wallet, different recipient.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/send`,
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
// ─── Budget hint (cross-chain spending limit nudge) ────────────────
//
// Sits above the wallet-popup narration on /send. Three states:
//   1. No budget set - silent (don't pile a CTA on top of the
//      send flow's existing surface area).
//   2. Send fits - green "fits within $X left this week".
//   3. Send overshoots - warning "would push {wallet} $X over its
//      weekly cap. Friends still need to approve, this is a heads-up".
//
// Today's a heads-up; the wallet's approval rule still gates every
// send. When the program enforces the cap on chain, the warning
// becomes a hard stop and this component grows a "request override"
// button instead of just narrating.

export function BudgetHint({
  budgetUsage,
  pendingUsd,
  walletName,
}: {
  budgetUsage: ReturnType<typeof useWalletBudgetUsage>;
  pendingUsd: number;
  walletName: string;
}) {
  const walletDisplay = toDisplayName(walletName);
  const cap = budgetUsage.budget?.weeklyUsd ?? null;
  if (cap === null || cap === undefined) return null;
  if (pendingUsd <= 0) return null;

  const remaining = cap - budgetUsage.spentUsd;
  const wouldExceed = pendingUsd > remaining;
  if (!wouldExceed) {
    return null;
  }
  const overage = pendingUsd - Math.max(0, remaining);
  return (
    <div className="mt-4 rounded-card border border-warning/30 bg-warning/5 p-3 text-left text-xs text-text-soft">
      <p className="font-medium text-text-strong">
        Heads up: this send would push {walletDisplay} {formatUsd(overage)}{" "}
        over its weekly cap.
      </p>
      <p className="mt-1 leading-snug">
        Friends still need to approve. The cap is a guide today, not a
        hard stop. Lower the amount or update the cap on{" "}
        <Link
          href={`/app/wallet/${encodeURIComponent(walletName)}/budget`}
          className="text-accent underline-offset-2 hover:underline"
        >
          {walletDisplay}&rsquo;s budget page
        </Link>
        .
      </p>
    </div>
  );
}
