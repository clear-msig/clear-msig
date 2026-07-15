import { formatTimestamp } from "@/lib/msig/datetime";
import { fromHex, sha256, toHex } from "@/lib/msig/hash";
import bs58 from "bs58";
import {
  resolveClearSignDeviceProfile,
  type ClearSignDeviceProfile,
  type ClearSignDeviceProfileRequest,
} from "@/lib/clearsign/deviceProfiles";

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
  | "agent_trade_settlement";

export type ClearSignNetwork =
  | "Solana devnet"
  | "Ethereum Sepolia"
  | "Bitcoin testnet"
  | "Bitcoin signet"
  | "Bitcoin testnet4"
  | "Zcash testnet"
  | "Hyperliquid testnet";

export interface ClearSignEnvelope<TPayload extends ClearSignPayload> {
  version: 3;
  kind: ClearSignActionKind;
  network: ClearSignNetwork;
  walletName: string;
  walletId?: string;
  actionId: string;
  nonce: string;
  expiresAt: number;
  policyCommitment: string;
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
  | RecoveryPayload
  | SwapPayload;

export interface MoneyAmount {
  /** Human decimal amount. Never pass wei, satoshis, zatoshis, or token base units. */
  amount: string;
  /** Executable asset identity (ticker for native assets, contract for ERC-20). */
  asset: string;
  assetEncoding?: "text" | "sha256_text";
  /** Required for assets whose precision cannot be inferred from the ticker. */
  decimals?: number;
  /** Human label when `asset` is an executable identifier such as a contract. */
  displayAsset?: string;
}

export interface RecipientAmount extends MoneyAmount {
  recipient: string;
  recipientEncoding?: "text" | "solana_pubkey" | "sha256_text";
}

export interface SendPayload extends RecipientAmount {
  note?: string;
  /** Live USD snapshot shown to the signer; informational, not an oracle assertion. */
  estimatedUsd?: string;
}

export interface BatchSendPayload {
  recipients: RecipientAmount[];
}

export interface MemberPayload {
  member: string;
  role: string;
  /** Target Custom intent index being rewritten. */
  targetIntentIndex: number;
  /** Final proposer set after the change (base58). */
  proposers: string[];
  /** Final approver set after the change (base58). */
  approvers: string[];
  approvalThreshold: number;
  cancellationThreshold: number;
  timelockSeconds: number;
}

export interface ThresholdPayload {
  approvalsRequired: number;
  targetIntentIndex: number;
  proposers: string[];
  approvers: string[];
  cancellationThreshold: number;
  timelockSeconds: number;
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
}

export interface EscrowReturnPayload {
  escrowId?: string;
  escrowTitle: string;
  returns: RecipientAmount[];
}

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
}

export interface AgentRiskPolicyPayload {
  sessionId: string;
  oraclePolicyHash: string;
  maxLossRaw: string;
  status: "active" | "paused";
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
}

export interface RecoveryPayload {
  recoveryAction: string;
}

export interface SwapPayload {
  from: MoneyAmount;
  toAsset: string;
  minReceive: string;
}

export interface ClearSignSummary {
  headline: string;
  lines: string[];
  payloadHash: string;
  envelopeHash: string;
  signableText: string;
  deviceProfile: ClearSignDeviceProfile;
}

const enc = new TextEncoder();
const CLEARSIGN_V3_VERSION = 3;
const CLEARSIGN_V3_DOMAIN = "clearsig:policy-engine:v3";
// V3 deliberately preserves the deployed payload canonicalization. Execution
// adapters already recompute this hash onchain; the v3 envelope domain and
// document hash provide protocol separation without invalidating that safety
// boundary or legacy v2 proposals.
const CLEARSIGN_PAYLOAD_DOMAIN = "clearsig:policy-engine:v2:payload";

export type ClearSignVoteKind = "propose" | "approve" | "cancel";

export function summarizeClearSignAction(
  envelope: ClearSignEnvelope<ClearSignPayload>,
  profileRequest?: ClearSignDeviceProfileRequest,
): ClearSignSummary {
  const deviceProfile = resolveClearSignDeviceProfile(profileRequest);
  const payloadHash = clearSignPayloadHash(envelope);
  const lines = actionLines(envelope).map(normalizeText);
  const signableText = clearSignDocument(
    envelope,
    lines,
    payloadHash,
    deviceProfile,
  );
  const envelopeHash = clearSignEnvelopeHash(envelope, signableText);
  return {
    headline: lines[0] ?? "Review ClearSig action",
    lines,
    payloadHash,
    envelopeHash,
    signableText,
    deviceProfile,
  };
}

