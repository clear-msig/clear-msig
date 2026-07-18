use clear_msig_signing::IdentityEncoding;
use serde_json::Value;

use super::payload::{normalize_text, payload_u32, AssetEncoding};
use crate::ApiError;

const MAX_POLICY_BYTES: usize = 2_048;

pub(super) fn payload_u8(payload: &Value, field: &str) -> Result<u8, ApiError> {
    u8::try_from(payload_u32(payload, field)?)
        .map_err(|_| ApiError::BadRequest(format!("payload.{field} must fit in one byte")))
}

pub(super) fn strict_required_text(
    payload: &Value,
    field: &str,
    max_bytes: usize,
) -> Result<String, ApiError> {
    let value = strict_optional_text(payload, field, max_bytes)?;
    if value.is_empty() {
        return Err(ApiError::BadRequest(format!(
            "payload.{field} must not be empty"
        )));
    }
    Ok(value)
}

pub(super) fn payload_u128(payload: &Value, field: &str) -> Result<u128, ApiError> {
    let value = payload.get(field).ok_or_else(|| {
        ApiError::BadRequest(format!("payload.{field} must be an unsigned integer"))
    })?;
    let text = match value {
        Value::String(value) => value.trim().to_string(),
        Value::Number(value) if value.as_u64().is_some() => value.to_string(),
        _ => {
            return Err(ApiError::BadRequest(format!(
                "payload.{field} must be an unsigned integer"
            )))
        }
    };
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(ApiError::BadRequest(format!(
            "payload.{field} must be an unsigned integer"
        )));
    }
    text.parse::<u128>()
        .map_err(|_| ApiError::BadRequest(format!("payload.{field} is too large")))
}

pub(super) fn payload_u64_strict(payload: &Value, field: &str) -> Result<u64, ApiError> {
    u64::try_from(payload_u128(payload, field)?)
        .map_err(|_| ApiError::BadRequest(format!("payload.{field} is too large")))
}

pub(super) fn payload_i64(payload: &Value, field: &str) -> Result<i64, ApiError> {
    payload
        .get(field)
        .and_then(Value::as_i64)
        .ok_or_else(|| ApiError::BadRequest(format!("payload.{field} must be an integer")))
}

pub(super) fn payload_status(
    payload: &Value,
    field: &str,
    allowed: &[(&str, u8)],
) -> Result<u8, ApiError> {
    let value = strict_required_text(payload, field, 32)?;
    allowed
        .iter()
        .find_map(|(label, code)| value.eq_ignore_ascii_case(label).then_some(*code))
        .ok_or_else(|| ApiError::BadRequest(format!("payload.{field} is not supported")))
}

pub(super) fn decode_payload_hash(payload: &Value, field: &str) -> Result<[u8; 32], ApiError> {
    let value = strict_required_text(payload, field, 66)?;
    let decoded = decode_hex_32(&value, &format!("payload.{field}"))?;
    if decoded == [0u8; 32] {
        return Err(ApiError::BadRequest(format!(
            "payload.{field} must not be the zero hash"
        )));
    }
    Ok(decoded)
}

pub(super) fn payload_pubkeys(payload: &Value, field: &str) -> Result<Vec<[u8; 32]>, ApiError> {
    payload
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::BadRequest(format!("payload.{field} must be an array")))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| {
                    ApiError::BadRequest(format!("payload.{field} entries must be strings"))
                })
                .and_then(|value| decode_base58_32(value, &format!("payload.{field}")))
        })
        .collect()
}

pub(super) fn asset_encoding(value: AssetEncoding) -> IdentityEncoding {
    match value {
        AssetEncoding::Text => IdentityEncoding::Text,
        AssetEncoding::SolanaPubkey => IdentityEncoding::SolanaPubkey,
        AssetEncoding::Sha256Text => IdentityEncoding::Sha256Text,
    }
}

