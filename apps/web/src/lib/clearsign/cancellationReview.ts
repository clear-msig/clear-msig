import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import {
  findWalletAddress,
  findIntentAddress,
  findProposalAddress,
  findTypedProposalAddress,
} from "@/lib/msig/pda";
import {
  parseAnyProposal,
  parseIntent,
  parseWallet,
  type AnyProposalAccount,
  type IntentAccount,
  type WalletAccount,
} from "@/lib/msig/accounts";
import { sha256, toHex, fromHex } from "@/lib/msig/hash";
import type { DryRunDescriptor, TypedDryRunDescriptor } from "@/lib/api/types";
import { verifiedTypedClearSignMessageBytes } from "./typedMessage";

export interface CancellationContext {
  proposal: AnyProposalAccount;
  intent: IntentAccount;
  address: string;
  walletName: string;
  fingerprint: string;
}

/** Cancellation does not authorize execution and must remain available for
 * requests whose action document is not supported by the approval reviewer.
 * Bind the observed network even on older deployments without a configured pin.
 */
export async function readOwnedProposalContext(
  connection: Connection,
  address: string,
  walletName?: string,
  options: { program?: PublicKey; expectedGenesis?: string } = {},
): Promise<(CancellationContext & { wallet: WalletAccount }) | null> {
  const program = options.program ?? CLEAR_WALLET_PROGRAM_ID;
  const genesis = await connection.getGenesisHash();
  const pin =
    options.expectedGenesis ??
    process.env.NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH?.trim();
  if (pin && genesis !== pin)
    throw new Error("RPC network differs from the pinned deployment.");
  const key = new PublicKey(address);
  const owned = (info: AccountInfo<Buffer> | null, max: number) => {
    if (
      !info ||
      !info.owner.equals(program) ||
      info.executable ||
      info.data.length > max
    )
      throw new Error("Request account ownership or size mismatch.");
    return new Uint8Array(info.data);
  };
  const first = await connection.getAccountInfoAndContext(key, {
    commitment: "finalized",
  });
  if (!first.value) return null;
  const firstBytes = owned(first.value, 5000);
  const initial = parseAnyProposal(firstBytes);
  const walletKey = new PublicKey(initial.wallet),
    intentKey = new PublicKey(initial.intent);
  const snapshot = await connection.getMultipleAccountsInfoAndContext(
    [key, walletKey, intentKey],
    { commitment: "finalized", minContextSlot: first.context.slot },
  );
  if (snapshot.context.slot < first.context.slot || snapshot.value.length !== 3)
    throw new Error("Inconsistent request snapshot.");
  const proposalBytes = owned(snapshot.value[0], 5000),
    walletBytes = owned(snapshot.value[1], 512),
    intentBytes = owned(snapshot.value[2], 65536);
  if (toHex(firstBytes) !== toHex(proposalBytes))
    throw new Error("Request changed while loading its verified context.");
  const proposal = parseAnyProposal(proposalBytes),
    wallet = parseWallet(walletBytes),
    intent = parseIntent(intentBytes);
  const [walletPda, wb] = findWalletAddress(
    wallet.name,
    new PublicKey(wallet.creator),
    program,
  );
  const [intentPda, ib] = findIntentAddress(
    walletKey,
    intent.intentIndex,
    program,
  );
  const [proposalPda, pb] = (
    proposal.typed ? findTypedProposalAddress : findProposalAddress
  )(intentKey, proposal.proposalIndex, program);
  if (
    (walletName !== undefined && wallet.name !== walletName) ||
    !walletPda.equals(walletKey) ||
    wb !== wallet.bump ||
    !intentPda.equals(intentKey) ||
    ib !== intent.bump ||
    !proposalPda.equals(key) ||
    pb !== proposal.bump ||
    intent.wallet !== initial.wallet ||
    ![0, 1].includes(intentBytes[37])
  )
    throw new Error("Request account PDA or authority identity is invalid.");
  const fingerprint = toHex(
    sha256(
      new TextEncoder().encode(
        [
          connection.rpcEndpoint,
          genesis,
          program.toBase58(),
          address,
          toHex(proposalBytes),
          toHex(walletBytes),
          toHex(intentBytes),
        ].join("\n"),
      ),
    ),
  );
  return {
    proposal,
    intent,
    wallet,
    address,
    walletName: wallet.name,
    fingerprint,
  };
}

