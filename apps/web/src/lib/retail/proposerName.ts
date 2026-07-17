// Resolve a proposer's base58 pubkey to a human-readable label for
// the "started by X" line in pending-approval notifications and the
// dashboard action-needed row.
//
// Lookup order:
//   1. The user's contacts (HMAC-protected entries in localStorage).
//   2. Short address fallback (`AbCd…wXyZ`).
//
// Returns "you" when the proposer matches `viewerAddress` — surfaces
// the rare case where a wallet's own pending row is shown to the
// proposer themselves (e.g. they aren't in the approvers list but
// can see the proposal exists). The action-needed feed normally
// filters out the viewer's own approvals, so this case shouldn't
// arise from the dashboard, but cheap to handle.

import { findByAddress, shortAddress } from "@/lib/retail/contacts";

export function proposerDisplayName(
  proposerAddress: string,
  viewerAddress: string,
): string {
  if (!proposerAddress) return "a teammate";
  if (viewerAddress && proposerAddress === viewerAddress) return "you";
  const contact = findByAddress(proposerAddress);
  if (contact && contact.name.trim().length > 0) return contact.name.trim();
  return shortAddress(proposerAddress);
}