pub(super) fn validate_replay_label(value: &str, field: &str) -> Result<(), ApiError> {
    if value.is_empty() || value.len() > 128 || !value.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err(ApiError::BadRequest(format!(
            "{field} must be 1 to 128 visible ASCII bytes with no whitespace"
        )));
    }
    Ok(())
}

pub(super) fn strict_optional_text(
    payload: &Value,
    field: &str,
    max_bytes: usize,
) -> Result<String, ApiError> {
    let Some(value) = payload.get(field) else {
        return Ok(String::new());
    };
    if value.is_null() {
        return Ok(String::new());
    }
    let value = value
        .as_str()
        .ok_or_else(|| ApiError::BadRequest(format!("payload.{field} must be a string")))?;
    if value.len() > max_bytes || value.bytes().any(|byte| !(0x20..=0x7e).contains(&byte)) {
        return Err(ApiError::BadRequest(format!(
            "payload.{field} must be at most {max_bytes} visible ASCII bytes"
        )));
    }
    Ok(normalize_text(value))
}

pub(super) fn value_string<'a>(value: &'a Value, field: &str) -> Result<&'a str, ApiError> {
    value
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::InvalidOutput(format!("trusted command did not return {field}")))
}

pub(super) fn value_u64(value: &Value, field: &str) -> Result<u64, ApiError> {
    value
        .get(field)
        .and_then(Value::as_u64)
        .ok_or_else(|| ApiError::InvalidOutput(format!("trusted command did not return {field}")))
}

pub(super) fn value_u8(value: &Value, field: &str) -> Result<u8, ApiError> {
    u8::try_from(value_u64(value, field)?)
        .map_err(|_| ApiError::InvalidOutput(format!("trusted {field} does not fit in one byte")))
}

pub(super) fn value_pubkeys(value: &Value, field: &str) -> Result<Vec<[u8; 32]>, ApiError> {
    value
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::InvalidOutput(format!("trusted command did not return {field}")))?
        .iter()
        .map(|item| {
            item.as_str()
                .ok_or_else(|| {
                    ApiError::InvalidOutput(format!("trusted {field} entry is not text"))
                })
                .and_then(|value| decode_base58_32(value, field))
        })
        .collect()
}

pub(super) fn decode_base58_32(value: &str, field: &str) -> Result<[u8; 32], ApiError> {
    let bytes = bs58::decode(value.trim())
        .into_vec()
        .map_err(|_| ApiError::BadRequest(format!("{field} must be a base58 public key")))?;
    bytes
        .try_into()
        .map_err(|_| ApiError::BadRequest(format!("{field} must decode to 32 bytes")))
}

pub(super) fn decode_bounded_hex(value: &str, field: &str) -> Result<Vec<u8>, ApiError> {
    let value = value.trim().strip_prefix("0x").unwrap_or(value.trim());
    if value.len() > MAX_POLICY_BYTES * 2 || !value.len().is_multiple_of(2) {
        return Err(ApiError::BadRequest(format!(
            "{field} must be even-length hex encoding at most {MAX_POLICY_BYTES} bytes"
        )));
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|chunk| {
            let pair = core::str::from_utf8(chunk)
                .map_err(|_| ApiError::BadRequest(format!("{field} must be hex encoded")))?;
            u8::from_str_radix(pair, 16)
                .map_err(|_| ApiError::BadRequest(format!("{field} must be hex encoded")))
        })
        .collect()
}

pub(super) fn decode_hex_32(value: &str, field: &str) -> Result<[u8; 32], ApiError> {
    let bytes = decode_bounded_hex(value, field)?;
    bytes
        .try_into()
        .map_err(|_| ApiError::BadRequest(format!("{field} must encode exactly 32 bytes")))
}

pub(super) fn signing_error(error: clear_msig_signing::Error) -> ApiError {
    ApiError::BadRequest(format!("canonical ClearSign intent is invalid: {error:?}"))
}

pub(super) fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
