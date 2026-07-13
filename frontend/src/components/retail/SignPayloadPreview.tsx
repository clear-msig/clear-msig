"use client";

// SignPayloadPreview. The human-readable summary of what the user is
// about to sign, rendered immediately above the WalletPopupNarration.
//
// The team's 2026-05-01 review flagged that Solana wallets show raw
// hex bytes in the signMessage prompt instead of a friendly summary.
// We cannot change what the wallet renders, but we can make sure the
// user has already seen the structured intent before they tap. So
// every signed-write surface drops this component above its CTA.
//
// Together with WalletPopupNarration this is a two-part contract:
//   1. SignPayloadPreview  : "here's exactly what you're approving"
//   2. WalletPopupNarration: "your wallet will pop up; the bytes are
//                             that thing above, in technical form"
// Once the user has both, the hex no longer reads as a surprise.
//
// Use a verb-phrase action ("Send $50 to Sarah", "Add Mara to Family")
// and key-value details that name the wallet, chain, recipient,
// approvals, or anything else load-bearing for the decision. Keep
// details to 4 or fewer; this is a confirmation, not a wall of data.
//
// For high-stakes actions (large transfers, role changes, member
// removals) pass `warning` to surface a one-line caveat the user
// should consciously absorb before signing.

import { ChevronDown, Eye } from "lucide-react";

export interface SignPayloadDetail {
  label: string;
  value: string;
  /// Optional emphasis. "mono" renders as monospace (addresses,
  /// hashes); "amount" renders accent-coloured (money values).
  emphasis?: "mono" | "amount";
}

interface SignPayloadPreviewProps {
  /// Plain-language headline of the action being signed. Verb first.
  action: string;
  /// Key-value rows. Keep to 4 or fewer.
  details?: SignPayloadDetail[];
  /// Optional warning footer for high-stakes actions.
  warning?: string;
  /// Optional signer-specific note for wallet popups that render a
  /// digest or technical bytes instead of the human summary.
  technicalNote?: string;
  /// When true, the detail rows render behind an info icon next to
  /// the headline instead of inline below it. Use on dense surfaces
  /// (e.g. /send) where the rows duplicate context the user has
  /// already keyed in. Headline + warning stay visible regardless.
  collapsibleDetails?: boolean;
}

export function SignPayloadPreview({
  action,
  details,
  warning,
  technicalNote,
  collapsibleDetails = false,
}: SignPayloadPreviewProps) {
  const primaryDetails = collapsibleDetails
    ? details?.filter((detail) => !isTechnicalDetail(detail))
    : details;
  const technicalDetails = collapsibleDetails
    ? details?.filter(isTechnicalDetail)
    : [];
  return (
    <section
      aria-label="Review transaction"
      // Switched from bg-accent/10 to a SOLID surface
      // (bg-surface-raised: theme-aware white / dark) plus a thick
      // left accent stripe. The opacity-layered green tint kept
      // bleeding into the page bg unpredictably - depending on the
      // OS theme + user pref combo, text-text-strong on the
      // tinted panel rendered as anything from "barely readable"
      // to "fully legible" without a single deterministic answer.
      // bg-surface-raised + text-text-strong is the same contrast
      // pair the wallet hub uses for every card and it always
      // works. The accent stripe + accent kicker text below carry
      // the "this is the signing surface" signal that the green
      // tint used to.
      className="clear-receipt-card rounded-card border border-border-soft bg-surface-raised p-4 text-left shadow-card-rest border-l-4 border-l-accent"
    >
      <header className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Eye className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
            Review transaction
          </p>
          <div className="mt-1 flex items-start gap-1.5">
            <p className="font-display text-base font-semibold leading-snug text-text-strong">
              {action}
            </p>
          </div>
        </div>
      </header>

      {!!primaryDetails?.length && (
        <dl className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {primaryDetails.map((d) => (
            <div
              key={d.label}
              // Stacked label-over-value so long values ("Just you
              // for now", "Ships immediately") aren't truncated by
              // the narrow right-aligned column. bg-canvas/60 was
              // the same opacity-layering trap the parent had -
              // switched to solid bg-canvas so the values never
              // render with semi-transparent surfaces over an
              // unpredictable parent.
              className="clear-receipt-row flex flex-col gap-0.5 rounded-soft bg-canvas px-2.5 py-1.5"
            >
              <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-soft">
                {reviewLabel(d.label)}
              </dt>
              <dd
                className={
                  "break-words text-sm leading-snug " +
                  (d.emphasis === "mono"
                    ? "font-mono text-xs text-text-strong"
                    : d.emphasis === "amount"
                      ? "font-display text-base text-accent"
                      : "text-text-strong")
                }
              >
                {d.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {!!technicalDetails?.length && (
        <details className="group mt-3 border-t border-border-soft pt-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium text-text-soft hover:text-text-strong">
            Technical details
            <ChevronDown
              className="h-4 w-4 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <dl className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {technicalDetails.map((detail) => (
              <div
                key={detail.label}
                className="clear-receipt-row flex flex-col gap-0.5 rounded-soft bg-canvas px-2.5 py-1.5"
              >
                <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-soft">
                  {reviewLabel(detail.label)}
                </dt>
                <dd className="break-all font-mono text-xs leading-snug text-text-strong">
                  {detail.value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {warning && (
        <p className="mt-3 rounded-soft bg-warning/10 px-2.5 py-1.5 text-[11px] leading-snug text-text-strong">
          <span className="font-medium text-warning">Heads up.</span> {warning}
        </p>
      )}

      {technicalNote && (
        <p className="mt-3 rounded-soft border border-border-soft bg-canvas px-2.5 py-1.5 text-[11px] leading-snug text-text-soft">
          <span className="font-medium text-text-strong">ClearSign check.</span>{" "}
          {technicalNote}
        </p>
      )}
    </section>
  );
}

function isTechnicalDetail(detail: SignPayloadDetail): boolean {
  const label = detail.label.toLowerCase();
  return (
    label.includes("contract") ||
    label.includes("hash") ||
    label.includes("payload") ||
    label.includes("transaction id") ||
    label === "from address"
  );
}

function reviewLabel(label: string): string {
  switch (label) {
    case "From wallet":
      return "From";
    case "Chain":
      return "Network";
    case "Recipient":
    case "Recipient address":
      return "To";
    case "Fee":
    case "Miner fee":
    case "Gas reserve":
      return "Network fee";
    case "Approval threshold":
      return "Approvals";
    case "Cooldown":
    case "Timelock":
      return "Available after";
    default:
      return label;
  }
}
