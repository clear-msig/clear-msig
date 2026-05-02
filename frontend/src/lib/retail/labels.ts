// Retail copy translators — turn on-chain enums and template names
// into language a non-technical user can read at a glance.
//
// Used by the dashboard, wallet detail, and request-detail screens.
// Keep this list in sync as new intent templates ship from the
// program; missing entries fall back to a Sentence-Cased version of
// the raw template name so nothing crashes.

import { ProposalStatus } from "@/lib/msig";
import type { IntentAccount } from "@/lib/msig/accounts";

/// chain_kind values from the on-chain enum (programs/clear-wallet).
/// Keep in sync if the program ever shuffles these.
const CHAIN_KIND = {
  Solana: 0,
  EvmNative: 1,
  Bitcoin: 2,
  ZcashTransparent: 3,
  EvmErc20: 4,
} as const;

const CHAIN_LABEL: Record<number, string> = {
  [CHAIN_KIND.Solana]: "Send SOL",
  [CHAIN_KIND.EvmNative]: "Send ETH",
  [CHAIN_KIND.Bitcoin]: "Send BTC",
  [CHAIN_KIND.ZcashTransparent]: "Send ZEC",
  [CHAIN_KIND.EvmErc20]: "Send ERC-20 token",
};

export type ProposalStatusLike = ProposalStatus | number;

// Template families that mutate the wallet's rules rather than move
// money. For these, "Executed" should read as "Done" — saying "Sent"
// next to "Set up a spending rule" makes users think they just lost
// SOL. We branch on template name to keep the per-status word right.
const META_TEMPLATES = new Set([
  "AddIntent",
  "RemoveIntent",
  "UpdateIntent",
  "UpdateApprovers",
  "UpdateThreshold",
  "Cleanup",
]);

export function friendlyStatus(
  s: ProposalStatusLike,
  intentTemplate?: string,
): string {
  const isMeta =
    typeof intentTemplate === "string" && META_TEMPLATES.has(intentTemplate);
  switch (s) {
    case ProposalStatus.Active:
      return "Waiting for approval";
    case ProposalStatus.Approved:
      return isMeta ? "Ready" : "Ready to send";
    case ProposalStatus.Executed:
      return isMeta ? "Done" : "Sent";
    case ProposalStatus.Cancelled:
      return "Cancelled";
    default:
      return String(s);
  }
}

const TEMPLATE_LABELS: Record<string, string> = {
  SolTransfer: "Send money",
  TokenTransfer: "Send a token",
  AddIntent: "Set up a spending rule",
  UpdateApprovers: "Change who can approve",
  UpdateThreshold: "Change how many approvals are needed",
  Cleanup: "Clean up an old rule",
};

/// Best-effort label for an intent. Prefer chainKind (it's the
/// canonical "what kind of rule is this") over the template string,
/// which is the literal interpolation pattern with `{0}`/`{1}`
/// placeholders that should never reach a user.
///
/// Falls through to template-name heuristics for the named templates
/// in `TEMPLATE_LABELS` (covers meta-intents and pre-chainKind data).
export function friendlyIntentLabel(intent: IntentAccount | string): string {
  // 1. Object form: prefer chainKind. It's the canonical "what kind
  //    of rule is this", and the template field is full of `{0}`
  //    placeholders we never want a user to see.
  if (typeof intent !== "string") {
    const chainLabel = CHAIN_LABEL[intent.chainKind];
    if (chainLabel) return chainLabel;
    const t = intent.template?.trim() ?? "";
    return labelFromString(t);
  }
  // 2. String form (legacy callers passing intentTemplate from
  //    aggregated proposal lists). Same fallback ladder minus the
  //    chain-kind hint.
  return labelFromString(intent);
}

function labelFromString(t: string): string {
  if (!t) return "Send";
  if (TEMPLATE_LABELS[t]) return TEMPLATE_LABELS[t];
  // Strip every interpolation placeholder before display so no
  // `{0}` / `{1}` / `{2:10^9}` ever reaches a user.
  const cleaned = t.replace(/\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
  return cleaned ? sentenceCase(cleaned) : "Send";
}

function sentenceCase(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
