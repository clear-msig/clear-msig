use crate::{ensure_base58, ensure_hex_exact_len, ensure_non_empty, ApiError};

use crate::clearsign::PreSigned;

pub(super) fn validate_typed_create_fields(
    action_kind: u8,
    policy_commitment: &str,
    payload_hash: &str,
    envelope_hash: &str,
    action_id: &str,
    nonce: &str,
) -> Result<(), ApiError> {
    if !(1..=11).contains(&action_kind) {
        return Err(ApiError::BadRequest(
            "action_kind must be between 1 and 11".into(),
        ));
    }
    ensure_hex_exact_len(policy_commitment, "policy_commitment", 32)?;
    ensure_hex_exact_len(payload_hash, "payload_hash", 32)?;
    ensure_hex_exact_len(envelope_hash, "envelope_hash", 32)?;
    ensure_typed_text(action_id, "action_id")?;
    ensure_typed_text(nonce, "nonce")?;
    Ok(())
}

pub(super) fn push_typed_pre_signed_flags(args: &mut Vec<String>, ps: &PreSigned) {
    args.push("--signer-pubkey".into());
    args.push(ps.signer_pubkey.clone());
    args.push("--signature".into());
    args.push(ps.signature.clone());
    if let Some(flavor) = &ps.message_flavor {
        args.push("--message-flavor".into());
        args.push(flavor.clone());
    }
    if let Some(hex) = &ps.signed_message_hex {
        args.push("--signed-message".into());
        args.push(hex.clone());
    }
}

pub(super) fn push_actor_pubkey(
    args: &mut Vec<String>,
    actor: &Option<String>,
) -> Result<(), ApiError> {
    let Some(pk) = actor.as_deref() else {
        return Ok(());
    };
    let trimmed = pk.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    ensure_base58(trimmed, "actor_pubkey", 32, 44)?;
    args.push("--signer-pubkey".to_string());
    args.push(trimmed.to_string());
    Ok(())
}

fn ensure_typed_text(value: &str, field: &str) -> Result<(), ApiError> {
    ensure_non_empty(value, field)?;
    if value.len() > 128 {
        return Err(ApiError::BadRequest(format!(
            "{field} must be 128 bytes or fewer"
        )));
    }
    Ok(())
}
