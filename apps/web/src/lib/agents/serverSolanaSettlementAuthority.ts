import type { Connection } from "@solana/web3.js";
import { solanaAuthorityCodec as codec } from "./serverSolanaTradeAuthority";
import {
  validateExpectedAgentSettlement,
  verifyExecutedAgentSettlement,
  type ExpectedAgentSettlement,
  type ExecutedAgentSettlementAuthority,
} from "./serverSettlementProof";

/** Verifies existing executed settlement accounts. Never signs or changes chain state. */
export function createSolanaSettlementAuthorityReader(config: {
  rpc: Pick<Connection, "getGenesisHash" | "getMultipleAccountsInfoAndContext">;
  deployment: { chainGenesisHash: string; programId: string };
}) {
  const program = codec.canonicalKey(config.deployment.programId);
  const genesis = codec
    .canonicalKey(config.deployment.chainGenesisHash)
    .toBase58();
  return async (
    proposalAddress: string,
    input: ExpectedAgentSettlement,
  ): Promise<ExecutedAgentSettlementAuthority> => {
    const expected = Object.freeze({
      chainGenesisHash: input.chainGenesisHash,
      programId: input.programId,
      walletPda: input.walletPda,
      policyCommitment: input.policyCommitment,
      sessionIdHash: input.sessionIdHash,
      executionIdHash: input.executionIdHash,
      settlementArtifactHash: input.settlementArtifactHash,
      oraclePolicyHash: input.oraclePolicyHash,
      closedNotionalRaw: input.closedNotionalRaw,
      outcome: input.outcome,
      pnlAbsRaw: input.pnlAbsRaw,
      settlementSequence: input.settlementSequence,
    });
    if (
      expected.chainGenesisHash !== genesis ||
      expected.programId !== program.toBase58()
    )
      throw new Error("Untrusted settlement deployment.");
    const proposalKey = codec.canonicalKey(proposalAddress);
    validateExpectedAgentSettlement(expected, proposalAddress);
    if ((await config.rpc.getGenesisHash()) !== genesis)
      throw new Error("RPC genesis does not match the pinned chain.");
    const first = await config.rpc.getMultipleAccountsInfoAndContext(
      [proposalKey],
      { commitment: "finalized" },
    );
    codec.validSlot(first.context.slot);
    const initialBytes = codec.owned(first.value[0], program, 5000);
    const initial = codec.parseProposal(initialBytes, 14);
    const walletKey = codec.canonicalKey(expected.walletPda);
    const intentKey = codec.canonicalKey(initial.intent);
    if (initial.wallet !== expected.walletPda)
      throw new Error("Settlement proposal belongs to another wallet.");
    const snapshot = await config.rpc.getMultipleAccountsInfoAndContext(
      [proposalKey, walletKey, intentKey],
      { commitment: "finalized", minContextSlot: first.context.slot },
    );
    codec.validSlot(snapshot.context.slot);
    if (
      snapshot.context.slot < first.context.slot ||
      snapshot.value.length !== 3
    )
      throw new Error("Inconsistent finalized settlement snapshot.");
    const proposalBytes = codec.owned(snapshot.value[0], program, 5000);
    if (!proposalBytes.equals(initialBytes))
      throw new Error("Settlement proposal changed during resolution.");
    const proposal = codec.parseProposal(proposalBytes, 14);
    const { wallet, intent, approvals } = codec.verifyContext(
      proposal,
      proposalKey,
      walletKey,
      intentKey,
      program,
      snapshot.value[1],
      snapshot.value[2],
    );
    const policy = codec.policyHash(proposal.policyBytes);
    const payload = codec.hash(
      Buffer.concat([
        codec.bytes("clearsig:policy-engine:v2:payload"),
        Buffer.from([14]),
        codec.bytes("agent_trade_settlement"),
        ...[
          expected.sessionIdHash,
          expected.executionIdHash,
          expected.settlementArtifactHash,
          expected.oraclePolicyHash,
        ].map((v) => Buffer.from(v, "hex")),
        codec.uint(BigInt(expected.closedNotionalRaw), 16),
        Buffer.from([expected.outcome]),
        codec.uint(BigInt(expected.pnlAbsRaw), 16),
        codec.uint(BigInt(expected.settlementSequence), 8),
      ]),
    );
    if (
      policy !== expected.policyCommitment ||
      proposal.policyCommitment !== policy ||
      proposal.payloadHash !== payload ||
      proposal.actionId.length !== 32 ||
      !proposal.actionId.some(Boolean) ||
      proposal.nonce.length !== 32 ||
      !proposal.nonce.some(Boolean)
    )
      throw new Error("Canonical settlement payload or replay fields differ.");
    const envelope = codec.hash(
      Buffer.concat([
        codec.bytes("clearsig:policy-engine:v4"),
        Buffer.from([4, 14, 7]),
        codec.uint(proposal.index, 8),
        codec.bytes(wallet.name),
        codec.bytes(walletKey.toBuffer()),
        codec.bytes(codec.canonicalKey(proposal.proposer).toBuffer()),
        codec.bytes(proposal.actionId),
        codec.bytes(proposal.nonce),
        codec.uint(BigInt(proposal.expiresAtMs / 1000), 8),
        Buffer.from([intent.approvalThreshold]),
        Buffer.from(policy, "hex"),
        Buffer.from(payload, "hex"),
        Buffer.from(codec.hash(proposal.clearText), "hex"),
      ]),
    );
    if (proposal.envelopeHash !== envelope)
      throw new Error("Canonical v4 settlement envelope verification failed.");
    // Expiry governs execution, not later proof of an already executed settlement.
    const authority: ExecutedAgentSettlementAuthority = {
      chainGenesisHash: genesis,
      ownerProgramId: program.toBase58(),
      walletPda: expected.walletPda,
      proposalPda: proposalAddress,
      finalized: true,
      status: "executed",
      actionKind: 14,
      clearSignVersion: 4,
      approvals,
      threshold: intent.approvalThreshold,
      canonical: canonicalFields(expected),
    };
    verifyExecutedAgentSettlement(expected, authority);
    return authority;
  };
}
function canonicalFields(
  expected: ExpectedAgentSettlement,
): ExecutedAgentSettlementAuthority["canonical"] {
  const {
    chainGenesisHash: _chain,
    programId: _program,
    walletPda: _wallet,
    ...canonical
  } = expected;
  void _chain;
  void _program;
  void _wallet;
  return canonical;
}
