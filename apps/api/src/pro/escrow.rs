use serde::{Deserialize, Serialize};

use crate::ApiError;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowFunder {
    pub(super) id: String,
    pub(super) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) entity: Option<String>,
    pub(super) address: String,
    pub(super) asset: String,
    pub(super) amount: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) token_account: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowMilestone {
    pub(super) id: String,
    pub(super) title: String,
    pub(super) recipient: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) recipient_entity: Option<String>,
    pub(super) asset: String,
    pub(super) amount: String,
    pub(super) status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) token_account: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowExecution {
    pub(super) mode: String,
    pub(super) network: String,
    pub(super) chain_kind: u8,
    pub(super) decimals: u8,
    pub(super) asset_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) mint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) route_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) settlement_artifact_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) private_evaluation_hash: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowPolicy {
    pub(super) version: u8,
    pub(super) mode: String,
    pub(super) release_requires: String,
    pub(super) unwind_requires: String,
    pub(super) return_basis: String,
    pub(super) asset_mode: String,
    pub(super) enforcement: String,
    pub(super) commitment: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowRecord {
    pub(super) id: String,
    pub(super) wallet_name: String,
    pub(super) title: String,
    pub(super) counterparty: String,
    pub(super) status: String,
    pub(super) funders: Vec<ProEscrowFunder>,
    pub(super) milestones: Vec<ProEscrowMilestone>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) policy: Option<ProEscrowPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) execution: Option<ProEscrowExecution>,
    pub(super) created_at: i64,
    pub(super) updated_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowInput {
    pub(super) id: String,
    pub(super) title: String,
    pub(super) counterparty: String,
    pub(super) status: String,
    pub(super) funders: Vec<ProEscrowFunder>,
    pub(super) milestones: Vec<ProEscrowMilestone>,
    #[serde(default)]
    pub(super) policy: Option<ProEscrowPolicy>,
    #[serde(default)]
    pub(super) execution: Option<ProEscrowExecution>,
    pub(super) created_at: Option<i64>,
    pub(super) updated_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowsResponse {
    pub(super) wallet_name: String,
    pub(super) escrows: Vec<ProEscrowRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowDeleteRequest {
    pub(super) id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowReturnPreviewRequest {
    pub(super) id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowReleasePreviewRequest {
    pub(super) id: String,
    pub(super) milestone_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowReturnRow {
    funder_id: String,
    funder_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    funder_entity: Option<String>,
    recipient: String,
    asset: String,
    amount: String,
    raw_amount: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowReturnPreview {
    wallet_name: String,
    escrow_id: String,
    escrow_title: String,
    policy: ProEscrowPolicy,
    total_return: String,
    raw_total_return: String,
    returns: Vec<ProEscrowReturnRow>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProEscrowReleasePreview {
    wallet_name: String,
    escrow_id: String,
    escrow_title: String,
    milestone_id: String,
    milestone_title: String,
    recipient: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recipient_entity: Option<String>,
    asset: String,
    amount: String,
    raw_amount: String,
    policy: ProEscrowPolicy,
}

pub(super) fn validate_pro_escrow(input: &ProEscrowInput) -> Result<(), ApiError> {
    ensure_non_empty(&input.id, "id")?;
    ensure_non_empty(&input.title, "title")?;
    ensure_non_empty(&input.counterparty, "counterparty")?;
    normalize_escrow_status(&input.status)?;
    if input.funders.is_empty() {
        return Err(ApiError::BadRequest(
            "escrow must include at least one funder".to_string(),
        ));
    }
    if input.milestones.is_empty() {
        return Err(ApiError::BadRequest(
            "escrow must include at least one milestone".to_string(),
        ));
    }
    for funder in &input.funders {
        ensure_non_empty(&funder.id, "funder.id")?;
        ensure_non_empty(&funder.name, "funder.name")?;
        ensure_non_empty(&funder.address, "funder.address")?;
        ensure_non_empty(&funder.asset, "funder.asset")?;
        ensure_positive_amount(&funder.amount, "funder.amount")?;
    }
    for milestone in &input.milestones {
        ensure_non_empty(&milestone.id, "milestone.id")?;
        ensure_non_empty(&milestone.title, "milestone.title")?;
        ensure_non_empty(&milestone.recipient, "milestone.recipient")?;
        ensure_non_empty(&milestone.asset, "milestone.asset")?;
        ensure_positive_amount(&milestone.amount, "milestone.amount")?;
        normalize_milestone_status(&milestone.status)?;
    }
    if let Some(policy) = &input.policy {
        normalize_escrow_policy(policy.clone())?;
    }
    if let Some(execution) = &input.execution {
        match execution.mode.as_str() {
            "spl" if execution.chain_kind == 0 => {
                ensure_non_empty(execution.mint.as_deref().unwrap_or(""), "execution.mint")?;
                ensure_non_empty(
                    execution.source_token.as_deref().unwrap_or(""),
                    "execution.sourceToken",
                )?;
            }
            "cross_chain" if execution.chain_kind > 0 => {
                ensure_non_empty(
                    execution.route_hash.as_deref().unwrap_or(""),
                    "execution.routeHash",
                )?;
                ensure_non_empty(
                    execution.settlement_artifact_hash.as_deref().unwrap_or(""),
                    "execution.settlementArtifactHash",
                )?;
            }
            "private" => {
                ensure_non_empty(
                    execution.private_evaluation_hash.as_deref().unwrap_or(""),
                    "execution.privateEvaluationHash",
                )?;
                ensure_non_empty(
                    execution.settlement_artifact_hash.as_deref().unwrap_or(""),
                    "execution.settlementArtifactHash",
                )?;
            }
            _ => {
                return Err(ApiError::BadRequest(
                    "unsupported escrow execution mode or chain".to_string(),
                ));
            }
        }
        ensure_non_empty(&execution.network, "execution.network")?;
        ensure_non_empty(&execution.asset_id, "execution.assetId")?;
        if execution.decimals > 36 {
            return Err(ApiError::BadRequest(
                "execution.decimals must be 36 or less".to_string(),
            ));
        }
    }
    Ok(())
}

pub(super) fn normalize_escrow_status(value: &str) -> Result<String, ApiError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "active" => Ok("active".to_string()),
        "disputed" => Ok("disputed".to_string()),
        "returned" => Ok("returned".to_string()),
        "complete" => Ok("complete".to_string()),
        _ => Err(ApiError::BadRequest(
            "escrow status must be active, disputed, returned, or complete".to_string(),
        )),
    }
}

pub(super) fn normalize_escrow_funders(
    rows: Vec<ProEscrowFunder>,
) -> Result<Vec<ProEscrowFunder>, ApiError> {
    rows.into_iter()
        .map(|row| {
            Ok(ProEscrowFunder {
                id: row.id.trim().to_string(),
                name: row.name.trim().to_string(),
                entity: trim_optional(row.entity),
                address: row.address.trim().to_string(),
                asset: row.asset.trim().to_ascii_uppercase(),
                amount: row.amount.trim().to_string(),
                token_account: trim_optional(row.token_account),
            })
        })
        .collect()
}

pub(super) fn normalize_escrow_milestones(
    rows: Vec<ProEscrowMilestone>,
) -> Result<Vec<ProEscrowMilestone>, ApiError> {
    rows.into_iter()
        .map(|row| {
            Ok(ProEscrowMilestone {
                id: row.id.trim().to_string(),
                title: row.title.trim().to_string(),
                recipient: row.recipient.trim().to_string(),
                recipient_entity: trim_optional(row.recipient_entity),
                asset: row.asset.trim().to_ascii_uppercase(),
                amount: row.amount.trim().to_string(),
                status: normalize_milestone_status(&row.status)?,
                token_account: trim_optional(row.token_account),
            })
        })
        .collect()
}

pub(super) fn normalize_escrow_policy(
    policy: ProEscrowPolicy,
) -> Result<ProEscrowPolicy, ApiError> {
    if policy.version != 1 {
        return Err(ApiError::BadRequest(
            "escrow policy version must be 1".to_string(),
        ));
    }
    let mode = policy.mode.trim();
    let release_requires = policy.release_requires.trim();
    let unwind_requires = policy.unwind_requires.trim();
    let return_basis = policy.return_basis.trim();
    let asset_mode = policy.asset_mode.trim();
    let enforcement = policy.enforcement.trim();
    let commitment = policy.commitment.trim();
    if mode != "milestone_escrow"
        || release_requires != "wallet_approval"
        || unwind_requires != "wallet_approval"
        || return_basis != "recorded_funder_contribution"
        || asset_mode != "per_asset"
    {
        return Err(ApiError::BadRequest(
            "unsupported escrow policy".to_string(),
        ));
    }
    match enforcement {
        "approval_workflow" | "onchain_policy_pending" => {}
        _ => {
            return Err(ApiError::BadRequest(
                "unsupported escrow policy enforcement".to_string(),
            ))
        }
    }
    if commitment.len() < 16 || !commitment.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ApiError::BadRequest(
            "escrow policy commitment must be hex".to_string(),
        ));
    }
    Ok(ProEscrowPolicy {
        version: policy.version,
        mode: mode.to_string(),
        release_requires: release_requires.to_string(),
        unwind_requires: unwind_requires.to_string(),
        return_basis: return_basis.to_string(),
        asset_mode: asset_mode.to_string(),
        enforcement: enforcement.to_string(),
        commitment: commitment.to_string(),
    })
}

pub(super) fn build_return_preview(
    escrow: &ProEscrowRecord,
) -> Result<ProEscrowReturnPreview, ApiError> {
    let policy = escrow
        .policy
        .clone()
        .map(normalize_escrow_policy)
        .transpose()?
        .unwrap_or_else(|| default_escrow_policy(escrow));
    let funders = escrow
        .funders
        .iter()
        .filter(|row| row.asset.eq_ignore_ascii_case("SOL"))
        .collect::<Vec<_>>();
    if funders.is_empty() {
        return Err(ApiError::BadRequest(
            "escrow has no SOL funders to return".to_string(),
        ));
    }
    let funded = funders.iter().try_fold(0u64, |acc, row| {
        acc.checked_add(parse_sol_lamports(&row.amount, "funder.amount")?)
            .ok_or_else(|| ApiError::BadRequest("escrow amount is too large".to_string()))
    })?;
    let released = escrow
        .milestones
        .iter()
        .filter(|row| row.asset.eq_ignore_ascii_case("SOL") && row.status == "released")
        .try_fold(0u64, |acc, row| {
            acc.checked_add(parse_sol_lamports(&row.amount, "milestone.amount")?)
                .ok_or_else(|| ApiError::BadRequest("escrow amount is too large".to_string()))
        })?;
    let remaining = funded.saturating_sub(released);
    if funded == 0 || remaining == 0 {
        return Err(ApiError::BadRequest(
            "escrow has no remaining SOL to return".to_string(),
        ));
    }

    let mut rows = Vec::with_capacity(funders.len());
    let mut assigned = 0u64;
    for (index, funder) in funders.iter().enumerate() {
        let contribution = parse_sol_lamports(&funder.amount, "funder.amount")?;
        let mut raw_amount = ((remaining as u128) * (contribution as u128) / (funded as u128))
            .try_into()
            .map_err(|_| ApiError::BadRequest("escrow amount is too large".to_string()))?;
        if index + 1 == funders.len() {
            raw_amount = remaining.saturating_sub(assigned);
        }
        assigned = assigned.saturating_add(raw_amount);
        if raw_amount == 0 {
            continue;
        }
        rows.push(ProEscrowReturnRow {
            funder_id: funder.id.clone(),
            funder_name: funder.name.clone(),
            funder_entity: funder.entity.clone(),
            recipient: funder.address.clone(),
            asset: "SOL".to_string(),
            amount: format_sol_lamports(raw_amount),
            raw_amount: raw_amount.to_string(),
        });
    }
    if rows.is_empty() {
        return Err(ApiError::BadRequest(
            "escrow return amount is too small".to_string(),
        ));
    }

    Ok(ProEscrowReturnPreview {
        wallet_name: escrow.wallet_name.clone(),
        escrow_id: escrow.id.clone(),
        escrow_title: escrow.title.clone(),
        policy,
        total_return: format_sol_lamports(remaining),
        raw_total_return: remaining.to_string(),
        returns: rows,
    })
}

pub(super) fn build_release_preview(
    escrow: &ProEscrowRecord,
    milestone_id: &str,
) -> Result<ProEscrowReleasePreview, ApiError> {
    let milestone = escrow
        .milestones
        .iter()
        .find(|row| row.id == milestone_id)
        .ok_or_else(|| ApiError::BadRequest("milestone not found".to_string()))?;
    if !milestone.asset.eq_ignore_ascii_case("SOL") {
        return Err(ApiError::BadRequest(
            "only SOL escrow release is available on devnet".to_string(),
        ));
    }
    if milestone.status != "planned" {
        return Err(ApiError::BadRequest(
            "milestone is already released".to_string(),
        ));
    }
    let raw_amount = parse_sol_lamports(&milestone.amount, "milestone.amount")?;
    let policy = escrow
        .policy
        .clone()
        .map(normalize_escrow_policy)
        .transpose()?
        .unwrap_or_else(|| default_escrow_policy(escrow));
    Ok(ProEscrowReleasePreview {
        wallet_name: escrow.wallet_name.clone(),
        escrow_id: escrow.id.clone(),
        escrow_title: escrow.title.clone(),
        milestone_id: milestone.id.clone(),
        milestone_title: milestone.title.clone(),
        recipient: milestone.recipient.clone(),
        recipient_entity: milestone.recipient_entity.clone(),
        asset: "SOL".to_string(),
        amount: format_sol_lamports(raw_amount),
        raw_amount: raw_amount.to_string(),
        policy,
    })
}

fn normalize_milestone_status(value: &str) -> Result<String, ApiError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "planned" => Ok("planned".to_string()),
        "released" => Ok("released".to_string()),
        _ => Err(ApiError::BadRequest(
            "milestone status must be planned or released".to_string(),
        )),
    }
}

fn default_escrow_policy(escrow: &ProEscrowRecord) -> ProEscrowPolicy {
    ProEscrowPolicy {
        version: 1,
        mode: "milestone_escrow".to_string(),
        release_requires: "wallet_approval".to_string(),
        unwind_requires: "wallet_approval".to_string(),
        return_basis: "recorded_funder_contribution".to_string(),
        asset_mode: "per_asset".to_string(),
        enforcement: "onchain_policy_pending".to_string(),
        commitment: fallback_policy_commitment(escrow),
    }
}

fn fallback_policy_commitment(escrow: &ProEscrowRecord) -> String {
    let mut parts = vec![
        escrow.id.as_str(),
        escrow.title.as_str(),
        escrow.counterparty.as_str(),
    ];
    for funder in &escrow.funders {
        parts.extend([
            funder.id.as_str(),
            funder.name.as_str(),
            funder.entity.as_deref().unwrap_or(""),
            funder.address.as_str(),
            funder.asset.as_str(),
            funder.amount.as_str(),
        ]);
    }
    for milestone in &escrow.milestones {
        parts.extend([
            milestone.id.as_str(),
            milestone.title.as_str(),
            milestone.recipient.as_str(),
            milestone.recipient_entity.as_deref().unwrap_or(""),
            milestone.asset.as_str(),
            milestone.amount.as_str(),
        ]);
    }
    let encoded = parts.join("|");
    let mut hash = 0xcbf29ce484222325u64;
    for byte in encoded.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}{hash:016x}{hash:016x}{hash:016x}")
}

