use serde::{Deserialize, Serialize};

use crate::ApiError;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProScheduleRecord {
    pub(super) id: String,
    pub(super) wallet_name: String,
    pub(super) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) address: Option<String>,
    pub(super) category: String,
    pub(super) amount: String,
    pub(super) asset: String,
    pub(super) cadence: String,
    pub(super) next_run: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) note: Option<String>,
    pub(super) created_at: i64,
    pub(super) updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) proposal_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) intent_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) interval_seconds: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) first_execution_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) payment_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) mint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) destination_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) recipient_owner: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) policy_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) pending_execution: Option<PendingRecurringExecution>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProScheduleInput {
    pub(super) id: String,
    pub(super) name: String,
    #[serde(default)]
    pub(super) address: Option<String>,
    pub(super) category: String,
    pub(super) amount: String,
    pub(super) asset: String,
    pub(super) cadence: String,
    pub(super) next_run: String,
    #[serde(default)]
    pub(super) note: Option<String>,
    pub(super) created_at: Option<i64>,
    #[serde(default)]
    pub(super) proposal_address: Option<String>,
    #[serde(default)]
    pub(super) intent_address: Option<String>,
    #[serde(default)]
    pub(super) interval_seconds: Option<u32>,
    #[serde(default)]
    pub(super) first_execution_at: Option<i64>,
    #[serde(default)]
    pub(super) payment_count: Option<u32>,
    #[serde(default)]
    pub(super) mint: Option<String>,
    #[serde(default)]
    pub(super) source_token: Option<String>,
    #[serde(default)]
    pub(super) destination_token: Option<String>,
    #[serde(default)]
    pub(super) recipient_owner: Option<String>,
    #[serde(default)]
    pub(super) policy_version: Option<String>,
    #[serde(default)]
    pub(super) pending_execution: Option<PendingRecurringExecution>,
}

