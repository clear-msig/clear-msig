//! Bitcoin P2WPKH (single-input, one-or-two-output) BIP143 preimage builder.
//!
//! Builds the BIP143 sighash **preimage** for a single P2WPKH input spending
//! to a recipient output and, for the v2 schema, an optional change output.
//! This module no longer applies the final
//! `sha256d` to the preimage — the on-chain `MessageApproval.message_hash`
//! is computed by [`crate::chains::dispatch_sighash`] as `keccak256(preimage)`
//! so that every chain stores the same kind of uniqueness key, and the
//! dwallet network independently re-applies `sha256d` (via
//! `hash_scheme = DoubleSHA256`) to produce the actual ECDSA signing digest
//! off-chain. The inner `hashPrevouts` / `hashSequence` / `hashOutputs`
//! commitments still use `sha256d` because they are part of the BIP143
//! preimage definition itself, not a final hash on top of it.
//!
//! Spec: https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki
//!
//! Preimage layout (BIP143):
//!   1.  nVersion       (4 LE)
//!   2.  hashPrevouts   (32)
//!   3.  hashSequence   (32)
//!   4.  outpoint       (36)
//!   5.  scriptCode     (varint length + bytes; for P2WPKH this is
//!                       `1976a914{20-byte-pubkey-hash}88ac` = 26 bytes total)
//!   6.  amount         (8 LE) — value of the input being spent
//!   7.  nSequence      (4 LE)
//!   8.  hashOutputs    (32)
//!   9.  nLockTime      (4 LE)
//!   10. sighash type   (4 LE) — we always use SIGHASH_ALL = 0x01
//!
//! Since we have exactly one input:
//!   hashPrevouts = sha256d(outpoint)
//!   hashSequence = sha256d(nSequence_le)
//!   hashOutputs  = sha256d(each output serialized as value || scriptPubKey)
//!
//! # Tx template format
//!
//! 16 bytes:
//!   version    (4, LE u32) — typically 2
//!   lock_time  (4, LE u32) — typically 0
//!   sequence   (4, LE u32) — typically 0xfffffffd (RBF)
//!   sighash    (4, LE u32) — typically 0x01 (SIGHASH_ALL)
//!
//! # Param schema
//!
//!   param[0] = prev_txid       : Bytes32   (input UTXO txid, internal byte order)
//!   param[1] = prev_vout       : U64       (input UTXO index; we read first 4 bytes)
//!   param[2] = prev_amount_sats: U64       (value of the UTXO being spent)
//!   param[3] = sender_pkh      : Bytes20   (HASH160 of input's pubkey, for scriptCode)
//!   param[4] = recipient_pkh   : Bytes20   (HASH160 of recipient pubkey)
//!   param[5] = send_amount_sats: U64       (output value)
//!   param[6] = change_pkh      : Bytes20   (v2 optional; HASH160 for change)
//!   param[7] = fee_sats        : U64       (v2 optional; exact miner fee)
//!
//! Approvers see e.g. `"send {5} sats to bc1q-pkh:0x{4} (input {0}:{1})"`.
//!
//! Note: legacy 6-param intents still work with the original implied-fee
//! single-output shape. New 8-param intents commit to an exact fee and return
//! the remainder to `change_pkh`.

use quasar_lang::prelude::*;
use sha2::{Digest, Sha256};

use super::{read_bytes20, read_bytes32, read_u64};
use crate::state::intent::Intent;

pub const TX_TEMPLATE_LEN: usize = 16;

/// BIP143 preimage length for one P2WPKH input + one P2WPKH output:
/// 4 + 32 + 32 + 36 + 26 + 8 + 4 + 32 + 4 + 4 = 182 bytes.
const PREIMAGE_LEN: usize = 182;

