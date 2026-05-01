// Retail copy translators — turn on-chain enums and template names
// into language a non-technical user can read at a glance.
//
// Used by the dashboard, wallet detail, and request-detail screens.
// Keep this list in sync as new intent templates ship from the
// program; missing entries fall back to a Sentence-Cased version of
// the raw template name so nothing crashes.

import { ProposalStatus } from "@/lib/msig";

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

export function friendlyIntentLabel(template: string): string {
  if (TEMPLATE_LABELS[template]) return TEMPLATE_LABELS[template];
  return template
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}
