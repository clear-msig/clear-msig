"use client";

// "Action needed" feed: Active proposals where the connected user is
// in the intent's approvers list and hasn't yet flipped their bit in
// the approval bitmap. This is the single most actionable signal for
// a treasury manager - "what do I need to sign right now".
//
// Combines useRecentActivity (proposals + bitmap) with useUserIntents
// (approvers list per intent). Both hooks share queryKey infrastructure
// so this is pure derivation, not extra RPC.

import { useMemo } from "react";
import { useWallet } from "@/lib/wallet";
import {
  useRecentActivity,
  type RecentActivityResult,
} from "@/lib/hooks/useRecentActivity";
import { useUserIntents } from "@/lib/hooks/useUserIntents";
import { ProposalStatus } from "@/lib/msig";

export interface ActionNeededRow {
  walletPda: string;
  walletName: string;
  proposalPda: string;
  proposalIndex: bigint;
  intentIndex: number;
  proposedAt: bigint;
  intentTemplate: string;
  /// Number of approvals already collected, useful for "1/2 collected"
  /// hint rendered next to the row.
  approvalsCollected: number;
  /// Total approvers on the intent.
  approverCount: number;
  /// Base58 pubkey of the teammate who started the proposal. Renders
  /// as "started by <name>" via `proposerDisplayName`.
  proposer: string;
  /// True when the matching intent definition wasn't loaded yet
  /// (race window: a brand-new intent and its first proposal can
  /// land in the same poll cycle, and useUserIntents may not have
  /// caught the intent yet). In that case we still surface the row
  /// so the notification fires; the dashboard renders a placeholder
  /// label until the next poll fills in the real template.
  intentPending: boolean;
}

export function useActionNeeded() {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? "";

  const proposals = useRecentActivity(Number.POSITIVE_INFINITY);
  const intents = useUserIntents();

  const rows = useMemo<ActionNeededRow[]>(() => {
    if (!address) return [];

    // Index intents by (walletPda, intentIndex) for O(1) lookup.
    const intentByKey = new Map<
      string,
      {
        approvers: string[];
        template: string;
      }
    >();
    for (const it of intents.rows) {
      const key = `${it.walletPda}#${it.intentIndex}`;
      intentByKey.set(key, {
        approvers: it.approvers,
        template: it.template,
      });
    }

    const out: ActionNeededRow[] = [];
    for (const p of proposals.allRows) {
      if (p.status !== ProposalStatus.Active) continue;
      const key = `${p.walletPda}#${p.intentIndex}`;
      const intent = intentByKey.get(key);

      // Count set bits for "N/M collected" hint.
      let collected = 0;
      let bits = p.approvalBitmap;
      while (bits) {
        collected += bits & 1;
        bits >>>= 1;
      }

      if (!intent || intent.approvers.length === 0) {
        // Race: a brand-new intent + its first proposal can land in
        // the same poll window, and useUserIntents may not have the
        // intent yet. Surface the row anyway so the notification
        // fires; we can't check whether the viewer is in the
        // approvers list yet, so we show it conservatively — better
        // a one-shot "new request landed" ping than silently
        // dropping it for the full poll window. Suppress for the
        // proposer themselves (they obviously know they just made it
        // and are auto-approved on chain via the propose handler).
        if (p.proposer === address) continue;
        out.push({
          walletPda: p.walletPda,
          walletName: p.walletName,
          proposalPda: p.proposalPda,
          proposalIndex: p.proposalIndex,
          intentIndex: p.intentIndex,
          proposedAt: p.proposedAt,
          intentTemplate: "Custom",
          approvalsCollected: collected,
          approverCount: 0,
          proposer: p.proposer,
          intentPending: true,
        });
        continue;
      }

      const myIndex = intent.approvers.indexOf(address);
      if (myIndex < 0) continue;
      const alreadyApproved = (p.approvalBitmap & (1 << myIndex)) !== 0;
      if (alreadyApproved) continue;

      out.push({
        walletPda: p.walletPda,
        walletName: p.walletName,
        proposalPda: p.proposalPda,
        proposalIndex: p.proposalIndex,
        intentIndex: p.intentIndex,
        proposedAt: p.proposedAt,
        intentTemplate: intent.template,
        approvalsCollected: collected,
        approverCount: intent.approvers.length,
        proposer: p.proposer,
        intentPending: false,
      });
    }
    // Oldest pending first - they've waited longest, sign those first.
    out.sort((a, b) => (a.proposedAt < b.proposedAt ? -1 : 1));
    return out;
  }, [address, proposals.allRows, intents.rows]);

  const loading = proposals.loading || intents.loading;
  return {
    rows,
    loading,
    activity: proposals as RecentActivityResult,
  };
}