export function clearSignPayloadHash(
  envelope: ClearSignEnvelope<ClearSignPayload>,
): string {
  return toHex(sha256(canonicalPayloadBytes(envelope.kind, envelope.payload)));
}

export function clearSignEnvelopeHash(
  envelope: ClearSignEnvelope<ClearSignPayload>,
  signableText = summarizeSignableText(envelope),
): string {
  const payloadHash = fromHex(clearSignPayloadHash(envelope));
  const out = new ByteWriter();
  out.pushBytes(CLEARSIGN_V3_DOMAIN);
  out.pushU8(CLEARSIGN_V3_VERSION);
  out.pushU8(clearSignActionKindCode(envelope.kind));
  out.pushI64(BigInt(normalizeNumber(envelope.expiresAt)));
  out.pushBytes(normalizeText(envelope.walletName));
  out.pushBytes(canonicalAddressOrText(normalizeOptional(envelope.walletId)));
  out.pushBytes(sha256(enc.encode(normalizeText(envelope.actionId))));
  out.pushBytes(sha256(enc.encode(normalizeText(envelope.nonce))));
  out.pushRaw(fromHex(normalizeHash(envelope.policyCommitment)));
  out.pushRaw(payloadHash);
  out.pushRaw(sha256(enc.encode(signableText)));
  return toHex(sha256(out.bytes()));
}

function summarizeSignableText(envelope: ClearSignEnvelope<ClearSignPayload>): string {
  const payloadHash = clearSignPayloadHash(envelope);
  return clearSignDocument(
    envelope,
    actionLines(envelope),
    payloadHash,
    resolveClearSignDeviceProfile(),
  );
}

export function clearSignVoteMessage(input: {
  voteKind: ClearSignVoteKind;
  walletName: string;
  signerPubkey: string;
  proposalIndex: number | bigint;
  envelopeHash: string;
  signableText: string;
  expiresAt: number | bigint;
  approvalsRequired: number;
  approvalsAfter: number;
}): Uint8Array {
  const approvalsRequired = normalizeApprovalCount(
    input.approvalsRequired,
    "approvalsRequired",
  );
  const approvalsAfter = normalizeApprovalCount(
    input.approvalsAfter,
    "approvalsAfter",
  );
  if (approvalsRequired === 0 || approvalsAfter > approvalsRequired) {
    throw new Error("ClearSign approval counts are invalid.");
  }
  const requirement = approvalRequirementLabel(
    input.voteKind,
    approvalsRequired,
  );
  return enc.encode(
    [
      input.signableText,
      "",
      "APPROVAL",
      `Decision: ${voteDecision(input.voteKind)}`,
      `Proposal: #${BigInt(input.proposalIndex).toString()}`,
      `Wallet: ${normalizeText(input.walletName)}`,
      `Requested by: ${normalizeText(input.signerPubkey)}`,
      `Requirement: ${approvalsRequired} ${requirement}`,
      `Status if accepted: ${approvalsAfter} of ${approvalsRequired} ${requirement}`,
      "",
      "EXPIRY",
      `${formatTimestamp(input.expiresAt)} UTC`,
      "",
      "PROOF",
      "ClearSign: v3",
      `Envelope: ${normalizeHash(input.envelopeHash)}`,
    ].join("\n"),
  );
}

function normalizeApprovalCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 16) {
    throw new Error(`ClearSign ${field} must be an integer from 0 to 16.`);
  }
  return value;
}

function approvalRequirementLabel(
  voteKind: ClearSignVoteKind,
  required: number,
): string {
  if (voteKind === "cancel") {
    return required === 1 ? "cancellation" : "cancellations";
  }
  return required === 1 ? "approval" : "approvals";
}

function clearSignDocument(
  envelope: ClearSignEnvelope<ClearSignPayload>,
  action: string[],
  payloadHash: string,
  profile: ClearSignDeviceProfile,
): string {
  const details = documentDetails(envelope, action, payloadHash, profile);
  const policy =
    profile.mode === "compact"
      ? [
          "Approval and timelock: enforced onchain",
          `Policy: ${shortHash(envelope.policyCommitment)}`,
          "Execution: exact payload must match",
          `Display profile: ${profile.id}@${profile.version}`,
        ]
      : [
          "Approval: Wallet's onchain threshold must be met",
          "Execution: Onchain policy and timelock must pass",
          `Commitment: ${shortHash(envelope.policyCommitment)}`,
          "Enforcement: Exact payload and policy must match onchain",
          `Display profile: ${profile.id}@${profile.version}`,
        ];
  const document = [
    "ClearSig Proposal",
    "",
    "ACTION",
    action[0] ?? "Review ClearSig action",
    "",
    "DETAILS",
    ...details,
    "",
    "POLICY",
    ...policy,
    "",
    "RISK",
    `Category: ${riskCategory(envelope.kind)}`,
    `Signer check: ${riskCheck(envelope.kind)}`,
    "",
    "PURPOSE",
    purposeFor(envelope),
  ].join("\n");
  if (enc.encode(document).length > profile.maxDocumentBytes) {
    throw new Error(
      `ClearSign document exceeds the ${profile.maxDocumentBytes}-byte limit for profile ${profile.id}.`,
    );
  }
  return document;
}

