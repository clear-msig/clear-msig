use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{
    kinds::{ClearSignActionKind, ClearSignVoteKind},
    payload::{
        json_string, leverage_to_x100, payload_text, payload_u32, recipient_amount,
        update_recipient_amount, Money,
    },
    NormalizedEnvelope, CLEARSIGN_V2_DOMAIN, CLEARSIGN_V2_PAYLOAD_DOMAIN, CLEARSIGN_V2_VERSION,
    CLEARSIGN_V2_VOTE_DOMAIN,
};
use crate::ApiError;

pub(super) fn hash_payload(
    kind: ClearSignActionKind,
    payload: &Value,
) -> Result<[u8; 32], ApiError> {
    let mut hasher = payload_hasher(kind);
    match kind {
        ClearSignActionKind::Send => {
            update_recipient_amount(&mut hasher, &recipient_amount(payload)?);
        }
        ClearSignActionKind::BatchSend => {
            let rows = payload
                .get("recipients")
                .and_then(Value::as_array)
                .ok_or_else(|| ApiError::BadRequest("payload.recipients must be an array".into()))?
                .iter()
                .map(recipient_amount)
                .collect::<Result<Vec<_>, _>>()?;
            update_u32(&mut hasher, rows.len() as u32);
            for row in &rows {
                update_recipient_amount(&mut hasher, row);
            }
        }
        ClearSignActionKind::ReleaseMilestone => {
            let row = recipient_amount(payload)?;
            update_bytes(
                &mut hasher,
                &text_commitment(
                    &payload_text(payload, "escrowId")
                        .or_else(|_| payload_text(payload, "escrowTitle"))?,
                ),
            );
            update_bytes(
                &mut hasher,
                &text_commitment(
                    &payload_text(payload, "milestoneId")
                        .or_else(|_| payload_text(payload, "milestoneTitle"))?,
                ),
            );
            update_recipient_amount(&mut hasher, &row);
        }
        ClearSignActionKind::ReturnEscrowFunds => {
            update_bytes(
                &mut hasher,
                &text_commitment(
                    &payload_text(payload, "escrowId")
                        .or_else(|_| payload_text(payload, "escrowTitle"))?,
                ),
            );
            let rows = payload
                .get("returns")
                .and_then(Value::as_array)
                .ok_or_else(|| ApiError::BadRequest("payload.returns must be an array".into()))?
                .iter()
                .map(recipient_amount)
                .collect::<Result<Vec<_>, _>>()?;
            update_u32(&mut hasher, rows.len() as u32);
            for row in &rows {
                update_recipient_amount(&mut hasher, row);
            }
        }
        ClearSignActionKind::AgentTradeApproval => {
            let market = payload_text(payload, "market")?.to_uppercase();
            let side = payload_text(payload, "side")?.to_lowercase();
            if side != "long" && side != "short" {
                return Err(ApiError::BadRequest(
                    "payload.side must be long or short".into(),
                ));
            }
            let amount = Money::new(payload_text(payload, "maxNotionalUsd")?, "USD".into())?;
            update_bytes(&mut hasher, market.as_bytes());
            update_bytes(&mut hasher, side.as_bytes());
            update_amount(&mut hasher, &amount);
            update_u32(
                &mut hasher,
                leverage_to_x100(&payload_text(payload, "maxLeverage")?)?,
            );
        }
        ClearSignActionKind::AddMember | ClearSignActionKind::RemoveMember => {
            let member = payload_text(payload, "member")?;
            let role = payload_text(payload, "role")?;
            update_bytes(
                &mut hasher,
                format!(
                    "{{\"member\":{},\"role\":{}}}",
                    json_string(&member)?,
                    json_string(&role)?
                )
                .as_bytes(),
            );
        }
        ClearSignActionKind::ChangeThreshold => {
            let approvals_required = payload_u32(payload, "approvalsRequired")?;
            update_bytes(
                &mut hasher,
                format!("{{\"approvalsRequired\":{approvals_required}}}").as_bytes(),
            );
        }
        ClearSignActionKind::SetProtection => {
            let summary = payload_text(payload, "summary")?;
            update_bytes(
                &mut hasher,
                format!("{{\"summary\":{}}}", json_string(&summary)?).as_bytes(),
            );
        }
        ClearSignActionKind::RecoveryAction => {
            let recovery_action = payload_text(payload, "recoveryAction")?;
            update_bytes(
                &mut hasher,
                format!("{{\"recoveryAction\":{}}}", json_string(&recovery_action)?).as_bytes(),
            );
        }
        ClearSignActionKind::SwapIntent => {
            let from = payload
                .get("from")
                .ok_or_else(|| ApiError::BadRequest("payload.from must be an object".into()))?;
            let from_money =
                Money::new(payload_text(from, "amount")?, payload_text(from, "asset")?)?;
            let to_asset = payload_text(payload, "toAsset")?.to_uppercase();
            let min_receive =
                super::payload::normalize_decimal(&payload_text(payload, "minReceive")?)?;
            update_bytes(
                &mut hasher,
                format!(
                    "{{\"from\":{{\"amount\":{},\"asset\":{}}},\"toAsset\":{},\"minReceive\":{}}}",
                    json_string(&from_money.amount)?,
                    json_string(&from_money.asset)?,
                    json_string(&to_asset)?,
                    json_string(&min_receive)?
                )
                .as_bytes(),
            );
        }
    }
    Ok(finish_hash(hasher))
}

pub(super) fn hash_envelope(envelope: &NormalizedEnvelope, payload_hash: [u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, CLEARSIGN_V2_DOMAIN);
    hasher.update([CLEARSIGN_V2_VERSION]);
    hasher.update([envelope.kind.code()]);
    hasher.update(envelope.expires_at.to_le_bytes());
    update_bytes(&mut hasher, envelope.wallet_name.as_bytes());
    update_bytes(&mut hasher, envelope.wallet_id.as_bytes());
    hasher.update(Sha256::digest(envelope.action_id.as_bytes()));
    hasher.update(Sha256::digest(envelope.nonce.as_bytes()));
    hasher.update(envelope.policy_commitment);
    hasher.update(payload_hash);
    finish_hash(hasher)
}

pub(super) fn hash_vote_message(
    vote_kind: ClearSignVoteKind,
    wallet_id: &str,
    proposal_index: u64,
    envelope_hash: [u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, CLEARSIGN_V2_VOTE_DOMAIN);
    hasher.update([CLEARSIGN_V2_VERSION]);
    hasher.update([vote_kind.code()]);
    update_bytes(&mut hasher, wallet_id.as_bytes());
    hasher.update(proposal_index.to_le_bytes());
    hasher.update(envelope_hash);
    finish_hash(hasher)
}

fn payload_hasher(kind: ClearSignActionKind) -> Sha256 {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, CLEARSIGN_V2_PAYLOAD_DOMAIN);
    hasher.update([kind.code()]);
    hasher
}

pub(super) fn text_commitment(value: &str) -> [u8; 32] {
    Sha256::digest(value.trim().as_bytes()).into()
}

pub(super) fn update_amount(hasher: &mut Sha256, money: &Money) {
    update_bytes(hasher, money.asset.as_bytes());
    hasher.update(money.raw_amount.to_le_bytes());
}

pub(super) fn update_bytes(hasher: &mut Sha256, value: &[u8]) {
    update_u32(hasher, value.len() as u32);
    hasher.update(value);
}

pub(super) fn update_u32(hasher: &mut Sha256, value: u32) {
    hasher.update(value.to_le_bytes());
}

fn finish_hash(hasher: Sha256) -> [u8; 32] {
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}
