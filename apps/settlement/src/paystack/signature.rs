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
    let provided = x_paystack_signature
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(SignatureError::MissingSignature)?;

    let provided_lower = provided.to_ascii_lowercase();

    if provided_lower.len() % 2 != 0 || hex::decode(&provided_lower).is_err() {
        return Err(SignatureError::InvalidHex);
    }

    let mut mac = HmacSha512::new_from_slice(secret_key.as_bytes())
        .map_err(|_| SignatureError::SignatureMismatch)?;
    mac.update(raw_body);
    let expected = hex::encode(mac.finalize().into_bytes());

    if expected == provided_lower {
        Ok(())
    } else {
        Err(SignatureError::SignatureMismatch)
    }
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
