import { formatTimestamp } from "@/lib/msig/datetime";
import { fromHex, sha256, toHex } from "@/lib/msig/hash";

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
  envelopeHash: string;
  signableText: string;
}

const enc = new TextEncoder();
const CLEARSIGN_V2_VERSION = 2;
const CLEARSIGN_V2_DOMAIN = "clearsig:policy-engine:v2";
const CLEARSIGN_V2_PAYLOAD_DOMAIN = "clearsig:policy-engine:v2:payload";
const CLEARSIGN_V2_VOTE_DOMAIN = "clearsig:policy-engine:v2:vote";

export type ClearSignVoteKind = "propose" | "approve" | "cancel";

export function summarizeClearSignAction(
  envelope: ClearSignEnvelope<ClearSignPayload>,
): ClearSignSummary {
  const payloadHash = clearSignPayloadHash(envelope);
  const envelopeHash = clearSignEnvelopeHash(envelope);
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
    envelopeHash,
    signableText: signableLines.join("\n"),
  };
}

export function clearSignPayloadHash(
  envelope: ClearSignEnvelope<ClearSignPayload>,
): string {
  return toHex(sha256(canonicalPayloadBytes(envelope.kind, envelope.payload)));
}

export function clearSignEnvelopeHash(
  envelope: ClearSignEnvelope<ClearSignPayload>,
): string {
  const payloadHash = fromHex(clearSignPayloadHash(envelope));
  const out = new ByteWriter();
  out.pushBytes(CLEARSIGN_V2_DOMAIN);
  out.pushU8(CLEARSIGN_V2_VERSION);
  out.pushU8(clearSignActionKindCode(envelope.kind));
  out.pushI64(BigInt(normalizeNumber(envelope.expiresAt)));
  out.pushBytes(normalizeText(envelope.walletName));
  out.pushBytes(normalizeOptional(envelope.walletId));
  out.pushRaw(sha256(enc.encode(normalizeText(envelope.actionId))));
  out.pushRaw(sha256(enc.encode(normalizeText(envelope.nonce))));
  out.pushRaw(fromHex(normalizeHash(envelope.policyCommitment)));
  out.pushRaw(payloadHash);
  return toHex(sha256(out.bytes()));
}

export function clearSignVoteMessageHash(input: {
  voteKind: ClearSignVoteKind;
  walletId: string;
  proposalIndex: number | bigint;
  envelopeHash: string;
}): string {
  const out = new ByteWriter();
  out.pushBytes(CLEARSIGN_V2_VOTE_DOMAIN);
  out.pushU8(CLEARSIGN_V2_VERSION);
  out.pushU8(clearSignVoteKindCode(input.voteKind));
  out.pushBytes(normalizeText(input.walletId));
  out.pushU64(BigInt(input.proposalIndex));
  out.pushRaw(fromHex(normalizeHash(input.envelopeHash)));
  return toHex(sha256(out.bytes()));
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
  }
}

export function clearSignVoteKindCode(kind: ClearSignVoteKind): number {
  switch (kind) {
    case "propose":
      return 1;
    case "approve":
      return 2;
    case "cancel":
      return 3;
  }
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

function canonicalPayloadBytes(
  kind: ClearSignActionKind,
  payload: ClearSignPayload,
): Uint8Array {
  const out = new ByteWriter();
  out.pushBytes(CLEARSIGN_V2_PAYLOAD_DOMAIN);
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
      out.pushBytes(row.market);
      out.pushBytes(row.side);
      out.pushAmount({
        asset: "USD",
        amount: row.maxNotionalUsd,
      });
      out.pushU32(leverageToX100(row.maxLeverage));
      break;
    }
    default:
      out.pushBytes(JSON.stringify(normalizePayload(kind, payload)));
      break;
  }
  return out.bytes();
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

function textCommitment(value: string): Uint8Array {
  return sha256(enc.encode(normalizeText(value)));
}

function normalizeDecimal(value: string): string {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? String(parsed) : value.trim();
}

function assetDecimals(asset: string): number {
  switch (normalizeText(asset).toUpperCase()) {
    case "BTC":
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

function decimalToRawAmount(value: string, asset: string): bigint {
  const normalized = normalizeDecimal(value);
  if (!/^\d+(\.\d+)?$/.test(normalized)) return 0n;
  const decimals = assetDecimals(asset);
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
    this.pushBytes(row.recipient);
    this.pushAmount(row);
  }

  pushAmount(row: MoneyAmount) {
    this.pushBytes(normalizeText(row.asset).toUpperCase());
    this.pushU128(decimalToRawAmount(row.amount, row.asset));
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

function shortHash(value: string): string {
  const normalized = normalizeHash(value);
  return normalized.length > 12 ? `${normalized.slice(0, 12)}...` : normalized;
}
