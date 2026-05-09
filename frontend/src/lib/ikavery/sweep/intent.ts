// Structural sweep intent — BCS-encoded fingerprint of a sweep's
// instructions. The on-chain `sweep::intent::hash_message_bytes`
// parses sweep messageBytes and computes
// `keccak256(bcs(vec![SweepIntent { fee_payer, ixs }]))`. Propose
// stores those digests, execute rebuilds them from freshly-built
// message bytes, and only proceeds if they match — that's how the
// dWallet sign-at-execute model stays safe under blockhash refresh.
//
// This module is the byte-exact TS port of the host-side encoder in
// upstream's `solana/packages/program/src/sweep/intent.rs` (`bcs_encode_intents`,
// `hash_intents`). The Rust side has a `host_bcs_matches_handrolled_bcs`
// test and an `on_chain_digest_matches_host` test that both pin the
// exact wire shape; we mirror it here.
//
// Whitelist (mirrors upstream — adding a variant means changes here AND
// in the upstream parser):
//   - System Program transfer (SystemTransfer)
//   - SPL Token / Token-2022 TransferChecked (SplTransferChecked)
//   - SPL Token / Token-2022 CloseAccount (SplCloseAccount)
//   - ATA Program CreateIdempotent (AtaCreateIdempotent)
// ComputeBudget instructions are silently dropped (executor-tunable;
// don't affect intent).

import { keccak_256 } from "@noble/hashes/sha3";

export type SweepIxIntent =
  | {
      kind: "SystemTransfer";
      from: Uint8Array;
      to: Uint8Array;
      lamports: bigint;
    }
  | {
      kind: "SplTransferChecked";
      programId: Uint8Array;
      source: Uint8Array;
      mint: Uint8Array;
      destination: Uint8Array;
      authority: Uint8Array;
      amount: bigint;
      decimals: number;
    }
  | {
      kind: "AtaCreateIdempotent";
      tokenProgram: Uint8Array;
      payer: Uint8Array;
      ata: Uint8Array;
      owner: Uint8Array;
      mint: Uint8Array;
    }
  | {
      kind: "SplCloseAccount";
      programId: Uint8Array;
      account: Uint8Array;
      destination: Uint8Array;
      authority: Uint8Array;
    };

export interface SweepIntent {
  feePayer: Uint8Array;
  ixs: SweepIxIntent[];
}

const VARIANT_TAG: Record<SweepIxIntent["kind"], number> = {
  SystemTransfer: 0,
  SplTransferChecked: 1,
  AtaCreateIdempotent: 2,
  SplCloseAccount: 3,
};

/** uleb128 encode `value` and append to `out`. */
function writeUleb128(value: number, out: number[]): void {
  let x = value >>> 0;
  while (x >= 0x80) {
    out.push((x & 0x7f) | 0x80);
    x >>>= 7;
  }
  out.push(x);
}

/** BCS bytes: uleb128(len) || raw. */
function writeBcsBytes(bytes: Uint8Array, out: number[]): void {
  writeUleb128(bytes.length, out);
  for (let i = 0; i < bytes.length; i++) out.push(bytes[i]!);
}

function writeU64Le(value: bigint, out: number[]): void {
  let v = value;
  for (let i = 0; i < 8; i++) {
    out.push(Number(v & 0xffn));
    v >>= 8n;
  }
}

function writeU8(value: number, out: number[]): void {
  out.push(value & 0xff);
}

