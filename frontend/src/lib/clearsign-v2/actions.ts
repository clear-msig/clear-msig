import { formatTimestamp } from "@/lib/msig/datetime";
import { sha256, toHex } from "@/lib/msig/hash";

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
  | "swap_intent";

export interface ClearSignEnvelope<TPayload extends ClearSignPayload> {
  version: 2;
  kind: ClearSignActionKind;
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
  | RecoveryPayload
  | SwapPayload;

export interface MoneyAmount {
  amount: string;
  asset: string;
}

export interface RecipientAmount extends MoneyAmount {
  recipient: string;
}

export interface SendPayload extends RecipientAmount {
  note?: string;
}

export interface BatchSendPayload {
  recipients: RecipientAmount[];
}

export interface MemberPayload {
  member: string;
  role: string;
}

export interface ThresholdPayload {
  approvalsRequired: number;
}

export interface ProtectionPayload {
  summary: string;
}

export interface MilestonePayload extends RecipientAmount {
  escrowTitle: string;
  milestoneTitle: string;
}

export interface EscrowReturnPayload {
  escrowTitle: string;
  returns: RecipientAmount[];
}

export interface AgentTradePayload {
  market: string;
  side: "long" | "short";
  maxNotionalUsd: string;
  maxLeverage: string;
  stopLossRequired: boolean;
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
  signableText: string;
}

const enc = new TextEncoder();

export function summarizeClearSignAction(
  envelope: ClearSignEnvelope<ClearSignPayload>,
): ClearSignSummary {
  const payloadHash = clearSignPayloadHash(envelope);
  const lines = actionLines(envelope);
  const expires = `Expires ${formatTimestamp(envelope.expiresAt)}`;
  const context = [
    `Wallet ${envelope.walletName}`,
    `Policy ${shortHash(envelope.policyCommitment)}`,
    `Action ${envelope.actionId}`,
    `Nonce ${envelope.nonce}`,
    expires,
  ];
  const signableLines = [...lines, ...context, `Payload ${payloadHash}`];
  return {
    headline: lines[0] ?? "Review ClearSig action",
    lines,
    payloadHash,
    signableText: signableLines.join("\n"),
  };
}

export function clearSignPayloadHash(
  envelope: ClearSignEnvelope<ClearSignPayload>,
): string {
  return stableHash({
    version: envelope.version,
    kind: envelope.kind,
    walletName: normalizeText(envelope.walletName),
    walletId: normalizeOptional(envelope.walletId),
    actionId: normalizeText(envelope.actionId),
    nonce: normalizeText(envelope.nonce),
    expiresAt: normalizeNumber(envelope.expiresAt),
    policyCommitment: normalizeHash(envelope.policyCommitment),
    payload: normalizePayload(envelope.kind, envelope.payload),
  });
}

function actionLines(envelope: ClearSignEnvelope<ClearSignPayload>): string[] {
  const wallet = envelope.walletName;
  switch (envelope.kind) {
    case "send": {
      const payload = envelope.payload as SendPayload;
      return [
        `Send ${formatMoney(payload)} from ${wallet} to ${payload.recipient}`,
        "Requires wallet approval",
      ];
    }
    case "batch_send": {
      const payload = envelope.payload as BatchSendPayload;
      return [
        `Send ${payload.recipients.length} payments from ${wallet}`,
        ...payload.recipients
          .slice(0, 4)
          .map((row) => `${row.recipient} receives ${formatMoney(row)}`),
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
        ...payload.returns
          .slice(0, 6)
          .map((row) => `${row.recipient} receives ${formatMoney(row)}`),
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
      return { summary: normalizeText((payload as ProtectionPayload).summary) };
    case "release_milestone": {
      const row = payload as MilestonePayload;
      return {
        ...normalizeRecipientAmount(row),
        escrowTitle: normalizeText(row.escrowTitle),
        milestoneTitle: normalizeText(row.milestoneTitle),
      };
    }
    case "return_escrow_funds": {
      const row = payload as EscrowReturnPayload;
      return {
        escrowTitle: normalizeText(row.escrowTitle),
        returns: row.returns.map(normalizeRecipientAmount),
      };
    }
    case "agent_trade_approval": {
      const row = payload as AgentTradePayload;
      return {
        market: normalizeText(row.market).toUpperCase(),
        side: row.side,
        maxNotionalUsd: normalizeDecimal(row.maxNotionalUsd),
        maxLeverage: normalizeText(row.maxLeverage).toLowerCase(),
        stopLossRequired: Boolean(row.stopLossRequired),
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

function normalizeRecipientAmount(row: RecipientAmount): RecipientAmount {
  return {
    recipient: normalizeText(row.recipient),
    ...normalizeMoney(row),
  };
}

function normalizeMoney(row: MoneyAmount): MoneyAmount {
  return {
    amount: normalizeDecimal(row.amount),
    asset: normalizeText(row.asset).toUpperCase(),
  };
}

function formatMoney(row: MoneyAmount): string {
  return `${normalizeDecimal(row.amount)} ${normalizeText(row.asset).toUpperCase()}`;
}

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeOptional(value: string | undefined): string {
  return value?.trim() ?? "";
}

function normalizeHash(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeNumber(value: number): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function normalizeDecimal(value: string): string {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? String(parsed) : value.trim();
}

function shortHash(value: string): string {
  const normalized = normalizeHash(value);
  return normalized.length > 12 ? `${normalized.slice(0, 12)}...` : normalized;
}

function stableHash(value: unknown): string {
  return toHex(sha256(enc.encode(stableStringify(value))));
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