export async function readCancellationContext(
  connection: Connection,
  address: string,
  walletName: string,
  options: { program?: PublicKey; expectedGenesis?: string } = {},
): Promise<CancellationContext> {
  const context = await readOwnedProposalContext(
    connection,
    address,
    walletName,
    options,
  );
  if (!context) throw new Error("Request account is missing.");
  const { proposal, intent } = context;
  if (
    !intent.approved ||
    !intent.proposers.includes(proposal.proposer) ||
    ![0, 1].includes(proposal.status) ||
    intent.approvers.length < 1 ||
    intent.approvers.length > 16 ||
    new Set(intent.approvers).size !== intent.approvers.length ||
    intent.cancellationThreshold < 1 ||
    intent.cancellationThreshold > intent.approvers.length ||
    proposal.cancellationBitmap >>> intent.approvers.length !== 0
  )
    throw new Error(
      "Cancellation authority is invalid or the request is no longer active.",
    );
  return context;
}

export function bindCancellationDescriptor(
  context: CancellationContext,
  descriptor: DryRunDescriptor | TypedDryRunDescriptor,
  signer: string,
  now = Date.now(),
): void {
  const { proposal, intent } = context;
  const member = intent.approvers.indexOf(signer);
  if (
    member < 0 ||
    (proposal.cancellationBitmap & (1 << member)) !== 0 ||
    descriptor.action !==
      (proposal.typed ? "proposal_typed_cancel" : "proposal_cancel") ||
    descriptor.wallet_name !== context.walletName ||
    descriptor.wallet_pubkey !== proposal.wallet ||
    descriptor.intent_pubkey !== proposal.intent ||
    descriptor.intent_index !== intent.intentIndex ||
    descriptor.proposal_pubkey !== context.address ||
    !Number.isSafeInteger(descriptor.proposal_index) ||
    BigInt(descriptor.proposal_index!) !== proposal.proposalIndex ||
    !Number.isSafeInteger(descriptor.expiry) ||
    descriptor.expiry <= Math.floor(now / 1000) + 15
  )
    throw new Error(
      "Prepared cancellation differs from this request or signing authority.",
    );
  if (!proposal.typed) {
    const legacy = descriptor as DryRunDescriptor;
    if (legacy.params_data_hex !== toHex(proposal.paramsData))
      throw new Error(
        "Prepared cancellation parameters differ from the stored request.",
      );
    return;
  }
  const typed = descriptor as TypedDryRunDescriptor;
  const count = proposal.cancellationBitmap
    .toString(2)
    .replaceAll("0", "").length;
  if (
    typed.signer_pubkey !== signer ||
    typed.approval_kind !== "cancellations" ||
    typed.approval_requirement !== intent.cancellationThreshold ||
    typed.approval_count_after !== count + 1 ||
    typed.action_kind !== proposal.actionKind ||
    typed.policy_commitment_hex !== proposal.policyCommitment ||
    typed.payload_hash_hex !== proposal.payloadHash ||
    typed.envelope_hash_hex !== proposal.envelopeHash ||
    typed.action_id !== proposal.actionId ||
    typed.nonce !== proposal.nonce ||
    BigInt(typed.expiry) !== proposal.expiresAt
  )
    throw new Error(
      "Prepared cancellation changed the request commitment or cancellation quorum.",
    );
  verifiedTypedClearSignMessageBytes(typed);
  if (proposal.clearTextHex) {
    const document = new TextDecoder("utf-8", { fatal: true }).decode(
      fromHex(proposal.clearTextHex),
    );
    const message = new TextDecoder("utf-8", { fatal: true }).decode(
      fromHex(typed.message_hex),
    );
    if (typed.message_flavor === "clearsign_v2_text") {
      const prefix = `ClearSign v2 cancel\nWallet ${context.walletName}\nProposal ${proposal.proposalIndex}\nEnvelope ${proposal.envelopeHash}\n\n`;
      if (message !== prefix + document)
        throw new Error("Prepared cancellation changed the stored document.");
    } else if (
      message.slice(0, message.lastIndexOf("\n\nAPPROVAL\n")) !== document
    )
      throw new Error("Prepared cancellation changed the stored document.");
  }
}
