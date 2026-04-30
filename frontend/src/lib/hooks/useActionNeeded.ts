"use client";

// "Action needed" feed: Active proposals where the connected user is
// in the intent's approvers list and hasn't yet flipped their bit in
// the approval bitmap. This is the single most actionable signal for
// a treasury manager — "what do I need to sign right now".
//
// Combines useRecentActivity (proposals + bitmap) with useUserIntents
// (approvers list per intent). Both hooks share queryKey infrastructure
// so this is pure derivation, not extra RPC.

import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useRecentActivity } from "@/lib/hooks/useRecentActivity";
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
      if (!intent || intent.approvers.length === 0) continue;
      const myIndex = intent.approvers.indexOf(address);
      if (myIndex < 0) continue;
      const alreadyApproved = (p.approvalBitmap & (1 << myIndex)) !== 0;
      if (alreadyApproved) continue;

      // Count set bits for "N/M collected" hint.
      let collected = 0;
      let bits = p.approvalBitmap;
      while (bits) {
        collected += bits & 1;
        bits >>>= 1;
      }

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
      });
    }
    // Oldest pending first — they've waited longest, sign those first.
    out.sort((a, b) => (a.proposedAt < b.proposedAt ? -1 : 1));
    return out;
  }, [address, proposals.allRows, intents.rows]);

  const loading = proposals.loading || intents.loading;
  return { rows, loading };
}