fn ensure_non_empty(value: &str, field: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    Ok(())
}

fn ensure_positive_amount(value: &str, field: &str) -> Result<(), ApiError> {
    ensure_non_empty(value, field)?;
    let parsed = value
        .trim()
        .parse::<f64>()
        .map_err(|_| ApiError::BadRequest(format!("{field} must be a positive number")))?;
    if !parsed.is_finite() || parsed <= 0.0 {
        return Err(ApiError::BadRequest(format!(
            "{field} must be a positive number"
        )));
    }
    Ok(())
}

fn parse_sol_lamports(value: &str, field: &str) -> Result<u64, ApiError> {
    let trimmed = value.trim();
    let (whole, frac) = trimmed
        .split_once('.')
        .map_or((trimmed, ""), |(whole, frac)| (whole, frac));
    if whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !frac.bytes().all(|b| b.is_ascii_digit())
        || frac.len() > 9
    {
        return Err(ApiError::BadRequest(format!(
            "{field} must be a SOL decimal with at most 9 decimals"
        )));
    }
    let whole_lamports = whole
        .parse::<u64>()
        .map_err(|_| ApiError::BadRequest(format!("{field} is too large")))?
        .checked_mul(1_000_000_000)
        .ok_or_else(|| ApiError::BadRequest(format!("{field} is too large")))?;
    let frac_lamports = if frac.is_empty() {
        0
    } else {
        format!("{frac:0<9}")
            .parse::<u64>()
            .map_err(|_| ApiError::BadRequest(format!("{field} is too large")))?
    };
    let out = whole_lamports
        .checked_add(frac_lamports)
        .ok_or_else(|| ApiError::BadRequest(format!("{field} is too large")))?;
    if out == 0 {
        return Err(ApiError::BadRequest(format!("{field} must be positive")));
    }
    Ok(out)
}