function documentDetails(
  envelope: ClearSignEnvelope<ClearSignPayload>,
  action: string[],
  payloadHash: string,
  profile: ClearSignDeviceProfile,
): string[] {
  const details = [
    `${profile.mode === "compact" ? "Wallet" : "From wallet"}: ${normalizeText(envelope.walletName)}`,
    `Network: ${normalizeText(envelope.network)}`,
  ];
  if (envelope.kind === "send") {
    const payload = envelope.payload as SendPayload;
    details.push(`Amount: ${formatMoney(payload)}`);
    details.push(`To: ${normalizeText(payload.recipient)}`);
    const estimatedUsd = normalizeOptional(payload.estimatedUsd);
    if (estimatedUsd && profile.mode === "full") {
      details.push(`Estimated value: $${normalizeDecimal(estimatedUsd)} USD (informational)`);
    }
    details.push(`Payload: ${shortHash(payloadHash)}`);
    return details;
  }
  const secondary = action.slice(1).filter(
    (line) =>
      line !== "Requires wallet approval" &&
      !line.startsWith("Reason:") &&
      !line.startsWith("Estimated value at review:"),
  );
  return [...details, ...secondary, `Payload: ${shortHash(payloadHash)}`];
}

function purposeFor(envelope: ClearSignEnvelope<ClearSignPayload>): string {
  return (
    normalizeOptional((envelope.payload as ClearSignPayload & { note?: string }).note) ||
    "Not provided"
  );
}

function riskCategory(kind: ClearSignActionKind): string {
  switch (kind) {
    case "send":
    case "release_milestone":
    case "return_escrow_funds":
    case "swap_intent":
      return "Funds movement";
    case "batch_send":
      return "Multiple funds movements";
    case "add_member":
    case "remove_member":
    case "change_threshold":
      return "Authorization change";
    case "set_protection":
      return "Policy change";
    case "recovery_action":
      return "Recovery authority";
    case "agent_session_grant":
    case "agent_risk_policy":
      return "Agent authority";
    case "agent_trade_approval":
    case "agent_trade_settlement":
      return "Agent execution";
  }
}

function riskCheck(kind: ClearSignActionKind): string {
  switch (kind) {
    case "send":
    case "batch_send":
    case "release_milestone":
    case "return_escrow_funds":
      return "Verify amount, asset, network, and every destination";
    case "swap_intent":
      return "Verify network, assets, and minimum received";
    case "add_member":
    case "remove_member":
    case "change_threshold":
      return "Verify the resulting signer authority";
    case "set_protection":
      return "Verify the complete replacement policy";
    case "recovery_action":
      return "Verify the recovery target and authority";
    case "agent_trade_approval":
    case "agent_session_grant":
    case "agent_risk_policy":
    case "agent_trade_settlement":
      return "Verify agent scope, limits, and execution evidence";
  }
}

function voteDecision(kind: ClearSignVoteKind): string {
  switch (kind) {
    case "propose":
      return "PROPOSE";
    case "approve":
      return "APPROVE";
    case "cancel":
      return "CANCEL";
  }
}

function shortHash(value: string): string {
  const hash = normalizeHash(value);
  return `${hash.slice(0, 12)}...${hash.slice(-12)}`;
}

export function clearSignActionKindCode(kind: ClearSignActionKind): number {
  switch (kind) {
    case "send":
      return 1;
    case "batch_send":
      return 2;
    case "add_member":
      return 3;
    case "remove_member":
      return 4;
    case "change_threshold":
      return 5;
    case "set_protection":
      return 6;
    case "release_milestone":
      return 7;
    case "return_escrow_funds":
      return 8;
    case "agent_trade_approval":
      return 9;
    case "recovery_action":
      return 10;
    case "swap_intent":
      return 11;
    case "agent_session_grant":
      return 12;
    case "agent_risk_policy":
      return 13;
    case "agent_trade_settlement":
      return 14;
  }
}

