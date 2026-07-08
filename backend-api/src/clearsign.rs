use axum::{extract::State, routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;

mod display;
mod expiry;
mod hash;
mod kinds;
mod payload;
mod presigned;

pub(crate) use expiry::{format_expiry, normalize_expiry_arg};
pub(crate) use presigned::{push_pre_signed_flags, PreSigned};

use display::action_lines;
use hash::{hash_clear_text, hash_envelope, hash_payload};
use kinds::{ClearSignActionKind, ClearSignVoteKind};
use payload::normalize_text;

use crate::{current_unix_timestamp, ensure_hex_exact_len, ApiError, AppState};

const CLEARSIGN_V2_VERSION: u8 = 2;
const CLEARSIGN_V2_DOMAIN: &[u8] = b"clearsig:policy-engine:v2";
const CLEARSIGN_V2_PAYLOAD_DOMAIN: &[u8] = b"clearsig:policy-engine:v2:payload";
const MAX_ACTION_TTL_SECONDS: i64 = 30 * 24 * 60 * 60;

pub(crate) fn router() -> Router<AppState> {
    Router::new().route("/v2/prepare", post(prepare_clearsign_v2))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignPrepareRequest {
    envelope: ClearSignEnvelopeRequest,
    #[serde(default)]
    vote: Option<ClearSignVoteRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignEnvelopeRequest {
    version: u8,
    kind: String,
    wallet_name: String,
    #[serde(default)]
    wallet_id: Option<String>,
    action_id: String,
    nonce: String,
    expires_at: i64,
    policy_commitment: String,
    payload: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignVoteRequest {
    wallet_id: String,
    proposal_index: u64,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    vote_messages: Option<ClearSignVoteMessages>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignVoteMessages {
    propose: String,
    approve: String,
    cancel: String,
}

async fn prepare_clearsign_v2(
    State(state): State<AppState>,
    Json(req): Json<ClearSignPrepareRequest>,
) -> Result<Json<ClearSignPrepareResponse>, ApiError> {
    let wallet_id = resolve_wallet_id(&state, &req.envelope.wallet_name).await?;
    prepare_clearsign_v2_response(req, Some(wallet_id))
}

fn prepare_clearsign_v2_response(
    mut req: ClearSignPrepareRequest,
    wallet_id_override: Option<String>,
) -> Result<Json<ClearSignPrepareResponse>, ApiError> {
    if let Some(wallet_id) = wallet_id_override {
        req.envelope.wallet_id = Some(wallet_id);
    }
    let envelope = req.envelope.normalized()?;
    let payload_hash = hash_payload(envelope.kind, &envelope.payload)?;
    let lines = action_lines(&envelope)?;
    let payload_hex = to_hex(&payload_hash);
    let context = [
        format!("Wallet {}", envelope.wallet_name),
        format!("Action {}", envelope.action_id),
        format!("Nonce {}", envelope.nonce),
        format!("Expires {}", format_expiry(envelope.expires_at)?),
        format!("Payload {}", payload_hex),
    ];
    let signable_text = lines
        .iter()
        .chain(context.iter())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let clear_text_hash = hash_clear_text(&signable_text);
    let envelope_hash = hash_envelope(&envelope, payload_hash, clear_text_hash);
    let vote_messages = req
        .vote
        .map(|vote| {
            let wallet_id = normalize_text(&vote.wallet_id);
            if wallet_id.is_empty() {
                return Err(ApiError::BadRequest(
                    "vote.wallet_id must not be empty".into(),
                ));
            }
            Ok(ClearSignVoteMessages {
                propose: to_hex(
                    vote_message(
                        ClearSignVoteKind::Propose,
                        &envelope.wallet_name,
                        vote.proposal_index,
                        envelope_hash,
                        &signable_text,
                    )
                    .as_bytes(),
                ),
                approve: to_hex(
                    vote_message(
                        ClearSignVoteKind::Approve,
                        &envelope.wallet_name,
                        vote.proposal_index,
                        envelope_hash,
                        &signable_text,
                    )
                    .as_bytes(),
                ),
                cancel: to_hex(
                    vote_message(
                        ClearSignVoteKind::Cancel,
                        &envelope.wallet_name,
                        vote.proposal_index,
                        envelope_hash,
                        &signable_text,
                    )
                    .as_bytes(),
                ),
            })
        })
        .transpose()?;
    let envelope_hex = to_hex(&envelope_hash);

    Ok(Json(ClearSignPrepareResponse {
        version: CLEARSIGN_V2_VERSION,
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
        vote_messages,
    }))
}

async fn resolve_wallet_id(state: &AppState, wallet_name: &str) -> Result<String, ApiError> {
    let name = normalize_text(wallet_name);
    if name.is_empty() {
        return Err(ApiError::BadRequest("wallet_name must not be empty".into()));
    }

    let wallet = state
        .runner
        .run_json(vec![
            "wallet".to_string(),
            "show".to_string(),
            "--name".to_string(),
            name,
        ])
        .await?;
    wallet
        .get("address")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| ApiError::InvalidOutput("wallet show did not return address".into()))
}

struct NormalizedEnvelope {
    kind: ClearSignActionKind,
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
        if self.version != CLEARSIGN_V2_VERSION {
            return Err(ApiError::BadRequest(format!(
                "clearsign version must be {CLEARSIGN_V2_VERSION}"
            )));
        }
        let kind = ClearSignActionKind::parse(&self.kind)?;
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

fn vote_message(
    vote_kind: ClearSignVoteKind,
    wallet_name: &str,
    proposal_index: u64,
    envelope_hash: [u8; 32],
    signable_text: &str,
) -> String {
    format!(
        "ClearSign v2 {}\nWallet {}\nProposal {}\nEnvelope {}\n\n{}",
        vote_kind.label(),
        wallet_name,
        proposal_index,
        to_hex(&envelope_hash),
        signable_text
    )
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn send_envelope(amount: &str, nonce: &str) -> ClearSignEnvelopeRequest {
        ClearSignEnvelopeRequest {
            version: CLEARSIGN_V2_VERSION,
            kind: "send".into(),
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
    fn prepare_overrides_stale_browser_wallet_id() {
        let stale_req = ClearSignPrepareRequest {
            envelope: send_envelope("2.5", "nonce-1"),
            vote: None,
        };
        let mut canonical_req = ClearSignPrepareRequest {
            envelope: send_envelope("2.5", "nonce-1"),
            vote: None,
        };
        canonical_req.envelope.wallet_id = Some("CanonicalWallet1111111111111111111111111".into());

        let Json(overridden) = prepare_clearsign_v2_response(
            stale_req,
            Some("CanonicalWallet1111111111111111111111111".into()),
        )
        .unwrap();
        let Json(canonical) = prepare_clearsign_v2_response(canonical_req, None).unwrap();
        let Json(stale) = prepare_clearsign_v2_response(
            ClearSignPrepareRequest {
                envelope: send_envelope("2.5", "nonce-1"),
                vote: None,
            },
            None,
        )
        .unwrap();

        assert_eq!(overridden.envelope_hash, canonical.envelope_hash);
        assert_ne!(overridden.envelope_hash, stale.envelope_hash);
    }

    #[tokio::test]
    async fn prepare_returns_readable_vote_messages() {
        let req = ClearSignPrepareRequest {
            envelope: send_envelope("2.5", "nonce-1"),
            vote: Some(ClearSignVoteRequest {
                wallet_id: "Team#abc".into(),
                proposal_index: 7,
            }),
        };

        let Json(response) = prepare_clearsign_v2_response(req, None).unwrap();
        let vote_messages = response.vote_messages.unwrap();
        let propose = decode_hex_string(&vote_messages.propose);

        assert!(propose.starts_with("ClearSign v2 propose\nWallet Team\nProposal 7\nEnvelope "));
        assert!(propose.contains("\nSend 2.5 SOL from Team to Sarah\n"));
        assert!(propose.contains("\nPayload "));
        assert!(propose.ends_with(&response.signable_text));
        assert_ne!(vote_messages.propose, vote_messages.approve);
        assert_ne!(vote_messages.approve, vote_messages.cancel);
    }

    #[test]
    fn vote_messages_are_readable_and_distinct_by_vote_kind() {
        let envelope = send_envelope("2.5", "nonce-1").normalized().unwrap();
        let payload_hash = hash_payload(envelope.kind, &envelope.payload).unwrap();
        let envelope_hash = hash_envelope(
            &envelope,
            payload_hash,
            hash_clear_text("Send 2.5 SOL to Sarah"),
        );

        let propose = vote_message(
            ClearSignVoteKind::Propose,
            "Team",
            7,
            envelope_hash,
            "Send 2.5 SOL to Sarah",
        );
        let approve = vote_message(
            ClearSignVoteKind::Approve,
            "Team",
            7,
            envelope_hash,
            "Send 2.5 SOL to Sarah",
        );
        let cancel = vote_message(
            ClearSignVoteKind::Cancel,
            "Team",
            7,
            envelope_hash,
            "Send 2.5 SOL to Sarah",
        );

        assert!(propose.starts_with("ClearSign v2 propose\nWallet Team\nProposal 7\nEnvelope "));
        assert!(propose.ends_with("\n\nSend 2.5 SOL to Sarah"));
        assert_ne!(propose, approve);
        assert_ne!(approve, cancel);
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

    fn decode_hex_string(hex: &str) -> String {
        let bytes = (0..hex.len() / 2)
            .map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap())
            .collect::<Vec<_>>();
        String::from_utf8(bytes).unwrap()
    }
}
