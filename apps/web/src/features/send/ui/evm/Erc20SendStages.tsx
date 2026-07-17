"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, List as ListIcon, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import { SendAmountField } from "@/components/retail/SendAmountField";
import { RecentRecipientsChips } from "@/components/retail/RecentRecipientsChips";
import { FormField, TextInput } from "@/components/retail/FormField";
import { SendReceipt, type ReceiptDetail } from "@/components/retail/SendReceipt";
import { UsdHint } from "@/components/retail/UsdHint";
import { SignPayloadPreview, type SignPayloadDetail } from "@/components/retail/SignPayloadPreview";
import { shortEvmAddress } from "@/lib/chain/eth";
import { tokenAmountToString } from "@/lib/chain/erc20";
import { chainByKind } from "@/lib/retail/chains";
import { toDisplayName } from "@/lib/retail/walletNames";
import { SEND_NOTE_LABEL, SEND_NOTE_MAX_LENGTH, SEND_NOTE_PLACEHOLDER } from "@/lib/sendFields";

const ETH_CHAIN_KIND = 1;
const ERC20_CHAIN_KIND = 4;

// ─── Compose stage ────────────────────────────────────────────────

interface ComposeStageProps {
  walletName: string;
  walletEthAddress: string | null;
  tokenContract: string;
  setTokenContract: (s: string) => void;
  tokenContractValid: boolean;
  metadata: { decimals: number; symbol: string; name: string | null } | null;
  metadataLoading: boolean;
  metadataError: boolean;
  amount: string;
  setAmount: (s: string) => void;
  amountBase: bigint;
  recipient: string;
  setRecipient: (s: string) => void;
  recipientValid: boolean;
  note: string;
  setNote: (s: string) => void;
  amountValid: boolean;
  canSubmit: boolean;
  walletBalance: bigint | null;
  balanceLoading: boolean;
  insufficientBalance: boolean;
  approvalThreshold: number;
  timelockSeconds: number;
  onSubmit: () => void;
  reduce: boolean;
}

