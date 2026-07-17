use super::*;

pub(in crate::commands::proposal) fn message_approval_is_signed(data: &[u8]) -> bool {
    data.len() > ika::MA_STATUS && data[ika::MA_STATUS] == ika::MA_STATUS_SIGNED
}

pub(in crate::commands::proposal) fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub(in crate::commands::proposal) fn attestation_session_for_binding(
    attestation: &NetworkSignedAttestation,
    expected_public_key: &[u8],
    expected_session_hex: &str,
) -> Result<[u8; 32]> {
    let versioned: VersionedDWalletDataAttestation = bcs::from_bytes(&attestation.attestation_data)
        .with_context(|| "failed to decode dWallet attestation")?;
    let VersionedDWalletDataAttestation::V1(data) = versioned;

    if data.public_key != expected_public_key {
        return Err(anyhow!(
            "attestation public_key={} but current dWallet public_key={}",
            hex_lower(&data.public_key),
            hex_lower(expected_public_key),
        ));
    }

    let expected_session = parse_hex_local(expected_session_hex)
        .with_context(|| "failed to decode IkaConfig.user_pubkey session id")?;
    if expected_session.len() != 32 {
        return Err(anyhow!(
            "IkaConfig.user_pubkey must be 32 bytes, got {}",
            expected_session.len()
        ));
    }
    if data.session_identifier[..] != expected_session[..] {
        return Err(anyhow!(
            "attestation session_identifier={} but IkaConfig.user_pubkey={}",
            hex_lower(&data.session_identifier),
            expected_session_hex,
        ));
    }

    Ok(data.session_identifier)
}

/// Build the chain-specific [`crate::chains::BroadcastInputs`] payload from
/// the intent's params + tx_template. EVM-compatible chains do not need any
/// extras (the EIP-1559 RLP is fully self-describing), so chains 1, 4, and 5
/// short-circuit to `BroadcastInputs::Evm`. Bitcoin BIP143 commits to its
/// outputs as a hash, so we have to plumb the originals through.
pub(in crate::commands::proposal) fn build_broadcast_inputs(
    chain_kind: u8,
    intent: &accounts::IntentAccount,
    params_data: &[u8],
) -> Result<crate::chains::BroadcastInputs> {
    use crate::chains::BroadcastInputs;
    use crate::ika;

    match chain_kind {
        0 => {
            let destination = ika::read_param_bytes32(intent, params_data, 0)?;
            let amount_lamports = ika::read_param_u64(intent, params_data, 1)?;
            Ok(BroadcastInputs::Solana {
                destination,
                amount_lamports,
            })
        }
        1 | 4 | 5 => Ok(BroadcastInputs::Evm),
        2 => {
            // Param schema (must match `clear_wallet::chains::bitcoin`):
            //   [0] prev_txid       : Bytes32
            //   [1] prev_vout       : U64 (we use the low 32 bits)
            //   [2] prev_amount     : U64  (committed via BIP143 amount field)
            //   [3] sender_pkh      : Bytes20 (committed via scriptCode)
            //   [4] recipient_pkh   : Bytes20 ← needed for output assembly
            //   [5] send_amount_sats: U64    ← needed for output assembly
            //   [6] change_pkh      : Bytes20 ← v2 optional change output
            //   [7] fee_sats        : U64    ← v2 exact miner fee
            let prev_txid = ika::read_param_bytes32(intent, params_data, 0)?;
            let prev_vout = ika::read_param_u64(intent, params_data, 1)? as u32;
            let prev_amount_sats = ika::read_param_u64(intent, params_data, 2)?;
            // Skip sender_pkh (committed via scriptCode); we don't need it
            // again for the witness tx body.
            let recipient_pkh = ika::read_param_bytes20(intent, params_data, 4)?;
            let send_amount_sats = ika::read_param_u64(intent, params_data, 5)?;
            let (change_pkh, change_amount_sats) = if intent.params.len() >= 8 {
                let change_pkh = ika::read_param_bytes20(intent, params_data, 6)?;
                let fee_sats = ika::read_param_u64(intent, params_data, 7)?;
                let change_amount_sats = prev_amount_sats
                    .checked_sub(send_amount_sats)
                    .and_then(|remaining| remaining.checked_sub(fee_sats))
                    .ok_or_else(|| anyhow!("bitcoin change amount underflow"))?;
                (Some(change_pkh), change_amount_sats)
            } else {
                (None, 0)
            };

            // tx_template layout (16 bytes):
            //   version(4) || lock_time(4) || sequence(4) || sighash_type(4)
            // Pull out sequence + lock_time so the broadcast tx body matches
            // the BIP143 preimage byte-for-byte.
            let off = intent.tx_template_offset as usize;
            let len = intent.tx_template_len as usize;
            if len != 16 {
                return Err(anyhow!(
                    "bitcoin_p2wpkh tx_template must be 16 bytes, got {len}"
                ));
            }
            let tt = intent
                .byte_pool
                .get(off..off + len)
                .ok_or(anyhow!("tx_template OOB"))?;
            let lock_time = u32::from_le_bytes(tt[4..8].try_into().unwrap());
            let sequence = u32::from_le_bytes(tt[8..12].try_into().unwrap());

            Ok(BroadcastInputs::BitcoinP2wpkh {
                prev_txid,
                prev_vout,
                sequence,
                recipient_pkh,
                send_amount_sats,
                change_pkh,
                change_amount_sats,
                lock_time,
            })
        }
        3 => {
            let prev_txid = ika::read_param_bytes32(intent, params_data, 0)?;
            let prev_vout = ika::read_param_u64(intent, params_data, 1)? as u32;
            let recipient_pkh = ika::read_param_bytes20(intent, params_data, 4)?;
            let send_amount_zat = ika::read_param_u64(intent, params_data, 5)?;

            let off = intent.tx_template_offset as usize;
            let len = intent.tx_template_len as usize;
            if len != 20 {
                return Err(anyhow!(
                    "zcash_transparent tx_template must be 20 bytes, got {len}"
                ));
            }
            let tt = intent
                .byte_pool
                .get(off..off + len)
                .ok_or(anyhow!("tx_template OOB"))?;
            let header = u32::from_le_bytes(tt[0..4].try_into().unwrap());
            let version_group_id = u32::from_le_bytes(tt[4..8].try_into().unwrap());
            let lock_time = u32::from_le_bytes(tt[8..12].try_into().unwrap());
            let expiry_height = u32::from_le_bytes(tt[12..16].try_into().unwrap());

            Ok(BroadcastInputs::ZcashTransparent {
                header,
                version_group_id,
                prev_txid,
                prev_vout,
                recipient_pkh,
                send_amount_zat,
                lock_time,
                expiry_height,
            })
        }
        n => Err(anyhow!("broadcast not supported for chain_kind {n}")),
    }
}
