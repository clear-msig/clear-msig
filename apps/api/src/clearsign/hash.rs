use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{
    kinds::ClearSignActionKind,
    payload::{
        json_string, leverage_to_x100, payload_text, payload_u32, recipient_amount,
        update_recipient_amount, AssetEncoding, Money,
    },
    NormalizedEnvelope, CLEARSIGN_PAYLOAD_DOMAIN, CLEARSIGN_V3_DOMAIN, CLEARSIGN_V3_VERSION,
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
        ClearSignActionKind::RecurringSchedule => {
            let row = recipient_amount(payload)?;
            update_bytes(
                &mut hasher,
                &text_commitment(&payload_text(payload, "scheduleId")?),
            );
            update_recipient_amount(&mut hasher, &row);
            update_u32(&mut hasher, payload_u32(payload, "intervalSeconds")?);
            hasher.update(
                payload
                    .get("firstExecutionAt")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| {
                        ApiError::BadRequest("payload.firstExecutionAt must be an integer".into())
                    })?
                    .to_le_bytes(),
            );
            update_u32(&mut hasher, payload_u32(payload, "paymentCount")?);
            hasher.update([if payload_text(payload, "status")? == "revoked" {
                2
            } else {
                1
            }]);
        }
        ClearSignActionKind::AgentTradeApproval => {
            let market = payload_text(payload, "market")?.to_uppercase();
            let side = payload_text(payload, "side")?.to_lowercase();
            if side != "long" && side != "short" {
                return Err(ApiError::BadRequest(
                    "payload.side must be long or short".into(),
                ));
            }
            let amount = Money::new(
                payload_text(payload, "maxNotionalUsd")?,
                "USD".into(),
                AssetEncoding::Text,
            )?;
            let leverage = leverage_to_x100(&payload_text(payload, "maxLeverage")?)?;
            let v2_fields = [
                optional_payload_text(payload, "agentId")?,
                optional_payload_text(payload, "venue")?,
                optional_payload_text(payload, "assetId")?,
                optional_payload_text(payload, "sessionId")?,
                optional_payload_text(payload, "route")?,
                optional_payload_text(payload, "riskCheckHash")?,
            ];
            let has_any_v2 = v2_fields.iter().any(Option::is_some);
            let has_all_v2 = v2_fields.iter().all(Option::is_some);
            if has_any_v2 && !has_all_v2 {
                return Err(ApiError::BadRequest(
                    "agent_trade_approval v2 requires agentId, venue, assetId, sessionId, route, and riskCheckHash"
                        .into(),
                ));
            }
            if has_all_v2 {
                let agent_id = v2_fields[0].as_deref().unwrap_or_default();
                let venue = v2_fields[1].as_deref().unwrap_or_default();
                let asset_id = v2_fields[2].as_deref().unwrap_or_default();
                let session_id = v2_fields[3].as_deref().unwrap_or_default();
                let route = v2_fields[4].as_deref().unwrap_or_default();
                let risk_check_hash = hash_bytes_from_hex(
                    v2_fields[5].as_deref().unwrap_or_default(),
                    "payload.riskCheckHash",
                )?;
                update_bytes(&mut hasher, &text_commitment(agent_id));
                update_bytes(&mut hasher, &text_commitment(venue));
                update_bytes(&mut hasher, &text_commitment(&market));
                update_bytes(&mut hasher, &text_commitment(&side));
                update_bytes(&mut hasher, &text_commitment(asset_id));
                hasher.update(amount.raw_amount.to_le_bytes());
                update_u32(&mut hasher, leverage);
                update_bytes(&mut hasher, &text_commitment(session_id));
                update_bytes(&mut hasher, &text_commitment(route));
                update_bytes(&mut hasher, &risk_check_hash);
            } else {
                update_bytes(&mut hasher, market.as_bytes());
                update_bytes(&mut hasher, side.as_bytes());
                update_amount(&mut hasher, &amount);
                update_u32(&mut hasher, leverage);
            }
        }
        ClearSignActionKind::AgentSessionGrant => {
            let session_id = payload_text(payload, "sessionId")?;
            let agent_id = payload_text(payload, "agentId")?;
            let venue = payload_text(payload, "venue")?;
            let market = payload_text(payload, "market")?.to_uppercase();
            let amount = Money::new(
                payload_text(payload, "maxNotionalUsd")?,
                "USD".into(),
                AssetEncoding::Text,
            )?;
            let leverage = leverage_to_x100(&payload_text(payload, "maxLeverage")?)?;
            let expires_at = payload
                .get("expiresAt")
                .and_then(Value::as_i64)
                .ok_or_else(|| {
                    ApiError::BadRequest("payload.expiresAt must be an integer".into())
                })?;
            let status = match payload_text(payload, "status")?.as_str() {
                "active" => 1u8,
                "revoked" => 2u8,
                _ => {
                    return Err(ApiError::BadRequest(
                        "payload.status must be active or revoked".into(),
                    ))
                }
            };
            update_bytes(&mut hasher, b"agent_session");
            hasher.update(text_commitment(&session_id));
            hasher.update(text_commitment(&agent_id));
            hasher.update(text_commitment(&venue));
            hasher.update(text_commitment(&market));
            hasher.update(amount.raw_amount.to_le_bytes());
            update_u32(&mut hasher, leverage);
            hasher.update(expires_at.to_le_bytes());
            hasher.update([status]);
        }
        ClearSignActionKind::AgentRiskPolicy => {
            let session_id = payload_text(payload, "sessionId")?;
            let oracle_policy_hash = hash_bytes_from_hex(
                &payload_text(payload, "oraclePolicyHash")?,
                "payload.oraclePolicyHash",
            )?;
            let max_loss_raw = payload_text(payload, "maxLossRaw")?
                .parse::<u128>()
                .map_err(|_| {
                    ApiError::BadRequest("payload.maxLossRaw must be an integer".into())
                })?;
            let status = match payload_text(payload, "status")?.as_str() {
                "active" => 1u8,
                "paused" => 2u8,
                _ => {
                    return Err(ApiError::BadRequest(
                        "payload.status must be active or paused".into(),
                    ))
                }
            };
            if status == 1 && max_loss_raw == 0 {
                return Err(ApiError::BadRequest(
                    "payload.maxLossRaw must be positive for an active policy".into(),
                ));
            }
            update_bytes(&mut hasher, b"agent_risk_policy");
            hasher.update(text_commitment(&session_id));
            hasher.update(oracle_policy_hash);
            hasher.update(max_loss_raw.to_le_bytes());
            hasher.update([status]);
        }
        ClearSignActionKind::AgentTradeSettlement => {
            let session_id = payload_text(payload, "sessionId")?;
            let execution_id = payload_text(payload, "executionId")?;
            let settlement_artifact_hash = hash_bytes_from_hex(
                &payload_text(payload, "settlementArtifactHash")?,
                "payload.settlementArtifactHash",
            )?;
            let oracle_policy_hash = hash_bytes_from_hex(
                &payload_text(payload, "oraclePolicyHash")?,
                "payload.oraclePolicyHash",
            )?;
            let closed_notional_raw = payload_text(payload, "closedNotionalRaw")?
                .parse::<u128>()
                .map_err(|_| {
                    ApiError::BadRequest("payload.closedNotionalRaw must be an integer".into())
                })?;
            let pnl_abs_raw = payload_text(payload, "pnlAbsRaw")?
                .parse::<u128>()
                .map_err(|_| ApiError::BadRequest("payload.pnlAbsRaw must be an integer".into()))?;
            let outcome = match payload_text(payload, "outcome")?.as_str() {
                "profit" => 1u8,
                "loss" => 2u8,
                "flat" => 3u8,
                _ => {
                    return Err(ApiError::BadRequest(
                        "payload.outcome must be profit, loss, or flat".into(),
                    ))
                }
            };
            let sequence = payload
                .get("settlementSequence")
                .and_then(Value::as_u64)
                .ok_or_else(|| {
                    ApiError::BadRequest("payload.settlementSequence must be an integer".into())
                })?;
            if closed_notional_raw == 0
                || (outcome == 3 && pnl_abs_raw != 0)
                || (outcome != 3 && pnl_abs_raw == 0)
            {
                return Err(ApiError::BadRequest(
                    "agent settlement amount or outcome is invalid".into(),
                ));
            }
            update_bytes(&mut hasher, b"agent_trade_settlement");
            hasher.update(text_commitment(&session_id));
            hasher.update(text_commitment(&execution_id));
            hasher.update(settlement_artifact_hash);
            hasher.update(oracle_policy_hash);
            hasher.update(closed_notional_raw.to_le_bytes());
            hasher.update([outcome]);
            hasher.update(pnl_abs_raw.to_le_bytes());
            hasher.update(sequence.to_le_bytes());
        }
        ClearSignActionKind::AddMember
        | ClearSignActionKind::RemoveMember
        | ClearSignActionKind::ChangeThreshold => {
            // Bind final intent governance state so the signed ClearSign
            // text cannot diverge from the typed executor rewrite.
            hash_intent_governance_fields(&mut hasher, payload)?;
        }
        ClearSignActionKind::SetProtection => {
            if let Some(policy_commitment) = payload.get("policyCommitment").and_then(Value::as_str)
            {
                let chain_kind = payload
                    .get("chainKind")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| ApiError::BadRequest("payload.chainKind is required".into()))?;
                if chain_kind > u8::MAX as u64 {
                    return Err(ApiError::BadRequest(
                        "payload.chainKind is out of range".into(),
                    ));
                }
                update_bytes(&mut hasher, b"wallet_policy");
                hasher.update([chain_kind as u8]);
                hasher.update(hash_bytes_from_hex(
                    policy_commitment,
                    "payload.policyCommitment",
                )?);
            } else {
                let summary = payload_text(payload, "summary")?;
                update_bytes(
                    &mut hasher,
                    format!("{{\"summary\":{}}}", json_string(&summary)?).as_bytes(),
                );
            }
        }
        ClearSignActionKind::SetAssetProtection => {
            let chain_kind = payload
                .get("chainKind")
                .and_then(Value::as_u64)
                .ok_or_else(|| ApiError::BadRequest("payload.chainKind is required".into()))?;
            let scope_kind = payload
                .get("scopeKind")
                .and_then(Value::as_u64)
                .ok_or_else(|| ApiError::BadRequest("payload.scopeKind is required".into()))?;
            let decimals = payload
                .get("decimals")
                .and_then(Value::as_u64)
                .ok_or_else(|| ApiError::BadRequest("payload.decimals is required".into()))?;
            if chain_kind > 255 || scope_kind > 255 || decimals > 255 {
                return Err(ApiError::BadRequest(
                    "asset policy scope is out of range".into(),
                ));
            }
            update_bytes(&mut hasher, b"asset_policy");
            hasher.update([chain_kind as u8, scope_kind as u8, decimals as u8]);
            hasher.update(super::v4_input::decode_base58_32(
                &payload_text(payload, "assetId")?,
                "payload.assetId",
            )?);
            update_bytes(
                &mut hasher,
                payload_text(payload, "displayAsset")?.as_bytes(),
            );
            hasher.update(hash_bytes_from_hex(
                &payload_text(payload, "policyCommitment")?,
                "payload.policyCommitment",
            )?);
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
            let from_money = Money::new(
                payload_text(from, "amount")?,
                payload_text(from, "asset")?,
                AssetEncoding::Text,
            )?;
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

pub(super) fn hash_clear_text(clear_text: &str) -> [u8; 32] {
    Sha256::digest(clear_text.as_bytes()).into()
}

pub(super) fn hash_envelope(
    envelope: &NormalizedEnvelope,
    payload_hash: [u8; 32],
    clear_text_hash: [u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, CLEARSIGN_V3_DOMAIN);
    hasher.update([CLEARSIGN_V3_VERSION]);
    hasher.update([envelope.kind.code()]);
    hasher.update(envelope.expires_at.to_le_bytes());
    update_bytes(&mut hasher, envelope.wallet_name.as_bytes());
    update_bytes(&mut hasher, &canonical_address_or_text(&envelope.wallet_id));
    update_bytes(&mut hasher, &Sha256::digest(envelope.action_id.as_bytes()));
    update_bytes(&mut hasher, &Sha256::digest(envelope.nonce.as_bytes()));
    hasher.update(envelope.policy_commitment);
    hasher.update(payload_hash);
    hasher.update(clear_text_hash);
    finish_hash(hasher)
}

fn payload_hasher(kind: ClearSignActionKind) -> Sha256 {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, CLEARSIGN_PAYLOAD_DOMAIN);
    hasher.update([kind.code()]);
    hasher
}

