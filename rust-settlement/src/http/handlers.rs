use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    app_state::AppState,
    contracts::api::{
        BankListItem, BankListQuery, BankResolveQuery, ChainTransferConfirmationRequest,
        CreateRampIntentRequest, CreateRampIntentResponse, InitializePaymentResponse,
        IntentDetailResponse, PrepareSignatureResponse, ServiceHealth,
    },
    kora::{events::KoraWebhookEvent, signature::verify_kora_signature},
    paystack::{events::PaystackWebhookEnvelope, signature::verify_paystack_signature},
    services::{idempotency, intents, intents::TreasuryFallbacks, webhook_inbox},
};

#[derive(Debug, Serialize)]
struct ApiEnvelope<T> {
    success: bool,
    data: T,
}

#[derive(Debug, Serialize)]
struct ApiErrorEnvelope {
    success: bool,
    error: String,
}

fn user_id_from_headers(headers: &HeaderMap) -> Result<Uuid, String> {
    let raw = headers
        .get("x-user-id")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "x-user-id header is required".to_string())?;

    Uuid::parse_str(raw).map_err(|_| "x-user-id must be a valid UUID".to_string())
}

fn active_provider(state: &AppState) -> String {
    state.config.ramp_payment_provider.trim().to_ascii_lowercase()
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/v1/ramp/intents", post(create_intent))
        .route("/v1/ramp/intents/:intent_id", get(get_intent))
        .route(
            "/v1/ramp/intents/:intent_id/prepare-signature",
            post(prepare_signature),
        )
        .route(
            "/v1/ramp/intents/:intent_id/initialize-payment",
            post(initialize_payment),
        )
        .route("/v1/ramp/bank/resolve", get(resolve_bank))
        .route("/v1/ramp/banks", get(list_banks))
        .route("/v1/internal/chain/confirm", post(chain_confirm))
        .route("/v1/webhooks/paystack", post(paystack_webhook))
        .route("/v1/webhooks/kora", post(kora_webhook))
        .with_state(state)
}

async fn health() -> Json<ApiEnvelope<ServiceHealth>> {
    Json(ApiEnvelope {
        success: true,
        data: ServiceHealth {
            service: "rust-settlement",
            status: "ok",
            version: env!("CARGO_PKG_VERSION"),
        },
    })
}

pub async fn create_intent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateRampIntentRequest>,
) -> Response {
    let user_id = match user_id_from_headers(&headers) {
        Ok(user_id) => user_id,
        Err(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiErrorEnvelope {
                    success: false,
                    error: message,
                }),
            )
                .into_response()
        }
    };

    let idempotency_key = match idempotency::ensure_non_empty_idempotency(
        headers
            .get("idempotency-key")
            .and_then(|value| value.to_str().ok()),
    ) {
        Ok(value) => value,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiErrorEnvelope {
                    success: false,
                    error: error.to_string(),
                }),
            )
                .into_response()
        }
    };

    let request_hash = match idempotency::hash_request_payload(&payload) {
        Ok(hash) => hash,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiErrorEnvelope {
                    success: false,
                    error: error.to_string(),
                }),
            )
                .into_response()
        }
    };

    match intents::create_intent(
        &state.pool,
        state.payment_provider.as_ref(),
        state.config.onramp_max_usd_cents,
        user_id,
        &payload,
        &idempotency_key,
        &request_hash,
    )
    .await
    {
        Ok(result) => {
            let status = if result.idempotency_replayed {
                StatusCode::OK
            } else {
                StatusCode::CREATED
            };
            (
                status,
                Json(ApiEnvelope::<CreateRampIntentResponse> {
                    success: true,
                    data: result,
                }),
            )
                .into_response()
        }
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(ApiErrorEnvelope {
                success: false,
                error: error.to_string(),
            }),
        )
            .into_response(),
    }
}

pub async fn get_intent(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(intent_id): Path<Uuid>,
) -> Response {
    let user_id = match user_id_from_headers(&headers) {
        Ok(user_id) => user_id,
        Err(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiErrorEnvelope {
                    success: false,
                    error: message,
                }),
            )
                .into_response()
        }
    };

    match intents::get_intent(&state.pool, intent_id, user_id).await {
        Ok(Some(intent)) => (
            StatusCode::OK,
            Json(ApiEnvelope::<IntentDetailResponse> {
                success: true,
                data: intent,
            }),
        )
            .into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(ApiErrorEnvelope {
                success: false,
                error: "Intent not found".to_string(),
            }),
        )
            .into_response(),
        Err(error) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiErrorEnvelope {
                success: false,
                error: error.to_string(),
            }),
        )
            .into_response(),
    }
}

