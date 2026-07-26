import { PublicKey, type Connection } from "@solana/web3.js";
import { ProposalStatus } from "@/lib/msig";
import { fetchProposal } from "@/lib/chain/proposals";

export async function waitForSolanaProposalStatus(
  connection: Connection,
  proposalPda: string,
): Promise<ProposalStatus | null> {
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(proposalPda);
  } catch {
    return null;
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const account = await fetchProposal(connection, pubkey);
      if (account) return account.status;
    } catch {
      // Fresh writes can briefly lag on public RPCs.
    }
    await new Promise((resolve) =>
      setTimeout(resolve, 500 + attempt * 250),
    );
  }
  return null;
}
export function isProposalNotApprovedError(error: unknown): boolean {
  const payload = (
    error as {
      payload?: { error?: string; stderr?: string; stdout?: string };
    }
  )?.payload;
  const parts = [
    error instanceof Error ? error.message : "",
    payload?.error,
    payload?.stderr,
    payload?.stdout,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  return (
    parts.includes("proposalnotapproved") ||
    parts.includes("proposal is not in an approved state") ||
    parts.includes("custom program error: 0x1775")
  );
}
