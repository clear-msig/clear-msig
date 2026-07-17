use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ApiError;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProAuditEvent {
    pub(super) id: String,
    pub(super) wallet_name: String,
    pub(super) event_type: String,
    pub(super) title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) reference: Option<String>,
    #[serde(default)]
    pub(super) metadata: Value,
    pub(super) created_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProAuditEventInput {
    pub(super) id: Option<String>,
    pub(super) wallet_name: String,
    pub(super) event_type: String,
    pub(super) title: String,
    #[serde(default)]
    pub(super) reference: Option<String>,
    #[serde(default)]
    pub(super) metadata: Value,
    pub(super) created_at: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(super) struct ProAuditEventsResponse {
    pub(super) wallet_name: String,
    pub(super) events: Vec<ProAuditEvent>,
}

pub(super) fn validate_pro_audit_event(input: &ProAuditEventInput) -> Result<(), ApiError> {
    ensure_non_empty(&input.wallet_name, "walletName")?;
    ensure_non_empty(&input.event_type, "eventType")?;
    ensure_non_empty(&input.title, "title")?;
    Ok(())
}

fn ensure_non_empty(value: &str, field: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    Ok(())
}
