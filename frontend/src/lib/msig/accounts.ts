// Account parsers . TypeScript mirrors of cli/src/accounts.rs.
//
// Every parser returns records whose field names / types line up with
// the Rust structs so the browser can render them without an extra
// translation layer. Byte offsets and vec prefixes match the on-chain
// layout in programs/clear-wallet/src/state/*.rs.
//
// Design notes:
//   - Addresses (32-byte pubkeys) are kept as base58 strings in parsed
//     records . that's what the UI shows and what Solana RPC returns.
//   - Byte pools + params_data stay as `Uint8Array`; the renderer /
//     encoder slice them directly.
//   - All multi-byte integers are little-endian (matches PodU16/PodU64
//     in Rust). u64 / u32 go through `DataView` for exact semantics.

import bs58 from "bs58";
import {
  AccountSourceType,
  ConstraintType,
  DataEncoding,
  ParamType,
  SeedType,
  SegmentType,
  type AccountEntry,
  type DataSegmentEntry,
  type InstructionEntry,
  type ParamEntry,
  type SeedEntry,
} from "@/lib/msig/definition";

// ── discriminators (match the `#[account(discriminator = N)]` attrs) ─

export const DISC_CLEAR_WALLET = 1;
export const DISC_INTENT = 2;
export const DISC_PROPOSAL = 3;
export const DISC_IKA_CONFIG = 4;
export const DISC_DWALLET_OWNERSHIP = 5;

// ── WalletAccount ────────────────────────────────────────────────────

export interface WalletAccount {
  bump: number;
  proposalIndex: bigint;
  intentIndex: number;
  /// Pubkey of the address that paid for + signed the create_wallet
  /// instruction. Stored on chain so the UI can identify the wallet's
  /// owner without re-fetching the create transaction. Used to gate
  /// destructive actions (you can't kick the creator) and to render
  /// the Crown badge on the members list.
  creator: string;
  name: string;
}

export function parseWallet(data: Uint8Array): WalletAccount {
  const r = new Reader(data, "ClearWallet", DISC_CLEAR_WALLET);
  const bump = r.u8();
  const proposalIndex = r.u64();
  const intentIndex = r.u8();
  const creator = r.address();
  const nameLen = Number(r.u32());
  const name = r.utf8(nameLen);
  return { bump, proposalIndex, intentIndex, creator, name };
}

// ── IntentAccount ────────────────────────────────────────────────────

export interface IntentAccount {
  wallet: string;
  bump: number;
  intentIndex: number;
  intentType: number;
  chainKind: number;
  approved: boolean;
  approvalThreshold: number;
  cancellationThreshold: number;
  timelockSeconds: number;
  templateOffset: number;
  templateLen: number;
  txTemplateOffset: number;
  txTemplateLen: number;
  activeProposalCount: number;
  proposers: string[];
  approvers: string[];
  params: ParamEntry[];
  accounts: AccountEntry[];
  instructions: InstructionEntry[];
  dataSegments: DataSegmentEntry[];
  seeds: SeedEntry[];
  policyCiphertexts: Uint8Array;
  policyCiphertextIds: string[];
  bytePool: Uint8Array;
  /// Convenience accessor for the template string slice in `bytePool`.
  template: string;
}