fn format_sol_lamports(lamports: u64) -> String {
    let whole = lamports / 1_000_000_000;
    let frac = lamports % 1_000_000_000;
    if frac == 0 {
        whole.to_string()
    } else {
        let frac = format!("{frac:09}");
        format!("{whole}.{}", frac.trim_end_matches('0'))
    }
}

fn trim_optional(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn escrow() -> ProEscrowRecord {
        ProEscrowRecord {
            id: "escrow-1".to_string(),
            wallet_name: "Team".to_string(),
            title: "Land redevelopment".to_string(),
            counterparty: "Construction cooperative".to_string(),
            status: "active".to_string(),
            funders: vec![
                ProEscrowFunder {
                    id: "alice".to_string(),
                    name: "Alice".to_string(),
                    entity: Some("Fund".to_string()),
                    address: "AliceSol".to_string(),
                    asset: "SOL".to_string(),
                    amount: "6".to_string(),
                    token_account: None,
                },
                ProEscrowFunder {
                    id: "bob".to_string(),
                    name: "Bob".to_string(),
                    entity: Some("Community".to_string()),
                    address: "BobSol".to_string(),
                    asset: "SOL".to_string(),
                    amount: "4".to_string(),
                    token_account: None,
                },
            ],
            milestones: vec![ProEscrowMilestone {
                id: "milestone-1".to_string(),
                title: "Design approved".to_string(),
                recipient: "BuilderSol".to_string(),
                recipient_entity: Some("Builder".to_string()),
                asset: "SOL".to_string(),
                amount: "2.5".to_string(),
                status: "released".to_string(),
                token_account: None,
            }],
            policy: None,
            execution: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn return_preview_uses_exact_lamport_pro_rata() {
        let preview = build_return_preview(&escrow()).unwrap();
        assert_eq!(preview.total_return, "7.5");
        assert_eq!(preview.raw_total_return, "7500000000");
        assert_eq!(preview.returns[0].recipient, "AliceSol");
        assert_eq!(preview.returns[0].amount, "4.5");
        assert_eq!(preview.returns[0].raw_amount, "4500000000");
        assert_eq!(preview.returns[1].recipient, "BobSol");
        assert_eq!(preview.returns[1].amount, "3");
        assert_eq!(preview.returns[1].raw_amount, "3000000000");
    }

    #[test]
    fn release_preview_rejects_released_milestone() {
        let err = build_release_preview(&escrow(), "milestone-1").unwrap_err();
        assert!(
            matches!(err, ApiError::BadRequest(message) if message.contains("already released"))
        );
    }

    #[test]
    fn sol_lamport_format_round_trips_cleanly() {
        assert_eq!(parse_sol_lamports("0.000000001", "amount").unwrap(), 1);
        assert_eq!(format_sol_lamports(1), "0.000000001");
        assert_eq!(format_sol_lamports(1_230_000_000), "1.23");
    }
}
