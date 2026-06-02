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

export interface AgentProfile {
  id: string;
  walletName: string;
  name: string;
  kind: AgentKind;
  status: AgentStatus;
  /// Optional public signing / API identity for the agent. This is
  /// not custody. It only identifies the agent that authored an intent.
  identityPubkey?: string;
  endpoint?: string;
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
  confidence: number;
  expiresAt: number;
  evaluationDecision?: AgentPolicyDecision;
  policyViolations?: AgentPolicyViolation[];
  status: AgentProposalStatus;
  createdAt: number;
  updatedAt: number;
  version: AgentVersion;
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
  status: AgentExecutionStatus;
  openedAt: number;
  closedAt?: number | null;
  realizedPnlUsd: string;
  version: AgentVersion;
}

export type AgentAuditEventKind =
  | "agent_status_changed"
  | "proposal_created"
  | "proposal_approved"
  | "proposal_rejected"
  | "proposal_rechecked"
  | "proposal_executed"
  | "execution_opened"
  | "execution_closed"
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

export interface AgentVaultPolicy {
  id: string;
  walletName: string;
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
  | "emergency_paused"
  | "agent_not_active"
  | "session_missing"
  | "session_inactive"
  | "session_expired"
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
  score: number;
  rankInputs: {
    returnScore: number;
    complianceScore: number;
    drawdownScore: number;
    executionScore: number;
    trustPenalty: number;
  };
}
