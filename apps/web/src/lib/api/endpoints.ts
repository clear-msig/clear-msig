// Endpoint-level service methods keep route paths out of UI components.
//
// Two kinds of write endpoints:
//   - prepare.*  . POSTs to /prepare/**, returns a DryRunDescriptor the
//                  caller feeds into `wallet.signMessage`.
//   - submit.*   . POSTs to the real route with a PreSigned payload.
//
// Reads are unchanged: GETs + the /health probe.
import { apiRequest } from "@/lib/api/client";
import { withFreshExpiry } from "@/lib/api/expiry";
import { withRetry } from "@/lib/api/retry";
import type {
  AddChainInput,
  CreateWalletInput,
  DryRunDescriptor,
  ExecuteProposalInput,
  PrepareAddIntentInput,
  PrepareApproveCancelInput,
  PrepareCreateProposalInput,
  PrepareRemoveIntentInput,
  PrepareTypedProposalCreateInput,
  PrepareUpdateIntentInput,
  SignedAddIntentInput,
  SignedApproveCancelInput,
  SignedCreateProposalInput,
  SignedRemoveIntentInput,
  SignedTypedProposalCreateInput,
  SignedUpdateIntentInput,
  TypedDryRunDescriptor,
  WalletChainsResponse
} from "@/lib/api/types";

