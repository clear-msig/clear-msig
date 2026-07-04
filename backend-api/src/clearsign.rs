use axum::{routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;

mod expiry;
mod hash;
mod kinds;
mod payload;
mod presigned;

pub(crate) use expiry::format_expiry;
pub(crate) use presigned::{push_pre_signed_flags, PreSigned};

use hash::{hash_envelope, hash_payload, hash_vote_message};
use kinds::{ClearSignActionKind, ClearSignVoteKind};
use payload::{
    format_money, normalize_decimal, normalize_text, payload_text, payload_u32, recipient_amount,
    Money,
};

use crate::{current_unix_timestamp, ensure_hex_exact_len, ApiError, AppState};

const CLEARSIGN_V2_VERSION: u8 = 2;
const CLEARSIGN_V2_DOMAIN: &[u8] = b"clearsig:policy-engine:v2";
const CLEARSIGN_V2_PAYLOAD_DOMAIN: &[u8] = b"clearsig:policy-engine:v2:payload";
const CLEARSIGN_V2_VOTE_DOMAIN: &[u8] = b"clearsig:policy-engine:v2:vote";
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
    vote_hashes: Option<ClearSignVoteHashes>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignVoteHashes {
    propose: String,
    approve: String,
    cancel: String,
}

async fn prepare_clearsign_v2(
    Json(req): Json<ClearSignPrepareRequest>,
) -> Result<Json<ClearSignPrepareResponse>, ApiError> {
    let envelope = req.envelope.normalized()?;
    let payload_hash = hash_payload(envelope.kind, &envelope.payload)?;
    let envelope_hash = hash_envelope(&envelope, payload_hash);
    let lines = action_lines(&envelope)?;
    let vote_hashes = req
        .vote
        .map(|vote| {
            let wallet_id = normalize_text(&vote.wallet_id);
            if wallet_id.is_empty() {
                return Err(ApiError::BadRequest(
                    "vote.wallet_id must not be empty".into(),
                ));
            }
            Ok(ClearSignVoteHashes {
                propose: to_hex(&hash_vote_message(
                    ClearSignVoteKind::Propose,
                    &wallet_id,
                    vote.proposal_index,
                    envelope_hash,
                )),
                approve: to_hex(&hash_vote_message(
                    ClearSignVoteKind::Approve,
                    &wallet_id,
                    vote.proposal_index,
                    envelope_hash,
                )),
                cancel: to_hex(&hash_vote_message(
                    ClearSignVoteKind::Cancel,
                    &wallet_id,
                    vote.proposal_index,
                    envelope_hash,
                )),
            })
        })
        .transpose()?;
    let payload_hex = to_hex(&payload_hash);
    let envelope_hex = to_hex(&envelope_hash);
    let context = [
        format!("Wallet {}", envelope.wallet_name),
        format!("Action {}", envelope.action_id),
        format!("Nonce {}", envelope.nonce),
        format!("Expires {}", envelope.expires_at),
        format!("Payload {}", payload_hex),
    ];
    let signable_text = lines
        .iter()
        .chain(context.iter())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");

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
        vote_hashes,
    }))
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

