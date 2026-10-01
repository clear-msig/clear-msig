import { assertPinnedSolanaNetwork, PinnedNetworkError } from "./pinnedNetwork";
import { PublicKey, type Connection, type AccountInfo } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";
import { requestRecovery } from "@/lib/clearsign/requestRecovery";
import { savedProposalError } from "@/lib/clearsign/inlineApproval";
import { parseIntent, parseTypedProposal } from "@/lib/msig/accounts";
import { findIntentAddress, findTypedProposalAddress } from "@/lib/msig/pda";
import { fromHex } from "@/lib/msig/hash";
import { ProposalStatus } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "./client";
import { solanaSubmissionTxid } from "./executionEvidence";
export type GovernanceExecution = {
  connection: Connection;
  walletName: string;
  walletId: string;
  accountKey: string;
  proposal: string;
  voteIntentIndex: number;
  targetIntentIndex: number;
  newIntentBodyHex: string;
  actionKind: number;
  policyCommitment: string;
  payloadHash: string;
  envelopeHash: string;
  policyBytesHex: string;
  assertCurrent: () => void;
};
function owned(info: AccountInfo<Buffer> | null): Uint8Array | null {
  if (
    !info ||
    info.executable ||
    !info.owner.equals(CLEAR_WALLET_PROGRAM_ID) ||
    info.data.length > 65536
  )
    return null;
  return new Uint8Array(info.data);
}
function targetDefinition(input: GovernanceExecution) {
  const body = fromHex(input.newIntentBodyHex),
    bytes = new Uint8Array(body.length + 1);
  bytes[0] = 2;
  bytes.set(body, 1);
  const target = parseIntent(bytes),
    wallet = new PublicKey(input.walletId);
  const [address, bump] = findIntentAddress(
    wallet,
    input.targetIntentIndex,
    CLEAR_WALLET_PROGRAM_ID,
  );
  if (
    ![3, 4, 5].includes(input.actionKind) ||
    target.wallet !== input.walletId ||
    target.intentIndex !== input.targetIntentIndex ||
    target.bump !== bump ||
    bytes[37] !== 1
  )
    throw new Error(
      "Governance replacement does not match the reviewed canonical target.",
    );
  return { bytes, address, wallet };
}
export async function typedGovernanceIsFinalized(
  input: GovernanceExecution,
): Promise<boolean> {
  await assertPinnedSolanaNetwork(input.connection);
  const expected = targetDefinition(input),
    address = new PublicKey(input.proposal);
  const [vote] = findIntentAddress(
    expected.wallet,
    input.voteIntentIndex,
    CLEAR_WALLET_PROGRAM_ID,
  );
  const snapshot = await input.connection.getMultipleAccountsInfoAndContext(
    [address, expected.address],
    { commitment: "finalized" },
  );
  await assertPinnedSolanaNetwork(input.connection);
  const proposalBytes = owned(snapshot.value[0] ?? null),
    targetBytes = owned(snapshot.value[1] ?? null);
  if (!proposalBytes || !targetBytes) return false;
  const proposal = parseTypedProposal(proposalBytes);
  const [canonical, bump] = findTypedProposalAddress(
    vote,
    proposal.proposalIndex,
    CLEAR_WALLET_PROGRAM_ID,
  );
  if (
    !canonical.equals(address) ||
    proposal.bump !== bump ||
    proposal.wallet !== input.walletId ||
    proposal.intent !== vote.toBase58() ||
    proposal.status !== ProposalStatus.Executed ||
    proposal.actionKind !== input.actionKind ||
    proposal.policyCommitment !== input.policyCommitment ||
    proposal.payloadHash !== input.payloadHash ||
    proposal.envelopeHash !== input.envelopeHash ||
    proposal.policyBytesHex !== input.policyBytesHex
  )
    return false;
  parseIntent(targetBytes);
  return (
    targetBytes.length >= expected.bytes.length &&
    expected.bytes.every(
      (byte, i) => i === 52 || i === 53 || byte === targetBytes[i],
    )
  );
}
/** Read finalized chain state; a submission signature is never authority-change completion. */
export async function executeAndVerifyTypedGovernance(
  input: GovernanceExecution,
): Promise<void> {
  targetDefinition(input);
  await assertPinnedSolanaNetwork(input.connection);
  input.assertCurrent();
  const verified = async () => {
    input.assertCurrent();
    try {
      return await typedGovernanceIsFinalized(input);
    } catch (error) {
      if (error instanceof PinnedNetworkError) throw error;
      return false;
    }
  };
  if (await verified()) {
    input.assertCurrent();
    requestRecovery.resolveExecution(
      input.connection.rpcEndpoint,
      input.proposal,
    );
    return;
  }
  if (
    requestRecovery.executionFor(input.connection.rpcEndpoint, input.proposal)
  )
    throw savedProposalError(
      input.proposal,
      new Error(
        "Governance execution was already attempted. Check the existing request's finalized state before any further action.",
      ),
    );
  const execution = requestRecovery.begin({
    walletName: input.walletName,
    endpoint: input.connection.rpcEndpoint,
    accountKey: input.accountKey,
    label: "Wallet authority execution",
    phase: "execution",
    identity: ["execute", input.proposal],
  });
  let txid: string | undefined;
  try {
    input.assertCurrent();
    await assertPinnedSolanaNetwork(input.connection);
    input.assertCurrent();
    execution.submitting(input.proposal);
    const result = await backendApi.executeTypedIntentGovernance(
      input.walletName,
      input.proposal,
      {
        actionKind: input.actionKind,
        targetIndex: input.targetIntentIndex,
        newIntentBodyHex: input.newIntentBodyHex,
      },
      { retry: false },
    );
    txid = solanaSubmissionTxid(result, {
      proposal: input.proposal,
      path: "typed_intent_governance",
      requireProposal: true,
    });
    if (result.action_kind !== input.actionKind)
      throw new Error("Execution response changed the governance action.");
    execution.accepted(input.proposal, txid);
    for (let i = 0; i < 6; i += 1) {
      if (await verified()) {
        input.assertCurrent();
        execution.complete();
        return;
      }
      if (i < 5) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      "Finalized proposal and exact target authority change are not yet verified.",
    );
  } catch (cause) {
    const detail =
      cause instanceof Error
        ? cause.message
        : "Execution response unavailable.";
    throw savedProposalError(
      input.proposal,
      new Error(
        `${txid ? "Governance verification pending" : "Governance execution outcome unknown"}. ${detail}`,
      ),
    );
  } finally {
    execution.finish();
  }
}
/** Independently compare requested authority to the backend's compiled replacement before signing. */
export function assertGovernanceReplacement(
  input: {
    walletId: string;
    targetIntentIndex: number;
    proposers: string[];
    approvers: string[];
    approvalThreshold: number;
    cancellationThreshold: number;
    timelockSeconds: number;
  },
  paramsDataHex: string,
): void {
  const params = fromHex(paramsDataHex);
  if (params[0] !== input.targetIntentIndex)
    throw new Error("Governance preparation changed the target intent.");
  const definition = new Uint8Array(params.length);
  definition[0] = 2;
  definition.set(params.subarray(1), 1);
  const body = parseIntent(definition);
  const [, bump] = findIntentAddress(
    new PublicKey(input.walletId),
    input.targetIntentIndex,
    CLEAR_WALLET_PROGRAM_ID,
  );
  if (
    body.wallet !== input.walletId ||
    body.intentIndex !== input.targetIntentIndex ||
    body.bump !== bump ||
    definition[37] !== 1 ||
    JSON.stringify(body.proposers) !== JSON.stringify(input.proposers) ||
    JSON.stringify(body.approvers) !== JSON.stringify(input.approvers) ||
    body.approvalThreshold !== input.approvalThreshold ||
    body.cancellationThreshold !== input.cancellationThreshold ||
    body.timelockSeconds !== input.timelockSeconds
  )
    throw new Error(
      "Governance preparation changed the reviewed authority settings.",
    );
}