function actionLines(envelope: ClearSignEnvelope<ClearSignPayload>): string[] {
  const wallet = normalizeText(envelope.walletName);
  switch (envelope.kind) {
    case "send": {
      const payload = envelope.payload as SendPayload;
      const lines = [
        `Send ${formatMoney(payload)} from ${wallet} to ${normalizeText(payload.recipient)}`,
        "Requires wallet approval",
      ];
      const note = normalizeText(payload.note ?? "");
      if (note) lines.push(`Reason: ${note}`);
      const estimatedUsd = normalizeOptional(payload.estimatedUsd);
      if (estimatedUsd) {
        lines.push(`Estimated value at review: $${normalizeDecimal(estimatedUsd)} USD (informational)`);
      }
      return lines;
    }
    case "batch_send": {
      const payload = envelope.payload as BatchSendPayload;
      return [
        `Send ${payload.recipients.length} payments from ${wallet}`,
        ...payload.recipients.map(
          (row) => `${normalizeText(row.recipient)} receives ${formatMoney(row)}`,
        ),
        "Requires wallet approval",
      ];
    }
    case "add_member": {
      const payload = envelope.payload as MemberPayload;
      return [`Add ${payload.member} as ${payload.role} to ${wallet}`];
    }
    case "remove_member": {
      const payload = envelope.payload as MemberPayload;
      return [`Remove ${payload.member} from ${wallet}`];
    }
    case "change_threshold": {
      const payload = envelope.payload as ThresholdPayload;
      return [
        `Require ${payload.approvalsRequired} approval${payload.approvalsRequired === 1 ? "" : "s"} for ${wallet}`,
      ];
    }
    case "set_protection": {
      const payload = envelope.payload as ProtectionPayload;
      return [`Set protection for ${wallet}`, payload.summary];
    }
    case "release_milestone": {
      const payload = envelope.payload as MilestonePayload;
      return [
        `Release ${formatMoney(payload)} from ${wallet}`,
        `${payload.recipient} receives funds for ${payload.milestoneTitle}`,
        `Escrow ${payload.escrowTitle}`,
      ];
    }
    case "return_escrow_funds": {
      const payload = envelope.payload as EscrowReturnPayload;
      return [
        `Return remaining escrow funds from ${wallet}`,
        ...payload.returns.map(
          (row) => `${row.recipient} receives ${formatMoney(row)}`,
        ),
        "Requires wallet approval",
      ];
    }
    case "agent_trade_approval": {
      const payload = envelope.payload as AgentTradePayload;
      return [
        `Approve ${payload.market} ${payload.side} up to $${payload.maxNotionalUsd}`,
        `Max leverage ${payload.maxLeverage}`,
        payload.stopLossRequired ? "Stop loss required" : "Stop loss not required",
      ];
    }
    case "agent_session_grant": {
      const payload = envelope.payload as AgentSessionGrantPayload;
      return [
        `${payload.status === "revoked" ? "Revoke" : "Grant"} agent session for ${payload.agentId}`,
        `${payload.market} on ${payload.venue} up to $${payload.maxNotionalUsd}`,
        `Max leverage ${payload.maxLeverage}`,
      ];
    }
    case "agent_risk_policy": {
      const payload = envelope.payload as AgentRiskPolicyPayload;
      return [
        `${payload.status === "paused" ? "Pause" : "Set"} agent risk policy for ${payload.sessionId}`,
        `Maximum realized loss ${payload.maxLossRaw} raw units`,
        `Oracle policy ${payload.oraclePolicyHash}`,
      ];
    }
    case "agent_trade_settlement": {
      const payload = envelope.payload as AgentTradeSettlementPayload;
      return [
        `Settle agent execution ${payload.executionId}`,
        `Close ${payload.closedNotionalRaw} raw notional as ${payload.outcome}`,
        `Absolute P/L ${payload.pnlAbsRaw} raw units, sequence ${payload.settlementSequence}`,
        `Settlement artifact ${payload.settlementArtifactHash}`,
      ];
    }
    case "recovery_action": {
      const payload = envelope.payload as RecoveryPayload;
      return [`Approve recovery for ${wallet}`, payload.recoveryAction];
    }
    case "swap_intent": {
      const payload = envelope.payload as SwapPayload;
      return [
        `Swap ${formatMoney(payload.from)} from ${wallet}`,
        `Receive at least ${payload.minReceive} ${payload.toAsset}`,
        "Requires wallet approval",
      ];
    }
    default: {
      const exhaustive: never = envelope.kind;
      return [`Review unsupported action ${exhaustive}`];
    }
  }
}

