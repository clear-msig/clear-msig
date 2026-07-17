use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PaystackWebhookEnvelope {
    pub event: String,
    pub data: Value,
}

pub fn is_supported_event(event: &str) -> bool {
    matches!(
        event,
        "charge.success" | "transfer.success" | "transfer.failed" | "transfer.reversed"
    )
}