export function parseIntent(data: Uint8Array): IntentAccount {
  const r = new Reader(data, "Intent", DISC_INTENT);
  const wallet = r.address();
  const bump = r.u8();
  const intentIndex = r.u8();
  const intentType = r.u8();
  const chainKind = r.u8();
  const approved = r.u8() !== 0;
  const approvalThreshold = r.u8();
  const cancellationThreshold = r.u8();
  const timelockSeconds = Number(r.u32());
  const templateOffset = r.u16();
  const templateLen = r.u16();
  const txTemplateOffset = r.u16();
  const txTemplateLen = r.u16();
  const activeProposalCount = r.u16();

  const proposers = r.vecAddresses();
  const approvers = r.vecAddresses();
  const params = r.vecParamEntries();
  const accounts = r.vecAccountEntries();
  const instructions = r.vecInstructionEntries();
  const dataSegments = r.vecDataSegmentEntries();
  const seeds = r.vecSeedEntries();
  const tailOffset = r.position();
  let policyCiphertexts: Uint8Array;
  let bytePool: Uint8Array;
  try {
    policyCiphertexts = r.vecU8();
    bytePool = r.vecU8();
  } catch {
    // Older deployed program builds wrote intent accounts before the
    // policy_ciphertexts tail field existed. Accept that layout so
    // wallet signing can still verify legacy on-chain intents.
    const legacyTail = readOptionalVecU8(data, tailOffset, "Intent");
    policyCiphertexts = new Uint8Array();
    bytePool = legacyTail.bytes;
  }

  const template = new TextDecoder().decode(
    checkedSlice(bytePool, templateOffset, templateLen, "template")
  );
  checkedSlice(bytePool, txTemplateOffset, txTemplateLen, "tx_template");
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!;
    checkedSlice(bytePool, p.nameOffset, p.nameLen, `param[${i}].name`);
  }
  const policyCiphertextIds = decodePolicyCiphertexts(policyCiphertexts);

  return {
    wallet,
    bump,
    intentIndex,
    intentType,
    chainKind,
    approved,
    approvalThreshold,
    cancellationThreshold,
    timelockSeconds,
    templateOffset,
    templateLen,
    txTemplateOffset,
    txTemplateLen,
    activeProposalCount,
    proposers,
    approvers,
    params,
    accounts,
    instructions,
    dataSegments,
    seeds,
    policyCiphertexts,
    policyCiphertextIds,
    bytePool,
    template,
  };
}

function checkedSlice(
  data: Uint8Array,
  offset: number,
  len: number,
  label: string,
): Uint8Array {
  const end = offset + len;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(len) || offset < 0 || len < 0 || end > data.length) {
    throw new Error(
      `parseIntent: ${label} range ${offset}..${end} outside byte_pool length ${data.length}`,
    );
  }
  return data.subarray(offset, end);
}

function decodePolicyCiphertexts(data: Uint8Array): string[] {
  if (data.length === 0) return [];
  let offset = 0;
  const readU16 = () => {
    if (offset + 2 > data.length) return null;
    const value = data[offset] | (data[offset + 1] << 8);
    offset += 2;
    return value;
  };
  const count = readU16();
  if (count == null) return [];
  const ids: string[] = [];
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const len = readU16();
    if (len == null || offset + len > data.length) return ids;
    ids.push(dec.decode(data.subarray(offset, offset + len)));
    offset += len;
  }
  return ids;
}

function readOptionalVecU8(
  data: Uint8Array,
  offset: number,
  tag: string,
): { bytes: Uint8Array; nextOffset: number } {
  if (offset === data.length) return { bytes: new Uint8Array(), nextOffset: offset };
  if (offset + 4 > data.length) {
    throw new Error(
      `parse${tag}: unexpected end of data (need 4 at offset ${offset}, total ${data.length})`
    );
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = dv.getUint32(offset, true);
  const start = offset + 4;
  const end = start + len;
  if (end > data.length) {
    throw new Error(
      `parse${tag}: unexpected end of data (need ${len} at offset ${start}, total ${data.length})`
    );
  }
  return { bytes: data.slice(start, end), nextOffset: end };
}

// ── ProposalAccount ──────────────────────────────────────────────────

export const ProposalStatus = {
  Active: 0,
  Approved: 1,
  Executed: 2,
  Cancelled: 3,
} as const;
export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];

export interface ProposalAccount {
  wallet: string;
  intent: string;
  proposalIndex: bigint;
  proposer: string;
  status: ProposalStatus;
  statusLabel: "Active" | "Approved" | "Executed" | "Cancelled" | "Unknown";
  proposedAt: bigint;
  approvedAt: bigint;
  bump: number;
  approvalBitmap: number;
  cancellationBitmap: number;
  rentRefund: string;
  paramsData: Uint8Array;
}

