// Shared enums + small record types mirroring
// programs/clear-wallet/src/utils/definition.rs.
//
// All #[repr(u8)] on the Rust side . so the on-chain byte values must
// match these numeric constants exactly. We use const objects (not TS
// enums) because TS enums emit a runtime object with both string and
// numeric keys, which confuses byte-level parsers.

export const ParamType = {
  Address: 0,
  U64: 1,
  I64: 2,
  String: 3,
  Bool: 4,
  U8: 5,
  U16: 6,
  U32: 7,
  U128: 8,
  Bytes20: 9,
  Bytes32: 10,
  Bytes: 11,
} as const;
export type ParamType = (typeof ParamType)[keyof typeof ParamType];

export const ConstraintType = {
  None: 0,
  LessThanU64: 1,
  GreaterThanU64: 2,
} as const;
export type ConstraintType = (typeof ConstraintType)[keyof typeof ConstraintType];

export const AccountSourceType = {
  Static: 0,
  Param: 1,
  PdaDerived: 2,
  HasOne: 3,
  Vault: 4,
} as const;
export type AccountSourceType = (typeof AccountSourceType)[keyof typeof AccountSourceType];

export const SegmentType = {
  Literal: 0,
  Param: 1,
} as const;
export type SegmentType = (typeof SegmentType)[keyof typeof SegmentType];

export const SeedType = {
  Literal: 0,
  ParamRef: 1,
  AccountRef: 2,
} as const;
export type SeedType = (typeof SeedType)[keyof typeof SeedType];

export const DataEncoding = {
  RawAddress: 0,
  LittleEndianU64: 1,
  LittleEndianI64: 2,
  Bool: 3,
  LittleEndianU8: 4,
  LittleEndianU16: 5,
  LittleEndianU32: 6,
  LittleEndianU128: 7,
} as const;
export type DataEncoding = (typeof DataEncoding)[keyof typeof DataEncoding];

// ── Intent sub-records (1:1 byte layout with the Rust structs) ────────
//
// These appear inside a parsed `IntentAccount.params / accounts /
// instructions / data_segments / seeds` array. Keep fields in the same
// order as the Rust structs for the sake of readers; no byte layout is
// implied here (the account parser emits these records fully decoded).

export interface ParamEntry {
  paramType: ParamType;
  nameOffset: number;
  nameLen: number;
  constraintType: ConstraintType;
  constraintValue: bigint;
}

export interface AccountEntry {
  isSigner: boolean;
  isWritable: boolean;
  sourceType: AccountSourceType;
  poolOffset: number;
  poolLen: number;
}

export interface InstructionEntry {
  programAccountIndex: number;
  accountIndexesOffset: number;
  accountIndexesLen: number;
  segmentsStart: number;
  segmentsCount: number;
}

export interface DataSegmentEntry {
  segmentType: SegmentType;
  poolOffset: number;
  poolLen: number;
}

export interface SeedEntry {
  seedType: SeedType;
  poolOffset: number;
  poolLen: number;
}

/// Variable-width param size in `params_data`. Matches
/// programs/clear-wallet/src/utils/definition.rs::param_byte_size.
export function paramByteSize(
  paramType: ParamType,
  paramsData: Uint8Array,
  offset: number
): number {
  switch (paramType) {
    case ParamType.Address:
    case ParamType.Bytes32:
      return 32;
    case ParamType.U64:
    case ParamType.I64:
      return 8;
    case ParamType.Bytes20:
      return 20;
    case ParamType.String: {
      if (offset >= paramsData.length) {
        throw new Error("paramByteSize: string length byte OOB");
      }
      return 1 + paramsData[offset];
    }
    case ParamType.Bytes: {
      if (offset + 1 >= paramsData.length) {
        throw new Error("paramByteSize: bytes length OOB");
      }
      const len = paramsData[offset] | (paramsData[offset + 1] << 8);
      return 2 + len;
    }
    case ParamType.Bool:
    case ParamType.U8:
      return 1;
    case ParamType.U16:
      return 2;
    case ParamType.U32:
      return 4;
    case ParamType.U128:
      return 16;
    default: {
      const exhaustive: never = paramType;
      throw new Error(`paramByteSize: unknown ParamType ${exhaustive}`);
    }
  }
}

/// Byte offset of the `idx`-th param inside `paramsData`. Walks the
/// preceding params using `paramByteSize`. Used by the renderer + the
/// message builder to pick out individual fields from the opaque blob.
export function paramOffsetAt(
  params: readonly { paramType: ParamType }[],
  paramsData: Uint8Array,
  idx: number
): number {
  let off = 0;
  for (let i = 0; i < idx; i++) {
    const p = params[i];
    if (!p) throw new Error(`paramOffsetAt: param index ${i} out of bounds`);
    off += paramByteSize(p.paramType, paramsData, off);
  }
  return off;
}
