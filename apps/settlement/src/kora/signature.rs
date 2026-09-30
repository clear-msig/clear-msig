use hmac::{Hmac, Mac};
use sha2::Sha256;

pub fn verify_kora_signature(secret: &str, body: &str, provided_hex: &str) -> bool {
    if secret.trim().is_empty() {
        return false;
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unconfigured_secret_even_with_a_matching_hmac() {
        for secret in ["", "   "] {
            let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
            mac.update(b"{}");
            let signature = hex::encode(mac.finalize().into_bytes());
            assert!(!verify_kora_signature(secret, r#"{"data":{}}"#, &signature));
        }
    }

    #[test]
    fn accepts_configured_signature_and_rejects_data_substitution() {
        let mut mac = Hmac::<Sha256>::new_from_slice(b"configured-secret").unwrap();
        mac.update(br#"{"reference":"original"}"#);
        let signature = hex::encode(mac.finalize().into_bytes());
        assert!(verify_kora_signature(
            "configured-secret",
            r#"{"data":{"reference":"original"}}"#,
            &signature
        ));
        assert!(!verify_kora_signature(
            "configured-secret",
            r#"{"data":{"reference":"changed"}}"#,
            &signature
        ));
    }
}