fn action_lines(envelope: &NormalizedEnvelope) -> Result<Vec<String>, ApiError> {
    match envelope.kind {
        ClearSignActionKind::Send => {
            let row = recipient_amount(&envelope.payload)?;
            Ok(vec![
                format!(
                    "Send {} from {} to {}",
                    format_money(&row.money),
                    envelope.wallet_name,
                    row.recipient
                ),
                "Requires wallet approval".into(),
            ])
        }
        ClearSignActionKind::BatchSend => {
            let rows = envelope
                .payload
                .get("recipients")
                .and_then(Value::as_array)
                .ok_or_else(|| ApiError::BadRequest("payload.recipients must be an array".into()))?
                .iter()
                .map(recipient_amount)
                .collect::<Result<Vec<_>, _>>()?;
            let mut lines = vec![format!(
                "Send {} payments from {}",
                rows.len(),
                envelope.wallet_name
            )];
            lines.extend(
                rows.iter()
                    .take(4)
                    .map(|row| format!("{} receives {}", row.recipient, format_money(&row.money))),
            );
            lines.push("Requires wallet approval".into());
            Ok(lines)
        }
        ClearSignActionKind::ReleaseMilestone => {
            let row = recipient_amount(&envelope.payload)?;
            Ok(vec![
                format!(
                    "Release {} from {}",
                    format_money(&row.money),
                    envelope.wallet_name
                ),
                format!(
                    "{} receives funds for {}",
                    row.recipient,
                    payload_text(&envelope.payload, "milestoneTitle")?
                ),
                format!("Escrow {}", payload_text(&envelope.payload, "escrowTitle")?),
            ])
        }
        ClearSignActionKind::ReturnEscrowFunds => {
            let rows = envelope
                .payload
                .get("returns")
                .and_then(Value::as_array)
                .ok_or_else(|| ApiError::BadRequest("payload.returns must be an array".into()))?
                .iter()
                .map(recipient_amount)
                .collect::<Result<Vec<_>, _>>()?;
            let mut lines = vec![format!(
                "Return remaining escrow funds from {}",
                envelope.wallet_name
            )];
            lines.extend(
                rows.iter()
                    .take(6)
                    .map(|row| format!("{} receives {}", row.recipient, format_money(&row.money))),
            );
            lines.push("Requires wallet approval".into());
            Ok(lines)
        }
        ClearSignActionKind::AgentTradeApproval => Ok(vec![
            format!(
                "Approve {} {} up to ${}",
                payload_text(&envelope.payload, "market")?.to_uppercase(),
                payload_text(&envelope.payload, "side")?.to_lowercase(),
                payload_text(&envelope.payload, "maxNotionalUsd")?
            ),
            format!(
                "Max leverage {}",
                payload_text(&envelope.payload, "maxLeverage")?
            ),
            if envelope
                .payload
                .get("stopLossRequired")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                "Stop loss required".into()
            } else {
                "Stop loss not required".into()
            },
        ]),
        ClearSignActionKind::AddMember => Ok(vec![format!(
            "Add {} as {} to {}",
            payload_text(&envelope.payload, "member")?,
            payload_text(&envelope.payload, "role")?,
            envelope.wallet_name
        )]),
        ClearSignActionKind::RemoveMember => Ok(vec![format!(
            "Remove {} from {}",
            payload_text(&envelope.payload, "member")?,
            envelope.wallet_name
        )]),
        ClearSignActionKind::ChangeThreshold => {
            let approvals_required = payload_u32(&envelope.payload, "approvalsRequired")?;
            Ok(vec![format!(
                "Require {} approval{} for {}",
                approvals_required,
                if approvals_required == 1 { "" } else { "s" },
                envelope.wallet_name
            )])
        }
        ClearSignActionKind::SetProtection => Ok(vec![
            format!("Set protection for {}", envelope.wallet_name),
            payload_text(&envelope.payload, "summary")?,
        ]),
        ClearSignActionKind::RecoveryAction => Ok(vec![
            format!("Approve recovery for {}", envelope.wallet_name),
            payload_text(&envelope.payload, "recoveryAction")?,
        ]),
        ClearSignActionKind::SwapIntent => {
            let from = envelope
                .payload
                .get("from")
                .ok_or_else(|| ApiError::BadRequest("payload.from must be an object".into()))?;
            let from_money =
                Money::new(payload_text(from, "amount")?, payload_text(from, "asset")?)?;
            Ok(vec![
                format!(
                    "Swap {} from {}",
                    format_money(&from_money),
                    envelope.wallet_name
                ),
                format!(
                    "Receive at least {} {}",
                    normalize_decimal(&payload_text(&envelope.payload, "minReceive")?)?,
                    payload_text(&envelope.payload, "toAsset")?.to_uppercase()
                ),
                "Requires wallet approval".into(),
            ])
        }
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

fn to_hex(bytes: &[u8; 32]) -> String {
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

        assert_ne!(
            to_hex(&hash_envelope(&a, a_payload_hash)),
            to_hex(&hash_envelope(&b, b_payload_hash))
        );
    }

    #[test]
    fn vote_hashes_are_distinct_by_vote_kind() {
        let envelope = send_envelope("2.5", "nonce-1").normalized().unwrap();
        let payload_hash = hash_payload(envelope.kind, &envelope.payload).unwrap();
        let envelope_hash = hash_envelope(&envelope, payload_hash);

        let propose = hash_vote_message(ClearSignVoteKind::Propose, "Team#abc", 7, envelope_hash);
        let approve = hash_vote_message(ClearSignVoteKind::Approve, "Team#abc", 7, envelope_hash);
        let cancel = hash_vote_message(ClearSignVoteKind::Cancel, "Team#abc", 7, envelope_hash);

        assert_ne!(to_hex(&propose), to_hex(&approve));
        assert_ne!(to_hex(&approve), to_hex(&cancel));
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
}