export function ComposeStage({
  walletName,
  walletEthAddress,
  tokenContract,
  setTokenContract,
  tokenContractValid,
  metadata,
  metadataLoading,
  metadataError,
  amount,
  setAmount,
  amountBase,
  recipient,
  setRecipient,
  recipientValid,
  note,
  setNote,
  amountValid,
  canSubmit,
  walletBalance,
  balanceLoading,
  insufficientBalance,
  approvalThreshold,
  timelockSeconds,
  onSubmit,
}: ComposeStageProps) {
  const walletDisplay = toDisplayName(walletName);
  const ethMeta = chainByKind(ETH_CHAIN_KIND);
  const symbol = metadata?.symbol ?? "TOKEN";
  const decimals = metadata?.decimals ?? 18;

  const previewDetails: SignPayloadDetail[] = [
    { label: "From wallet", value: walletDisplay || "your wallet" },
    { label: "Chain", value: "Ethereum (Sepolia) - ERC-20" },
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
    { label: "Network fee", value: "Estimated at execution" },
    walletEthAddress
      ? {
          label: "From address",
          value: shortEvmAddress(walletEthAddress),
          emphasis: "mono",
        }
      : { label: "From address", value: "spinning up" },
  ];
  if (tokenContractValid && metadata) {
    previewDetails.push({
      label: "Token",
      value: metadata.name
        ? `${metadata.name} (${metadata.symbol})`
        : metadata.symbol,
    });
    previewDetails.push({
      label: "Token contract",
      value: shortEvmAddress(tokenContract),
      emphasis: "mono",
    });
  }
  if (recipientValid) {
    previewDetails.push({
      label: "Recipient",
      value: shortEvmAddress(recipient),
      emphasis: "mono",
    });
  }
  if (amountValid && metadata) {
    previewDetails.push({
      label: "Amount",
      value: `${amount.trim()} ${metadata.symbol}`,
      emphasis: "amount",
    });
  }
  if (note.trim()) {
    previewDetails.push({ label: "Reason", value: note.trim() });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Compact left-aligned header. Matches SOL / ETH / BTC /send. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          {ethMeta ? <ChainBadge chain={ethMeta} size="md" /> : null}
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Send
            </p>
            <h1 className="hidden font-display text-2xl font-semibold leading-tight text-text-strong md:block">
              Send token
            </h1>
          </div>
        </div>
        <p className="text-xs text-text-soft sm:text-sm">
          From{" "}
          <span className="font-medium text-text-strong">{walletDisplay}</span>
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <Field
          label="Token contract"
          hint={
            tokenContract.trim() && !tokenContractValid
              ? "Must be a 0x… 42-character contract address."
              : metadataError
                ? "Couldn't read this token's metadata. Make sure the address is right and the network's reachable."
                : undefined
          }
        >
          <TextInput
            type="text"
            value={tokenContract}
            onChange={(e) => setTokenContract(e.target.value)}
            placeholder="0x… (e.g. Sepolia USDC)"
            className="font-mono"
          />
          {metadataLoading && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-soft">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Reading token…
            </p>
          )}
          {metadata && !metadataLoading && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              {metadata.name
                ? `${metadata.name} (${metadata.symbol}) · ${metadata.decimals} decimals`
                : `${metadata.symbol} · ${metadata.decimals} decimals`}
            </p>
          )}
        </Field>

        <SendAmountField
          id="send-erc20-amount-input"
          ticker={symbol}
          value={amount}
          onChange={(e) => {
            const stripped = e.target.value.replace(/[^\d.]/g, "");
            const [whole = "", frac] = stripped.split(".");
            const next =
              frac === undefined
                ? whole.slice(0, 24)
                : `${whole.slice(0, 24)}.${frac.slice(0, decimals)}`;
            setAmount(next);
          }}
          placeholder="0"
          disabled={!metadata}
          action={
            typeof walletBalance === "bigint" &&
            walletBalance > 0n &&
            metadata ? (
              <button
                type="button"
                onClick={() => {
                  setAmount(
                    tokenAmountToString(
                      walletBalance,
                      metadata.decimals,
                      metadata.decimals,
                    ),
                  );
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
              <span className="font-numerals font-semibold text-text-strong tabular-nums">
                {balanceLoading
                  ? "..."
                  : typeof walletBalance === "bigint" && metadata
                    ? tokenAmountToString(walletBalance, metadata.decimals, 6)
                    : "-"}
              </span>
              <span> {metadata?.symbol ?? symbol}</span>
              {typeof walletBalance === "bigint" &&
                walletBalance > 0n &&
                metadata && (
                  <UsdHint
                    amount={walletBalance}
                    smallestPerWhole={10n ** BigInt(metadata.decimals)}
                    ticker={metadata.symbol}
                    variant="plain"
                    className="text-text-soft"
                  />
                )}
              {amount.trim() && !amountValid && metadata && (
                <span className="ml-1.5 text-warning">
                  Must be a positive {metadata.symbol} amount.
                </span>
              )}
            </>
          }
          warning={
            insufficientBalance && walletBalance !== null && metadata ? (
              <>
                <span className="font-medium">Insufficient balance.</span> You
                have {tokenAmountToString(walletBalance, metadata.decimals, 6)}{" "}
                {metadata.symbol} - need{" "}
                {tokenAmountToString(amountBase, metadata.decimals, 6)}.
              </>
            ) : null
          }
        />

        <RecentRecipientsChips
          walletName={walletName}
          chainKind={ERC20_CHAIN_KIND}
          onPick={(addr) => setRecipient(addr)}
        />

        <Field
          label="Recipient"
          hint={
            recipient.trim() && !recipientValid
              ? "Must be a 0x… 42-character Ethereum address."
              : undefined
          }
        >
          <TextInput
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="0x…"
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

      <div className="flex flex-col gap-2">
        <SignPayloadPreview
          action={
            amountValid && recipientValid && metadata
              ? `Send ${amount.trim()} ${metadata.symbol} to ${shortEvmAddress(recipient)}`
              : "Fill in the token, amount and recipient above"
          }
          details={previewDetails}
        />
      </div>

      {/* Sticky-bottom CTA on mobile - see SOL send for rationale. */}
      <div
        className={
          "mt-3 -mx-3 sm:mx-0 px-3 sm:px-0 " +
          "sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4rem)] z-20 sm:static sm:bottom-auto " +
          "border-t border-border-soft bg-canvas pt-3 sm:border-0 sm:bg-transparent sm:pt-0"
        }
      >
        <Button
          size="lg"
          fullWidth
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          Send request
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────

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
