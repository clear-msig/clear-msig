import type { EncryptedPayload } from "@/lib/encrypt/client";
export type AgentVersion = 1;

export type AgentKind =
  | "manual"
  | "api"
  | "hermes"
  | "mock";

export type AgentStatus =
  | "active"
  | "paused"
  | "revoked";

export type TradingVenue =
  | "mock_perps"
  | "hyperliquid_testnet"
  | "bulktrade_mock";

export type TradeSide = "long" | "short";

export type TradeOrderType = "market" | "limit";

export type AgentTradeDecisionEvidenceKind =
  | "market_data"
  | "technical"
  | "fundamental"
  | "news"
  | "macro"
  | "strategy"
  | "risk";

export interface AgentTradeDecisionEvidence {
  id: string;
  kind: AgentTradeDecisionEvidenceKind;
  label: string;
  summary: string;
  source?: string;
  observedAt?: number;
}

export interface AgentTradeDecisionJournal {
  summary: string;
  entryReason: string;
  technicalSummary?: string;
  fundamentalSummary?: string;
  newsSummary?: string;
  riskPlan: string;
  exitPlan: string;
  invalidation: string;
  policySummary: string;
  confidenceRationale: string;
  evidence: AgentTradeDecisionEvidence[];
  createdAt: number;
  version: AgentVersion;
}

export type AgentTradingMode =
  | "read_only"
  | "paper"
  | "bounded_live";

export interface AgentStrategyProfile {
  mode: AgentTradingMode;
  summary?: string;
  allowedMarkets: string[];
  entryRules: string;
  exitRules: string;
  riskRules: string;
  executionProtocol: string;
  killSwitchRules: string;
  updatedAt: number;
}

export type AgentPublishingStatus = "draft" | "published";
export type AgentModerationStatus =
  | "pending_review"
  | "approved"
  | "paused"
  | "delisted";

export interface AgentPublishingModeration {
  status: AgentModerationStatus;
  reason?: string;
  reviewedBy?: string;
  reviewedAt?: number;
  updatedAt: number;
  version: AgentVersion;
}

export interface AgentPublishingProfile {
  status: AgentPublishingStatus;
  slug: string;
  publicSummary: string;
  moderation?: AgentPublishingModeration;
  visibleMetrics: Array<
    | "score"
    | "realized_pnl"
    | "closed_trades"
    | "open_trades"
    | "win_rate"
    | "safety_stops"
    | "allocation_tier"
  >;
  publishedAt?: number;
  updatedAt: number;
  version: AgentVersion;
}

export type AgentProposalStatus =
  | "draft"
  | "blocked"
  | "needs_approval"
  | "approved"
  | "rejected"
  | "executed"
  | "expired";

export type AgentExecutionStatus =
  | "open"
  | "closed";

export type AgentExecutionMode = "paper" | "testnet";
export type AgentAllocationTierId = "probation" | "trusted" | "proven";
export type AgentTrackRecordSource = "paper" | "testnet" | "verified_live";

export type AgentPostTradeOutcome = "win" | "loss" | "flat";
export type AgentTradeThesisVerdict =
  | "confirmed"
  | "invalidated"
  | "inconclusive";

export interface AgentPostTradeReview {
  outcome: AgentPostTradeOutcome;
  thesisVerdict: AgentTradeThesisVerdict;
  summary: string;
  lesson: string;
  riskReview: string;
  realizedPnlUsd: string;
  reviewedAt: number;
  version: AgentVersion;
}

export type AgentExecutionAdapterStatus =
  | "ready"
  | "backend_required";

export type AgentOwnerActionKind =
  | "grant_allowance"
  | "start_automatic_trading"
  | "submit_venue_trade"
  | "pause_agent"
  | "pause_all_trading"
  | "close_practice_trade"
  | "close_all_practice_trades";

export type AgentOwnerApprovalMethod =
  | "browser_confirm"
  | "wallet_signature";

export interface AgentOwnerApprovalDetail {
  label: string;
  value: string;
}

export interface AgentOwnerApproval {
  id: string;
  walletName: string;
  agentId?: string;
  action: AgentOwnerActionKind;
  summary: string;
  details: AgentOwnerApprovalDetail[];
  targetType?: "agent" | "session" | "proposal" | "execution" | "policy" | "venue";
  targetId?: string;
  approvalMethod: AgentOwnerApprovalMethod;
  approvedBy?: string | null;
  signature?: string | null;
  approvalHash: string;
  createdAt: number;
  version: AgentVersion;
}

export interface AgentProfile {
  id: string;
  walletName: string;
  name: string;
  kind: AgentKind;
  status: AgentStatus;
  /// Set only for prepared ClearSig traders chosen from the Trader Library.
  libraryTraderId?: string;
  /// Optional public signing / API identity for the agent. This is
  /// not custody. It only identifies the agent that authored an intent.
  identityPubkey?: string;
  endpoint?: string;
  publishing?: AgentPublishingProfile;
  description?: string;
  strategy?: AgentStrategyProfile;
  encryptedDescription?: EncryptedPayload;
  createdAt: number;
  updatedAt: number;
  version: AgentVersion;
}