pub(super) fn text_commitment(value: &str) -> [u8; 32] {
    Sha256::digest(value.trim().as_bytes()).into()
}

fn optional_payload_text(payload: &Value, field: &str) -> Result<Option<String>, ApiError> {
    let Some(value) = payload.get(field) else {
        return Ok(None);
    };
    let Some(raw) = value.as_str() else {
        return Err(ApiError::BadRequest(format!(
            "payload.{field} must be a string"
        )));
    };
    let normalized = raw.trim().to_string();
    if normalized.is_empty() {
        return Ok(None);
    }
    Ok(Some(normalized))
}

fn hash_bytes_from_hex(value: &str, field: &str) -> Result<[u8; 32], ApiError> {
    let normalized = value.trim().to_lowercase();
    if normalized.len() != 64 || !normalized.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ApiError::BadRequest(format!(
            "{field} must be a 32-byte hex hash"
        )));
    }
    let mut out = [0u8; 32];
    for (idx, pair) in normalized.as_bytes().chunks_exact(2).enumerate() {
        out[idx] = (hex_nibble(pair[0])? << 4) | hex_nibble(pair[1])?;
    }
    Ok(out)
}

fn hex_nibble(value: u8) -> Result<u8, ApiError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        b'A'..=b'F' => Ok(value - b'A' + 10),
        _ => Err(ApiError::BadRequest(
            "payload.riskCheckHash must be a 32-byte hex hash".into(),
        )),
    }
}