pub fn build_preimage(
    intent: &Intent<'_>,
    params_data: &[u8],
    tx_template: &[u8],
    out: &mut [u8],
) -> Result<usize, ProgramError> {
    if tx_template.len() != TX_TEMPLATE_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    if out.len() < PREIMAGE_LEN {
        return Err(ProgramError::InvalidInstructionData);
    }
    let version = u32::from_le_bytes(tx_template[0..4].try_into().unwrap());
    let lock_time = u32::from_le_bytes(tx_template[4..8].try_into().unwrap());
    let sequence = u32::from_le_bytes(tx_template[8..12].try_into().unwrap());
    let sighash_type = u32::from_le_bytes(tx_template[12..16].try_into().unwrap());

    let prev_txid = read_bytes32(intent, params_data, 0)?;
    let prev_vout = read_u64(intent, params_data, 1)? as u32;
    let prev_amount = read_u64(intent, params_data, 2)?;
    let _sender_pkh = read_bytes20(intent, params_data, 3)?; // unused unless we need to bind
    let recipient_pkh = read_bytes20(intent, params_data, 4)?;
    let send_amount = read_u64(intent, params_data, 5)?;

    // outpoint = prev_txid (32) || prev_vout (4 LE)
    let mut outpoint = [0u8; 36];
    outpoint[..32].copy_from_slice(&prev_txid);
    outpoint[32..36].copy_from_slice(&prev_vout.to_le_bytes());

    // hashPrevouts = sha256d(outpoint)
    let hash_prevouts = sha256d(&outpoint);

    // hashSequence = sha256d(sequence_le)
    let hash_sequence = sha256d(&sequence.to_le_bytes());

    // hashOutputs = sha256d(serialized outputs). Legacy BTC intents had a
    // single recipient output and treated prev-send as the fee. V2 intents
    // add change_pkh + fee_sats, so the change returns to the wallet.
    let mut outputs = [0u8; 62];
    write_p2wpkh_output(&mut outputs[0..31], send_amount, &recipient_pkh);
    let outputs_len = if intent.params().len() >= 8 {
        let change_pkh = read_bytes20(intent, params_data, 6)?;
        let fee_sats = read_u64(intent, params_data, 7)?;
        let after_send = prev_amount
            .checked_sub(send_amount)
            .ok_or(ProgramError::InvalidInstructionData)?;
        let change_amount = after_send
            .checked_sub(fee_sats)
            .ok_or(ProgramError::InvalidInstructionData)?;
        if change_amount > 0 {
            write_p2wpkh_output(&mut outputs[31..62], change_amount, &change_pkh);
            62
        } else {
            31
        }
    } else {
        31
    };
    let hash_outputs = sha256d(&outputs[..outputs_len]);

    // scriptCode for P2WPKH = 0x1976a914 || pkh(20) || 0x88ac (26 bytes total)
    // The pkh used here is the *input's* HASH160 (the spender's pubkey).
    let mut script_code = [0u8; 26];
    script_code[0] = 0x19; // length prefix (varint, 25 bytes)
    script_code[1] = 0x76; // OP_DUP
    script_code[2] = 0xa9; // OP_HASH160
    script_code[3] = 0x14; // push20
    script_code[4..24].copy_from_slice(&_sender_pkh);
    script_code[24] = 0x88; // OP_EQUALVERIFY
    script_code[25] = 0xac; // OP_CHECKSIG

    // Assemble the BIP143 preimage directly into the caller's `out` buffer.
    let mut p = 0;
    out[p..p + 4].copy_from_slice(&version.to_le_bytes());
    p += 4;
    out[p..p + 32].copy_from_slice(&hash_prevouts);
    p += 32;
    out[p..p + 32].copy_from_slice(&hash_sequence);
    p += 32;
    out[p..p + 36].copy_from_slice(&outpoint);
    p += 36;
    out[p..p + 26].copy_from_slice(&script_code);
    p += 26;
    out[p..p + 8].copy_from_slice(&prev_amount.to_le_bytes());
    p += 8;
    out[p..p + 4].copy_from_slice(&sequence.to_le_bytes());
    p += 4;
    out[p..p + 32].copy_from_slice(&hash_outputs);
    p += 32;
    out[p..p + 4].copy_from_slice(&lock_time.to_le_bytes());
    p += 4;
    out[p..p + 4].copy_from_slice(&sighash_type.to_le_bytes());
    p += 4;
    debug_assert_eq!(p, PREIMAGE_LEN);

    Ok(PREIMAGE_LEN)
}

/// Bitcoin double-SHA256: `sha256(sha256(data))`.
fn sha256d(data: &[u8]) -> [u8; 32] {
    let first = Sha256::digest(data);
    let second = Sha256::digest(first);
    let mut out = [0u8; 32];
    out.copy_from_slice(&second);
    out
}

fn write_p2wpkh_output(out: &mut [u8], amount_sats: u64, pkh: &[u8; 20]) {
    out[..8].copy_from_slice(&amount_sats.to_le_bytes());
    out[8] = 22; // CompactSize varint for P2WPKH scriptPubKey length.
    out[9] = 0x00;
    out[10] = 0x14;
    out[11..31].copy_from_slice(pkh);
}
