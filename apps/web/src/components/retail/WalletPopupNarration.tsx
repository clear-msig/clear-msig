"use client";

// Explain the signing handoff without treating the app preview or an opaque
// wallet prompt as independent verification. Physical-device qualification is separate.

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
  /// A neutral reminder that signing and execution are separate.
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
    "Signing and execution are separate steps. Review the requested action before you decide.";
  const showFooter = !compact && !hideHexDisclaimer;
  const disclaimer = isLedger ? (
    <>
      Device screens depend on the installed app and firmware. Read what your
      device actually displays; do not infer the action from an unexplained hash.
    </>
  ) : (
    <>
      Wallet prompts vary. A technical message or raw bytes alone may not explain
      the action. This app’s preview is not a separate source of verification.
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
          {popups === 1 ? (
            <>Review the prompt for <em>{action}</em> before deciding. </>
          ) : (
            <>Review each prompt for <em>{action}</em> separately. A later prompt
              can request a different step. </>
          )}
          {trailing}
          {showInlineTip && (
            <>
              {" "}
              <InfoTip
                label={
                  isLedger
                    ? "About the device prompt"
                    : isMobile
                      ? "About the mobile signing prompt"
                      : "About the signing prompt"
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
        <p className="mt-2 text-text-soft">
          An in-app preview or hash is not independent verification. If you cannot
          verify the requested action, or the prompt differs, cancel.
        </p>
        {showInlineFooter && (
          <p className="mt-2 text-text-soft">{disclaimer}</p>
        )}
      </div>
    </div>
  );
}
