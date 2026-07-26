use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KoraWebhookEvent {
    pub event: String,
    #[serde(default)]
    pub data: Value,
}