function normalizePayload(
  kind: ClearSignActionKind,
  payload: ClearSignPayload,
): unknown {
  switch (kind) {
    case "send":
      return normalizeRecipientAmount(payload as SendPayload);
    case "batch_send":
      return {
        recipients: (payload as BatchSendPayload).recipients.map(
          normalizeRecipientAmount,
        ),
      };
    case "add_member":
    case "remove_member": {
      const row = payload as MemberPayload;
      return {
        member: normalizeText(row.member),
        role: normalizeText(row.role),
      };
    }
    case "change_threshold":
      return {
        approvalsRequired: normalizeNumber(
          (payload as ThresholdPayload).approvalsRequired,
        ),
      };
    case "set_protection":
      return {
        summary: normalizeText((payload as ProtectionPayload).summary),
        policyCommitment: normalizeOptional(
          (payload as ProtectionPayload).policyCommitment,
        ),
        chainKind: normalizeOptionalNumber(
          (payload as ProtectionPayload).chainKind,
        ),
      };
    case "release_milestone": {
      const row = payload as MilestonePayload;
      return {
        ...normalizeRecipientAmount(row),
        escrowId: normalizeText(row.escrowId ?? ""),
        escrowTitle: normalizeText(row.escrowTitle),
        milestoneId: normalizeText(row.milestoneId ?? ""),
        milestoneTitle: normalizeText(row.milestoneTitle),
      };
    }
    case "return_escrow_funds": {
      const row = payload as EscrowReturnPayload;
      return {
        escrowId: normalizeText(row.escrowId ?? ""),
        escrowTitle: normalizeText(row.escrowTitle),
        returns: row.returns.map(normalizeRecipientAmount),
      };
    }
    case "agent_trade_approval": {
      const row = payload as AgentTradePayload;
      return {
        agentId: normalizeText(row.agentId ?? ""),
        venue: normalizeText(row.venue ?? ""),
        market: normalizeText(row.market).toUpperCase(),
        side: row.side,
        maxNotionalUsd: normalizeDecimal(row.maxNotionalUsd),
        maxLeverage: normalizeText(row.maxLeverage).toLowerCase(),
        stopLossRequired: Boolean(row.stopLossRequired),
        assetId: normalizeText(row.assetId ?? ""),
        sessionId: normalizeText(row.sessionId ?? ""),
        route: normalizeText(row.route ?? ""),
        riskCheckHash: normalizeText(row.riskCheckHash ?? ""),
      };
    }
    case "agent_session_grant": {
      const row = payload as AgentSessionGrantPayload;
      return {
        sessionId: normalizeText(row.sessionId),
        agentId: normalizeText(row.agentId),
        venue: normalizeText(row.venue),
        market: normalizeText(row.market).toUpperCase(),
        maxNotionalUsd: normalizeDecimal(row.maxNotionalUsd),
        maxLeverage: normalizeText(row.maxLeverage).toLowerCase(),
        expiresAt: Math.trunc(row.expiresAt),
        status: row.status,
      };
    }
    case "agent_risk_policy": {
      const row = payload as AgentRiskPolicyPayload;
      return {
        sessionId: normalizeText(row.sessionId),
        oraclePolicyHash: normalizeHash(row.oraclePolicyHash),
        maxLossRaw: normalizeRawInteger(row.maxLossRaw),
        status: row.status,
      };
    }
    case "agent_trade_settlement": {
      const row = payload as AgentTradeSettlementPayload;
      return {
        sessionId: normalizeText(row.sessionId),
        executionId: normalizeText(row.executionId),
        settlementArtifactHash: normalizeHash(row.settlementArtifactHash),
        oraclePolicyHash: normalizeHash(row.oraclePolicyHash),
        closedNotionalRaw: normalizeRawInteger(row.closedNotionalRaw),
        outcome: row.outcome,
        pnlAbsRaw: normalizeRawInteger(row.pnlAbsRaw),
        settlementSequence: normalizeSettlementSequence(row.settlementSequence),
      };
    }
    case "recovery_action":
      return {
        recoveryAction: normalizeText((payload as RecoveryPayload).recoveryAction),
      };
    case "swap_intent": {
      const row = payload as SwapPayload;
      return {
        from: normalizeMoney(row.from),
        toAsset: normalizeText(row.toAsset).toUpperCase(),
        minReceive: normalizeDecimal(row.minReceive),
      };
    }
  }
}