/// The exact reviewed execution request, retained while other approvers vote.
/// This is retry metadata, never authorization to bypass on-chain validation.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PendingRecurringExecution {
    version: u8,
    proposal_address: String,
    schedule_id: String,
    status: u8,
    asset: String,
    recipient: String,
    amount: String,
    interval_seconds: u32,
    first_execution_at: i64,
    payment_count: u32,
    policy_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    destination_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recipient_owner: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProSchedulesResponse {
    pub(super) wallet_name: String,
    pub(super) schedules: Vec<ProScheduleRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProScheduleDeleteRequest {
    pub(super) id: String,
}

pub(super) fn validate_pro_schedule(input: &ProScheduleInput) -> Result<(), ApiError> {
    ensure_non_empty(&input.id, "id")?;
    ensure_non_empty(&input.name, "name")?;
    ensure_non_empty(&input.category, "category")?;
    ensure_non_empty(&input.amount, "amount")?;
    ensure_non_empty(&input.asset, "asset")?;
    ensure_non_empty(&input.next_run, "nextRun")?;
    match input.category.trim().to_ascii_lowercase().as_str() {
        "vendor" | "payroll" => {}
        _ => {
            return Err(ApiError::BadRequest(
                "category must be vendor or payroll".to_string(),
            ))
        }
    }
    normalize_cadence(&input.cadence)?;
    if let Some(version) = &input.policy_version {
        validate_policy_version(version)?;
    }
    if let Some(pending) = &input.pending_execution {
        validate_pending_execution(input, pending)?;
    }
    Ok(())
}

fn validate_policy_version(value: &str) -> Result<(), ApiError> {
    if !matches!(value, "CSP1" | "CSP2") {
        return Err(ApiError::BadRequest(
            "policyVersion must be CSP1 or CSP2".into(),
        ));
    }
    Ok(())
}

fn validate_pending_execution(
    input: &ProScheduleInput,
    pending: &PendingRecurringExecution,
) -> Result<(), ApiError> {
    let invalid = || ApiError::BadRequest("Invalid pending recurring execution snapshot".into());
    if pending.version != 1
        || !matches!(pending.status, 1 | 2)
        || pending.schedule_id != input.id
        || pending.schedule_id.len() > 128
        || input.proposal_address.as_deref() != Some(pending.proposal_address.as_str())
        || pending.interval_seconds == 0
        || pending.first_execution_at <= 0
        || pending.first_execution_at > 9_007_199_254_740_991
        || !(1..=1000).contains(&pending.payment_count)
    {
        return Err(invalid());
    }
    validate_policy_version(&pending.policy_version)?;
    crate::ensure_base58_pubkey(
        &pending.proposal_address,
        "pendingExecution.proposalAddress",
    )?;
    crate::ensure_base58_pubkey(&pending.recipient, "pendingExecution.recipient")?;
    let decimals = match pending.asset.as_str() {
        "SOL" => 9,
        "USDC" => 6,
        _ => return Err(invalid()),
    };
    if !valid_exact_amount(&pending.amount, decimals) {
        return Err(invalid());
    }
    for (field, value) in [
        ("mint", &pending.mint),
        ("sourceToken", &pending.source_token),
        ("destinationToken", &pending.destination_token),
        ("recipientOwner", &pending.recipient_owner),
    ] {
        if let Some(address) = value {
            crate::ensure_base58_pubkey(address, field)?;
        } else if pending.asset == "USDC" {
            return Err(invalid());
        }
    }
    Ok(())
}

fn valid_exact_amount(value: &str, decimals: usize) -> bool {
    if value.is_empty() || value.len() > 64 {
        return false;
    }
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    if whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || fraction.len() > decimals
        || !fraction.bytes().all(|b| b.is_ascii_digit())
    {
        return false;
    }
    let Ok(whole) = whole.parse::<u64>() else {
        return false;
    };
    let Ok(fraction) = format!("{fraction:0<decimals$}").parse::<u64>() else {
        return false;
    };
    whole
        .checked_mul(10u64.pow(decimals as u32))
        .and_then(|n| n.checked_add(fraction))
        .is_some_and(|amount| amount > 0 && amount <= 9_007_199_254_740_991)
}

pub(super) fn normalize_cadence(value: &str) -> Result<String, ApiError> {
    match value.trim().to_ascii_lowercase().as_str() {
        "weekly" => Ok("Weekly".to_string()),
        "monthly" => Ok("Monthly".to_string()),
        _ => Err(ApiError::BadRequest(
            "cadence must be Weekly or Monthly".to_string(),
        )),
    }
}

fn ensure_non_empty(value: &str, field: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn input() -> Value {
        json!({"id":"schedule-1","name":"Payroll","category":"payroll","amount":"1.000000001","asset":"SOL","cadence":"Monthly","nextRun":"2026-10-01","proposalAddress":"11111111111111111111111111111111","policyVersion":"CSP1",
            "pendingExecution":{"version":1,"proposalAddress":"11111111111111111111111111111111","scheduleId":"schedule-1","status":2,"asset":"SOL","recipient":"11111111111111111111111111111111","amount":"1.000000001","intervalSeconds":604800,"firstExecutionAt":1800000000,"paymentCount":2,"policyVersion":"CSP1"}})
    }
    #[test]
    fn pending_revoke_roundtrips_exact_values() {
        let parsed: ProScheduleInput = serde_json::from_value(input()).unwrap();
        validate_pro_schedule(&parsed).unwrap();
        let output = serde_json::to_value(parsed).unwrap();
        assert_eq!(output["pendingExecution"], input()["pendingExecution"]);
        assert_eq!(output["policyVersion"], "CSP1");
    }
    #[test]
    fn legacy_schedule_without_snapshot_stays_readable() {
        let mut value = input();
        value.as_object_mut().unwrap().remove("pendingExecution");
        value.as_object_mut().unwrap().remove("policyVersion");
        let parsed: ProScheduleInput = serde_json::from_value(value).unwrap();
        validate_pro_schedule(&parsed).unwrap();
        assert!(parsed.pending_execution.is_none());
    }
    #[test]
    fn rejects_ambiguous_or_mutated_pending_requests() {
        for (key, value) in [
            ("version", json!(2)),
            ("status", json!(3)),
            ("scheduleId", json!("other")),
            ("proposalAddress", json!("other")),
            ("recipient", json!("bad")),
            ("amount", json!("-1")),
            ("amount", json!("1e3")),
            ("amount", json!("0.0000000001")),
            ("amount", json!("9007199.254740992")),
            ("intervalSeconds", json!(0)),
            ("firstExecutionAt", json!(-1)),
            ("paymentCount", json!(1001)),
            ("policyVersion", json!("CSP3")),
        ] {
            let mut value_json = input();
            value_json["pendingExecution"][key] = value;
            let parsed: ProScheduleInput = serde_json::from_value(value_json).unwrap();
            assert!(
                validate_pro_schedule(&parsed).is_err(),
                "accepted invalid {key}"
            );
        }
    }
    #[test]
    fn token_snapshot_requires_all_token_accounts_and_exact_precision() {
        let mut value = input();
        value["pendingExecution"]["asset"] = json!("USDC");
        value["pendingExecution"]["amount"] = json!("0.000001");
        value["pendingExecution"]["policyVersion"] = json!("CSP2");
        let parsed: ProScheduleInput = serde_json::from_value(value.clone()).unwrap();
        assert!(validate_pro_schedule(&parsed).is_err());
        for key in ["mint", "sourceToken", "destinationToken", "recipientOwner"] {
            value["pendingExecution"][key] = json!("11111111111111111111111111111111");
        }
        validate_pro_schedule(&serde_json::from_value(value.clone()).unwrap()).unwrap();
        value["pendingExecution"]["amount"] = json!("0.0000001");
        assert!(validate_pro_schedule(&serde_json::from_value(value).unwrap()).is_err());
    }
    #[tokio::test]
    async fn store_retains_pending_snapshot_and_policy_version_across_reload() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "clearsig-schedule-test-{}-{nonce}.json",
            std::process::id()
        ));
        let store = super::super::ProStore::new(path.clone());
        store
            .upsert_schedule("team".into(), serde_json::from_value(input()).unwrap())
            .await
            .unwrap();
        let restored = super::super::ProStore::new(path.clone())
            .list_schedules("team")
            .await
            .unwrap();
        let output = serde_json::to_value(&restored[0]).unwrap();
        assert_eq!(output["pendingExecution"], input()["pendingExecution"]);
        assert_eq!(output["policyVersion"], "CSP1");
        std::fs::remove_file(path).unwrap();
    }
}
