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
    Ok(())
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