function canonicalPayloadBytes(
  kind: ClearSignActionKind,
  payload: ClearSignPayload,
): Uint8Array {
  const out = new ByteWriter();
  out.pushBytes(CLEARSIGN_PAYLOAD_DOMAIN);
  out.pushU8(clearSignActionKindCode(kind));
  switch (kind) {
    case "send": {
      const row = normalizeRecipientAmount(payload as SendPayload);
      out.pushRecipientAmount(row);
      break;
    }
    case "batch_send": {
      const rows = (payload as BatchSendPayload).recipients.map(
        normalizeRecipientAmount,
      );
      out.pushU32(rows.length);
      rows.forEach((row) => out.pushRecipientAmount(row));
      break;
    }
    case "release_milestone": {
      const row = normalizePayload(kind, payload) as MilestonePayload;
      out.pushBytes(textCommitment(row.escrowId || row.escrowTitle));
      out.pushBytes(textCommitment(row.milestoneId || row.milestoneTitle));
      out.pushRecipientAmount(row);
      break;
    }
    case "return_escrow_funds": {
      const row = normalizePayload(kind, payload) as EscrowReturnPayload;
      out.pushBytes(textCommitment(row.escrowId || row.escrowTitle));
      out.pushU32(row.returns.length);
      row.returns.forEach((item) => out.pushRecipientAmount(item));
      break;
    }
    case "agent_trade_approval": {
      const row = normalizePayload(kind, payload) as AgentTradePayload;
      if (isAgentTradeApprovalV2(row)) {
        out.pushBytes(textCommitment(row.agentId));
        out.pushBytes(textCommitment(row.venue));
        out.pushBytes(textCommitment(row.market));
        out.pushBytes(textCommitment(row.side));
        out.pushBytes(textCommitment(row.assetId));
        out.pushU128(decimalToRawAmount(row.maxNotionalUsd, "USD"));
        out.pushU32(leverageToX100(row.maxLeverage));
        out.pushBytes(textCommitment(row.sessionId));
        out.pushBytes(textCommitment(row.route));
        out.pushBytes(hashBytesFromHex(row.riskCheckHash));
      } else {
        out.pushBytes(row.market);
        out.pushBytes(row.side);
        out.pushAmount({
          asset: "USD",
          amount: row.maxNotionalUsd,
        });
        out.pushU32(leverageToX100(row.maxLeverage));
      }
      break;
    }
    case "agent_session_grant": {
      const row = normalizePayload(kind, payload) as AgentSessionGrantPayload;
      out.pushBytes("agent_session");
      out.pushRaw(textCommitment(row.sessionId));
      out.pushRaw(textCommitment(row.agentId));
      out.pushRaw(textCommitment(row.venue));
      out.pushRaw(textCommitment(row.market.toUpperCase()));
      out.pushU128(decimalToRawAmount(row.maxNotionalUsd, "USD"));
      out.pushU32(leverageToX100(row.maxLeverage));
      out.pushI64(BigInt(Math.trunc(row.expiresAt)));
      out.pushU8(row.status === "active" ? 1 : 2);
      break;
    }
    case "agent_risk_policy": {
      const row = normalizePayload(kind, payload) as AgentRiskPolicyPayload;
      const maxLossRaw = BigInt(row.maxLossRaw);
      if (row.status === "active" && maxLossRaw === 0n) {
        throw new Error("Active agent risk policy requires positive maxLossRaw.");
      }
      out.pushBytes("agent_risk_policy");
      out.pushRaw(textCommitment(row.sessionId));
      out.pushRaw(hash32FromHex(row.oraclePolicyHash, "oraclePolicyHash"));
      out.pushU128(maxLossRaw);
      out.pushU8(row.status === "active" ? 1 : 2);
      break;
    }
    case "agent_trade_settlement": {
      const row = normalizePayload(kind, payload) as AgentTradeSettlementPayload;
      const closedNotionalRaw = BigInt(row.closedNotionalRaw);
      const pnlAbsRaw = BigInt(row.pnlAbsRaw);
      if (
        closedNotionalRaw === 0n ||
        (row.outcome === "flat" && pnlAbsRaw !== 0n) ||
        (row.outcome !== "flat" && pnlAbsRaw === 0n)
      ) {
        throw new Error("Agent settlement amount or outcome is invalid.");
      }
      out.pushBytes("agent_trade_settlement");
      out.pushRaw(textCommitment(row.sessionId));
      out.pushRaw(textCommitment(row.executionId));
      out.pushRaw(hash32FromHex(row.settlementArtifactHash, "settlementArtifactHash"));
      out.pushRaw(hash32FromHex(row.oraclePolicyHash, "oraclePolicyHash"));
      out.pushU128(closedNotionalRaw);
      out.pushU8(row.outcome === "profit" ? 1 : row.outcome === "loss" ? 2 : 3);
      out.pushU128(pnlAbsRaw);
      out.pushU64(BigInt(row.settlementSequence));
      break;
    }
    case "set_protection": {
      const row = normalizePayload(kind, payload) as ProtectionPayload;
      if (row.policyCommitment) {
        out.pushBytes("wallet_policy");
        out.pushU8(normalizeChainKind(row.chainKind));
        out.pushRaw(fromHex(normalizeHash(row.policyCommitment)));
      } else {
        out.pushBytes(JSON.stringify({ summary: row.summary }));
      }
      break;
    }
    case "add_member":
    case "remove_member": {
      const row = normalizePayload(kind, payload) as MemberPayload;
      pushIntentGovernance(out, {
        targetIntentIndex: row.targetIntentIndex,
        approvalThreshold: row.approvalThreshold,
        cancellationThreshold: row.cancellationThreshold,
        timelockSeconds: row.timelockSeconds,
        proposers: row.proposers,
        approvers: row.approvers,
      });
      break;
    }
    case "change_threshold": {
      const row = normalizePayload(kind, payload) as ThresholdPayload;
      pushIntentGovernance(out, {
        targetIntentIndex: row.targetIntentIndex,
        approvalThreshold: row.approvalsRequired,
        cancellationThreshold: row.cancellationThreshold,
        timelockSeconds: row.timelockSeconds,
        proposers: row.proposers,
        approvers: row.approvers,
      });
      break;
    }
    default:
      out.pushBytes(JSON.stringify(normalizePayload(kind, payload)));
      break;
  }
  return out.bytes();
}