pub async fn prepare_signature(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(intent_id): Path<Uuid>,
) -> Response {
    let user_id = match user_id_from_headers(&headers) {
        Ok(user_id) => user_id,
        Err(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiErrorEnvelope {
                    success: false,
                    error: message,
                }),
            )
                .into_response()
        }
    };

    match intents::prepare_signature(
        &state.pool,
        intent_id,
        user_id,
        TreasuryFallbacks {
            solana: &state.config.treasury_sol_address,
            evm: &state.config.treasury_evm_address,
            bitcoin: &state.config.treasury_btc_address,
            zcash: &state.config.treasury_zec_address,
        },
    )
    .await
    {
        Ok(result) => (
            StatusCode::OK,
            Json(ApiEnvelope::<PrepareSignatureResponse> {
                success: true,
                data: result,
            }),
        )
            .into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(ApiErrorEnvelope {
                success: false,
                error: error.to_string(),
            }),
        )
            .into_response(),
    }
}

// ── POST /v1/ramp/intents/:id/initialize-payment ──────────────────────────────

pub async fn initialize_payment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(intent_id): Path<Uuid>,
) -> Response {
    let user_id = match user_id_from_headers(&headers) {
        Ok(id) => id,
        Err(msg) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiErrorEnvelope { success: false, error: msg }),
            )
                .into_response()
        }
    };

    // clear-msig has no `users` table — Paystack just needs *an* email
    // for the receipt, so we synthesise a deterministic placeholder
    // from the user identifier. Operators can override per-deploy by
    // exposing a richer auth layer later.
    let user_email: String = format!("{user_id}@clear-msig.app");

    let callback_url = state.config.ramp_frontend_callback_url.as_deref();

    match intents::initialize_payment(
        &state.pool,
        state.payment_provider.as_ref(),
        &state.signer_engine,
        state.config.enable_treasury_liquidity_check,
        intent_id,
        user_id,
        &user_email,
        callback_url,
    )
    .await
    {
        Ok(result) => (
            StatusCode::OK,
            Json(ApiEnvelope::<InitializePaymentResponse> {
                success: true,
                data: result,
            }),
        )
            .into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(ApiErrorEnvelope {
                success: false,
                error: error.to_string(),
            }),
        )
            .into_response(),
    }
}

// ── GET /v1/ramp/bank/resolve?account_number=&bank_code= ─────────────────────

/// Resolves a Nigerian bank account number to an account name via Paystack.
/// No authentication required — the account number itself is not sensitive.
pub async fn resolve_bank(
    State(state): State<AppState>,
    Query(params): Query<BankResolveQuery>,
) -> Response {
    match intents::resolve_bank_account(
        state.payment_provider.as_ref(),
        &params.account_number,
        &params.bank_code,
    )
    .await
    {
        Ok(result) => (
            StatusCode::OK,
            Json(ApiEnvelope { success: true, data: result }),
        )
            .into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(ApiErrorEnvelope {
                success: false,
                error: error.to_string(),
            }),
        )
            .into_response(),
    }
}

// ── GET /v1/ramp/banks?country=nigeria ───────────────────────────────────────

/// Returns the list of Paystack-supported banks for a given country.
/// Defaults to Nigeria. No user auth required — purely a lookup proxy.
pub async fn list_banks(
    State(state): State<AppState>,
    Query(params): Query<BankListQuery>,
) -> Response {
    let country = params.country.as_deref().unwrap_or("nigeria");

    match state.payment_provider.list_banks(country).await {
        Ok(banks) => {
            let items: Vec<BankListItem> = banks
                .into_iter()
                .filter(|b| b.active.unwrap_or(true))
                .map(|b| BankListItem {
                    name: b.name,
                    code: b.code,
                    slug: b.slug,
                    country: b.country,
                    currency: b.currency,
                })
                .collect();

            (
                StatusCode::OK,
                Json(ApiEnvelope { success: true, data: items }),
            )
                .into_response()
        }
        Err(error) => (
            StatusCode::BAD_GATEWAY,
            Json(ApiErrorEnvelope {
                success: false,
                error: error.to_string(),
            }),
        )
            .into_response(),
    }
}

