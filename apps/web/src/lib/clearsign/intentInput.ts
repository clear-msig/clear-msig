export type ClearSignActionKind =
  | "send"
  | "batch_send"
  | "add_member"
  | "remove_member"
  | "change_threshold"
  | "set_protection"
  | "release_milestone"
  | "return_escrow_funds"
  | "agent_trade_approval"
  | "recovery_action"
  | "swap_intent"
  | "agent_session_grant"
  | "agent_risk_policy"
  | "agent_trade_settlement"
  | "recurring_schedule";

export type ClearSignNetwork =
  | "Solana devnet"
  | "Ethereum Sepolia"
  | "Bitcoin testnet"
  | "Bitcoin signet"
  | "Bitcoin testnet4"
  | "Zcash testnet"
  | "Hyperliquid testnet";

/**
 * Untrusted browser input to canonical v4 preparation. The backend replaces
 * wallet, proposal, actor, threshold, policy, and execution context with
 * current onchain state before producing signable bytes.
 */
export interface ClearSignIntentInput<TPayload extends ClearSignPayload> {
  kind: ClearSignActionKind;
  network: ClearSignNetwork;
  walletName: string;
  walletId?: string;
  actionId: string;
  nonce: string;
  expiresAt: number;
  policyCommitment?: string;
  payload: TPayload;
}

export type ClearSignPayload =
  | SendPayload
  | BatchSendPayload
  | MemberPayload
  | ThresholdPayload
  | ProtectionPayload
  | MilestonePayload
  | EscrowReturnPayload
  | AgentTradePayload
  | AgentSessionGrantPayload
  | AgentRiskPolicyPayload
  | AgentTradeSettlementPayload
  | RecurringSchedulePayload
  | RecoveryPayload
  | SwapPayload;

export interface MoneyAmount {
  /** Human decimal amount. Never pass base units in this field. */
  amount: string;
  /** Native ticker or executable token identifier. */
  asset: string;
  assetEncoding?: "text" | "solana_pubkey" | "sha256_text";
  decimals?: number;
  displayAsset?: string;
}

export interface RecipientAmount extends MoneyAmount {
  recipient: string;
  recipientEncoding?: "text" | "solana_pubkey" | "sha256_text";
}

export interface SendPayload extends RecipientAmount {
  note?: string;
  /** Signed review context; excluded from executable payload authorization. */
  fiatEstimate?: FiatEstimateInput;
}

export interface FiatEstimateInput {
  amount: string;
  currency: "USD";
  source: string;
  observedAt: number;
  informationalOnly: true;
}

export interface BatchSendPayload {
  recipients: RecipientAmount[];
  note?: string;
}

export interface MemberPayload {
  member: string;
  role: string;
  targetIntentIndex: number;
  proposers: string[];
  approvers: string[];
  approvalThreshold: number;
  cancellationThreshold: number;
  timelockSeconds: number;
  reason?: string;
}

export interface ThresholdPayload {
  approvalsRequired: number;
  targetIntentIndex: number;
  proposers: string[];
  approvers: string[];
  cancellationThreshold: number;
  timelockSeconds: number;
  reason?: string;
}

export interface ProtectionPayload {
  summary: string;
  policyCommitment?: string;
  chainKind?: number;
}

export interface MilestonePayload extends RecipientAmount {
  escrowId?: string;
  escrowTitle: string;
  milestoneId?: string;
  milestoneTitle: string;
  execution?: EscrowExecutionBinding;
  reason?: string;
}

export interface EscrowReturnPayload {
  escrowId?: string;
  escrowTitle: string;
  returns: RecipientAmount[];
  execution?: EscrowExecutionBinding;
  reason?: string;
}

export type EscrowExecutionBinding =
  | {
      mode: "spl";
      mint: string;
      sourceToken: string;
      destinationToken?: string;
      recipientOwner?: string;
      tokenReturns?: Array<{ destinationToken: string; funderOwner: string }>;
    }
  | {
      mode: "cross_chain";
      routeHash: string;
      settlementArtifactHash: string;
    }
  | {
      mode: "private";
      privateEvaluationHash: string;
      settlementArtifactHash: string;
    };

export interface AgentTradePayload {
  agentId?: string;
  venue?: string;
  market: string;
  side: "long" | "short";
  maxNotionalUsd: string;
  maxLeverage: string;
  stopLossRequired: boolean;
  assetId?: string;
  sessionId?: string;
  route?: string;
  riskCheckHash?: string;
  reason?: string;
}

export interface AgentSessionGrantPayload {
  sessionId: string;
  agentId: string;
  venue: string;
  market: string;
  maxNotionalUsd: string;
  maxLeverage: string;
  expiresAt: number;
  status: "active" | "revoked";
  reason?: string;
}

export interface AgentRiskPolicyPayload {
  sessionId: string;
  oraclePolicyHash: string;
  maxLossRaw: string;
  status: "active" | "paused";
  reason?: string;
}

export interface AgentTradeSettlementPayload {
  sessionId: string;
  executionId: string;
  settlementArtifactHash: string;
  oraclePolicyHash: string;
  closedNotionalRaw: string;
  outcome: "profit" | "loss" | "flat";
  pnlAbsRaw: string;
  settlementSequence: number;
  reason?: string;
}

export interface RecurringSchedulePayload extends RecipientAmount {
  scheduleId: string;
  intervalSeconds: number;
  firstExecutionAt: number;
  paymentCount: number;
  status: "active" | "revoked";
  reason?: string;
}

export interface RecoveryPayload {
  recoveryAction: string;
}

export interface SwapPayload {
  from: MoneyAmount;
  toAsset: string;
  minReceive: string;
}