function pushIntentGovernance(
  out: ByteWriter,
  input: {
    targetIntentIndex: number;
    approvalThreshold: number;
    cancellationThreshold: number;
    timelockSeconds: number;
    proposers: string[];
    approvers: string[];
  },
): void {
  out.pushBytes("intent_governance");
  out.pushU8(input.targetIntentIndex & 0xff);
  out.pushU8(input.approvalThreshold & 0xff);
  out.pushU8(input.cancellationThreshold & 0xff);
  out.pushU32(input.timelockSeconds >>> 0);
  const proposers = input.proposers.map(decodeSolanaPubkey);
  const approvers = input.approvers.map(decodeSolanaPubkey);
  out.pushU32(proposers.length);
  proposers.forEach((pk) => out.pushRaw(pk));
  out.pushU32(approvers.length);
  approvers.forEach((pk) => out.pushRaw(pk));
}

function decodeSolanaPubkey(value: string): Uint8Array {
  const text = normalizeText(value);
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(text);
  } catch {
    throw new Error(`Invalid Solana pubkey in governance payload: ${text}`);
  }
  if (bytes.length !== 32) {
    throw new Error(`Governance pubkey must decode to 32 bytes: ${text}`);
  }
  return bytes;
}

function normalizeRecipientAmount(row: RecipientAmount): RecipientAmount {
  return {
    recipient: normalizeText(row.recipient),
    recipientEncoding: row.recipientEncoding ?? "text",
    ...normalizeMoney(row),
  };
}

function normalizeMoney(row: MoneyAmount): MoneyAmount {
  return {
    amount: normalizeDecimal(row.amount),
    asset: normalizeAssetIdentity(row.asset),
    assetEncoding: row.assetEncoding ?? "text",
    decimals: normalizeAssetDecimals(row.decimals),
    displayAsset: normalizeOptional(row.displayAsset)?.toUpperCase(),
  };
}

type AgentTradePayloadV2 = AgentTradePayload & {
  agentId: string;
  venue: string;
  assetId: string;
  sessionId: string;
  route: string;
  riskCheckHash: string;
};

function isAgentTradeApprovalV2(row: AgentTradePayload): row is AgentTradePayloadV2 {
  const fields = [
    row.agentId,
    row.venue,
    row.assetId,
    row.sessionId,
    row.route,
    row.riskCheckHash,
  ];
  const hasAny = fields.some((value) => normalizeText(value ?? "") !== "");
  const hasAll = fields.every((value) => normalizeText(value ?? "") !== "");
  if (hasAny && !hasAll) {
    throw new Error(
      "Agent trade approval v2 requires agentId, venue, assetId, sessionId, route, and riskCheckHash.",
    );
  }
  return hasAll;
}

function formatMoney(row: MoneyAmount): string {
  const asset = row.displayAsset
    ? normalizeText(row.displayAsset).toUpperCase()
    : normalizeAssetIdentity(row.asset);
  return `${normalizeDecimal(row.amount)} ${asset}`;
}