pub(super) fn update_amount(hasher: &mut Sha256, money: &Money) {
    if money.asset_encoding == AssetEncoding::Sha256Text {
        update_bytes(hasher, &text_commitment(&money.asset));
    } else {
        update_bytes(hasher, money.asset.as_bytes());
    }
    hasher.update(money.raw_amount.to_le_bytes());
}

pub(super) fn update_bytes(hasher: &mut Sha256, value: &[u8]) {
    update_u32(hasher, value.len() as u32);
    hasher.update(value);
}

pub(super) fn update_u32(hasher: &mut Sha256, value: u32) {
    hasher.update(value.to_le_bytes());
}

fn hash_intent_governance_fields(hasher: &mut Sha256, payload: &Value) -> Result<(), ApiError> {
    update_bytes(hasher, b"intent_governance");
    let target_index = payload_u32(payload, "targetIntentIndex")?;
    if target_index > u8::MAX as u32 {
        return Err(ApiError::BadRequest(
            "payload.targetIntentIndex is out of range".into(),
        ));
    }
    let approval = payload
        .get("approvalThreshold")
        .and_then(Value::as_u64)
        .or_else(|| payload.get("approvalsRequired").and_then(Value::as_u64))
        .ok_or_else(|| {
            ApiError::BadRequest(
                "payload.approvalThreshold (or approvalsRequired) is required".into(),
            )
        })?;
    if approval == 0 || approval > u8::MAX as u64 {
        return Err(ApiError::BadRequest(
            "payload.approvalThreshold is out of range".into(),
        ));
    }
    let cancellation = payload
        .get("cancellationThreshold")
        .and_then(Value::as_u64)
        .unwrap_or(1);
    if cancellation == 0 || cancellation > u8::MAX as u64 {
        return Err(ApiError::BadRequest(
            "payload.cancellationThreshold is out of range".into(),
        ));
    }
    let timelock = payload
        .get("timelockSeconds")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if timelock > u32::MAX as u64 {
        return Err(ApiError::BadRequest(
            "payload.timelockSeconds is out of range".into(),
        ));
    }
    hasher.update([target_index as u8]);
    hasher.update([approval as u8]);
    hasher.update([cancellation as u8]);
    hasher.update((timelock as u32).to_le_bytes());

    let proposers = payload_pubkey_list(payload, "proposers")?;
    let approvers = payload_pubkey_list(payload, "approvers")?;
    update_u32(hasher, proposers.len() as u32);
    for pk in &proposers {
        hasher.update(pk);
    }
    update_u32(hasher, approvers.len() as u32);
    for pk in &approvers {
        hasher.update(pk);
    }
    Ok(())
}

