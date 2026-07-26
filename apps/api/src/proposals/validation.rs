use crate::{ensure_hex_exact_len, ensure_non_empty, ApiError};

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

fn ensure_typed_text(value: &str, field: &str) -> Result<(), ApiError> {
    ensure_non_empty(value, field)?;
    if value.len() > 128 {
        return Err(ApiError::BadRequest(format!(
            "{field} must be 128 bytes or fewer"
        )));
    }
    if value.chars().any(char::is_control) {
        return Err(ApiError::BadRequest(format!(
            "{field} must not contain control characters"
        )));
    }
    Ok(())
}