export function parseProposal(data: Uint8Array): ProposalAccount {
  const r = new Reader(data, "Proposal", DISC_PROPOSAL);
  const wallet = r.address();
  const intent = r.address();
  const proposalIndex = r.u64();
  const proposer = r.address();
  const statusByte = r.u8();
  const proposedAt = r.i64();
  const approvedAt = r.i64();
  const bump = r.u8();
  const approvalBitmap = r.u16();
  const cancellationBitmap = r.u16();
  const rentRefund = r.address();
  const paramsData = r.vecU8();
  const statusLabel = (
    ["Active", "Approved", "Executed", "Cancelled"] as const
  )[statusByte] ?? "Unknown";
  return {
    wallet,
    intent,
    proposalIndex,
    proposer,
    status: statusByte as ProposalStatus,
    statusLabel,
    proposedAt,
    approvedAt,
    bump,
    approvalBitmap,
    cancellationBitmap,
    rentRefund,
    paramsData,
  };
}

// ── IkaConfigAccount (manual repr, not Quasar) ───────────────────────
//
// Layout from programs/clear-wallet/src/state/ika_config.rs:
//   disc(1) + wallet(32) + dwallet(32) + user_pubkey(32) + chain_kind(1)
//   + signature_scheme(1) + bump(1)  = 100 bytes
// `user_pubkey` in this slot is not a Solana pubkey . it's the 32-byte
// Ika session identifier. We return it as lowercase hex for clarity.

export interface IkaConfigAccount {
  wallet: string;
  dwallet: string;
  userPubkeyHex: string;
  chainKind: number;
  signatureScheme: number;
  bump: number;
}

export function parseIkaConfig(data: Uint8Array): IkaConfigAccount {
  if (data.length < 100 || data[0] !== DISC_IKA_CONFIG) {
    throw new Error(
      `parseIkaConfig: not an IkaConfig account (disc=${data[0]}, len=${data.length})`
    );
  }
  const wallet = bs58.encode(data.subarray(1, 33));
  const dwallet = bs58.encode(data.subarray(33, 65));
  const userPubkey = data.subarray(65, 97);
  const chainKind = data[97];
  const signatureScheme = data[98];
  const bump = data[99];
  return {
    wallet,
    dwallet,
    userPubkeyHex: Array.from(userPubkey)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
    chainKind,
    signatureScheme,
    bump,
  };
}

// ── DwalletOwnership ────────────────────────────────────────────────

export interface DwalletOwnershipAccount {
  wallet: string;
  dwallet: string;
  bump: number;
}

export function parseDwalletOwnership(data: Uint8Array): DwalletOwnershipAccount {
  if (data.length < 66 || data[0] !== DISC_DWALLET_OWNERSHIP) {
    throw new Error(
      `parseDwalletOwnership: bad account (disc=${data[0]}, len=${data.length})`
    );
  }
  return {
    wallet: bs58.encode(data.subarray(1, 33)),
    dwallet: bs58.encode(data.subarray(33, 65)),
    bump: data[65],
  };
}

// ── internals ─────────────────────────────────────────────────────────

class Reader {
  private dv: DataView;
  private off = 0;

