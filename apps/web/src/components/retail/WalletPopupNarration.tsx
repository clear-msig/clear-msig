"use client";

// "Your wallet will pop up" narration banner.
//
// The single biggest moment of confusion for a non-crypto user is the
// seam between Clear and the wallet extension. The browser flips to a
// popup with cryptic text and a Reject button right next to Approve.
// Squads notably omits this hand-off; for retail it's non-negotiable.
//
// Drop this above the primary CTA on every signed-write flow:
//   <WalletPopupNarration action="enable sending" />
//   <WalletPopupNarration action="add Sarah" popups={2} />
//
// `popups` defaults to 1. Use 2 when the flow is propose + approve
// (every meta-intent path) so the user isn't surprised by the second
// popup mid-flow.
//
// Two narration modes, picked from `useWallet().isLedger`:
//   - Software wallet (Solflare / Backpack / embedded): the popup
//     renders technical-looking bytes. Disclaimer says "that's
//     normal" so users don't bail. (Phantom is gated upstream by
//     UnsupportedSignerBanner - it rejects our offchain envelope.)
//   - Ledger device: the device renders the full message text on its
//     screen (`signOffchainMessage` + format-byte 0). Copy flips to
//     "your Ledger will show the full message - read it before
//     approving" because the device IS the source of truth.

import { ShieldCheck } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { InfoTip } from "./InfoTip";

interface WalletPopupNarrationProps {
  /// Verb-phrase the wallet will be confirming. Lowercased so it
  /// reads inline ("confirm enable sending"). Avoid punctuation.
  action: string;
  /// How many wallet popups will fire end-to-end. Defaults to 1.
  popups?: number;
  /// Optional override of the trailing reassurance line. Defaults to
  /// "Nothing leaves your account. This just sets up the rules on chain."
  note?: string;
  /// Compact rendering (smaller padding + text) for inline embedding
  /// on dense screens like the proposal-detail action panel. Hides the
  /// hex disclaimer to keep the footprint tight.
  compact?: boolean;
  /// Force-disable the hex disclaimer even outside compact mode.
  /// Default false. Use only on surfaces that already have their own
  /// honest narration (e.g. the welcome confirm step).
  hideHexDisclaimer?: boolean;
  /// Move the hex / Ledger disclaimer footer into an info-icon tooltip
  /// instead of rendering it inline. Trims vertical space on dense
  /// surfaces (e.g. /send) without dropping the disclaimer entirely.
  disclaimerBehindInfoTip?: boolean;
}

export function WalletPopupNarration({
  action,
  popups = 1,
  note,
  compact = false,
  hideHexDisclaimer = false,
  disclaimerBehindInfoTip = false,
}: WalletPopupNarrationProps) {
  const { isLedger, isMobile } = useWallet();
  const popupCopy = isLedger
    ? popups === 1
      ? "Your Ledger will prompt you."
      : `Your Ledger will prompt you ${popups} times.`
    : popups === 1
      ? "Your wallet will pop up."
      : `Your wallet will pop up ${popups} times.`;
  const trailing =
    note ??
    "Nothing leaves your account. This turns on sending protection on chain.";
  const showFooter = !compact && !hideHexDisclaimer;
  const disclaimer = isLedger ? (
    <>
      <span className="font-medium text-text-strong">
        Read it before approving.
      </span>{" "}
      Your Ledger displays the exact message it&rsquo;s about to sign.
      If anything looks off, cancel on the device.
    </>
  ) : isMobile ? (
    <>
      <span className="font-medium text-text-strong">Heads up.</span>{" "}
      Mobile wallet apps render the signing prompt as raw hex instead of
      the human-readable text the desktop extensions show. The bytes
      they&rsquo;re signing are exactly what the preview above
      describes — verify the preview before approving.
    </>
  ) : (
    <>
      <span className="font-medium text-text-strong">Heads up.</span>{" "}
      Solana software wallets show technical-looking text instead of a
      friendly summary in the signing prompt. That is the message your
      wallet is signing for you. It is normal.
    </>
  );
  const showInlineFooter = showFooter && !disclaimerBehindInfoTip;
  const showInlineTip = showFooter && disclaimerBehindInfoTip;
  return (
    <div
      role="note"
      className={
        "flex items-start gap-2.5 rounded-card border border-accent/30 bg-accent/5 text-left text-text-soft " +
        (compact ? "p-2.5 text-[11px]" : "p-3 text-xs")
      }
    >
      <ShieldCheck
        className={
          "mt-0.5 shrink-0 text-accent " +
          (compact ? "h-3.5 w-3.5" : "h-4 w-4")
        }
        strokeWidth={2}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 leading-snug">
        <p>
          <span className="font-medium text-text-strong">{popupCopy}</span>{" "}
          {isLedger ? (
            popups === 1 ? (
              <>
                Read the message on the device, then press the right
                button to approve <em>{action}</em>.{" "}
              </>
            ) : (
              <>
                Read each message on the device. One to start{" "}
                <em>{action}</em>, one to approve it. Press the right
                button both times.{" "}
              </>
            )
          ) : popups === 1 ? (
            <>
              It&rsquo;ll ask you to confirm <em>{action}</em>. Tap Approve.{" "}
            </>
          ) : (
            <>
              One to start <em>{action}</em>, one to approve it. Tap Approve
              both times.{" "}
            </>
          )}
          {trailing}
          {showInlineTip && (
            <>
              {" "}
              <InfoTip
                label={
                  isLedger
                    ? "Why your Ledger shows that message"
                    : isMobile
                      ? "Why your mobile wallet shows hex"
                      : "Why your wallet shows technical text"
                }
                width="md"
                size="xs"
                side="end"
              >
                <span className="block">{disclaimer}</span>
              </InfoTip>
            </>
          )}
        </p>
        {showInlineFooter && (
          <p className="mt-2 text-text-soft">{disclaimer}</p>
        )}
      </div>
    </div>
  );
}
