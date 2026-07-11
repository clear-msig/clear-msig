use serde_json::Value;

use super::{
    kinds::ClearSignActionKind,
    payload::{
        format_money, normalize_decimal, payload_text, payload_u32, recipient_amount,
        AssetEncoding, Money,
    },
    NormalizedEnvelope,
};
use crate::ApiError;

pub(super) fn action_lines(envelope: &NormalizedEnvelope) -> Result<Vec<String>, ApiError> {
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
        ClearSignActionKind::AgentSessionGrant => Ok(vec![
            format!(
                "{} agent session for {}",
                if payload_text(&envelope.payload, "status")? == "revoked" {
                    "Revoke"
                } else {
                    "Grant"
                },
                payload_text(&envelope.payload, "agentId")?
            ),
            format!(
                "{} on {} up to ${}",
                payload_text(&envelope.payload, "market")?.to_uppercase(),
                payload_text(&envelope.payload, "venue")?,
                payload_text(&envelope.payload, "maxNotionalUsd")?
            ),
            format!(
                "Max leverage {}",
                payload_text(&envelope.payload, "maxLeverage")?
            ),
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
            let from_money = Money::new(
                payload_text(from, "amount")?,
                payload_text(from, "asset")?,
                AssetEncoding::Text,
            )?;
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
