"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Users } from "lucide-react";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { QuickSendInput } from "@/components/retail/QuickSendInput";
import { QrScanButton } from "@/components/retail/QrScanButton";
import { RecentRecipientsChips } from "@/components/retail/RecentRecipientsChips";
import { SendAmountField } from "@/components/retail/SendAmountField";
import { SignPayloadPreview } from "@/components/retail/SignPayloadPreview";
import { UnsupportedSignerBanner } from "@/components/retail/UnsupportedSignerBanner";
import { UsdHint } from "@/components/retail/UsdHint";
import {
  formatAmount,
  formatLamports,
  parseSolanaRecipientFromQr,
  type ResolvedSolanaRecipient,
} from "@/features/send/domain/solanaSend";
import {
  RecipientStatus,
  SolanaSendField as Field,
} from "@/features/send/ui/solana/SolanaRecipientFields";
import { BudgetHint } from "@/features/send/ui/solana/SolanaSendCompletion";
import { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";
import { shortAddress } from "@/lib/retail/contacts";
import { chainByKind } from "@/lib/retail/chains";
import { toDisplayName } from "@/lib/retail/walletNames";
import {
  SEND_NOTE_MAX_LENGTH,
  SEND_NOTE_PLACEHOLDER,
} from "@/lib/sendFields";
import {
  buildSendPreviewDetails,
  buildSendPreviewWarning,
} from "@/features/send/ui/solana/solanaSendPreview";

type ResolvedRecipient = ResolvedSolanaRecipient;

interface ComposeStageProps {
  walletName: string;
  amount: string;
  setAmount: (s: string) => void;
  recipientText: string;
  setRecipientText: (s: string) => void;
  note: string;
  setNote: (s: string) => void;
  resolved: ResolvedRecipient;
  savedNewContact: boolean;
  onSaveNewContact: (name: string, address: string) => void;
  canSubmit: boolean;
  onSubmit: () => void;
  waitingForRule: boolean;
  budgetUsage: ReturnType<typeof useWalletBudgetUsage>;
  pendingUsd: number;
  contactNames: string[];
  vaultBalanceLamports: bigint | null;
  balanceLoading: boolean;
  insufficientBalance: boolean;
  signerBlocked: boolean;
  feeReserveLamports: bigint;
  approvalThreshold: number;
  timelockSeconds: number;
  onQuickFill: (parsed: {
    recipientText?: string;
    amountSol?: number;
    note?: string;
  }) => void;
}

export function ComposeStage({
  walletName,
  amount,
  setAmount,
  recipientText,
  setRecipientText,
  note,
  setNote,
  resolved,
  savedNewContact,
  onSaveNewContact,
  canSubmit,
  onSubmit,
  waitingForRule,
  budgetUsage,
  pendingUsd,
  contactNames,
  vaultBalanceLamports,
  balanceLoading,
  insufficientBalance,
  signerBlocked,
  feeReserveLamports,
  approvalThreshold,
  timelockSeconds,
  onQuickFill,
}: ComposeStageProps) {
  const walletDisplay = toDisplayName(walletName);

  const display = useMemo(() => formatAmount(amount), [amount]);
  const amountValid = useMemo(() => {
    const n = parseFloat(amount);
    return !isNaN(n) && n > 0;
  }, [amount]);

  const solMeta = chainByKind(0);

  return (
    <section className="flex flex-col gap-4">
      {/* Compact left-aligned header. Chain badge sits inline with
          the title so the network identity is unmistakable without
          eating a full hero block. Matches the rest of the redesigned
          app (Home / Activity / Settings / Account). */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          {solMeta ? <ChainBadge chain={solMeta} size="md" /> : null}
          <div className="flex flex-col gap-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                Send
              </p>
              <h1 className="hidden font-display text-2xl font-semibold leading-tight text-text-strong md:block">
                Send SOL
              </h1>
          </div>
        </div>
        <p className="text-xs text-text-soft sm:text-sm">
          <span className="font-medium text-text-strong">{walletDisplay}</span>
        </p>
      </header>

      {/* Quick-send shortcut - type a sentence, the form fills. */}
      <QuickSendInput contactNames={contactNames} onParsed={onQuickFill} />

      {signerBlocked ? (
        <UnsupportedSignerBanner
          title="This sign-in cannot finish SOL ClearSign yet"
          compact
        />
      ) : null}

      {/* Compose grid - Amount + Recipient sit side-by-side on lg+
          so desktop users see both inputs at once. Stacks single-
          column on smaller screens. `items-start` keeps the cards
          at their natural heights instead of stretching to match.

          Mobile: the wrapper itself becomes the bordered card so
          Amount + Recipient read as one merged form, not two
          stacked cards. lg+: the wrapper sheds its card styling and
          each region restores its own card chrome (the original
          two-card desktop layout). */}
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
          id="send-amount-input"
          ticker="SOL"
          value={amount}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d.]/g, "");
            const [wholeRaw = "", frac] = raw.split(".");
            const whole = wholeRaw.slice(0, 12);
            const next =
              frac === undefined ? whole : `${whole}.${frac.slice(0, 4)}`;
            setAmount(next);
          }}
          autoFocus
          maxLength={20}
          action={
            typeof vaultBalanceLamports === "bigint" &&
            vaultBalanceLamports > 0n ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  const max =
                    vaultBalanceLamports > feeReserveLamports
                      ? vaultBalanceLamports - feeReserveLamports
                      : 0n;
                  setAmount(formatLamports(max, 4));
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
                  : typeof vaultBalanceLamports === "bigint"
                    ? formatLamports(vaultBalanceLamports)
                    : "-"}
              </span>
              <span> SOL</span>
              {typeof vaultBalanceLamports === "bigint" && (
                <UsdHint
                  amount={vaultBalanceLamports}
                  smallestPerWhole={1_000_000_000n}
                  ticker="SOL"
                />
              )}
              {amount && (
                <>
                  <span aria-hidden="true" className="mx-1.5">
                    ·
                  </span>
                  <span>{display} SOL to send</span>
                </>
              )}
            </>
          }
          warning={
            insufficientBalance && typeof vaultBalanceLamports === "bigint" ? (
              <>
              <span className="font-medium">Insufficient balance.</span>{" "}
              {walletDisplay} has {formatLamports(vaultBalanceLamports)} SOL
              <UsdHint
                amount={vaultBalanceLamports}
                smallestPerWhole={1_000_000_000n}
                ticker="SOL"
              />
              {" "}- top up before sending.
              </>
            ) : null
          }
        />
      </section>

      {/* Recipient + Note card. Same merged-on-mobile / split-on-lg+
          treatment as the Amount section above. */}
      <section
        className={
          "flex flex-col gap-3 " +
          "lg:rounded-card lg:border lg:border-border-soft lg:bg-surface-raised lg:p-4 lg:shadow-card-rest"
        }
      >
        <div className="flex items-stretch gap-2">
          <div className="min-w-0 flex-1">
            <Field
              label="To"
              value={recipientText}
              onChange={setRecipientText}
              placeholder="Sarah, or paste a wallet address"
              maxLength={64}
            />
          </div>
          <QrScanButton
            ariaLabel="Scan recipient QR"
            title="Scan a recipient QR"
            onResult={(v) => setRecipientText(parseSolanaRecipientFromQr(v))}
          />
        </div>

        {/* Recents - Cash-App-style stacked list of recent recipients
            on this wallet+chain. The component subscribes to txLog
            updates and self-hides when empty. */}
        <RecentRecipientsChips
          walletName={walletName}
          chainKind={0}
          onPick={setRecipientText}
        />

        <RecipientStatus
          resolved={resolved}
          savedNewContact={savedNewContact}
          onSaveContact={onSaveNewContact}
        />

        <Field
          label="Note"
          value={note}
          onChange={setNote}
          placeholder={SEND_NOTE_PLACEHOLDER}
          optional
          maxLength={SEND_NOTE_MAX_LENGTH}
        />
      </section>

      </div>{/* end Amount + Recipient wrapper (merged-card mobile, split lg+) */}

      <BudgetHint
        budgetUsage={budgetUsage}
        pendingUsd={pendingUsd}
        walletName={walletName}
      />

      {/* Preview + popup narration. Lives just above the CTA so the
          user reads the action they're about to authorize before
          they click Send. Both blocks render in their compact
          "details behind an info icon" mode - the headline + warning
          stay visible, secondary context is one hover/tap away. */}
      <div className="flex flex-col gap-2">
        <SignPayloadPreview
          action={
            amountValid &&
            (resolved.kind === "contact" ||
              resolved.kind === "address" ||
              resolved.kind === "sns")
              ? `Send ${formatAmount(amount)} SOL to ${
                  resolved.kind === "contact"
                    ? resolved.contact.name
                    : resolved.kind === "sns"
                      ? resolved.name
                      : shortAddress(resolved.address)
                }`
              : "Fill in the amount and recipient above"
          }
          details={buildSendPreviewDetails({
            walletName,
            amount,
            amountValid,
            resolved,
            pendingUsd,
            budgetUsage,
            approvalThreshold,
            timelockSeconds,
            feeReserveLamports,
          })}
          warning={buildSendPreviewWarning({
            resolved,
            pendingUsd,
            budgetUsage,
          })}
          technicalNote="Your wallet will sign readable ClearSign text for this request. Verify the amount, recipient, wallet, and expiry before approving."
          collapsibleDetails
        />
      </div>

      {/* Action footer - primary Send CTA + secondary "Send to many"
          link. Sticky on mobile (bottom of viewport, clears safe
          area + BottomNav); inline on sm+ where the page scrolls
          inside the workspace shell. */}
      <div className="flex flex-col gap-2 pt-1">
        <div
          className={
            "-mx-3 sm:mx-0 px-3 sm:px-0 " +
            "sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4rem)] z-20 sm:static sm:bottom-auto " +
            "border-t border-border-soft bg-canvas pt-3 sm:border-0 sm:bg-transparent sm:pt-0"
          }
        >
          <Button
            size="lg"
            fullWidth
            disabled={!canSubmit || waitingForRule || signerBlocked}
            onClick={onSubmit}
          >
            {waitingForRule ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading wallet…
              </>
            ) : (
              <>
                Send request
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
        <Link
          href={`/app/wallet/${encodeURIComponent(walletName)}/send/batch`}
          className={
            "inline-flex min-h-tap items-center justify-center gap-2 self-center rounded-full border border-border-soft " +
            "bg-canvas px-4 py-2 text-xs font-medium text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
          Send to many at once
        </Link>
      </div>
    </section>
  );
}
