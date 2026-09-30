use hmac::{Hmac, Mac};
use sha2::Sha512;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum SignatureError {
    #[error("missing x-paystack-signature header")]
    MissingSignature,
    #[error("invalid hex signature")]
    InvalidHex,
    #[error("signature mismatch")]
    SignatureMismatch,
}

type HmacSha512 = Hmac<Sha512>;

pub fn verify_paystack_signature(
    secret_key: &str,
    raw_body: &[u8],
    x_paystack_signature: Option<&str>,
) -> Result<(), SignatureError> {
    // An unconfigured webhook secret is not a shared secret. Never accept
    // attacker-computable HMACs made with an empty key.
    if secret_key.trim().is_empty() {
        return Err(SignatureError::SignatureMismatch);
    }
    let provided = x_paystack_signature
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(SignatureError::MissingSignature)?;

    let provided = hex::decode(provided).map_err(|_| SignatureError::InvalidHex)?;
    let mut mac = HmacSha512::new_from_slice(secret_key.as_bytes())
        .map_err(|_| SignatureError::SignatureMismatch)?;
    mac.update(raw_body);
    // The MAC library checks length and compares in constant time.
    mac.verify_slice(&provided)
        .map_err(|_| SignatureError::SignatureMismatch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verifies_valid_signature() {
        let secret = "sk_test_sample";
        let body = br#"{\"event\":\"charge.success\",\"data\":{\"id\":1}}"#;

        let mut mac = HmacSha512::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let signature = hex::encode(mac.finalize().into_bytes());

        let result = verify_paystack_signature(secret, body, Some(&signature));
        assert!(result.is_ok());
    }

    #[test]
    fn rejects_unconfigured_secret_even_with_a_matching_hmac() {
        for secret in ["", "   "] {
            let mut mac = HmacSha512::new_from_slice(secret.as_bytes()).unwrap();
            mac.update(b"{}");
            let signature = hex::encode(mac.finalize().into_bytes());
            assert_eq!(
                verify_paystack_signature(secret, b"{}", Some(&signature)),
                Err(SignatureError::SignatureMismatch)
            );
        }
    }

    #[test]
    fn rejects_body_mutation_and_accepts_uppercase_hex() {
        let mut mac = HmacSha512::new_from_slice(b"configured-secret").unwrap();
        mac.update(b"original");
        let signature = hex::encode(mac.finalize().into_bytes()).to_ascii_uppercase();
        assert!(
            verify_paystack_signature("configured-secret", b"original", Some(&signature)).is_ok()
        );
        assert!(
            verify_paystack_signature("configured-secret", b"changed", Some(&signature)).is_err()
        );
    }

    #[test]
    fn rejects_missing_signature() {
        let result = verify_paystack_signature("sk_test_sample", b"{}", None);
        assert_eq!(result, Err(SignatureError::MissingSignature));
    }

    #[test]
    fn rejects_mismatch() {
        let result = verify_paystack_signature("sk_test_sample", b"{}", Some("deadbeef"));
        assert_eq!(result, Err(SignatureError::SignatureMismatch));
    }
}
