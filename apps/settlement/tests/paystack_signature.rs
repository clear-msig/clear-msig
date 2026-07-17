use hmac::{Hmac, Mac};
use rust_settlement::paystack::signature::verify_paystack_signature;
use sha2::Sha512;

type HmacSha512 = Hmac<Sha512>;

#[test]
fn webhook_signature_roundtrip() {
    let secret = "sk_test_demo";
    let body = br#"{\"event\":\"transfer.success\",\"data\":{\"id\":42}}"#;

    let mut mac = HmacSha512::new_from_slice(secret.as_bytes()).expect("hmac key");
    mac.update(body);
    let signature = hex::encode(mac.finalize().into_bytes());

    let result = verify_paystack_signature(secret, body, Some(&signature));
    assert!(result.is_ok());
}
