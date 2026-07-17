"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, List as ListIcon, Loader2, Send, ShieldAlert } from "lucide-react";
import { QrScanButton } from "@/components/retail/QrScanButton";
import { RecentRecipientsChips } from "@/components/retail/RecentRecipientsChips";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import { SendAmountField } from "@/components/retail/SendAmountField";
import { FormField, TextInput } from "@/components/retail/FormField";
import { SendReceipt, type ReceiptDetail } from "@/components/retail/SendReceipt";
import { UsdHint } from "@/components/retail/UsdHint";
import { SignPayloadPreview, type SignPayloadDetail } from "@/components/retail/SignPayloadPreview";
import { chainByKind } from "@/lib/retail/chains";
import { toDisplayName } from "@/lib/retail/walletNames";
import { shortEvmAddress, weiToEth } from "@/lib/chain/eth";
import { SEND_NOTE_LABEL, SEND_NOTE_MAX_LENGTH, SEND_NOTE_PLACEHOLDER } from "@/lib/sendFields";

// Strip an EIP-681 / wallet-scheme prefix from a scanned QR. We
// don't fully parse the URI (chain id + value query params); the
// recipient field cares about the address. Anything we can't
// recognise passes through unchanged so the user can paste raw
// content too.
function parseEvmRecipientFromQr(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // ethereum:0x… or pay-ethereum:0x… (EIP-681).
  const m = trimmed.match(/^(?:pay-)?ethereum:(0x[0-9a-fA-F]{40})/);
  if (m) return m[1];
  // Otherwise let the input field's existing validation surface
  // any issues - better to pass through than silently swallow.
  return trimmed;
}

// ─── Compose stage ────────────────────────────────────────────────

interface ComposeStageProps {
  walletName: string;
  chainKind: number;
  chainLabel: string;
  ticker: string;
  walletEthAddress: string | null;
  amount: string;
  setAmount: (s: string) => void;
  amountWei: bigint;
  recipient: string;
  setRecipient: (s: string) => void;
  recipientValid: boolean;
  /// The 0x address we'll actually sign + broadcast against -
  /// either the typed 0x or the ENS-resolved one. Null while
  /// the user is typing.
  effectiveRecipient: string | null;
  /// The .eth name the user typed, when we successfully
  /// resolved it. Null when the user pasted a raw 0x address.
  ensName: string | null;
  /// True while the ENS proxy is in flight.
  ensResolving: boolean;
  /// True when the typed text looked like an ENS name but the
  /// proxy returned no record.
  ensFailed: boolean;
  note: string;
  setNote: (s: string) => void;
  amountValid: boolean;
  canSubmit: boolean;
  walletBalanceWei: bigint | null;
  balanceLoading: boolean;
  insufficientBalance: boolean;
  gasReserveWei: bigint;
  approvalThreshold: number;
  timelockSeconds: number;
  onSubmit: () => void;
  reduce: boolean;
}