export interface AgentTradeProposal {
  id: string;
  walletName: string;
  agentId: string;
  /** On-chain bounded session selected for this trade. */
  sessionId?: string;
  venue: TradingVenue;
  market: string;
  side: TradeSide;
  orderType: TradeOrderType;
  /// Decimal USD string to avoid floating point drift in persistence.
  notionalUsd: string;
  leverage: number;
  entryPrice?: string | null;
  stopLossPrice?: string | null;
  takeProfitPrice?: string | null;
  thesis?: string;
  encryptedThesis?: EncryptedPayload;
  decisionJournal?: AgentTradeDecisionJournal;
  confidence: number;
  clientSignalId?: string;
  expiresAt: number;
  evaluationDecision?: AgentPolicyDecision;
  policyViolations?: AgentPolicyViolation[];
  /// SHA-256 commitment to the vault policy used when this signal was
  /// evaluated. Future Solana/Ika grants can bind execution to this digest.
  policyHash?: string;
  /// ClearSign binding prepared when the proposal is created. The persisted
  /// property name is retained for compatibility with existing local records.
  clearSignV2?: AgentTradeClearSignSnapshot;
  status: AgentProposalStatus;
  createdAt: number;
  updatedAt: number;
  version: AgentVersion;
}

export interface AgentTradeClearSignSnapshot {
  /** Present only after trusted backend v4 preparation and proposal creation. */
  clearSignVersion?: 4;
  actionId: string;
  nonce: string;
  expiresAt: number;
  walletId: string;
  policyCommitment: string;
  payloadHash?: string;
  envelopeHash?: string;
  signableText?: string;
  onchainProposal?: {
    proposalAddress: string;
    proposalIndex: number;
    intentIndex: number;
    status: "created" | "approved" | "executed";
    createdAt: number;
    executedAt?: number;
    txid?: string;
  };
  payload: {
    agentId: string;
    venue: string;
    market: string;
    side: TradeSide;
    maxNotionalUsd: string;
    maxLeverage: string;
    stopLossRequired: boolean;
    assetId: string;
    sessionId: string;
    route: string;
    riskCheckHash: string;
  };
  executor: {
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
  };
}

export interface AgentExecutionRecord {
  id: string;
  walletName: string;
  proposalId: string;
  agentId: string;
  venue: TradingVenue;
  market: string;
  side: TradeSide;
  orderType: TradeOrderType;
  notionalUsd: string;
  leverage: number;
  entryPrice?: string | null;
  executionMode?: AgentExecutionMode;
  adapterStatus?: AgentExecutionAdapterStatus;
  externalOrderId?: string | null;
  policyHash?: string;
  postTradeReview?: AgentPostTradeReview;
  status: AgentExecutionStatus;
  openedAt: number;
  closedAt?: number | null;
  realizedPnlUsd: string;
  version: AgentVersion;
}

export type AgentAuditEventKind =
  | "agent_status_changed"
  | "agent_profile_published"
  | "agent_profile_unpublished"
  | "agent_profile_moderated"
  | "connection_key_rotated"
  | "owner_action_approved"
  | "policy_emergency_pause_changed"
  | "proposal_created"
  | "proposal_approved"
  | "proposal_rejected"
  | "proposal_rechecked"
  | "proposal_executed"
  | "execution_opened"
  | "execution_closed"
  | "execution_bulk_closed"
  | "session_status_changed"
  | "session_renewed";

export interface AgentAuditEvent {
  id: string;
  walletName: string;
  agentId?: string;
  proposalId?: string;
  executionId?: string;
  kind: AgentAuditEventKind;
  message: string;
  createdAt: number;
  version: AgentVersion;
}

export interface AgentConnectionKit {
  walletName: string;
  agentId: string;
  signalKey: string;
  managementKey: string;
  autoImportSessionSignals: boolean;
  createdAt: number;
  updatedAt: number;
  version: AgentVersion;
}

export interface AgentSignalInboxItem {
  id: string;
  walletName: string;
  agentId: string;
  payload: {
    clientSignalId?: string;
    submittedAt?: number;
    venue: TradingVenue;
    market: string;
    side: TradeSide;
    orderType?: TradeOrderType;
    notionalUsd: string;
    leverage: number;
    entryPrice?: string | null;
    stopLossPrice?: string | null;
    takeProfitPrice?: string | null;
    confidence?: number;
    expiresInMinutes?: number;
    thesis?: string;
    technicalSummary?: string;
    fundamentalSummary?: string;
    newsSummary?: string;
    riskPlan?: string;
    exitPlan?: string;
    invalidation?: string;
  };
  receivedAt: number;
  version: AgentVersion;
}

