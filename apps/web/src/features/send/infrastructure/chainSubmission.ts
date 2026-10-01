import { solanaSubmissionTxid } from "@/lib/chain/executionEvidence";
/** Broadcast identifiers are submission evidence, never destination finality. */
export function verifyChainSubmission(response: Record<string, unknown>, proposal: string, chainKind: number): void {
  solanaSubmissionTxid(response, { proposal, path: "ika-dwallet" });
  const broadcast = response.broadcast as { chain_kind?: unknown; tx_id?: unknown } | undefined;
  if (response.chain_kind !== chainKind || broadcast?.chain_kind !== chainKind || typeof broadcast.tx_id !== "string" ||
      !([1, 4, 5].includes(chainKind) ? /^0x[0-9a-fA-F]{64}$/ : /^[0-9a-fA-F]{64}$/).test(broadcast.tx_id)) {
    throw new Error("Destination submission evidence is missing or mismatched. Keep the existing request; confirmation is unverified.");
  }
}
