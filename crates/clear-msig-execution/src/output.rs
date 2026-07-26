use std::cell::RefCell;
use std::fmt::Arguments;

use serde::Serialize;
use serde_json::Value;

thread_local! {
    static JSON_CAPTURE: RefCell<Option<Vec<Value>>> = const { RefCell::new(None) };
}

struct CaptureGuard {
    previous: Option<Vec<Value>>,
    finished: bool,
}

impl CaptureGuard {
    fn start() -> Self {
        let previous = JSON_CAPTURE.with(|capture| capture.replace(Some(Vec::new())));
        Self {
            previous,
            finished: false,
        }
    }

    fn finish(mut self) -> Vec<Value> {
        let values = JSON_CAPTURE.with(|capture| capture.replace(self.previous.take()));
        self.finished = true;
        values.unwrap_or_default()
    }
}

impl Drop for CaptureGuard {
    fn drop(&mut self) {
        if !self.finished {
            JSON_CAPTURE.with(|capture| {
                capture.replace(self.previous.take());
            });
        }
    }
}

pub fn capture_json<T>(operation: impl FnOnce() -> T) -> (T, Vec<Value>) {
    let guard = CaptureGuard::start();
    let result = operation();
    (result, guard.finish())
}

pub fn emit_progress(arguments: Arguments<'_>) {
    let embedded = JSON_CAPTURE.with(|capture| capture.borrow().is_some());
    if !embedded {
        eprintln!("{arguments}");
    }
}

/// Print a JSON value to stdout.
pub fn print_json<T: Serialize>(value: &T) {
    let value = serde_json::to_value(value).unwrap();
    let captured = JSON_CAPTURE.with(|capture| {
        let mut capture = capture.borrow_mut();
        if let Some(values) = capture.as_mut() {
            values.push(value.clone());
            true
        } else {
            false
        }
    });
    if !captured {
        println!("{}", serde_json::to_string_pretty(&value).unwrap());
    }
}

/// A structured descriptor of what a signing action is about to do.
/// Emitted when `--dry-run` is set so a caller (typically the browser)
/// can ask the CLI "what exactly do I need to sign?" before prompting
/// the user's wallet.
///
/// The invariant that matters: `message_hex` is the EXACT bytes the
/// pre-signed mode signer would later verify against. A wallet that
/// signs `message_hex` verbatim will round-trip through the CLI without
/// a mismatch error.
#[derive(Serialize)]
pub struct DryRunDescriptor<'a> {
    pub action: &'a str,
    pub wallet_name: &'a str,
    pub wallet_pubkey: String,
    pub intent_index: u8,
    pub intent_pubkey: String,
    /// Solana offchain-wrapped message bytes, hex. This is what the
    /// wallet should sign with `signMessage`.
    pub message_hex: String,
    /// params_data bytes, hex. The relayer must echo this back as the
    /// `--params-data` CLI flag so the on-chain instruction is built
    /// from the same bytes that were signed over.
    pub params_data_hex: String,
    /// Unix timestamp at which the signature expires. Immutable — the
    /// browser must pass this back as `--expiry` on the follow-up call
    /// or it will rebuild a different message.
    pub expiry: i64,
    /// Proposal-related fields. Null for actions that don't derive a
    /// proposal PDA (intent list, wallet show, etc.).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_pubkey: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proposal_index: Option<u64>,
}

pub fn print_dry_run(descriptor: &DryRunDescriptor<'_>) {
    print_json(descriptor);
}

#[derive(Serialize)]
pub struct TypedDryRunDescriptor<'a> {
    pub action: &'a str,
    pub wallet_name: &'a str,
    pub wallet_pubkey: String,
    pub intent_index: u8,
    pub intent_pubkey: String,
    pub proposal_pubkey: String,
    pub proposal_index: u64,
    pub signer_pubkey: String,
    pub approval_requirement: u8,
    pub approval_count_after: u8,
    pub approval_kind: &'a str,
    pub action_kind: u8,
    pub policy_commitment_hex: String,
    pub payload_hash_hex: String,
    pub envelope_hash_hex: String,
    pub action_id: String,
    pub nonce: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_intent_hex: Option<String>,
    /// Exact readable ClearSign proposal document bytes to sign.
    pub message_hex: String,
    pub message_flavor: &'a str,
    pub expiry: i64,
}

pub fn print_typed_dry_run(descriptor: &TypedDryRunDescriptor<'_>) {
    print_json(descriptor);
}

/// Helper to hex-encode a byte slice.
pub fn hex_of(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::{capture_json, print_json};

    #[test]
    fn captures_structured_output_without_leaking_nested_state() {
        let (_, outer) = capture_json(|| {
            print_json(&serde_json::json!({ "scope": "outer-before" }));
            let (_, inner) = capture_json(|| {
                print_json(&serde_json::json!({ "scope": "inner" }));
            });
            assert_eq!(inner, vec![serde_json::json!({ "scope": "inner" })]);
            print_json(&serde_json::json!({ "scope": "outer-after" }));
        });

        assert_eq!(
            outer,
            vec![
                serde_json::json!({ "scope": "outer-before" }),
                serde_json::json!({ "scope": "outer-after" }),
            ]
        );
    }

    #[test]
    fn restores_capture_state_after_a_panic() {
        let _ = std::panic::catch_unwind(|| {
            capture_json(|| panic!("simulated embedded command panic"));
        });
        let (_, values) = capture_json(|| print_json(&serde_json::json!({ "ok": true })));
        assert_eq!(values, vec![serde_json::json!({ "ok": true })]);
    }
}