export const backendApi = {
  health: () =>
    apiRequest<{
      status: string;
      execution_mode: string;
      execution_workers: number;
    }>("/health", "GET"),
  memberships: (address: string) =>
    apiRequest<Record<string, unknown>>(`/memberships?address=${encodeURIComponent(address)}`, "GET"),

  // Bootstrap ops (no user signature required . on-chain instructions are
  // payed for and submitted by the relayer's sponsored-gas keypair).
  // Bootstrap create-wallet is intentionally single-shot. It consumes
  // a brand-new on-chain account slot, so retrying after the first
  // submit lands can replay the same instruction against an already
  // initialized PDA and turn a partial success into a hard failure.
  createWallet: (input: CreateWalletInput) =>
    apiRequest<Record<string, unknown>, CreateWalletInput>("/wallets", "POST", input, {
      timeoutMs: 55_000,
    }),
  showWallet: (walletName: string) =>
    apiRequest<Record<string, unknown>>(`/wallets/${encodeURIComponent(walletName)}`, "GET"),
  listWalletChains: (walletName: string) =>
    apiRequest<WalletChainsResponse>(
      `/wallets/${encodeURIComponent(walletName)}/chains`,
      "GET",
    ),
  // DKG runs through Ika's pre-alpha network; the UI explicitly tells
  // the user it can take >30s, so the request must outlive that
  // window. 3 minutes gives headroom for retries.
  addWalletChain: (walletName: string, input: AddChainInput) =>
    withRetry(
      () =>
        apiRequest<Record<string, unknown>, AddChainInput>(
          `/wallets/${encodeURIComponent(walletName)}/chains/add`,
          "POST",
          input,
          { timeoutMs: 180_000 },
        ),
      // DKG is expensive to redo, so cap to a single retry with a
      // longer wait - the most common transient is the post-DKG
      // confirm being a beat behind the cluster.
      { maxAttempts: 2, delayMs: 1500 },
    ),

  // Reads.
  listIntents: (walletName: string) =>
    apiRequest<unknown[]>(`/wallets/${encodeURIComponent(walletName)}/intents`, "GET"),
  listProposals: (walletName: string) =>
    apiRequest<unknown[]>(`/wallets/${encodeURIComponent(walletName)}/proposals`, "GET"),
  showProposal: (proposalAddress: string) =>
    apiRequest<Record<string, unknown>>(`/proposals/${encodeURIComponent(proposalAddress)}`, "GET"),

  // ── Dry-run "what do I sign?" routes ──────────────────────────────────
  prepare: {
    addIntent: (walletName: string, input: PrepareAddIntentInput) =>
      apiRequest<DryRunDescriptor, PrepareAddIntentInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/intents/add`,
        "POST",
        withFreshExpiry(input),
        { timeoutMs: 55_000 },
      ),
    removeIntent: (walletName: string, input: PrepareRemoveIntentInput) =>
      apiRequest<DryRunDescriptor, PrepareRemoveIntentInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/intents/remove`,
        "POST",
        withFreshExpiry(input),
      ),
    updateIntent: (walletName: string, input: PrepareUpdateIntentInput) =>
      apiRequest<DryRunDescriptor, PrepareUpdateIntentInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/intents/update`,
        "POST",
        withFreshExpiry(input),
      ),
    createProposal: (walletName: string, input: PrepareCreateProposalInput) =>
      apiRequest<DryRunDescriptor, PrepareCreateProposalInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/proposals/create`,
        "POST",
        withFreshExpiry(input),
      ),
    createTypedProposal: (walletName: string, input: PrepareTypedProposalCreateInput) =>
      apiRequest<TypedDryRunDescriptor, PrepareTypedProposalCreateInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/proposals/typed/create`,
        "POST",
        withFreshExpiry(input),
      ),
    approveProposal: (walletName: string, proposalAddress: string, input: PrepareApproveCancelInput) =>
      apiRequest<DryRunDescriptor, PrepareApproveCancelInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/approve`,
        "POST",
        withFreshExpiry(input),
      ),
    approveTypedProposal: (walletName: string, proposalAddress: string, input: PrepareApproveCancelInput) =>
      apiRequest<TypedDryRunDescriptor, PrepareApproveCancelInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-approve`,
        "POST",
        withFreshExpiry(input),
      ),
    cancelProposal: (walletName: string, proposalAddress: string, input: PrepareApproveCancelInput) =>
      apiRequest<DryRunDescriptor, PrepareApproveCancelInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/cancel`,
        "POST",
        withFreshExpiry(input),
      ),
    cancelTypedProposal: (walletName: string, proposalAddress: string, input: PrepareApproveCancelInput) =>
      apiRequest<TypedDryRunDescriptor, PrepareApproveCancelInput>(
        `/prepare/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-cancel`,
        "POST",
        withFreshExpiry(input),
      )
  },

  // ── Signed submit routes ─────────────────────────────────────────────
  //
  // These routes consume state that can advance between prepare and
  // submit (proposal index, intent slots, etc.). They must be single-shot
  // so a transient backend failure does not resubmit a stale signature
  // against a newer on-chain slot.
  submit: {
    addIntent: (walletName: string, input: SignedAddIntentInput) =>
      apiRequest<Record<string, unknown>, SignedAddIntentInput>(
        `/wallets/${encodeURIComponent(walletName)}/intents/add`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    removeIntent: (walletName: string, input: SignedRemoveIntentInput) =>
      apiRequest<Record<string, unknown>, SignedRemoveIntentInput>(
        `/wallets/${encodeURIComponent(walletName)}/intents/remove`,
        "POST",
        input
      ),
    updateIntent: (walletName: string, input: SignedUpdateIntentInput) =>
      apiRequest<Record<string, unknown>, SignedUpdateIntentInput>(
        `/wallets/${encodeURIComponent(walletName)}/intents/update`,
        "POST",
        input
      ),
    createProposal: (walletName: string, input: SignedCreateProposalInput) =>
      apiRequest<Record<string, unknown>, SignedCreateProposalInput>(
        `/wallets/${encodeURIComponent(walletName)}/proposals`,
        "POST",
        input
      ),
    createTypedProposal: (walletName: string, input: SignedTypedProposalCreateInput) =>
      apiRequest<Record<string, unknown>, SignedTypedProposalCreateInput>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/typed`,
        "POST",
        input
      ),
    approveProposal: (walletName: string, proposalAddress: string, input: SignedApproveCancelInput) =>
      apiRequest<Record<string, unknown>, SignedApproveCancelInput>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/approve`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    approveTypedProposal: (walletName: string, proposalAddress: string, input: SignedApproveCancelInput) =>
      apiRequest<Record<string, unknown>, SignedApproveCancelInput>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-approve`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    cancelProposal: (walletName: string, proposalAddress: string, input: SignedApproveCancelInput) =>
      apiRequest<Record<string, unknown>, SignedApproveCancelInput>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/cancel`,
        "POST",
        input
      ),
    cancelTypedProposal: (walletName: string, proposalAddress: string, input: SignedApproveCancelInput) =>
      apiRequest<Record<string, unknown>, SignedApproveCancelInput>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-cancel`,
        "POST",
        input
      )
  },

  executeProposal: (walletName: string, proposalAddress: string, input: ExecuteProposalInput) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, ExecuteProposalInput>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/execute`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedProposal: (walletName: string, proposalAddress: string) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, Record<string, never>>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-execute`,
        "POST",
        {},
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedEscrowRelease: (
    walletName: string,
    proposalAddress: string,
    input: {
      recipient: string;
      amountLamports: number;
      escrowId: string;
      milestoneId: string;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-escrow-release`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedEscrowReturn: (
    walletName: string,
    proposalAddress: string,
    input: {
      escrowId: string;
      returns: Array<{ recipient: string; amountLamports: number }>;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-escrow-return`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedSplEscrowRelease: (
    walletName: string,
    proposalAddress: string,
    input: {
      mint: string;
      sourceToken: string;
      destinationToken: string;
      recipientOwner: string;
      amountTokens: number;
      escrowId: string;
      milestoneId: string;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-spl-escrow-release`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedSplEscrowReturn: (
    walletName: string,
    proposalAddress: string,
    input: {
      mint: string;
      sourceToken: string;
      escrowId: string;
      returns: Array<{
        destinationToken: string;
        funderOwner: string;
        amountTokens: number;
      }>;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-spl-escrow-return`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedCrossChainEscrowRelease: (
    walletName: string,
    proposalAddress: string,
    input: {
      chainKind: number;
      amountRaw: string;
      escrowId: string;
      milestoneId: string;
      recipientHash: string;
      assetIdHash: string;
      routeHash: string;
      settlementArtifactHash: string;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-cross-chain-escrow-release`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedCrossChainEscrowReturn: (
    walletName: string,
    proposalAddress: string,
    input: {
      chainKind: number;
      amountRaw: string;
      escrowId: string;
      refundRecipientHash: string;
      assetIdHash: string;
      routeHash: string;
      settlementArtifactHash: string;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-cross-chain-escrow-return`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedPrivateEscrowRelease: (
    walletName: string,
    proposalAddress: string,
    input: {
      amountRaw: string;
      escrowId: string;
      milestoneId: string;
      recipientHash: string;
      assetIdHash: string;
      privateEvaluationHash: string;
      settlementArtifactHash: string;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-private-escrow-release`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedPrivateEscrowReturn: (
    walletName: string,
    proposalAddress: string,
    input: {
      amountRaw: string;
      escrowId: string;
      refundRecipientHash: string;
      assetIdHash: string;
      privateEvaluationHash: string;
      settlementArtifactHash: string;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-private-escrow-return`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedRecurringSchedule: (
    walletName: string,
    proposalAddress: string,
    input: {
      scheduleId: string;
      recipient: string;
      amountLamports: number;
      intervalSeconds: number;
      firstExecutionAt: number;
      paymentCount: number;
      status: 1 | 2;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-recurring-schedule`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeRecurringPayment: (
    walletName: string,
    input: { intent: string; scheduleId: string; recipient: string },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/recurring/execute`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedSolSend: (
    walletName: string,
    proposalAddress: string,
    input: {
      recipient: string;
      amountLamports: number;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-sol-send`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedWalletPolicyUpdate: (
    walletName: string,
    proposalAddress: string,
    input: {
      policyBytesHex: string;
      chainKind: number;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-wallet-policy-update`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedIntentGovernance: (
    walletName: string,
    proposalAddress: string,
    input: {
      actionKind: number;
      targetIndex: number;
      newIntentBodyHex?: string;
      file?: string;
      proposers?: string[];
      approvers?: string[];
      threshold?: number;
      cancellationThreshold?: number;
      timelock?: number;
    } | Record<string, never> = {},
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-intent-governance`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedChainSend: (
    walletName: string,
    proposalAddress: string,
    input: {
      chainKind: number;
      amountRaw: string;
      recipientHash: string;
      assetIdHash: string;
      paramsDataHex?: string;
      dwalletProgram?: string;
      grpcUrl?: string;
      rpcUrl?: string;
      broadcast?: boolean;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-chain-send`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedSolBatchSend: (
    walletName: string,
    proposalAddress: string,
    input: {
      payments: Array<{ recipient: string; amountLamports: number }>;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-sol-batch-send`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedAgentTradeApproval: (
    walletName: string,
    proposalAddress: string,
    input: {
      amountRaw: string;
      agentIdHash: string;
      venueHash: string;
      marketHash: string;
      sideHash: string;
      assetIdHash: string;
      maxLeverageX100: number;
      sessionIdHash: string;
      routeHash: string;
      riskCheckHash: string;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-agent-trade-approval`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedAgentSessionGrant: (
    walletName: string,
    proposalAddress: string,
    input: {
      sessionIdHash: string;
      agentIdHash: string;
      venueHash: string;
      marketHash: string;
      maxNotionalRaw: string;
      maxLeverageX100: number;
      expiresAt: number;
      status: 1 | 2;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-agent-session-grant`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedAgentRiskPolicy: (
    walletName: string,
    proposalAddress: string,
    input: {
      sessionIdHash: string;
      oraclePolicyHash: string;
      maxLossRaw: string;
      status: 1 | 2;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-agent-risk-policy`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  executeTypedAgentTradeSettlement: (
    walletName: string,
    proposalAddress: string,
    input: {
      sessionIdHash: string;
      executionIdHash: string;
      settlementArtifactHash: string;
      oraclePolicyHash: string;
      closedNotionalRaw: string;
      outcome: 1 | 2 | 3;
      pnlAbsRaw: string;
      settlementSequence: number;
    },
  ) =>
    withRetry(() =>
      apiRequest<Record<string, unknown>, typeof input>(
        `/wallets/${encodeURIComponent(walletName)}/proposals/${encodeURIComponent(proposalAddress)}/typed-agent-trade-settlement`,
        "POST",
        input,
        { timeoutMs: 55_000 },
      ),
    ),

  cleanupProposal: (proposalAddress: string) =>
    apiRequest<Record<string, unknown>, Record<string, never>>(
      `/proposals/${encodeURIComponent(proposalAddress)}/cleanup`,
      "POST",
      {}
    )
};
