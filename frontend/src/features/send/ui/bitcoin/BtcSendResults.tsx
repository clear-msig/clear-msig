"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  SendReceipt,
  type ReceiptDetail,
} from "@/components/retail/SendReceipt";
import {
  bitcoinExplorerLabel,
  type BitcoinNetwork,
} from "@/lib/chain/btc";
import type { BtcSetupPendingReason } from "@/features/send/ui/bitcoin/BtcSetupStates";

export function BitcoinSetupPendingCard({
  walletName,
  proposal,
  reason,
}: {
  walletName: string;
  proposal: string | null;
  reason: BtcSetupPendingReason;
}) {
  const body =
    reason === "approval"
      ? "Waiting for approval. After that, Bitcoin sends will work normally."
      : "Almost done. ClearSig is checking for the final confirmation.";
  return (
    <aside className="rounded-card border border-accent/35 bg-accent/[0.07] p-4 text-sm text-text-soft shadow-card-rest">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-text-strong">
            Bitcoin is turning on
          </p>
          <p className="mt-1">{body}</p>
          {proposal ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-text-soft hover:text-text-strong">
                Details
              </summary>
              <p className="mt-1 font-mono text-[11px] text-text-soft">
                {shortHash(proposal)}
              </p>
            </details>
          ) : null}
        </div>
        <Link
          href={`/app/wallet/${encodeURIComponent(walletName)}/activity`}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-accent/30 bg-accent/[0.12] px-4 text-xs font-semibold text-accent transition-colors hover:bg-accent/[0.18]"
        >
          View activity
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}

export function SentCard({
  sent,
  walletDisplay,
  walletName,
  network,
  onAnother,
}: {
  sent: {
    amountBtc: string;
    to: string;
    note: string;
    txid: string | null;
    explorerUrl: string | null;
  };
  walletDisplay: string;
  walletName: string;
  network: string;
  onAnother: () => void;
}) {
  const networkLabel =
    network === "mainnet" ? "Bitcoin" : `Bitcoin ${network}`;
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Network", value: networkLabel },
  ];
  if (sent.txid) {
    details.push({
      label: "Tx id",
      value: shortHash(sent.txid),
      mono: true,
      copyText: sent.txid,
    });
  }
  if (sent.note) {
    details.push({ label: "Note", value: sent.note });
  }
  return (
    <SendReceipt
      status="confirmed"
      statusLabel={`Broadcast on ${networkLabel}`}
      amount={sent.amountBtc}
      ticker="BTC"
      recipientLabel={sent.to}
      details={details}
      explorerHref={sent.explorerUrl}
      explorerLabel={bitcoinExplorerLabel(network as BitcoinNetwork)}
      actions={[
        {
          label: "Send another",
          hint: "Same wallet, different recipient.",
          onClick: onAnother,
          primary: true,
          icon: ArrowRight,
        },
        {
          label: "View activity",
          hint: "See approvals coming in.",
          href: `/app/wallet/${encodeURIComponent(walletName)}`,
        },
      ]}
    />
  );
}

export function AwaitingApprovalCard({
  request,
  walletDisplay,
  walletName,
  onAnother,
}: {
  request: {
    amountBtc: string;
    to: string;
    proposal: string;
  };
  walletDisplay: string;
  walletName: string;
  onAnother: () => void;
}) {
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Status", value: "Waiting for approvals" },
    {
      label: "Proposal",
      value: shortHash(request.proposal),
      mono: true,
      copyText: request.proposal,
    },
  ];
  return (
    <SendReceipt
      status="pending"
      statusLabel="Request created"
      amount={request.amountBtc}
      ticker="BTC"
      recipientLabel={request.to}
      details={details}
      actions={[
        {
          label: "View activity",
          hint: "See the request and approval status.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/activity`,
          primary: true,
          icon: ArrowRight,
        },
        {
          label: "New request",
          hint: "Compose another Bitcoin request.",
          onClick: onAnother,
        },
      ]}
    />
  );
}

function shortHash(s: string): string {
  if (s.length <= 16) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}
