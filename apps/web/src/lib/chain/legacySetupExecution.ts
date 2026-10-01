import { assertPinnedSolanaNetwork, PinnedNetworkError } from "./pinnedNetwork";
import { PublicKey, type Connection, type AccountInfo } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";
import { requestRecovery } from "@/lib/clearsign/requestRecovery";
import { savedProposalError } from "@/lib/clearsign/inlineApproval";
import { parseIntent, parseProposal } from "@/lib/msig/accounts";
import { findIntentAddress, findProposalAddress } from "@/lib/msig/pda";
import { fromHex } from "@/lib/msig/hash";
import { ProposalStatus } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "./client";
import { solanaSubmissionTxid } from "./executionEvidence";

type SetupExecution = {
  connection: Connection;
  walletName: string;
  walletAddress: PublicKey;
  accountKey: string;
  proposal: string;
  paramsDataHex: string;
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
/** execute_add_intent copies proposal.params_data into the new account after its discriminator. */
function setupDefinition(input: SetupExecution) {
  const params = fromHex(input.paramsDataHex);
  const bytes = new Uint8Array(params.length + 1);
  bytes[0] = 2;
  bytes.set(params, 1);
  const intent = parseIntent(bytes);
  const [address, bump] = findIntentAddress(
    input.walletAddress,
    intent.intentIndex,
    CLEAR_WALLET_PROGRAM_ID,
  );
  if (
    intent.wallet !== input.walletAddress.toBase58() ||
    intent.bump !== bump ||
    intent.intentIndex < 1 ||
    intent.intentType !== 3 ||
    bytes[37] !== 1
  )
    throw new Error(
      "Setup definition does not identify an approved canonical installed intent.",
    );
  return { params, bytes, address };
}
/** Read-only proof: exact proposal binding plus actual installed definition, both finalized. */
export async function legacySetupIsFinalized(
  input: SetupExecution,
): Promise<boolean> {
  await assertPinnedSolanaNetwork(input.connection);
  const expected = setupDefinition(input);
  const proposalAddress = new PublicKey(input.proposal);
  const [governing] = findIntentAddress(
    input.walletAddress,
    0,
    CLEAR_WALLET_PROGRAM_ID,
  );
  const snapshot = await input.connection.getMultipleAccountsInfoAndContext(
    [proposalAddress, expected.address],
    { commitment: "finalized" },
  );
  await assertPinnedSolanaNetwork(input.connection);
  const proposalBytes = owned(snapshot.value[0] ?? null),
    installed = owned(snapshot.value[1] ?? null);
  if (!proposalBytes || !installed) return false;
  const proposal = parseProposal(proposalBytes);
  const [canonical, bump] = findProposalAddress(
    governing,
    proposal.proposalIndex,
    CLEAR_WALLET_PROGRAM_ID,
  );
  if (
    !canonical.equals(proposalAddress) ||
    proposal.bump !== bump ||
    proposal.wallet !== input.walletAddress.toBase58() ||
    proposal.intent !== governing.toBase58() ||
    proposal.status !== ProposalStatus.Executed ||
    proposal.paramsData.length !== expected.params.length ||
    !proposal.paramsData.every((byte, i) => byte === expected.params[i])
  )
    return false;
  const parsed = parseIntent(installed);
  if (
    parsed.wallet !== input.walletAddress.toBase58() ||
    !parsed.approved ||
    installed.length < expected.bytes.length
  )
    return false;
  // active_proposal_count is mutable usage metadata, not the installed definition.
  return expected.bytes.every(
    (byte, i) => i === 52 || i === 53 || byte === installed[i],
  );
}
/** Never report ready from an HTTP response or txid; unknown writes retain a durable lock. */
export async function executeAndVerifyLegacySetup(
  input: SetupExecution,
): Promise<void> {
  setupDefinition(input);
  await assertPinnedSolanaNetwork(input.connection);
  input.assertCurrent();
  const verified = async () => {
    input.assertCurrent();
    try {
      return await legacySetupIsFinalized(input);
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
        "Setup execution was already attempted. Installation is not yet verified at finalized commitment. Check this request; do not execute it again.",
      ),
    );
  const attempt = requestRecovery.begin({
    walletName: input.walletName,
    endpoint: input.connection.rpcEndpoint,
    accountKey: input.accountKey,
    label: "Chain setup execution",
    phase: "execution",
    identity: ["execute", input.proposal],
  });
  let txid: string | undefined;
  try {
    input.assertCurrent();
    await assertPinnedSolanaNetwork(input.connection);
    input.assertCurrent();
    attempt.submitting(input.proposal);
    const response = await backendApi.executeProposal(
      input.walletName,
      input.proposal,
      {},
      { retry: false },
    );
    txid = solanaSubmissionTxid(response, {
      proposal: input.proposal,
      path: "meta-intent",
    });
    attempt.accepted(input.proposal, txid);
    for (let i = 0; i < 6; i += 1) {
      if (await verified()) {
        input.assertCurrent();
        attempt.complete();
        return;
      }
      if (i < 5) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      "Submission recorded; installed setup is not yet verified at finalized commitment.",
    );
  } catch (cause) {
    const detail =
      cause instanceof Error
        ? cause.message
        : "Execution response could not be verified.";
    throw savedProposalError(
      input.proposal,
      new Error(
        `${txid ? "Setup verification pending" : "Setup execution outcome unknown"}. ${detail} Do not submit another setup request.`,
      ),
    );
  } finally {
    attempt.finish();
  }
}
