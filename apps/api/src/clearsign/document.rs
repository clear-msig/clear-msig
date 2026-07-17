use super::{
    device_profiles::{DeviceProfile, RenderMode},
    kinds::ClearSignActionKind,
    payload, NormalizedEnvelope,
};
use crate::ApiError;

pub(super) fn clear_sign_document(
    envelope: &NormalizedEnvelope,
    action: &[String],
    payload_hash: [u8; 32],
    profile: DeviceProfile,
) -> Result<String, ApiError> {
    let details = document_details(envelope, action, payload_hash, profile.mode)?;
    let policy = match profile.mode {
        RenderMode::Full => vec![
            "Approval: Wallet's onchain threshold must be met".into(),
            "Execution: Onchain policy and timelock must pass".into(),
            format!("Commitment: {}", short_hash(&envelope.policy_commitment)),
            "Enforcement: Exact payload and policy must match onchain".into(),
            format!("Display profile: {}", profile.display_label()),
        ],
        RenderMode::Compact => vec![
            "Approval and timelock: enforced onchain".into(),
            format!("Policy: {}", short_hash(&envelope.policy_commitment)),
            "Execution: exact payload must match".into(),
            format!("Display profile: {}", profile.display_label()),
        ],
    };
    let document = [
        "ClearSig Proposal".into(),
        String::new(),
        "ACTION".into(),
        action
            .first()
            .cloned()
            .unwrap_or_else(|| "Review ClearSig action".into()),
        String::new(),
        "DETAILS".into(),
        details.join("\n"),
        String::new(),
        "POLICY".into(),
        policy.join("\n"),
        String::new(),
        "RISK".into(),
        format!("Category: {}", risk_category(envelope.kind)),
        format!("Signer check: {}", risk_check(envelope.kind)),
        String::new(),
        "PURPOSE".into(),
        purpose_for(envelope)?,
    ]
    .join("\n");
    if document.len() > profile.max_document_bytes {
        return Err(ApiError::BadRequest(format!(
            "ClearSign document exceeds the {}-byte limit for profile {}",
            profile.max_document_bytes, profile.id
        )));
    }
    Ok(document)
}

fn document_details(
    envelope: &NormalizedEnvelope,
    action: &[String],
    payload_hash: [u8; 32],
    mode: RenderMode,
) -> Result<Vec<String>, ApiError> {
    let wallet_label = match mode {
        RenderMode::Full => "From wallet",
        RenderMode::Compact => "Wallet",
    };
    let mut details = vec![
        format!("{wallet_label}: {}", envelope.wallet_name),
        format!("Network: {}", envelope.network),
    ];
    if envelope.kind == ClearSignActionKind::Send {
        let row = payload::recipient_amount(&envelope.payload)?;
        details.push(format!("Amount: {}", payload::format_money(&row.money)));
        details.push(format!("To: {}", row.recipient));
        if mode == RenderMode::Full {
            if let Some(value) = payload::optional_payload_text(&envelope.payload, "estimatedUsd")?
            {
                details.push(format!(
                    "Estimated value: ${} USD (informational)",
                    payload::normalize_decimal(&value)?
                ));
            }
        }
    } else {
        details.extend(
            action
                .iter()
                .skip(1)
                .filter(|line| {
                    line.as_str() != "Requires wallet approval"
                        && !line.starts_with("Reason:")
                        && !line.starts_with("Estimated value at review:")
                })
                .cloned(),
        );
    }
    details.push(format!("Payload: {}", short_hash(&payload_hash)));
    Ok(details)
}

fn purpose_for(envelope: &NormalizedEnvelope) -> Result<String, ApiError> {
    Ok(payload::optional_payload_text(&envelope.payload, "note")?
        .unwrap_or_else(|| "Not provided".into()))
}

fn risk_category(kind: ClearSignActionKind) -> &'static str {
    match kind {
        ClearSignActionKind::Send
        | ClearSignActionKind::ReleaseMilestone
        | ClearSignActionKind::ReturnEscrowFunds
        | ClearSignActionKind::SwapIntent => "Funds movement",
        ClearSignActionKind::BatchSend => "Multiple funds movements",
        ClearSignActionKind::AddMember
        | ClearSignActionKind::RemoveMember
        | ClearSignActionKind::ChangeThreshold => "Authorization change",
        ClearSignActionKind::SetProtection => "Policy change",
        ClearSignActionKind::RecoveryAction => "Recovery authority",
        ClearSignActionKind::AgentSessionGrant | ClearSignActionKind::AgentRiskPolicy => {
            "Agent authority"
        }
        ClearSignActionKind::AgentTradeApproval | ClearSignActionKind::AgentTradeSettlement => {
            "Agent execution"
        }
    }
}

fn risk_check(kind: ClearSignActionKind) -> &'static str {
    match kind {
        ClearSignActionKind::Send
        | ClearSignActionKind::BatchSend
        | ClearSignActionKind::ReleaseMilestone
        | ClearSignActionKind::ReturnEscrowFunds => {
            "Verify amount, asset, network, and every destination"
        }
        ClearSignActionKind::SwapIntent => "Verify network, assets, and minimum received",
        ClearSignActionKind::AddMember
        | ClearSignActionKind::RemoveMember
        | ClearSignActionKind::ChangeThreshold => "Verify the resulting signer authority",
        ClearSignActionKind::SetProtection => "Verify the complete replacement policy",
        ClearSignActionKind::RecoveryAction => "Verify the recovery target and authority",
        ClearSignActionKind::AgentTradeApproval
        | ClearSignActionKind::AgentSessionGrant
        | ClearSignActionKind::AgentRiskPolicy
        | ClearSignActionKind::AgentTradeSettlement => {
            "Verify agent scope, limits, and execution evidence"
        }
    }
}

fn short_hash(hash: &[u8; 32]) -> String {
    let hash = super::to_hex(hash);
    format!("{}...{}", &hash[..12], &hash[hash.len() - 12..])
}
