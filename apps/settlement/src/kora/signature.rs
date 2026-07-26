use hmac::{Hmac, Mac};
use sha2::Sha256;

pub fn verify_kora_signature(secret: &str, body: &str, provided_hex: &str) -> bool {
    let parsed: serde_json::Value = match serde_json::from_str(body) {
        Ok(value) => value,
        Err(_) => return false,
    };

    let data = parsed
        .get("data")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let canonical_data = match serde_json::to_string(&data) {
        Ok(value) => value,
        Err(_) => return false,
    };

    let mut mac = match Hmac::<Sha256>::new_from_slice(secret.as_bytes()) {
        Ok(value) => value,
        Err(_) => return false,
    };

    mac.update(canonical_data.as_bytes());

    let provided = match hex::decode(provided_hex.trim()) {
        Ok(value) => value,
        Err(_) => return false,
    };

    mac.verify_slice(&provided).is_ok()
}