function normalizeAssetIdentity(value: string): string {
  const asset = normalizeText(value);
  return /^0x[0-9a-fA-F]{40}$/.test(asset)
    ? asset.toLowerCase()
    : asset.toUpperCase();
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeRawInteger(value: string): string {
  const normalized = normalizeText(value);
  const parsed = BigInt(normalized);
  if (parsed < 0n || parsed > (1n << 128n) - 1n) {
    throw new Error("Raw integer is outside the u128 range.");
  }
  return parsed.toString();
}

function normalizeOptional(value: string | undefined): string {
  return value ? normalizeText(value) : "";
}

function normalizeHash(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeNumber(value: number): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function normalizeSettlementSequence(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Settlement sequence must be a non-negative safe integer.");
  }
  return value;
}

function normalizeOptionalNumber(value: number | undefined): number | undefined {
  return value === undefined ? undefined : normalizeNumber(value);
}

function normalizeChainKind(value: number | undefined): number {
  const chainKind = normalizeNumber(value ?? -1);
  if (!Number.isInteger(chainKind) || chainKind < 0 || chainKind > 255) {
    throw new Error("Protection chainKind must be a byte.");
  }
  return chainKind;
}

function textCommitment(value: string): Uint8Array {
  return sha256(enc.encode(normalizeText(value)));
}

function hashBytesFromHex(value: string): Uint8Array {
  return hash32FromHex(value, "riskCheckHash");
}

function hash32FromHex(value: string, field: string): Uint8Array {
  const normalized = normalizeHash(value);
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error(`${field} must be a 32-byte hex hash.`);
  }
  return fromHex(normalized);
}

function normalizeDecimal(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+(\.\d*)?$/.test(trimmed)) return trimmed;
  const [rawWhole, rawFraction = ""] = trimmed.split(".");
  const whole = rawWhole.replace(/^0+(?=\d)/, "") || "0";
  const fraction = rawFraction.replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function normalizeAssetDecimals(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 36) {
    throw new Error("Asset decimals must be an integer between 0 and 36.");
  }
  return value;
}

function assetDecimals(asset: string): number {
  switch (normalizeText(asset).toUpperCase()) {
    case "BTC":
    case "ZEC":
      return 8;
    case "ETH":
    case "HYPE":
      return 18;
    case "USDC":
    case "USDT":
    case "USD":
      return 6;
    case "SOL":
    default:
      return 9;
  }
}

function decimalToRawAmount(
  value: string,
  asset: string,
  explicitDecimals?: number,
): bigint {
  const normalized = normalizeDecimal(value);
  if (!/^\d+(\.\d+)?$/.test(normalized)) return 0n;
  const decimals = normalizeAssetDecimals(explicitDecimals) ?? assetDecimals(asset);
  const [whole, frac = ""] = normalized.split(".");
  const padded = `${frac.slice(0, decimals)}${"0".repeat(decimals)}`.slice(
    0,
    decimals,
  );
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

function leverageToX100(value: string): number {
  const normalized = normalizeText(value).toLowerCase().replace(/x$/, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

class ByteWriter {
  private chunks: number[] = [];

  pushRaw(bytes: Uint8Array) {
    for (const byte of bytes) this.chunks.push(byte);
  }

  pushBytes(value: string | Uint8Array) {
    const bytes = typeof value === "string" ? enc.encode(value) : value;
    this.pushU32(bytes.length);
    this.pushRaw(bytes);
  }

  pushRecipientAmount(row: RecipientAmount) {
    this.pushBytes(canonicalRecipientBytes(row));
    this.pushAmount(row);
  }

  pushAmount(row: MoneyAmount) {
    const asset = normalizeAssetIdentity(row.asset);
    this.pushBytes(row.assetEncoding === "sha256_text" ? textCommitment(asset) : asset);
    this.pushU128(decimalToRawAmount(row.amount, row.asset, row.decimals));
  }

  pushU8(value: number) {
    this.chunks.push(value & 0xff);
  }

  pushU32(value: number) {
    for (let i = 0; i < 4; i++) this.chunks.push((value >> (8 * i)) & 0xff);
  }

  pushU64(value: bigint) {
    this.pushBigIntLe(value, 8);
  }

  pushU128(value: bigint) {
    this.pushBigIntLe(value, 16);
  }

  pushI64(value: bigint) {
    this.pushBigIntLe(value < 0 ? (1n << 64n) + value : value, 8);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }

  private pushBigIntLe(value: bigint, byteLength: number) {
    let next = value;
    for (let i = 0; i < byteLength; i++) {
      this.chunks.push(Number(next & 0xffn));
      next >>= 8n;
    }
  }
}

function canonicalRecipientBytes(row: RecipientAmount): Uint8Array | string {
  if (row.recipientEncoding === "sha256_text") {
    return textCommitment(row.recipient);
  }
  if (row.recipientEncoding !== "solana_pubkey") {
    return row.recipient;
  }
  const decoded = bs58.decode(row.recipient);
  if (decoded.length !== 32) {
    throw new Error("ClearSign recipient must be a Solana address.");
  }
  return decoded;
}

function canonicalAddressOrText(value: string): Uint8Array | string {
  if (!value) return value;
  try {
    const decoded = bs58.decode(value);
    if (decoded.length === 32) return decoded;
  } catch {
    // Human test labels and non-Solana identifiers remain text.
  }
  return value;
}
