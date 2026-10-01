import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import {
  findWalletAddress,
  findIntentAddress,
  findTypedProposalAddress,
} from "@/lib/msig/pda";
import {
  parseAnyProposal,
  parseIntent,
  parseWallet,
} from "@/lib/msig/accounts";
import { sha256, toHex } from "@/lib/msig/hash";
import { verifyCanonicalProposalReview } from "./proposalReview";

export async function readCanonicalProposalReview(
  connection: Connection,
  address: string,
  walletName: string,
  options: { program?: PublicKey; expectedGenesis?: string } = {},
) {
  const program = options.program ?? CLEAR_WALLET_PROGRAM_ID;
  const expected =
    options.expectedGenesis ??
    process.env.NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH?.trim();
  if (!expected)
    throw new Error(
      "Canonical review requires the deployment's expected Solana genesis identity. Approval is blocked until configured.",
    );
  const genesis = await connection.getGenesisHash();
  if (genesis !== expected)
    throw new Error("RPC network differs from the pinned deployment.");
  const key = new PublicKey(address);
  const first = await connection.getAccountInfoAndContext(key, {
    commitment: "finalized",
  });
  const owned = (info: AccountInfo<Buffer> | null, max: number) => {
    if (
      !info ||
      !info.owner.equals(program) ||
      info.executable ||
      info.data.length > max
    )
      throw new Error("Canonical review account ownership or size mismatch.");
    return new Uint8Array(info.data);
  };
  const initialBytes = owned(first.value, 5000),
    initial = parseAnyProposal(initialBytes);
  if (!initial.typed)
    throw new Error(
      "Legacy request lacks a supported canonical action document. Approval is blocked; cancellation remains available.",
    );
  const walletKey = new PublicKey(initial.wallet),
    intentKey = new PublicKey(initial.intent);
  const snapshot = await connection.getMultipleAccountsInfoAndContext(
    [key, walletKey, intentKey],
    { commitment: "finalized", minContextSlot: first.context.slot },
  );
  if (snapshot.context.slot < first.context.slot || snapshot.value.length !== 3)
    throw new Error("Inconsistent finalized review snapshot.");
  const proposalBytes = owned(snapshot.value[0], 5000);
  if (toHex(proposalBytes) !== toHex(initialBytes))
    throw new Error("Request changed while loading. Refresh and review again.");
  const intentBytes = owned(snapshot.value[2], 65536);
  if (intentBytes[37] !== 1)
    throw new Error("Intent authority is not approved.");
  const proposal = parseAnyProposal(proposalBytes),
    wallet = parseWallet(owned(snapshot.value[1], 512)),
    intent = parseIntent(intentBytes);
  if (!proposal.typed) throw new Error("Typed request required.");
  const [walletPda, wb] = findWalletAddress(
      wallet.name,
      new PublicKey(wallet.creator),
      program,
    ),
    [intentPda, ib] = findIntentAddress(walletKey, intent.intentIndex, program),
    [proposalPda, pb] = findTypedProposalAddress(
      intentKey,
      proposal.proposalIndex,
      program,
    );
  if (
    wallet.name !== walletName ||
    !walletPda.equals(walletKey) ||
    wallet.bump !== wb ||
    !intentPda.equals(intentKey) ||
    intent.bump !== ib ||
    !proposalPda.equals(key) ||
    proposal.bump !== pb ||
    !intent.proposers.includes(proposal.proposer)
  )
    throw new Error("Canonical proposal/wallet/intent identity mismatch.");
  const review = verifyCanonicalProposalReview(
    proposal,
    intent,
    wallet.name,
    address,
  );
  return Object.freeze({
    ...review,
    reviewId: toHex(
      sha256(
        new TextEncoder().encode(
          `${genesis}\n${program.toBase58()}\n${review.reviewId}`,
        ),
      ),
    ),
    status: proposal.status,
    timelockSeconds: intent.timelockSeconds,
  });
}
