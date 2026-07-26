use crate::domain::types::{ChainFamily, IntentStatus, IntentType};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct ServiceHealth {
    pub service: &'static str,
    pub status: &'static str,
    pub version: &'static str,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MoneyAmount {
    pub amount_minor: i64,
    pub currency: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CreateRampIntentRequest {
    pub intent_type: IntentType,
    pub chain_family: ChainFamily,
    pub chain_id: String,
    pub asset_symbol: String,
    pub asset_amount_minor: i64,
    /// USD value in cents as computed by the frontend (e.g. $100.50 = 10050).
    /// Used for NGN conversion so the backend only needs a USD→NGN FX rate.
    pub usd_amount_cents: Option<i64>,
    pub destination_wallet: Option<String>,
    pub source_wallet: Option<String>,
    pub bank_code: Option<String>,
    pub bank_account_number: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreateRampIntentResponse {
    pub intent_id: Uuid,
    pub status: IntentStatus,
    pub quote_id: Uuid,
    pub idempotency_replayed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct IntentDetailResponse {
    pub intent_id: Uuid,
    pub user_id: Uuid,
    pub intent_type: IntentType,
    pub status: IntentStatus,
    pub chain_family: ChainFamily,
    pub chain_id: String,
    pub asset_symbol: String,
    pub asset_amount_minor: i64,
    pub quote_id: Option<Uuid>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct WithdrawQuoteResponse {
    pub quote_id: Uuid,
    pub input_asset_amount_minor: i64,
    pub input_asset_symbol: String,
    pub estimated_ngn_amount_minor: i64,
    pub platform_fee_bps: i32,
    pub network_fee_ngn_minor: i64,
    pub expires_at_iso: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SubmitSignedTransferRequest {
    pub intent_id: Uuid,
    pub quote_id: Uuid,
    pub signed_payload: String,
    pub source_wallet: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PrepareSignatureResponse {
    pub intent_id: Uuid,
    pub treasury_address: String,
    pub chain_family: ChainFamily,
    pub chain_id: String,
    pub asset_symbol: String,
    pub status: IntentStatus,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChainTransferConfirmationRequest {
    pub intent_id: Uuid,
    pub chain_family: ChainFamily,
    pub chain_id: String,
    pub tx_hash: String,
    pub event_index: i32,
    pub sender_wallet: String,
    pub asset_symbol: String,
    pub amount_minor: i64,
    pub confirmations: i32,
    pub finalized: bool,
}

// ── Onramp: Provider payment initialisation ───────────────────────────────────

/// Response for `POST /v1/ramp/intents/:id/initialize-payment`.
/// Returns the provider checkout URL plus the reference that must be
/// used when calling the active provider for status lookups or reconciliation.
#[derive(Debug, Clone, Serialize)]
pub struct InitializePaymentResponse {
    pub intent_id: Uuid,
    pub authorization_url: String,
    pub access_code: String,
    pub payment_provider: String,
    pub payment_reference: String,
    pub provider_status: String,
    /// Amount the user will pay in NGN kobo (100 kobo = ₦1)
    pub ngn_amount_minor: i64,
}

// ── Bank account name resolution ──────────────────────────────────────────────

/// Query params for `GET /v1/ramp/bank/resolve`.
#[derive(Debug, Clone, Deserialize)]
pub struct BankResolveQuery {
    pub account_number: String,
    pub bank_code: String,
}

/// Response for `GET /v1/ramp/bank/resolve`.
#[derive(Debug, Clone, Serialize)]
pub struct BankResolveResponse {
    pub account_number: String,
    pub account_name: String,
}

// ── Bank listing ─────────────────────────────────────────────────────────────

/// A single bank entry returned by `GET /v1/ramp/banks`.
#[derive(Debug, Clone, Serialize)]
pub struct BankListItem {
    pub name: String,
    pub code: String,
    pub slug: Option<String>,
    pub country: Option<String>,
    pub currency: Option<String>,
}

/// Query params for `GET /v1/ramp/banks`.
#[derive(Debug, Clone, Deserialize)]
pub struct BankListQuery {
    /// ISO country name, e.g. "nigeria" (default: "nigeria")
    pub country: Option<String>,
}
