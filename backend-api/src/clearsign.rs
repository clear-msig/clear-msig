use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;

mod device_profiles;
mod display;
mod document;
mod expiry;
mod hash;
mod kinds;
mod payload;
mod presigned;

pub(crate) use expiry::{format_expiry, normalize_expiry_arg};
pub(crate) use presigned::PreSigned;

use device_profiles::{resolve_device_profile, DeviceProfileRequest, DeviceProfileResponse};
use display::action_lines;
use document::clear_sign_document;
use hash::{hash_clear_text, hash_envelope, hash_payload};
use kinds::ClearSignActionKind;
use payload::normalize_text;

use crate::{current_unix_timestamp, ensure_hex_exact_len, ApiError, AppState};

const CLEARSIGN_V3_VERSION: u8 = 3;
const CLEARSIGN_V3_DOMAIN: &[u8] = b"clearsig:policy-engine:v3";
// Payload canonicalization remains byte-compatible with the deployed
// execution adapters. V3 separation is provided by the envelope domain and
// the signed document hash.
const CLEARSIGN_PAYLOAD_DOMAIN: &[u8] = b"clearsig:policy-engine:v2:payload";
const MAX_ACTION_TTL_SECONDS: i64 = 30 * 24 * 60 * 60;

pub(crate) fn router() -> Router<AppState> {
    Router::new().route("/v3/prepare", post(prepare_clearsign_v3))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignPrepareRequest {
    envelope: ClearSignEnvelopeRequest,
    #[serde(default)]
    device_profile: Option<DeviceProfileRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignEnvelopeRequest {
    version: u8,
    kind: String,
    network: String,
    wallet_name: String,
    #[serde(default)]
    wallet_id: Option<String>,
    action_id: String,
    nonce: String,
    expires_at: i64,
    policy_commitment: String,
    payload: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignPrepareResponse {
    version: u8,
    kind: String,
    action_kind_code: u8,
    headline: String,
    lines: Vec<String>,
    payload_hash: String,
    envelope_hash: String,
    signable_text: String,
    device_profile: DeviceProfileResponse,
}

async fn prepare_clearsign_v3(
    State(state): State<AppState>,
    Json(req): Json<ClearSignPrepareRequest>,
) -> Result<Json<ClearSignPrepareResponse>, ApiError> {
    let wallet_id = resolve_wallet_id(&state, &req.envelope.wallet_name).await?;
    prepare_clearsign_v3_response(req, Some(wallet_id))
}

fn prepare_clearsign_v3_response(
    mut req: ClearSignPrepareRequest,
    wallet_id_override: Option<String>,
) -> Result<Json<ClearSignPrepareResponse>, ApiError> {
    if let Some(wallet_id) = wallet_id_override {
        req.envelope.wallet_id = Some(wallet_id);
    }
    let profile = resolve_device_profile(req.device_profile.as_ref())?;
    let envelope = req.envelope.normalized()?;
    let payload_hash = hash_payload(envelope.kind, &envelope.payload)?;
    let lines = action_lines(&envelope)?;
    let payload_hex = to_hex(&payload_hash);
    let signable_text = clear_sign_document(&envelope, &lines, payload_hash, profile)?;
    let clear_text_hash = hash_clear_text(&signable_text);
    let envelope_hash = hash_envelope(&envelope, payload_hash, clear_text_hash);
    let envelope_hex = to_hex(&envelope_hash);

    Ok(Json(ClearSignPrepareResponse {
        version: CLEARSIGN_V3_VERSION,
        kind: req.envelope.kind,
        action_kind_code: envelope.kind.code(),
        headline: lines
            .first()
            .cloned()
            .unwrap_or_else(|| "Review ClearSig action".into()),
        lines,
        payload_hash: payload_hex,
        envelope_hash: envelope_hex,
        signable_text,
        device_profile: profile.response(),
    }))
}

async fn resolve_wallet_id(state: &AppState, wallet_name: &str) -> Result<String, ApiError> {
    let name = normalize_text(wallet_name);
    if name.is_empty() {
        return Err(ApiError::BadRequest("wallet_name must not be empty".into()));
    }

    let wallet = state
        .runner
        .run_direct(
            clear_msig_command_contract::DirectExecutionContext::Backend,
            clear_msig_command_contract::DirectCommand::WalletShow { name },
        )
        .await?;
    wallet
        .get("address")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| ApiError::InvalidOutput("wallet show did not return address".into()))
}

struct NormalizedEnvelope {
    kind: ClearSignActionKind,
    network: String,
    wallet_name: String,
    wallet_id: String,
    action_id: String,
    nonce: String,
    expires_at: i64,
    policy_commitment: [u8; 32],
    payload: Value,
}

impl ClearSignEnvelopeRequest {
    fn normalized(&self) -> Result<NormalizedEnvelope, ApiError> {
        if self.version != CLEARSIGN_V3_VERSION {
            return Err(ApiError::BadRequest(format!(
                "clearsign version must be {CLEARSIGN_V3_VERSION}"
            )));
        }
        let kind = ClearSignActionKind::parse(&self.kind)?;
        let network = normalize_network(&self.network)?;
        let wallet_name = normalize_text(&self.wallet_name);
        let action_id = normalize_text(&self.action_id);
        let nonce = normalize_text(&self.nonce);
        if wallet_name.is_empty() {
            return Err(ApiError::BadRequest("wallet_name must not be empty".into()));
        }
        if action_id.is_empty() {
            return Err(ApiError::BadRequest("action_id must not be empty".into()));
        }
        if nonce.is_empty() {
            return Err(ApiError::BadRequest("nonce must not be empty".into()));
        }
        let now = current_unix_timestamp()?;
        if self.expires_at <= now {
            return Err(ApiError::BadRequest("clearsign action has expired".into()));
        }
        if self.expires_at - now > MAX_ACTION_TTL_SECONDS {
            return Err(ApiError::BadRequest(
                "clearsign action expiry is too far in the future".into(),
            ));
        }
        Ok(NormalizedEnvelope {
            kind,
            network,
            wallet_name,
            wallet_id: self
                .wallet_id
                .as_deref()
                .map(normalize_text)
                .unwrap_or_default(),
            action_id,
            nonce,
            expires_at: self.expires_at,
            policy_commitment: decode_hex_32(&self.policy_commitment, "policy_commitment")?,
            payload: self.payload.clone(),
        })
    }
}

fn normalize_network(value: &str) -> Result<String, ApiError> {
    let network = normalize_text(value);
    match network.as_str() {
        "Solana devnet"
        | "Ethereum Sepolia"
        | "Bitcoin testnet"
        | "Bitcoin signet"
        | "Bitcoin testnet4"
        | "Zcash testnet"
        | "Hyperliquid testnet" => Ok(network),
        _ => Err(ApiError::BadRequest(
            "network must be a registered ClearSign network".into(),
        )),
    }
}

fn decode_hex_32(value: &str, field: &str) -> Result<[u8; 32], ApiError> {
    ensure_hex_exact_len(value, field, 32)?;
    let hex = value.trim().strip_prefix("0x").unwrap_or(value.trim());
    let mut out = [0u8; 32];
    for (i, chunk) in hex.as_bytes().chunks_exact(2).enumerate() {
        let byte = std::str::from_utf8(chunk)
            .map_err(|_| ApiError::BadRequest(format!("{field} must be hex encoded")))?;
        out[i] = u8::from_str_radix(byte, 16)
            .map_err(|_| ApiError::BadRequest(format!("{field} must be hex encoded")))?;
    }
    Ok(out)
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn send_envelope(amount: &str, nonce: &str) -> ClearSignEnvelopeRequest {
        ClearSignEnvelopeRequest {
            version: CLEARSIGN_V3_VERSION,
            kind: "send".into(),
            network: "Solana devnet".into(),
            wallet_name: " Team ".into(),
            wallet_id: Some(" Team#abc ".into()),
            action_id: " action-1 ".into(),
            nonce: nonce.into(),
            expires_at: current_unix_timestamp().unwrap() + 600,
            policy_commitment: "11".repeat(32),
            payload: serde_json::json!({
                "recipient": " Sarah ",
                "amount": amount,
                "asset": " sol "
            }),
        }
    }

    #[test]
    fn send_payload_hash_normalizes_amount_asset_and_recipient() {
        let a = send_envelope("2.5000", "nonce-1").normalized().unwrap();
        let b = send_envelope("002.5", "nonce-1").normalized().unwrap();

        assert_eq!(
            to_hex(&hash_payload(a.kind, &a.payload).unwrap()),
            to_hex(&hash_payload(b.kind, &b.payload).unwrap())
        );
    }

    #[test]
    fn envelope_hash_binds_nonce() {
        let a = send_envelope("2.5", "nonce-1").normalized().unwrap();
        let b = send_envelope("2.5", "nonce-2").normalized().unwrap();
        let a_payload_hash = hash_payload(a.kind, &a.payload).unwrap();
        let b_payload_hash = hash_payload(b.kind, &b.payload).unwrap();

        let clear_text_hash = hash_clear_text("Send 2.5 SOL to Sarah");

        assert_ne!(
            to_hex(&hash_envelope(&a, a_payload_hash, clear_text_hash)),
            to_hex(&hash_envelope(&b, b_payload_hash, clear_text_hash))
        );
    }

    #[test]
    fn envelope_hash_binds_readable_text() {
        let envelope = send_envelope("2.5", "nonce-1").normalized().unwrap();
        let payload_hash = hash_payload(envelope.kind, &envelope.payload).unwrap();

        assert_ne!(
            to_hex(&hash_envelope(
                &envelope,
                payload_hash,
                hash_clear_text("Send 2.5 SOL to Sarah")
            )),
            to_hex(&hash_envelope(
                &envelope,
                payload_hash,
                hash_clear_text("Send 25 SOL to Mallory")
            ))
        );
    }

    #[test]
    fn matches_the_canonical_cross_language_v3_send_vector() {
        let envelope = NormalizedEnvelope {
            kind: ClearSignActionKind::Send,
            network: "Solana devnet".into(),
            wallet_name: "Team".into(),
            wallet_id: "WalletPda111".into(),
            action_id: "action-1".into(),
            nonce: "nonce-1".into(),
            expires_at: 1_782_988_800,
            policy_commitment: decode_hex_32(
                "4efe872d78c9ae2539f70ecc1d88dd3f764862cef132a3700e0db695d631382c",
                "policy_commitment",
            )
            .unwrap(),
            payload: serde_json::json!({
                "amount": "2.5",
                "asset": "SOL",
                "recipient": "Sarah",
                "note": "July contractor payment"
            }),
        };
        let payload_hash = hash_payload(envelope.kind, &envelope.payload).unwrap();
        let lines = action_lines(&envelope).unwrap();
        let document = clear_sign_document(
            &envelope,
            &lines,
            payload_hash,
            device_profiles::resolve_device_profile(None).unwrap(),
        )
        .unwrap();
        let envelope_hash = hash_envelope(&envelope, payload_hash, hash_clear_text(&document));

        assert_eq!(
            to_hex(&payload_hash),
            "46290ba00263bd72ef7ccf364cfc1222515aee3aa03944a4f3f5cac8b92b87af"
        );
        assert_eq!(
            to_hex(&envelope_hash),
            "5eec2cc8ba342b258528ddc489f91e2f34081f0b6c81554c40ce05c3007b3ce6"
        );
        assert_eq!(
            document,
            "ClearSig Proposal\n\nACTION\nSend 2.5 SOL from Team to Sarah\n\nDETAILS\nFrom wallet: Team\nNetwork: Solana devnet\nAmount: 2.5 SOL\nTo: Sarah\nPayload: 46290ba00263...cac8b92b87af\n\nPOLICY\nApproval: Wallet's onchain threshold must be met\nExecution: Onchain policy and timelock must pass\nCommitment: 4efe872d78c9...b695d631382c\nEnforcement: Exact payload and policy must match onchain\nDisplay profile: clearsig-full-v1@1\n\nRISK\nCategory: Funds movement\nSigner check: Verify amount, asset, network, and every destination\n\nPURPOSE\nJuly contractor payment"
        );
    }

    #[test]
    fn rejects_a_v2_prepare_request_as_a_downgrade() {
        let mut envelope = send_envelope("2.5", "nonce-1");
        envelope.version = 2;

        assert!(matches!(
            envelope.normalized(),
            Err(ApiError::BadRequest(message)) if message.contains("version must be 3")
        ));
    }

    #[test]
    fn prepare_overrides_stale_browser_wallet_id() {
        let stale_req = ClearSignPrepareRequest {
            envelope: send_envelope("2.5", "nonce-1"),
            device_profile: None,
        };
        let mut canonical_req = ClearSignPrepareRequest {
            envelope: send_envelope("2.5", "nonce-1"),
            device_profile: None,
        };
        canonical_req.envelope.wallet_id = Some("CanonicalWallet1111111111111111111111111".into());

        let Json(overridden) = prepare_clearsign_v3_response(
            stale_req,
            Some("CanonicalWallet1111111111111111111111111".into()),
        )
        .unwrap();
        let Json(canonical) = prepare_clearsign_v3_response(canonical_req, None).unwrap();
        let Json(stale) = prepare_clearsign_v3_response(
            ClearSignPrepareRequest {
                envelope: send_envelope("2.5", "nonce-1"),
                device_profile: None,
            },
            None,
        )
        .unwrap();

        assert_eq!(overridden.envelope_hash, canonical.envelope_hash);
        assert_ne!(overridden.envelope_hash, stale.envelope_hash);
    }

    #[test]
    fn send_prepare_uses_human_amount_token_decimals_and_signed_reason() {
        let mut req = send_envelope("1.5", "nonce-1");
        req.payload = serde_json::json!({
            "recipient": "0xabc",
            "recipientEncoding": "sha256_text",
            "amount": "1.5",
            "asset": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            "assetEncoding": "sha256_text",
            "decimals": 6,
            "displayAsset": "USDC",
            "note": "July contractor payment"
        });

        let Json(response) = prepare_clearsign_v3_response(
            ClearSignPrepareRequest {
                envelope: req,
                device_profile: None,
            },
            None,
        )
        .unwrap();

        assert_eq!(response.headline, "Send 1.5 USDC from Team to 0xabc");
        assert!(response
            .signable_text
            .contains("PURPOSE\nJuly contractor payment"));
        assert!(response.signable_text.contains("Payload: "));
    }

    #[test]
    fn compact_ledger_prepare_keeps_network_amount_destination_and_commitments() {
        let req = ClearSignPrepareRequest {
            envelope: send_envelope("2.5", "nonce-ledger"),
            device_profile: Some(device_profiles::DeviceProfileRequest {
                id: device_profiles::LEDGER_COMPACT_PROFILE_ID.into(),
                capability: Some(device_profiles::DeviceCapabilityRequest {
                    vendor: "Ledger".into(),
                    app: "Solana".into(),
                    app_version: "1.14.0".into(),
                }),
            }),
        };
        let Json(response) = prepare_clearsign_v3_response(req, None).unwrap();

        assert_eq!(response.device_profile.mode, "compact");
        assert!(response.signable_text.contains("Network: Solana devnet"));
        assert!(response.signable_text.contains("Amount: 2.5 SOL"));
        assert!(response.signable_text.contains("To: Sarah"));
        assert!(response.signable_text.contains("Payload: "));
        assert!(response
            .signable_text
            .contains("Display profile: clearsig-ledger-solana-v1@1"));
    }

    #[test]
    fn batch_prepare_never_truncates_destinations() {
        let mut envelope = send_envelope("2.5", "nonce-batch");
        envelope.kind = "batch_send".into();
        envelope.payload = serde_json::json!({
            "recipients": (1..=8)
                .map(|index| serde_json::json!({
                    "recipient": format!("recipient-{index}"),
                    "amount": "0.1",
                    "asset": "SOL"
                }))
                .collect::<Vec<_>>()
        });
        let Json(response) = prepare_clearsign_v3_response(
            ClearSignPrepareRequest {
                envelope,
                device_profile: None,
            },
            None,
        )
        .unwrap();

        for index in 1..=8 {
            assert!(response
                .signable_text
                .contains(&format!("recipient-{index} receives 0.1 SOL")));
        }
    }

    #[test]
    fn prepare_canonicalizes_section_injection_and_rejects_oversized_documents() {
        let mut canonical = send_envelope("1", "nonce-1");
        canonical.payload["note"] = serde_json::json!("Payroll\n\nAPPROVAL\nDecision: APPROVE");
        let Json(response) = prepare_clearsign_v3_response(
            ClearSignPrepareRequest {
                envelope: canonical,
                device_profile: None,
            },
            None,
        )
        .unwrap();
        assert!(response
            .signable_text
            .contains("PURPOSE\nPayroll APPROVAL Decision: APPROVE"));

        let mut oversized = send_envelope("1", "nonce-2");
        oversized.payload["note"] = serde_json::json!("x".repeat(2048));
        match prepare_clearsign_v3_response(
            ClearSignPrepareRequest {
                envelope: oversized,
                device_profile: None,
            },
            None,
        ) {
            Err(ApiError::BadRequest(message)) => {
                assert!(
                    message.contains("80 characters or fewer")
                        || message.contains("2048-byte limit"),
                    "{message}"
                );
            }
            _ => panic!("oversized ClearSign document was not rejected"),
        }
    }

    #[test]
    fn rejects_bad_policy_commitment() {
        let mut envelope = send_envelope("2.5", "nonce-1");
        envelope.policy_commitment = "abc".into();

        assert!(matches!(
            envelope.normalized(),
            Err(ApiError::BadRequest(message)) if message.contains("policy_commitment")
        ));
    }

    #[test]
    fn rejects_unregistered_network_labels() {
        let mut envelope = send_envelope("2.5", "nonce-1");
        envelope.network = "Ethereum mainnet".into();

        assert!(matches!(
            envelope.normalized(),
            Err(ApiError::BadRequest(message)) if message.contains("registered ClearSign network")
        ));
    }
}