pub async fn kora_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Response {
    if active_provider(&state) != "kora" {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiErrorEnvelope {
                success: false,
                error: "Kora webhook rejected: active provider is not kora".to_string(),
            }),
        )
            .into_response();
    }

    let signature = headers
        .get("x-korapay-signature")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();

    let verified = verify_kora_signature(&state.config.kora_webhook_secret, &body, signature);

    let envelope: KoraWebhookEvent = match serde_json::from_str(&body) {
        Ok(parsed) => parsed,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiErrorEnvelope {
                    success: false,
                    error: format!("Invalid payload: {error}"),
                }),
            )
                .into_response()
        }
    };

    let provider_event_id = envelope
        .data
        .get("reference")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .or_else(|| {
            envelope
                .data
                .get("id")
                .and_then(|value| value.as_str())
                .map(|value| value.to_string())
        });

    let dedupe_key = if let Some(event_id) = provider_event_id.clone() {
        format!("{}:{}", envelope.event, event_id)
    } else {
        let mut hasher = Sha256::new();
        hasher.update(body.as_bytes());
        format!("{}:{:x}", envelope.event, hasher.finalize())
    };

    let payload_value: Value = serde_json::from_str(&body).unwrap_or_else(|_| serde_json::json!({}));

    let inserted = webhook_inbox::insert_webhook_event(
        &state.pool,
        "kora",
        provider_event_id.as_deref(),
        &envelope.event,
        &dedupe_key,
        verified,
        &payload_value,
    )
    .await;

    if let Err(error) = inserted {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiErrorEnvelope {
                success: false,
                error: error.to_string(),
            }),
        )
            .into_response();
    }

    if !verified {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ApiErrorEnvelope {
                success: false,
                error: "Invalid webhook signature".to_string(),
            }),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(ApiEnvelope {
            success: true,
            data: serde_json::json!({"accepted": true}),
        }),
    )
        .into_response()
}

pub async fn chain_confirm(
    State(state): State<AppState>,
    Json(payload): Json<ChainTransferConfirmationRequest>,
) -> Response {
    let result = sqlx::query(
        r#"
        INSERT INTO ramp_chain_transfers (
            id, intent_id, chain_family, chain_id, tx_hash, event_index,
            sender_wallet, asset_symbol, amount_minor, confirmations, is_finalized,
            detected_at, confirmed_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),CASE WHEN $11 THEN NOW() ELSE NULL END)
        ON CONFLICT (chain_family, chain_id, tx_hash, event_index)
        DO UPDATE SET
            confirmations = EXCLUDED.confirmations,
            is_finalized = EXCLUDED.is_finalized,
            confirmed_at = CASE WHEN EXCLUDED.is_finalized THEN NOW() ELSE ramp_chain_transfers.confirmed_at END
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(payload.intent_id)
    .bind(match payload.chain_family {
        crate::domain::types::ChainFamily::Evm => "evm",
        crate::domain::types::ChainFamily::Sui => "sui",
    })
    .bind(&payload.chain_id)
    .bind(&payload.tx_hash)
    .bind(payload.event_index)
    .bind(&payload.sender_wallet)
    .bind(&payload.asset_symbol)
    .bind(payload.amount_minor)
    .bind(payload.confirmations)
    .bind(payload.finalized)
    .execute(&state.pool)
    .await;

    match result {
        Ok(_) => (
            StatusCode::ACCEPTED,
            Json(ApiEnvelope {
                success: true,
                data: serde_json::json!({"accepted": true}),
            }),
        )
            .into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(ApiErrorEnvelope {
                success: false,
                error: error.to_string(),
            }),
        )
            .into_response(),
    }
}

pub async fn paystack_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> Response {
    if active_provider(&state) != "paystack" {
        return (
            StatusCode::BAD_REQUEST,
            Json(ApiErrorEnvelope {
                success: false,
                error: "Paystack webhook rejected: active provider is not paystack".to_string(),
            }),
        )
            .into_response();
    }

    let signature = headers
        .get("x-paystack-signature")
        .and_then(|value| value.to_str().ok());

    let verified = verify_paystack_signature(&state.config.paystack_webhook_secret, body.as_bytes(), signature);

    let envelope: PaystackWebhookEnvelope = match serde_json::from_str(&body) {
        Ok(parsed) => parsed,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(ApiErrorEnvelope {
                    success: false,
                    error: format!("Invalid payload: {error}"),
                }),
            )
                .into_response()
        }
    };

    let provider_event_id = envelope
        .data
        .get("id")
        .and_then(|value| value.as_i64())
        .map(|value| value.to_string());

    let dedupe_key = if let Some(event_id) = provider_event_id.clone() {
        format!("{}:{}", envelope.event, event_id)
    } else {
        let mut hasher = Sha256::new();
        hasher.update(body.as_bytes());
        format!("{}:{:x}", envelope.event, hasher.finalize())
    };

    let payload_value: Value = serde_json::from_str(&body).unwrap_or_else(|_| serde_json::json!({}));

    let inserted = webhook_inbox::insert_webhook_event(
        &state.pool,
        "paystack",
        provider_event_id.as_deref(),
        &envelope.event,
        &dedupe_key,
        verified.is_ok(),
        &payload_value,
    )
    .await;

    if let Err(error) = inserted {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ApiErrorEnvelope {
                success: false,
                error: error.to_string(),
            }),
        )
            .into_response();
    }

    if verified.is_err() {
        return (
            StatusCode::UNAUTHORIZED,
            Json(ApiErrorEnvelope {
                success: false,
                error: "Invalid webhook signature".to_string(),
            }),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(ApiEnvelope {
            success: true,
            data: serde_json::json!({"accepted": true}),
        }),
    )
        .into_response()
}
