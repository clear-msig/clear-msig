"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Send } from "lucide-react";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { SendAmountField } from "@/components/retail/SendAmountField";
import { FormField, TextInput } from "@/components/retail/FormField";
import { SendReceipt, type ReceiptDetail } from "@/components/retail/SendReceipt";
import { SignPayloadPreview, type SignPayloadDetail } from "@/components/retail/SignPayloadPreview";
import { UsdHint } from "@/components/retail/UsdHint";
import { formatSats } from "@/lib/chain/btc";
import { shortEvmAddress } from "@/lib/chain/eth";
import { ZCASH_SEND_FEE_RESERVE_ZATS, validateZcashDestination } from "@/lib/chain/zcash";
import { chainByKind } from "@/lib/retail/chains";
import { SEND_NOTE_LABEL, SEND_NOTE_MAX_LENGTH, SEND_NOTE_PLACEHOLDER } from "@/lib/sendFields";

const ZEC_CHAIN_KIND = 3;

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
    <div className="mx-auto flex w-full max-w-lg flex-col lg:max-w-3xl">
      <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          Zcash send
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold leading-tight text-text-strong">
          {title}
        </h1>
        {body ? <p className="mt-2 text-sm text-text-soft">{body}</p> : null}
        <Link
          href={cta.href}
          className="mt-4 inline-flex items-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest"
        >
          {cta.label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

export function ZcashCompose({
  walletDisplay,
  walletAddress,
  balance,
  balanceLoading,
  balanceError,
  amount,
  setAmount,
  note,
  setNote,
  recipient,
  setRecipient,
  recipientDecoded,
  amountValid,
  recipientValid,
  selectedUtxo,
  impliedFeeZats,
  zcashFeeBurnRisk,
  insufficientBalance,
  zcashRpcConfigured,
  approvalThreshold,
  timelockSeconds,
  canSubmit,
  onSubmit,
}: {
  walletDisplay: string;
  walletAddress: string | null;
  balance: bigint | null;
  balanceLoading: boolean;
  balanceError: Error | null;
  amount: string;
  setAmount: (s: string) => void;
  note: string;
  setNote: (s: string) => void;
  recipient: string;
  setRecipient: (s: string) => void;
  recipientDecoded: ReturnType<typeof validateZcashDestination>;
  amountValid: boolean;
  recipientValid: boolean;
  selectedUtxo: { txid: string; vout: number; satoshis: bigint } | null;
  impliedFeeZats: bigint | null;
  zcashFeeBurnRisk: boolean;
  insufficientBalance: boolean;
  zcashRpcConfigured: boolean;
  approvalThreshold: number;
  timelockSeconds: number;
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  const zecMeta = chainByKind(ZEC_CHAIN_KIND);
  const balanceLabel = !zcashRpcConfigured
    ? "RPC not configured"
    : balance !== null
      ? formatSats(balance)
      : balanceError
        ? "Couldn't load"
        : balanceLoading
          ? "Checking"
          : "-";
  const details: SignPayloadDetail[] = [
    { label: "From wallet", value: walletDisplay || "your wallet" },
    { label: "Chain", value: "Zcash" },
    {
      label: "Approval threshold",
      value: `${approvalThreshold} ${approvalThreshold === 1 ? "approval" : "approvals"}`,
    },
    {
      label: "Timelock",
      value:
        timelockSeconds > 0
          ? `${timelockSeconds} seconds after approval`
          : "Immediately after approval",
    },
    walletAddress
      ? { label: "From address", value: shortEvmAddress(walletAddress), emphasis: "mono" }
      : { label: "From address", value: "spinning up" },
  ];
  if (recipientValid) {
    details.push({ label: "Recipient", value: recipient, emphasis: "mono" });
  }
  if (amountValid) {
    details.push({ label: "Amount", value: `${amount.trim()} ZEC`, emphasis: "amount" });
    details.push({
      label: "Network fee",
      value: `${formatSats(ZCASH_SEND_FEE_RESERVE_ZATS)} ZEC`,
    });
  }
  if (note.trim()) {
    details.push({ label: "Note", value: note.trim() });
  }
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          {zecMeta ? <ChainBadge chain={zecMeta} size="md" /> : null}
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Send
            </p>
            <h1 className="hidden font-display text-2xl font-semibold leading-tight text-text-strong md:block">
              Send ZEC
            </h1>
          </div>
        </div>
        <p className="text-xs text-text-soft sm:text-sm">
          From <span className="font-medium text-text-strong">{walletDisplay}</span>
        </p>
      </header>

      <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
          <SendAmountField
            id="zec-amount"
            ticker="ZEC"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            footer={
              <>
                <span>Wallet has </span>
                <span className="font-numerals font-medium text-text-strong tabular-nums">
                  {balanceLabel}
                </span>
                {balance !== null ? <span> ZEC</span> : null}
                {balance !== null ? (
                  <UsdHint
                    amount={balance}
                    smallestPerWhole={100_000_000n}
                    ticker="ZEC"
                  />
                ) : null}
                {selectedUtxo ? (
                  <span className="block pt-1 text-[11px]">
                    Using input {selectedUtxo.txid.slice(0, 10)}…:
                    {selectedUtxo.vout}
                    {impliedFeeZats !== null ? (
                      <> · fee {formatSats(impliedFeeZats)} ZEC</>
                    ) : null}
                  </span>
                ) : null}
              </>
            }
            warning={
              !zcashRpcConfigured ? (
                <span className="font-medium">Zcash RPC is not configured.</span>
              ) : balanceError ? (
                <span className="font-medium">
                  Couldn&apos;t load Zcash balance or UTXOs.
                </span>
              ) : insufficientBalance ? (
                <span className="font-medium">Insufficient balance.</span>
              ) : zcashFeeBurnRisk && selectedUtxo ? (
                <span className="font-medium">
                  This input has no change output. Send exactly{" "}
                  {formatSats(
                    selectedUtxo.satoshis - ZCASH_SEND_FEE_RESERVE_ZATS,
                  )} ZEC to keep the fee at{" "}
                  {formatSats(ZCASH_SEND_FEE_RESERVE_ZATS)} ZEC.
                </span>
              ) : null
            }
          />
          <Field label="To" hint={recipient.trim() && !recipientValid ? recipientDecoded.ok ? undefined : recipientDecoded.reason : undefined}>
            <TextInput
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="t1… or tm…"
              className="font-mono"
            />
          </Field>
          <Field label={SEND_NOTE_LABEL}>
            <TextInput
              type="text"
              value={note}
              onChange={(e) =>
                setNote(e.target.value.slice(0, SEND_NOTE_MAX_LENGTH))
              }
              placeholder={SEND_NOTE_PLACEHOLDER}
              maxLength={SEND_NOTE_MAX_LENGTH}
            />
          </Field>
        </div>
      </div>

      <SignPayloadPreview action={amountValid && recipientValid ? `Send ${amount.trim()} ZEC` : "Fill in the amount and recipient above"} details={details} collapsibleDetails />
      <div className="pt-1">
        <Button size="lg" fullWidth onClick={onSubmit} disabled={!canSubmit}>
          Send request
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <FormField label={label} error={hint} as="div">
      {children}
    </FormField>
  );
}

export function SentStage({
  walletName,
  walletDisplay,
  amount,
  to,
  note,
  explorerUrl,
  explorerLabel,
}: {
  walletName: string;
  walletDisplay: string;
  amount: string;
  to: string;
  note: string;
  explorerUrl: string | null;
  explorerLabel: string;
}) {
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Network", value: "Zcash" },
  ];
  if (note) {
    details.push({ label: "Note", value: note });
  }
  return (
    <SendReceipt
      status="confirmed"
      statusLabel="Confirmed on Zcash"
      amount={amount}
      ticker="ZEC"
      recipientLabel={to}
      details={details}
      explorerHref={explorerUrl}
      explorerLabel={explorerLabel}
      actions={[
        {
          label: "Send another",
          hint: "Same wallet, different recipient.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/send/zec`,
          primary: true,
          icon: ArrowRight,
        },
        {
          label: "View activity",
          hint: "See proposals and wallet events.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/activity`,
          icon: Send,
        },
      ]}
    />
  );
}

export function ZcashAwaitingApproval({
  request,
  walletName,
  walletDisplay,
  onAnother,
}: {
  request: { amount: string; to: string; proposal: string };
  walletName: string;
  walletDisplay: string;
  onAnother: () => void;
}) {
  return (
    <SendReceipt
      status="pending"
      statusLabel="Waiting for remaining approvals"
      amount={request.amount}
      ticker="ZEC"
      recipientLabel={request.to}
      details={[
        { label: "From", value: walletDisplay },
        { label: "Network", value: "Zcash" },
        {
          label: "Proposal",
          value: `${request.proposal.slice(0, 8)}...${request.proposal.slice(-6)}`,
          mono: true,
          copyText: request.proposal,
        },
      ]}
      actions={[
        {
          label: "View approvals",
          href: `/app/wallet/${encodeURIComponent(walletName)}/activity`,
          primary: true,
          icon: ArrowRight,
        },
        { label: "New request", onClick: onAnother },
      ]}
    />
  );
}
