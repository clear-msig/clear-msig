use std::time::{SystemTime, UNIX_EPOCH};

use crate::ApiError;

pub(crate) fn ensure_non_empty(value: &str, field: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    Ok(())
}

pub(crate) fn current_unix_timestamp() -> Result<i64, ApiError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| ApiError::Internal(format!("system clock before unix epoch: {e}")))?;
    i64::try_from(duration.as_secs())
        .map_err(|_| ApiError::Internal("system clock timestamp out of range".into()))
}

pub(crate) fn ensure_hex(value: &str, field: &str) -> Result<(), ApiError> {
    let trimmed = value.trim();
    let hex = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    if hex.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    if hex.len() % 2 != 0 {
        return Err(ApiError::BadRequest(format!(
            "{field} must have an even number of hex characters"
        )));
    }
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ApiError::BadRequest(format!("{field} must be hex encoded")));
    }
    Ok(())
}

pub(crate) fn ensure_hex_exact_len(
    value: &str,
    field: &str,
    expected_bytes: usize,
) -> Result<(), ApiError> {
    ensure_hex(value, field)?;
    let trimmed = value.trim();
    let hex = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    let got = hex.len() / 2;
    if got != expected_bytes {
        return Err(ApiError::BadRequest(format!(
            "{field} must be {expected_bytes} bytes, got {got}"
        )));
    }
    Ok(())
}

pub(crate) fn ensure_intent_filename(value: &str, field: &str) -> Result<(), ApiError> {
    const ALLOWED_PREFIX: &str = "examples/intents/";

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    if trimmed.len() > 80 {
        return Err(ApiError::BadRequest(format!("{field} too long")));
    }

    let basename = trimmed.strip_prefix(ALLOWED_PREFIX).unwrap_or(trimmed);
    if basename.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    if basename.len() > 63 {
        return Err(ApiError::BadRequest(format!("{field} basename too long")));
    }
    if !basename.ends_with(".json") {
        return Err(ApiError::BadRequest(format!("{field} must end in .json")));
    }
    if basename.starts_with('.') || basename.contains("..") {
        return Err(ApiError::BadRequest(format!("{field} not permitted")));
    }
    if !basename
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err(ApiError::BadRequest(format!(
            "{field} contains disallowed characters"
        )));
    }
    Ok(())
}

pub(crate) fn ensure_base58_pubkey(value: &str, field: &str) -> Result<(), ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    if trimmed.len() < 32 || trimmed.len() > 44 {
        return Err(ApiError::BadRequest(format!(
            "{field} has wrong length for a Solana pubkey"
        )));
    }
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if !trimmed.bytes().all(|b| ALPHABET.contains(&b)) {
        return Err(ApiError::BadRequest(format!("{field} is not valid base58")));
    }
    let decoded = bs58::decode(trimmed)
        .into_vec()
        .map_err(|_| ApiError::BadRequest(format!("{field} is not valid base58")))?;
    if decoded.len() != 32 {
        return Err(ApiError::BadRequest(format!(
            "{field} must decode to a 32-byte Solana pubkey"
        )));
    }
    Ok(())
}

pub(crate) fn ensure_non_empty_vec(value: &[String], field: &str) -> Result<(), ApiError> {
    if value.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    if value.iter().any(|v| v.trim().is_empty()) {
        return Err(ApiError::BadRequest(format!(
            "{field} contains an empty value"
        )));
    }
    Ok(())
}

pub(crate) fn ensure_wallet_name(value: &str, field: &str) -> Result<(), ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    if trimmed.len() > 64 {
        return Err(ApiError::BadRequest(format!(
            "{field} must be 64 characters or fewer"
        )));
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(ApiError::BadRequest(format!(
            "{field} must not contain control characters"
        )));
    }
    Ok(())
}

pub(crate) fn ensure_chain(value: &str, field: &str) -> Result<(), ApiError> {
    const ALLOWED: &[&str] = &[
        "solana",
        "evm_1559",
        "evm_1559_erc20",
        "bitcoin_p2wpkh",
        "zcash_transparent",
        "hyperliquid_evm",
        "hyperliquid",
    ];
    let trimmed = value.trim();
    if !ALLOWED.contains(&trimmed) {
        return Err(ApiError::BadRequest(format!(
            "{field} must be one of: {}",
            ALLOWED.join(", ")
        )));
    }
    Ok(())
}

pub(crate) fn ensure_base58(
    value: &str,
    field: &str,
    min_len: usize,
    max_len: usize,
) -> Result<(), ApiError> {
    let trimmed = value.trim();
    if trimmed.len() < min_len || trimmed.len() > max_len {
        return Err(ApiError::BadRequest(format!(
            "{field} must be {min_len}-{max_len} characters of base58"
        )));
    }
    const BASE58: &str = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if !trimmed.chars().all(|c| BASE58.contains(c)) {
        return Err(ApiError::BadRequest(format!(
            "{field} contains characters outside the base58 alphabet"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clearsign::PreSigned;

    #[test]
    fn ensure_chain_accepts_hyperliquid_aliases() {
        ensure_chain("hyperliquid_evm", "chain").unwrap();
        ensure_chain("hyperliquid", "chain").unwrap();
    }

    #[test]
    fn ensure_chain_rejects_unknown_chain() {
        let err = ensure_chain("sui", "chain").unwrap_err();
        match err {
            ApiError::BadRequest(message) => {
                assert!(message.contains("hyperliquid_evm"));
                assert!(message.contains("hyperliquid"));
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn ensure_hex_exact_len_rejects_malformed_signature() {
        let err = ensure_hex_exact_len("abc", "signature", 64).unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(_)));

        let err = ensure_hex_exact_len("00", "signature", 64).unwrap_err();
        match err {
            ApiError::BadRequest(message) => assert!(message.contains("64 bytes")),
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn presigned_rejects_stale_expiry() {
        let ps = PreSigned {
            signer_pubkey: "11111111111111111111111111111111".to_string(),
            signature: "00".repeat(64),
            message_flavor: None,
            params_data_hex: Some("00".to_string()),
            expiry: current_unix_timestamp().unwrap(),
        };
        let err = ps.ensure_valid().unwrap_err();
        match err {
            ApiError::BadRequest(message) => assert!(message.contains("expired")),
            other => panic!("unexpected error: {other:?}"),
        }
    }
}