function encodeIntent(ix: SweepIxIntent, out: number[]): void {
  writeUleb128(VARIANT_TAG[ix.kind], out);
  switch (ix.kind) {
    case "SystemTransfer":
      writeBcsBytes(ix.from, out);
      writeBcsBytes(ix.to, out);
      writeU64Le(ix.lamports, out);
      return;
    case "SplTransferChecked":
      writeBcsBytes(ix.programId, out);
      writeBcsBytes(ix.source, out);
      writeBcsBytes(ix.mint, out);
      writeBcsBytes(ix.destination, out);
      writeBcsBytes(ix.authority, out);
      writeU64Le(ix.amount, out);
      writeU8(ix.decimals, out);
      return;
    case "AtaCreateIdempotent":
      writeBcsBytes(ix.tokenProgram, out);
      writeBcsBytes(ix.payer, out);
      writeBcsBytes(ix.ata, out);
      writeBcsBytes(ix.owner, out);
      writeBcsBytes(ix.mint, out);
      return;
    case "SplCloseAccount":
      writeBcsBytes(ix.programId, out);
      writeBcsBytes(ix.account, out);
      writeBcsBytes(ix.destination, out);
      writeBcsBytes(ix.authority, out);
      return;
  }
}

/** BCS-encode a SweepIntent (sans the outer Vec). */
function encodeOneIntent(intent: SweepIntent, out: number[]): void {
  writeBcsBytes(intent.feePayer, out);
  writeUleb128(intent.ixs.length, out);
  for (const ix of intent.ixs) encodeIntent(ix, out);
}

/** BCS-encode `vec![intents]`. Returns the raw byte buffer. */
export function bcsEncodeIntents(intents: SweepIntent[]): Uint8Array {
  const out: number[] = [];
  writeUleb128(intents.length, out);
  for (const i of intents) encodeOneIntent(i, out);
  return new Uint8Array(out);
}

/**
 * 32-byte structural intent digest =
 * `keccak256(bcs(vec![SweepIntent ...]))`. Matches the on-chain
 * `sweep::intent::hash_message_bytes` output.
 */
export function hashIntents(intents: SweepIntent[]): Uint8Array {
  return keccak_256(bcsEncodeIntents(intents));
}

/** Convenience builder for the only sweep variant the v3e UI ships:
 *  a single SOL transfer from the dWallet to a destination. */
export function buildSolTransferIntent(
  dwallet: Uint8Array,
  destination: Uint8Array,
  lamports: bigint,
): SweepIntent {
  return {
    feePayer: dwallet,
    ixs: [
      {
        kind: "SystemTransfer",
        from: dwallet,
        to: destination,
        lamports,
      },
    ],
  };
}

/**
 * Convenience builder for the SPL sweep variant. Two ix slots:
 *
 *   1. AtaCreateIdempotent — only emitted when the destination ATA
 *      doesn't exist yet. The ATA program's idempotent path is a
 *      no-op when the account already exists, so re-broadcasting is
 *      safe; we still keep the ix conditional because including it
 *      changes the structural digest, and the on-chain sweep parser
 *      reproduces our exact ix list.
 *   2. SplTransferChecked — moves `amount` from `sourceAta` to
 *      `destinationAta`, authorised by the dWallet.
 *
 * Caller is responsible for deriving ATAs and checking destination
 * existence (`getAccountInfo(destinationAta)`).
 */
export function buildSplTransferIntent(params: {
  dwallet: Uint8Array;
  programId: Uint8Array;
  mint: Uint8Array;
  sourceAta: Uint8Array;
  destinationOwner: Uint8Array;
  destinationAta: Uint8Array;
  destinationAtaExists: boolean;
  amount: bigint;
  decimals: number;
}): SweepIntent {
  const ixs: SweepIxIntent[] = [];
  if (!params.destinationAtaExists) {
    ixs.push({
      kind: "AtaCreateIdempotent",
      tokenProgram: params.programId,
      payer: params.dwallet,
      ata: params.destinationAta,
      owner: params.destinationOwner,
      mint: params.mint,
    });
  }
  ixs.push({
    kind: "SplTransferChecked",
    programId: params.programId,
    source: params.sourceAta,
    mint: params.mint,
    destination: params.destinationAta,
    authority: params.dwallet,
    amount: params.amount,
    decimals: params.decimals,
  });
  return { feePayer: params.dwallet, ixs };
}