export interface AgentVaultPolicy {
  id: string;
  walletName: string;
  /// Stable SHA-256 commitment to the plaintext policy controls. This is
  /// deliberately kept alongside encrypted policy fields so authority grants
  /// can prove which private rule set they were bound to.
  policyHash?: string;
  enabled: boolean;
  emergencyPaused: boolean;
  allowedVenues: TradingVenue[];
  encryptedAllowedVenues?: EncryptedPayload;
  allowedMarkets: string[];
  encryptedAllowedMarkets?: EncryptedPayload;
  maxNotionalUsd: string;
  encryptedMaxNotionalUsd?: EncryptedPayload;
  maxLeverage: number;
  encryptedMaxLeverage?: EncryptedPayload;
  requireStopLoss: boolean;
  encryptedRequireStopLoss?: EncryptedPayload;
  requireTakeProfit: boolean;
  encryptedRequireTakeProfit?: EncryptedPayload;
  maxOpenPositionsPerAgent: number;
  encryptedMaxOpenPositionsPerAgent?: EncryptedPayload;
  cooldownSeconds: number;
  encryptedCooldownSeconds?: EncryptedPayload;
  maxSessionHours: number;
  encryptedMaxSessionHours?: EncryptedPayload;
  dailyLossCapUsd: string;
  encryptedDailyLossCapUsd?: EncryptedPayload;
  createdAt: number;
  updatedAt: number;
  version: AgentVersion;
}

export interface AgentSessionGrant {
  id: string;
  walletName: string;
  agentId: string;
  status: "active" | "paused" | "expired" | "revoked";
  startsAt: number;
  expiresAt: number;
  allowedVenues?: TradingVenue[];
  allowedMarkets?: string[];
  maxNotionalUsd?: string;
  maxLeverage?: number;
  maxOpenPositions?: number;
  /// Human-approved leaderboard allocation tier used to prefill this grant.
  allocationTierId?: AgentAllocationTierId;
  /// Policy hash the session was issued under.
  policyHash?: string;
  onchain?: {
    proposalAddress: string;
    proposalIndex: number;
    intentIndex: number;
    operation: "active" | "revoked";
    status: "created" | "approved" | "executed";
    txid?: string;
    updatedAt: number;
  };
  riskOnchain?: {
    proposalAddress: string;
    proposalIndex: number;
    intentIndex: number;
    policyHash: string;
    operation: "active" | "paused";
    status: "created" | "approved" | "executed";
    txid?: string;
    updatedAt: number;
  };
  createdAt: number;
  updatedAt: number;
  version: AgentVersion;
}

export interface AgentRiskSnapshot {
  openPositions: number;
  lastTradeAt?: number | null;
  realizedPnlUsd?: string;
  dailyRealizedPnlUsd?: string;
  maxDrawdownPct?: number;
}

export type AgentPolicyDecision =
  | "blocked"
  | "requires_human_approval"
  | "allowed";

export type AgentPolicyViolationCode =
  | "policy_disabled"
  | "policy_incomplete"
  | "emergency_paused"
  | "agent_not_active"
  | "session_missing"
  | "session_inactive"
  | "session_expired"
  | "session_policy_stale"
  | "venue_not_allowed"
  | "market_not_allowed"
  | "invalid_notional"
  | "notional_too_large"
  | "invalid_leverage"
  | "leverage_too_high"
  | "stop_loss_required"
  | "take_profit_required"
  | "too_many_open_positions"
  | "cooldown_active"
  | "daily_loss_cap_reached"
  | "proposal_expired"
  | "strategy_missing"
  | "strategy_mode_read_only"
  | "strategy_market_not_allowed"
  | "strategy_venue_not_allowed";

export interface AgentPolicyViolation {
  code: AgentPolicyViolationCode;
  message: string;
  severity: "block" | "approval";
}

export interface AgentPolicyEvaluation {
  decision: AgentPolicyDecision;
  violations: AgentPolicyViolation[];
  normalized: {
    market: string;
    notionalUsd: number;
    leverage: number;
    venue: TradingVenue;
  };
}

export interface AgentScorecard {
  walletName: string;
  agentId: string;
  proposals: number;
  approved: number;
  rejected: number;
  blocked: number;
  executed: number;
  ruleViolations: number;
  realizedPnlUsd: string;
  maxDrawdownPct: number;
  humanOverrideCount: number;
  updatedAt: number;
  version: AgentVersion;
}

export interface AgentLeaderboardEntry {
  agentId: string;
  walletName: string;
  trackRecordSource?: AgentTrackRecordSource;
  score: number;
  rankInputs: {
    returnScore: number;
    complianceScore: number;
    drawdownScore: number;
    executionScore: number;
    trustPenalty: number;
  };
}

export type AgentReadinessStatus = "ready" | "needs_setup" | "blocked";

export type AgentReadinessItemStatus = "pass" | "todo" | "block";

export type AgentReadinessAction =
  | "none"
  | "risk_limits"
  | "strategy"
  | "session"
  | "agent";

export interface AgentReadinessItem {
  id: string;
  label: string;
  status: AgentReadinessItemStatus;
  message: string;
  action: AgentReadinessAction;
}

export interface AgentTradingReadiness {
  agentId: string;
  status: AgentReadinessStatus;
  headline: string;
  summary: string;
  score: number;
  primaryAction: AgentReadinessAction;
  items: AgentReadinessItem[];
}
