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

import { Eye } from "lucide-react";
import { InfoTip } from "./InfoTip";

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
  collapsibleDetails = false,
}: SignPayloadPreviewProps) {
  const hasDetails = !!details && details.length > 0;
  const showInline = hasDetails && !collapsibleDetails;
  const showInTip = hasDetails && collapsibleDetails;
  return (
    <section
      aria-label="What you are about to sign"
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
      className="rounded-card border border-border-soft bg-surface-raised p-4 text-left shadow-card-rest border-l-4 border-l-accent"
    >
      <header className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <Eye className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-accent">
            What you are about to sign
          </p>
          <div className="mt-1 flex items-start gap-1.5">
            <p className="font-display text-base font-semibold leading-snug text-text-strong">
              {action}
            </p>
            {showInTip && (
              <InfoTip
                label="See signing details"
                width="md"
                side="end"
                className="mt-0.5"
              >
                <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft">
                  Signing details
                </span>
                <span className="mt-2 block divide-y divide-border-soft">
                  {details!.map((d) => (
                    <span
                      key={d.label}
                      className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
                    >
                      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-soft">
                        {d.label}
                      </span>
                      <span
                        className={
                          "text-right text-xs leading-snug " +
                          (d.emphasis === "mono"
                            ? "font-mono text-text-strong"
                            : d.emphasis === "amount"
                              ? "font-display font-semibold text-accent"
                              : "text-text-strong")
                        }
                      >
                        {d.value}
                      </span>
                    </span>
                  ))}
                </span>
              </InfoTip>
            )}
          </div>
        </div>
      </header>

      {showInline && (
        <dl className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {details!.map((d) => (
            <div
              key={d.label}
              // Stacked label-over-value so long values ("Just you
              // for now", "Ships immediately") aren't truncated by
              // the narrow right-aligned column. bg-canvas/60 was
              // the same opacity-layering trap the parent had -
              // switched to solid bg-canvas so the values never
              // render with semi-transparent surfaces over an
              // unpredictable parent.
              className="flex flex-col gap-0.5 rounded-soft bg-canvas px-2.5 py-1.5"
            >
              <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-soft">
                {d.label}
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

      {warning && (
        <p className="mt-3 rounded-soft bg-warning/10 px-2.5 py-1.5 text-[11px] leading-snug text-text-strong">
          <span className="font-medium text-warning">Heads up.</span> {warning}
        </p>
      )}
    </section>
  );
}