  constructor(
    private readonly data: Uint8Array,
    private readonly tag: string,
    expectedDisc: number
  ) {
    this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.length === 0 || data[0] !== expectedDisc) {
      throw new Error(
        `parse${tag}: not a ${tag} account (disc=${data[0]}, expected ${expectedDisc})`
      );
    }
    this.off = 1;
  }

  u8(): number {
    this.ensureAvailable(1);
    const v = this.data[this.off];
    this.off += 1;
    return v;
  }
  u16(): number {
    this.ensureAvailable(2);
    const v = this.dv.getUint16(this.off, /* le */ true);
    this.off += 2;
    return v;
  }
  u32(): bigint {
    this.ensureAvailable(4);
    const v = BigInt(this.dv.getUint32(this.off, /* le */ true));
    this.off += 4;
    return v;
  }
  u64(): bigint {
    this.ensureAvailable(8);
    const v = this.dv.getBigUint64(this.off, /* le */ true);
    this.off += 8;
    return v;
  }
  i64(): bigint {
    this.ensureAvailable(8);
    const v = this.dv.getBigInt64(this.off, /* le */ true);
    this.off += 8;
    return v;
  }
  address(): string {
    this.ensureAvailable(32);
    const s = bs58.encode(this.data.subarray(this.off, this.off + 32));
    this.off += 32;
    return s;
  }
  utf8(len: number): string {
    this.ensureAvailable(len);
    const s = new TextDecoder().decode(this.data.subarray(this.off, this.off + len));
    this.off += len;
    return s;
  }
  vecAddresses(): string[] {
    const n = Number(this.u32());
    const out: string[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.address();
    return out;
  }
  vecU8(): Uint8Array {
    const n = Number(this.u32());
    this.ensureAvailable(n);
    const out = this.data.slice(this.off, this.off + n);
    this.off += n;
    return out;
  }
  position(): number {
    return this.off;
  }
  vecParamEntries(): ParamEntry[] {
    const n = Number(this.u32());
    const out: ParamEntry[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.readParamEntry();
    return out;
  }
  vecAccountEntries(): AccountEntry[] {
    const n = Number(this.u32());
    const out: AccountEntry[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.readAccountEntry();
    return out;
  }
  vecInstructionEntries(): InstructionEntry[] {
    const n = Number(this.u32());
    const out: InstructionEntry[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.readInstructionEntry();
    return out;
  }
  vecDataSegmentEntries(): DataSegmentEntry[] {
    const n = Number(this.u32());
    const out: DataSegmentEntry[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.readDataSegmentEntry();
    return out;
  }
  vecSeedEntries(): SeedEntry[] {
    const n = Number(this.u32());
    const out: SeedEntry[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.readSeedEntry();
    return out;
  }

  // Each sub-record is tight-packed alignment-1 (PodU16/PodU64 in Rust).
  // Sizes match backend-api/src/main.rs `skip_raw_vec` values: 14 / 7 / 9 / 5 / 5.

  private readParamEntry(): ParamEntry {
    this.ensureAvailable(14);
    const paramType = this.u8() as ParamType;
    const nameOffset = this.u16();
    const nameLen = this.u16();
    const constraintType = this.u8() as ConstraintType;
    const constraintValue = this.u64();
    return { paramType, nameOffset, nameLen, constraintType, constraintValue };
  }

  private readAccountEntry(): AccountEntry {
    this.ensureAvailable(7);
    const isSigner = this.u8() !== 0;
    const isWritable = this.u8() !== 0;
    const sourceType = this.u8() as AccountSourceType;
    const poolOffset = this.u16();
    const poolLen = this.u16();
    return { isSigner, isWritable, sourceType, poolOffset, poolLen };
  }

  private readInstructionEntry(): InstructionEntry {
    this.ensureAvailable(9);
    const programAccountIndex = this.u8();
    const accountIndexesOffset = this.u16();
    const accountIndexesLen = this.u16();
    const segmentsStart = this.u16();
    const segmentsCount = this.u16();
    return {
      programAccountIndex,
      accountIndexesOffset,
      accountIndexesLen,
      segmentsStart,
      segmentsCount,
    };
  }

  private readDataSegmentEntry(): DataSegmentEntry {
    this.ensureAvailable(5);
    const segmentType = this.u8() as SegmentType;
    const poolOffset = this.u16();
    const poolLen = this.u16();
    return { segmentType, poolOffset, poolLen };
  }

  private readSeedEntry(): SeedEntry {
    this.ensureAvailable(5);
    const seedType = this.u8() as SeedType;
    const poolOffset = this.u16();
    const poolLen = this.u16();
    return { seedType, poolOffset, poolLen };
  }

  private ensureAvailable(n: number): void {
    if (this.off + n > this.data.length) {
      throw new Error(
        `parse${this.tag}: unexpected end of data (need ${n} at offset ${this.off}, total ${this.data.length})`
      );
    }
  }
}

// Re-export the enum values actually used by account consumers so
// callers don't need to import from definition.ts separately.
export { AccountSourceType, DataEncoding, ParamType, SeedType, SegmentType };
