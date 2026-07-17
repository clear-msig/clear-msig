use serde_json::Value;

use super::{kinds::ClearSignActionKind, ApiError};

pub(super) fn validate_payload_shape(
    kind: ClearSignActionKind,
    payload: &Value,
) -> Result<(), ApiError> {
    const TRANSFER_FIELDS: &[&str] = &[
        "recipient",
        "recipientEncoding",
        "amount",
        "asset",
        "assetEncoding",
        "decimals",
        "displayAsset",
    ];
    let allowed = match kind {
        ClearSignActionKind::Send => &[
            "recipient",
            "recipientEncoding",
            "amount",
            "asset",
            "assetEncoding",
            "decimals",
            "displayAsset",
            "note",
            "fiatEstimate",
        ][..],
        ClearSignActionKind::BatchSend => &["recipients", "note"],
        ClearSignActionKind::AddMember | ClearSignActionKind::RemoveMember => &[
            "member",
            "role",
            "targetIntentIndex",
            "proposers",
            "approvers",
            "approvalThreshold",
            "cancellationThreshold",
            "timelockSeconds",
            "reason",
        ],
        ClearSignActionKind::ChangeThreshold => &[
            "approvalsRequired",
            "targetIntentIndex",
            "proposers",
            "approvers",
            "cancellationThreshold",
            "timelockSeconds",
            "reason",
        ],
        ClearSignActionKind::SetProtection => &["summary", "policyCommitment", "chainKind"],
        ClearSignActionKind::ReleaseMilestone => &[
            "recipient",
            "recipientEncoding",
            "amount",
            "asset",
            "assetEncoding",
            "decimals",
            "displayAsset",
            "escrowId",
            "escrowTitle",
            "milestoneId",
            "milestoneTitle",
            "reason",
        ],
        ClearSignActionKind::ReturnEscrowFunds => &["escrowId", "escrowTitle", "returns", "reason"],
        ClearSignActionKind::AgentTradeApproval => &[
            "agentId",
            "venue",
            "market",
            "side",
            "maxNotionalUsd",
            "maxLeverage",
            "stopLossRequired",
            "assetId",
            "sessionId",
            "route",
            "riskCheckHash",
            "reason",
        ],
        ClearSignActionKind::AgentSessionGrant => &[
            "sessionId",
            "agentId",
            "venue",
            "market",
            "maxNotionalUsd",
            "maxLeverage",
            "expiresAt",
            "status",
            "reason",
        ],
        ClearSignActionKind::AgentRiskPolicy => &[
            "sessionId",
            "oraclePolicyHash",
            "maxLossRaw",
            "status",
            "reason",
        ],
        ClearSignActionKind::AgentTradeSettlement => &[
            "sessionId",
            "executionId",
            "settlementArtifactHash",
            "oraclePolicyHash",
            "closedNotionalRaw",
            "outcome",
            "pnlAbsRaw",
            "settlementSequence",
            "reason",
        ],
        ClearSignActionKind::RecoveryAction => &["recoveryAction"],
        ClearSignActionKind::SwapIntent => &["from", "toAsset", "minReceive"],
    };
    validate_object_keys(payload, allowed, "payload")?;

    let nested = match kind {
        ClearSignActionKind::BatchSend => payload.get("recipients"),
        ClearSignActionKind::ReturnEscrowFunds => payload.get("returns"),
        _ => None,
    };
    if let Some(rows) = nested {
        let rows = rows
            .as_array()
            .ok_or_else(|| ApiError::BadRequest("payload rows must be an array".into()))?;
        for (index, row) in rows.iter().enumerate() {
            validate_object_keys(row, TRANSFER_FIELDS, &format!("payload row {index}"))?;
        }
    }
    if let Some(estimate) = payload.get("fiatEstimate") {
        validate_object_keys(
            estimate,
            &[
                "amount",
                "currency",
                "source",
                "observedAt",
                "informationalOnly",
            ],
            "payload.fiatEstimate",
        )?;
    }
    Ok(())
}

fn validate_object_keys(value: &Value, allowed: &[&str], field: &str) -> Result<(), ApiError> {
    let object = value
        .as_object()
        .ok_or_else(|| ApiError::BadRequest(format!("{field} must be an object")))?;
    if let Some(unknown) = object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(ApiError::BadRequest(format!(
            "{field} contains unsupported field {unknown}"
        )));
    }
    Ok(())
}