fn payload_pubkey_list(payload: &Value, field: &str) -> Result<Vec<[u8; 32]>, ApiError> {
    let rows = payload
        .get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::BadRequest(format!("payload.{field} must be an array")))?;
    if rows.is_empty() || rows.len() > 16 {
        return Err(ApiError::BadRequest(format!(
            "payload.{field} must contain 1..=16 base58 pubkeys"
        )));
    }
    let mut out = Vec::with_capacity(rows.len());
    for (idx, row) in rows.iter().enumerate() {
        let text = row.as_str().ok_or_else(|| {
            ApiError::BadRequest(format!("payload.{field}[{idx}] must be a string"))
        })?;
        let bytes = bs58::decode(text)
            .into_vec()
            .map_err(|_| ApiError::BadRequest(format!("payload.{field}[{idx}] must be base58")))?;
        if bytes.len() != 32 {
            return Err(ApiError::BadRequest(format!(
                "payload.{field}[{idx}] must decode to 32 bytes"
            )));
        }
        let mut pk = [0u8; 32];
        pk.copy_from_slice(&bytes);
        out.push(pk);
    }
    Ok(out)
}

fn finish_hash(hasher: Sha256) -> [u8; 32] {
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

fn canonical_address_or_text(value: &str) -> Vec<u8> {
    bs58::decode(value)
        .into_vec()
        .ok()
        .filter(|bytes| bytes.len() == 32)
        .unwrap_or_else(|| value.as_bytes().to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn envelope_hash_length_prefixes_replay_commitments() {
        let envelope = NormalizedEnvelope {
            kind: ClearSignActionKind::Send,
            network: "Solana devnet".into(),
            wallet_name: "Team".into(),
            wallet_id: "WalletPda111".into(),
            action_id: "action-1".into(),
            nonce: "nonce-1".into(),
            expires_at: 1_782_988_800,
            policy_commitment: [0x11; 32],
            payload: serde_json::json!({ "recipient": "Sarah", "amount": "2.5", "asset": "SOL" }),
        };
        let payload_hash = hash_payload(envelope.kind, &envelope.payload).unwrap();
        let clear_text_hash = hash_clear_text("Send 2.5 SOL from Team to Sarah");

        assert_ne!(
            hash_envelope(&envelope, payload_hash, clear_text_hash),
            legacy_envelope_hash_without_commitment_lengths(
                &envelope,
                payload_hash,
                clear_text_hash
            )
        );
    }

    #[test]
    fn agent_trade_approval_v2_binds_route_and_risk_artifact() {
        let payload = serde_json::json!({
            "agentId": "agent-1",
            "venue": "Hyperliquid Testnet",
            "market": "btc-perp",
            "side": "long",
            "maxNotionalUsd": "250.00",
            "maxLeverage": "2.5x",
            "stopLossRequired": true,
            "assetId": "USDC:hyperliquid:testnet",
            "sessionId": "agent-session:morning-risk-pass",
            "route": "clearsig-agent:hyperliquid:testnet:limit",
            "riskCheckHash": "8a58cb501c3269e8abe8f456629b04e12855131b2e8b1e6807749817d167a9d4"
        });
        let route_changed = serde_json::json!({
            "agentId": "agent-1",
            "venue": "Hyperliquid Testnet",
            "market": "btc-perp",
            "side": "long",
            "maxNotionalUsd": "250.00",
            "maxLeverage": "2.5x",
            "stopLossRequired": true,
            "assetId": "USDC:hyperliquid:testnet",
            "sessionId": "agent-session:morning-risk-pass",
            "route": "clearsig-agent:hyperliquid:testnet:market",
            "riskCheckHash": "8a58cb501c3269e8abe8f456629b04e12855131b2e8b1e6807749817d167a9d4"
        });
        let risk_changed = serde_json::json!({
            "agentId": "agent-1",
            "venue": "Hyperliquid Testnet",
            "market": "btc-perp",
            "side": "long",
            "maxNotionalUsd": "250.00",
            "maxLeverage": "2.5x",
            "stopLossRequired": true,
            "assetId": "USDC:hyperliquid:testnet",
            "sessionId": "agent-session:morning-risk-pass",
            "route": "clearsig-agent:hyperliquid:testnet:limit",
            "riskCheckHash": "2d4724a75961caff9e395a8d610dc4720c02bd809138e54ce2d32681bfcd9f49"
        });

        let base = hash_payload(ClearSignActionKind::AgentTradeApproval, &payload).unwrap();
        assert_ne!(
            base,
            hash_payload(ClearSignActionKind::AgentTradeApproval, &route_changed).unwrap()
        );
        assert_ne!(
            base,
            hash_payload(ClearSignActionKind::AgentTradeApproval, &risk_changed).unwrap()
        );
    }

    #[test]
    fn agent_trade_approval_v2_rejects_partial_payloads() {
        let payload = serde_json::json!({
            "venue": "Hyperliquid Testnet",
            "market": "btc-perp",
            "side": "long",
            "maxNotionalUsd": "250.00",
            "maxLeverage": "2.5x",
            "stopLossRequired": true
        });

        let error = hash_payload(ClearSignActionKind::AgentTradeApproval, &payload)
            .expect_err("partial v2 payload should fail");
        assert!(error
            .to_string()
            .contains("agent_trade_approval v2 requires agentId"));
    }

    #[test]
    fn agent_risk_policy_binds_loss_cap_and_oracle_commitment() {
        let payload = serde_json::json!({
            "sessionId": "session-1",
            "oraclePolicyHash": "1111111111111111111111111111111111111111111111111111111111111111",
            "maxLossRaw": "100000000",
            "status": "active"
        });
        let changed_cap = serde_json::json!({
            "sessionId": "session-1",
            "oraclePolicyHash": "1111111111111111111111111111111111111111111111111111111111111111",
            "maxLossRaw": "100000001",
            "status": "active"
        });
        let changed_oracle = serde_json::json!({
            "sessionId": "session-1",
            "oraclePolicyHash": "2222222222222222222222222222222222222222222222222222222222222222",
            "maxLossRaw": "100000000",
            "status": "active"
        });
        let base = hash_payload(ClearSignActionKind::AgentRiskPolicy, &payload).unwrap();
        assert_ne!(
            base,
            hash_payload(ClearSignActionKind::AgentRiskPolicy, &changed_cap).unwrap()
        );
        assert_ne!(
            base,
            hash_payload(ClearSignActionKind::AgentRiskPolicy, &changed_oracle).unwrap()
        );
    }

    #[test]
    fn agent_settlement_binds_artifact_accounting_and_sequence() {
        let payload = serde_json::json!({
            "sessionId": "session-1",
            "executionId": "execution-1",
            "settlementArtifactHash": "3333333333333333333333333333333333333333333333333333333333333333",
            "oraclePolicyHash": "1111111111111111111111111111111111111111111111111111111111111111",
            "closedNotionalRaw": "250000000",
            "outcome": "loss",
            "pnlAbsRaw": "50000000",
            "settlementSequence": 4
        });
        let changed_sequence = serde_json::json!({
            "sessionId": "session-1",
            "executionId": "execution-1",
            "settlementArtifactHash": "3333333333333333333333333333333333333333333333333333333333333333",
            "oraclePolicyHash": "1111111111111111111111111111111111111111111111111111111111111111",
            "closedNotionalRaw": "250000000",
            "outcome": "loss",
            "pnlAbsRaw": "50000000",
            "settlementSequence": 5
        });
        let changed_artifact = serde_json::json!({
            "sessionId": "session-1",
            "executionId": "execution-1",
            "settlementArtifactHash": "4444444444444444444444444444444444444444444444444444444444444444",
            "oraclePolicyHash": "1111111111111111111111111111111111111111111111111111111111111111",
            "closedNotionalRaw": "250000000",
            "outcome": "loss",
            "pnlAbsRaw": "50000000",
            "settlementSequence": 4
        });
        let base = hash_payload(ClearSignActionKind::AgentTradeSettlement, &payload).unwrap();
        assert_ne!(
            base,
            hash_payload(ClearSignActionKind::AgentTradeSettlement, &changed_sequence).unwrap()
        );
        assert_ne!(
            base,
            hash_payload(ClearSignActionKind::AgentTradeSettlement, &changed_artifact).unwrap()
        );
    }

    #[test]
    fn send_payload_binds_committed_recipient_and_asset() {
        let committed = serde_json::json!({
            "recipient": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
            "recipientEncoding": "sha256_text",
            "amount": "1.250000000000000000",
            "asset": "eth",
            "assetEncoding": "sha256_text"
        });
        let plain = serde_json::json!({
            "recipient": "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
            "recipientEncoding": "text",
            "amount": "1.250000000000000000",
            "asset": "eth",
            "assetEncoding": "text"
        });
        let recipient_changed = serde_json::json!({
            "recipient": "0x1111111111111111111111111111111111111111",
            "recipientEncoding": "sha256_text",
            "amount": "1.250000000000000000",
            "asset": "eth",
            "assetEncoding": "sha256_text"
        });

        let base = hash_payload(ClearSignActionKind::Send, &committed).unwrap();
        assert_ne!(
            base,
            hash_payload(ClearSignActionKind::Send, &plain).unwrap()
        );
        assert_ne!(
            base,
            hash_payload(ClearSignActionKind::Send, &recipient_changed).unwrap()
        );
    }

    fn legacy_envelope_hash_without_commitment_lengths(
        envelope: &NormalizedEnvelope,
        payload_hash: [u8; 32],
        clear_text_hash: [u8; 32],
    ) -> [u8; 32] {
        let mut hasher = Sha256::new();
        update_bytes(&mut hasher, CLEARSIGN_V3_DOMAIN);
        hasher.update([CLEARSIGN_V3_VERSION]);
        hasher.update([envelope.kind.code()]);
        hasher.update(envelope.expires_at.to_le_bytes());
        update_bytes(&mut hasher, envelope.wallet_name.as_bytes());
        update_bytes(&mut hasher, &canonical_address_or_text(&envelope.wallet_id));
        hasher.update(Sha256::digest(envelope.action_id.as_bytes()));
        hasher.update(Sha256::digest(envelope.nonce.as_bytes()));
        hasher.update(envelope.policy_commitment);
        hasher.update(payload_hash);
        hasher.update(clear_text_hash);
        finish_hash(hasher)
    }
}