export function ComposeStage({
  walletName,
  chainKind,
  chainLabel,
  ticker,
  walletEthAddress,
  amount,
  setAmount,
  amountWei,
  recipient,
  setRecipient,
  recipientValid,
  effectiveRecipient,
  ensName,
  ensResolving,
  ensFailed,
  note,
  setNote,
  amountValid,
  canSubmit,
  walletBalanceWei,
  balanceLoading,
  insufficientBalance,
  gasReserveWei,
  approvalThreshold,
  timelockSeconds,
  onSubmit,
}: ComposeStageProps) {
  const walletDisplay = toDisplayName(walletName);
  const ethMeta = chainByKind(chainKind);

  const previewDetails: SignPayloadDetail[] = [
    { label: "From wallet", value: toDisplayName(walletName) || "your wallet" },
    { label: "Chain", value: chainLabel },
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
    {
      label: "Gas reserve",
      value: `${weiToEth(gasReserveWei)} ${ticker} reserved`,
    },
    walletEthAddress
      ? {
          label: "From address",
          value: shortEvmAddress(walletEthAddress),
          emphasis: "mono",
        }
      : { label: "From address", value: "spinning up" },
  ];
  if (recipientValid && effectiveRecipient) {
    previewDetails.push({
      label: "Recipient",
      value: shortEvmAddress(effectiveRecipient),
      emphasis: "mono",
    });
    if (ensName) {
      previewDetails.push({ label: "ENS name", value: ensName });
    }
  }
  if (amountValid) {
    previewDetails.push({
      label: "Amount",
      value: `${amount.trim()} ${ticker}`,
      emphasis: "amount",
    });
  }
  if (note.trim()) {
    previewDetails.push({ label: "Reason", value: note.trim() });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Compact left-aligned header. Matches SOL /send. Chain badge
          inline with eyebrow + display title; "From {wallet}" sits on
          the right edge so the network identity is unmistakable
          without burning vertical space. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          {ethMeta ? <ChainBadge chain={ethMeta} size="md" /> : null}
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Send
            </p>
            <h1 className="hidden font-display text-2xl font-semibold leading-tight text-text-strong md:block">
              Send {ticker}
            </h1>
          </div>
        </div>
        <p className="text-xs text-text-soft sm:text-sm">
          From{" "}
          <span className="font-medium text-text-strong">{walletDisplay}</span>
        </p>
      </header>

      {chainKind === 1 || chainKind === 4 ? (
        <Link
          href={`/app/wallet/${encodeURIComponent(walletName)}/send/erc20`}
          className={
            "inline-flex min-h-tap w-fit items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-4 py-2 text-xs font-medium text-text-soft " +
            "transition-[border-color,color,transform] duration-base ease-out-soft " +
            "hover:-translate-y-0.5 hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          Send a token instead (USDC, DAI, …)
        </Link>
      ) : null}

      {/* Compose grid. Amount + Recipient sit side-by-side on lg+
          and merge into one bordered card on mobile. Same shell as
          SOL /send and BTC /send/btc. */}
      <div
        className={
          "flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest " +
          "lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 " +
          "lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
        }
      >
        {/* Amount card. Balance + Max live with the input so the
            number, asset, and available balance stay visually scoped. */}
        <section
          className={
            "flex flex-col gap-3 " +
            "lg:rounded-card lg:border lg:border-border-soft lg:bg-surface-raised lg:p-4 lg:shadow-card-rest"
          }
        >
          <SendAmountField
            id="send-eth-amount-input"
            ticker={ticker}
            value={amount}
            onChange={(e) => {
              const stripped = e.target.value.replace(/[^\d.]/g, "");
              const [whole = "", frac] = stripped.split(".");
              const next =
                frac === undefined
                  ? whole.slice(0, 12)
                  : `${whole.slice(0, 12)}.${frac.slice(0, 18)}`;
              setAmount(next);
            }}
            autoFocus
            maxLength={20}
            action={
              typeof walletBalanceWei === "bigint" &&
              walletBalanceWei > 0n ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    const max =
                      walletBalanceWei > gasReserveWei
                        ? walletBalanceWei - gasReserveWei
                        : 0n;
                    setAmount(weiToEth(max, 12));
                  }}
                  className="rounded-full border border-accent/30 bg-accent/[0.08] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent transition-colors duration-base ease-out-soft hover:bg-accent/15"
                >
                  Use max
                </button>
              ) : null
            }
            footer={
              <>
                <span>Wallet has </span>
                <span className="font-numerals font-medium text-text-strong tabular-nums">
                  {balanceLoading
                    ? "..."
                    : typeof walletBalanceWei === "bigint"
                      ? weiToEth(walletBalanceWei)
                      : "-"}
                </span>
                <span> {ticker}</span>
                {typeof walletBalanceWei === "bigint" &&
                  walletBalanceWei > 0n && (
                    <UsdHint
                      amount={walletBalanceWei}
                      smallestPerWhole={1_000_000_000_000_000_000n}
                      ticker={ticker}
                    />
                  )}
                {amount.trim() && !amountValid && (
                  <span className="ml-1.5 text-warning">
                    Must be a positive number.
                  </span>
                )}
              </>
            }
            warning={
              insufficientBalance && walletBalanceWei !== null ? (
                <>
                  <span className="font-medium">Insufficient balance.</span>{" "}
                  You have {weiToEth(walletBalanceWei)} {ticker}
                  <UsdHint
                    amount={walletBalanceWei}
                    smallestPerWhole={1_000_000_000_000_000_000n}
                    ticker={ticker}
                  />
                  {" "}, need at least {weiToEth(amountWei + gasReserveWei)}{" "}
                  {ticker} including ~{weiToEth(gasReserveWei)} for gas.
                </>
              ) : null
            }
          />
        </section>

        {/* Recipient + Note card. Same merged-mobile / split-lg+
            treatment as Amount above. */}
        <section
          className={
            "flex flex-col gap-3 " +
            "lg:rounded-card lg:border lg:border-border-soft lg:bg-surface-raised lg:p-4 lg:shadow-card-rest"
          }
        >
          <Field
            label="To"
            hint={
              recipient.trim() && !recipientValid && !ensResolving && ensFailed
                ? "Couldn’t resolve that ENS name. Paste a 0x address instead."
                : recipient.trim() && !recipientValid && !ensResolving
                  ? `Must be a 0x… 42-character ${chainLabel} address or a .eth name.`
                  : undefined
            }
          >
            <div className="flex items-stretch gap-2">
              <TextInput
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x… or vitalik.eth"
                className="flex-1 font-mono"
              />
              <QrScanButton
                ariaLabel="Scan recipient QR"
                title="Scan a recipient QR"
                onResult={(v) => setRecipient(parseEvmRecipientFromQr(v))}
                className={
                  "shrink-0 inline-flex h-auto items-center justify-center rounded-card border border-border-soft bg-canvas px-3 text-text-soft " +
                  "transition-[border-color,color,transform] duration-base ease-out-soft " +
                  "hover:-translate-y-0.5 hover:text-accent " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                }
              />
            </div>
            {ensResolving && (
              <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-soft">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Resolving {recipient.trim()}…
              </span>
            )}
            {ensName && effectiveRecipient && !ensResolving && (
              <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent">
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                Resolved {ensName} ·{" "}
                <span className="font-mono text-text-soft">
                  {shortEvmAddress(effectiveRecipient)}
                </span>
              </span>
            )}
          </Field>

          <RecentRecipientsChips
            walletName={walletName}
            chainKind={chainKind}
            onPick={(addr) => setRecipient(addr)}
          />

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
        </section>
      </div>

      {/* Preview + popup narration. Info-icon mode so the headline +
          warning stay visible and the secondary context is one
          hover/tap away. Same pattern as SOL /send. */}
      <div className="flex flex-col gap-2">
        <SignPayloadPreview
          action={
            amountValid && recipientValid && effectiveRecipient
              ? `Send ${amount.trim()} ${ticker} to ${
                  ensName ?? shortEvmAddress(effectiveRecipient)
                }`
              : "Fill in the amount and recipient above"
          }
          details={previewDetails}
          collapsibleDetails
        />
      </div>

      {/* Action footer. Sticky CTA mirrors the other send pages. */}
      <div className="flex flex-col gap-2 pt-1">
        <div
          className={
            "-mx-3 sm:mx-0 px-3 sm:px-0 " +
            "sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4rem)] z-20 sm:static sm:bottom-auto " +
            "border-t border-border-soft bg-canvas pt-3 sm:border-0 sm:bg-transparent sm:pt-0"
          }
        >
          <Button size="lg" fullWidth disabled={!canSubmit} onClick={onSubmit}>
            Send request
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <FormField label={label} error={hint} as="div">
      {children}
    </FormField>
  );
}
