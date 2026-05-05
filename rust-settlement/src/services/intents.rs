use crate::{
    contracts::api::{
        BankResolveResponse, CreateRampIntentRequest, CreateRampIntentResponse,
        InitializePaymentResponse, IntentDetailResponse, PrepareSignatureResponse,
        WithdrawQuoteResponse,
    },
    domain::types::{ChainFamily, IntentStatus, IntentType},
    providers::PaymentProvider,
    signer::engine::SignerEngine,
};
use chrono::{Duration, Utc};
use sqlx::{PgPool, Row};
use uuid::Uuid;

fn intent_type_db(value: IntentType) -> &'static str {
    match value {
        IntentType::Onramp => "onramp",
        IntentType::Offramp => "offramp",
    }
}

fn chain_family_db(value: ChainFamily) -> &'static str {
    match value {
        ChainFamily::Evm => "evm",
        ChainFamily::Sui => "sui",
    }
}

fn status_db(value: IntentStatus) -> &'static str {
    match value {
        IntentStatus::IntentCreated => "intent_created",
        IntentStatus::AwaitingUserTransferSignature => "awaiting_user_transfer_signature",
        IntentStatus::AwaitingUserTransferConfirmation => "awaiting_user_transfer_confirmation",
        IntentStatus::AwaitingPayment => "awaiting_payment",
        IntentStatus::PaymentConfirmed => "payment_confirmed",
        IntentStatus::SettlementQueued => "settlement_queued",
        IntentStatus::SettlementInProgress => "settlement_in_progress",
        IntentStatus::SettlementCompleted => "settlement_completed",
        IntentStatus::PayoutInProgress => "payout_in_progress",
        IntentStatus::PayoutCompleted => "payout_completed",
        IntentStatus::Expired => "expired",
        IntentStatus::Failed => "failed",
        IntentStatus::Cancelled => "cancelled",
        IntentStatus::ManualReviewRequired => "manual_review_required",
    }
}

fn parse_status(value: &str) -> anyhow::Result<IntentStatus> {
    match value {
        "intent_created" => Ok(IntentStatus::IntentCreated),
        "awaiting_user_transfer_signature" => Ok(IntentStatus::AwaitingUserTransferSignature),
        "awaiting_user_transfer_confirmation" => Ok(IntentStatus::AwaitingUserTransferConfirmation),
        "awaiting_payment" => Ok(IntentStatus::AwaitingPayment),
        "payment_confirmed" => Ok(IntentStatus::PaymentConfirmed),
        "settlement_queued" => Ok(IntentStatus::SettlementQueued),
        "settlement_in_progress" => Ok(IntentStatus::SettlementInProgress),
        "settlement_completed" => Ok(IntentStatus::SettlementCompleted),
        "payout_in_progress" => Ok(IntentStatus::PayoutInProgress),
        "payout_completed" => Ok(IntentStatus::PayoutCompleted),
        "expired" => Ok(IntentStatus::Expired),
        "failed" => Ok(IntentStatus::Failed),
        "cancelled" => Ok(IntentStatus::Cancelled),
        "manual_review_required" => Ok(IntentStatus::ManualReviewRequired),
        _ => anyhow::bail!("unknown status: {value}"),
    }
}

fn parse_intent_type(value: &str) -> anyhow::Result<IntentType> {
    match value {
        "onramp" => Ok(IntentType::Onramp),
        "offramp" => Ok(IntentType::Offramp),
        _ => anyhow::bail!("unknown intent_type: {value}"),
    }
}

fn parse_chain_family(value: &str) -> anyhow::Result<ChainFamily> {
    match value {
        "evm" => Ok(ChainFamily::Evm),
        "sui" => Ok(ChainFamily::Sui),
        _ => anyhow::bail!("unknown chain_family: {value}"),
    }
}

pub async fn create_intent(
    pool: &PgPool,
    payment_provider: &dyn PaymentProvider,
    onramp_max_usd_cents: i64,
    user_id: Uuid,
    request: &CreateRampIntentRequest,
    idempotency_key: &str,
    request_hash: &str,
) -> anyhow::Result<CreateRampIntentResponse> {
    let endpoint = "POST:/v1/ramp/intents";

    if matches!(request.intent_type, IntentType::Onramp) {
        let usd_cents = request
            .usd_amount_cents
            .filter(|value| *value > 0)
            .ok_or_else(|| anyhow::anyhow!("usd_amount_cents is required and must be greater than 0"))?;

        if usd_cents > onramp_max_usd_cents {
            anyhow::bail!(
                "For now, maximum buy amount is ${:.2}. Please reduce your amount.",
                onramp_max_usd_cents as f64 / 100.0
            );
        }
    }

    let mut tx = pool.begin().await?;

    if let Some(existing) = sqlx::query(
        r#"
        SELECT i.id, i.status, i.quote_id
        FROM ramp_idempotency_keys k
        JOIN ramp_intents i ON i.id = k.intent_id
        WHERE k.user_id = $1 AND k.endpoint = $2 AND k.idempotency_key = $3
        "#,
    )
    .bind(user_id)
    .bind(endpoint)
    .bind(idempotency_key)
    .fetch_optional(&mut *tx)
    .await?
    {
        let existing_hash: String = sqlx::query_scalar(
            "SELECT request_hash FROM ramp_idempotency_keys WHERE user_id = $1 AND endpoint = $2 AND idempotency_key = $3",
        )
        .bind(user_id)
        .bind(endpoint)
        .bind(idempotency_key)
        .fetch_one(&mut *tx)
        .await?;

        if existing_hash != request_hash {
            anyhow::bail!("Idempotency key was already used with a different payload");
        }

        let status: String = existing.get("status");
        let quote_id: Option<Uuid> = existing.try_get("quote_id").ok();

        tx.commit().await?;

        return Ok(CreateRampIntentResponse {
            intent_id: existing.get("id"),
            status: parse_status(&status)?,
            quote_id: quote_id.unwrap_or(Uuid::nil()),
            idempotency_replayed: true,
        });
    }

    let active_policy_version: i32 = sqlx::query_scalar(
        "SELECT version FROM ramp_policy_config_versions WHERE is_active = TRUE LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or(1);

    let intent_id = Uuid::new_v4();
    let quote_id = Uuid::new_v4();
    let bank_snapshot_id = if matches!(request.intent_type, IntentType::Offramp) {
        Some(Uuid::new_v4())
    } else {
        None
    };

    let status = match request.intent_type {
        IntentType::Offramp => IntentStatus::AwaitingUserTransferSignature,
        IntentType::Onramp => IntentStatus::AwaitingPayment,
    };

    sqlx::query(
        r#"
        INSERT INTO ramp_intents (
            id, user_id, intent_type, status, chain_family, chain_id, asset_symbol, asset_amount_minor,
            source_wallet, destination_wallet, quote_id, bank_snapshot_id, fee_config_version, metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        "#,
    )
    .bind(intent_id)
    .bind(user_id)
    .bind(intent_type_db(request.intent_type))
    .bind(status_db(status))
    .bind(chain_family_db(request.chain_family))
    .bind(&request.chain_id)
    .bind(&request.asset_symbol)
    .bind(request.asset_amount_minor)
    .bind(request.source_wallet.as_deref())
    .bind(request.destination_wallet.as_deref())
    .bind(quote_id)
    .bind(bank_snapshot_id)
    .bind(active_policy_version)
    .bind({
        let mut meta = serde_json::json!({"request_source": "api"});
        if let Some(usd_cents) = request.usd_amount_cents {
            meta["usd_amount_cents"] = serde_json::json!(usd_cents);
        }
        meta
    })
    .execute(&mut *tx)
    .await?;

    let expires_at = Utc::now() + Duration::minutes(5);
    let estimated_ngn = if matches!(request.intent_type, IntentType::Offramp) {
        let usd_cents = request
            .usd_amount_cents
            .filter(|value| *value > 0)
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "usd_amount_cents is required and must be greater than 0 for offramp"
                )
            })?;

        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .user_agent("deta-settlement/1.0")
            .build()
            .unwrap_or_default();

        usd_cents_to_ngn_kobo(&http, usd_cents).await.map_err(|e| {
            tracing::error!(error = %e, "USD→NGN rate fetch failed for offramp quote");
            e
        })?
    } else {
        request.asset_amount_minor
    };

    sqlx::query(
        r#"
        INSERT INTO ramp_quotes (
            id, intent_id, quote_version, input_asset_symbol, input_asset_amount_minor,
            estimated_ngn_amount_minor, platform_fee_bps, network_fee_ngn_minor, expires_at, is_locked
        )
        VALUES ($1,$2,1,$3,$4,$5,300,0,$6,FALSE)
        "#,
    )
    .bind(quote_id)
    .bind(intent_id)
    .bind(&request.asset_symbol)
    .bind(request.asset_amount_minor)
    .bind(estimated_ngn)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;

    if let Some(snapshot_id) = bank_snapshot_id {
        let bank_code = request.bank_code.as_deref().unwrap_or("");
        let account_number = request.bank_account_number.as_deref().unwrap_or("");

        // Resolve account details and create recipient metadata (provider-dependent)
        // so payout dispatch has the best available recipient context.
        let (account_name, recipient_code) = if !bank_code.is_empty() && !account_number.is_empty() {
            let name = match payment_provider
                .resolve_account_number(account_number, bank_code)
                .await
            {
                Ok((account_name, _resolved_account_number)) => account_name,
                Err(err) => {
                    tracing::warn!(
                        "resolve_account_number failed for {}/{}: {err}",
                        account_number,
                        bank_code
                    );
                    String::new()
                }
            };

            let recipient = match payment_provider
                .create_transfer_recipient(
                    if name.is_empty() { account_number } else { &name },
                    account_number,
                    bank_code,
                )
                .await
            {
                Ok(code) => code,
                Err(err) => {
                    tracing::warn!(
                        "create_transfer_recipient failed for {}/{}: {err}",
                        account_number,
                        bank_code
                    );
                    String::new()
                }
            };

            (name, recipient)
        } else {
            (String::new(), String::new())
        };

        sqlx::query(
            r#"
            INSERT INTO ramp_bank_snapshots (
                id, intent_id, snapshot_version, bank_code, bank_name, account_number,
                account_name, recipient_code, currency
            )
            VALUES ($1,$2,1,$3,NULL,$4,$5,$6,'NGN')
            "#,
        )
        .bind(snapshot_id)
        .bind(intent_id)
        .bind(bank_code)
        .bind(account_number)
        .bind(account_name)
        .bind(recipient_code)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        r#"
        INSERT INTO ramp_idempotency_keys (
            id, user_id, endpoint, idempotency_key, request_hash, intent_id
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(endpoint)
    .bind(idempotency_key)
    .bind(request_hash)
    .bind(intent_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(CreateRampIntentResponse {
        intent_id,
        status,
        quote_id,
        idempotency_replayed: false,
    })
}

pub async fn get_intent(pool: &PgPool, intent_id: Uuid, user_id: Uuid) -> anyhow::Result<Option<IntentDetailResponse>> {
    let row = sqlx::query(
        r#"
        SELECT id, user_id, intent_type, status, chain_family, chain_id, asset_symbol,
               asset_amount_minor, quote_id, created_at, updated_at
        FROM ramp_intents
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(intent_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else { return Ok(None) };

    Ok(Some(IntentDetailResponse {
        intent_id: row.get("id"),
        user_id: row.get("user_id"),
        intent_type: parse_intent_type(&row.get::<String, _>("intent_type"))?,
        status: parse_status(&row.get::<String, _>("status"))?,
        chain_family: parse_chain_family(&row.get::<String, _>("chain_family"))?,
        chain_id: row.get("chain_id"),
        asset_symbol: row.get("asset_symbol"),
        asset_amount_minor: row.get("asset_amount_minor"),
        quote_id: row.try_get("quote_id").ok(),
        created_at: row.get::<chrono::DateTime<chrono::Utc>, _>("created_at").to_rfc3339(),
        updated_at: row.get::<chrono::DateTime<chrono::Utc>, _>("updated_at").to_rfc3339(),
    }))
}

pub async fn get_quote(pool: &PgPool, intent_id: Uuid) -> anyhow::Result<Option<WithdrawQuoteResponse>> {
    let row = sqlx::query(
        r#"
        SELECT id, input_asset_amount_minor, input_asset_symbol, estimated_ngn_amount_minor,
               platform_fee_bps, network_fee_ngn_minor, expires_at
        FROM ramp_quotes
        WHERE intent_id = $1
        ORDER BY quote_version DESC
        LIMIT 1
        "#,
    )
    .bind(intent_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else { return Ok(None) };

    Ok(Some(WithdrawQuoteResponse {
        quote_id: row.get("id"),
        input_asset_amount_minor: row.get("input_asset_amount_minor"),
        input_asset_symbol: row.get("input_asset_symbol"),
        estimated_ngn_amount_minor: row.get("estimated_ngn_amount_minor"),
        platform_fee_bps: row.get("platform_fee_bps"),
        network_fee_ngn_minor: row.get("network_fee_ngn_minor"),
        expires_at_iso: row
            .get::<chrono::DateTime<chrono::Utc>, _>("expires_at")
            .to_rfc3339(),
    }))
}

pub async fn prepare_signature(
    pool: &PgPool,
    intent_id: Uuid,
    user_id: Uuid,
    fallback_treasury_evm_address: &str,
    fallback_treasury_sui_address: &str,
) -> anyhow::Result<PrepareSignatureResponse> {
    let mut tx = pool.begin().await?;

    let intent_row = sqlx::query(
        r#"
        SELECT chain_family, chain_id, asset_symbol, status
        FROM ramp_intents
        WHERE id = $1 AND user_id = $2
        FOR UPDATE
        "#,
    )
    .bind(intent_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(intent_row) = intent_row else {
        anyhow::bail!("Intent not found")
    };

    let current_status: String = intent_row.get("status");
    if current_status != "awaiting_user_transfer_signature" {
        anyhow::bail!("Intent is not in signature preparation state")
    }

    let chain_family: String = intent_row.get("chain_family");
    let chain_id: String = intent_row.get("chain_id");
    let asset_symbol: String = intent_row.get("asset_symbol");

    let mapping = sqlx::query(
        r#"
        SELECT treasury_address
        FROM ramp_treasury_mappings
        WHERE chain_family = $1 AND chain_id = $2 AND asset_symbol = $3 AND is_active = TRUE
        LIMIT 1
        "#,
    )
    .bind(&chain_family)
    .bind(&chain_id)
    .bind(&asset_symbol)
    .fetch_optional(&mut *tx)
    .await?;

    let treasury_address: String = if let Some(mapping_row) = mapping {
        mapping_row.get("treasury_address")
    } else {
        let fallback = if chain_family == "evm" {
            fallback_treasury_evm_address
        } else {
            fallback_treasury_sui_address
        };

        if fallback.trim().is_empty() {
            anyhow::bail!("Treasury mapping not configured and fallback treasury address is empty")
        }

        tracing::warn!(
            intent_id = %intent_id,
            chain_family = %chain_family,
            chain_id = %chain_id,
            asset_symbol = %asset_symbol,
            treasury_address = %fallback,
            "Treasury mapping missing; using configured fallback treasury address"
        );

        fallback.to_string()
    };

    sqlx::query(
        "UPDATE ramp_intents SET status = 'awaiting_user_transfer_confirmation', updated_at = NOW() WHERE id = $1",
    )
    .bind(intent_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(PrepareSignatureResponse {
        intent_id,
        treasury_address,
        chain_family: parse_chain_family(&chain_family)?,
        chain_id,
        asset_symbol,
        status: IntentStatus::AwaitingUserTransferConfirmation,
    })
}

// ── Onramp: Provider payment initialisation ───────────────────────────────────

// Returns the active provider hosted checkout URL and the reference.
pub async fn initialize_payment(
    pool: &PgPool,
    payment_provider: &dyn PaymentProvider,
    signer_engine: &SignerEngine,
    enable_treasury_liquidity_check: bool,
    intent_id: Uuid,
    user_id: Uuid,
    user_email: &str,
    callback_url: Option<&str>,
) -> anyhow::Result<InitializePaymentResponse> {
    // Load the intent and verify ownership / state.
    let row = sqlx::query(
        r#"
        SELECT status, asset_amount_minor, asset_symbol, chain_family, chain_id, metadata
        FROM ramp_intents
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(intent_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        anyhow::bail!("Intent not found");
    };

    let current_status: String = row.get("status");
    if current_status != "awaiting_payment" {
        anyhow::bail!(
            "Intent is not in awaiting_payment state (current: {current_status})"
        );
    }

    let amount_minor: i64 = row.get("asset_amount_minor");
    let asset_symbol: String = row.get("asset_symbol");
    let chain_family_raw: String = row.get("chain_family");
    let chain_id: String = row.get("chain_id");
    let metadata: Option<serde_json::Value> = row.get("metadata");

    let chain_family = parse_chain_family(&chain_family_raw)?;
    let token_address = metadata
        .as_ref()
        .and_then(|m| m.get("token_address"))
        .and_then(|v| v.as_str());

    if enable_treasury_liquidity_check {
        let has_liquidity = signer_engine
            .has_sufficient_balance(
                chain_family,
                &chain_id,
                &asset_symbol,
                amount_minor,
                token_address,
            )
            .await
            .map_err(|e| {
                tracing::error!(
                    intent_id = %intent_id,
                    error = %e,
                    "Treasury liquidity check failed"
                );
                anyhow::anyhow!(
                    "Unable to verify liquidity right now. Please try again shortly."
                )
            })?;

        if !has_liquidity {
            anyhow::bail!(
                "Insufficient treasury liquidity for this order. Please reduce the amount or try again shortly."
            );
        }
    }

    let provider_name = payment_provider.name();

    // ── Check for an existing provider checkout in metadata ───────────────────
    if let Some(ref meta) = metadata {
        let cached_provider = meta
            .get("payment_provider")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_ascii_lowercase());

        if let Some(ref existing_provider) = cached_provider {
            if existing_provider != provider_name {
                anyhow::bail!(
                    "Intent checkout provider mismatch: intent uses '{}' but active provider is '{}'. Create a new intent under current provider.",
                    existing_provider,
                    provider_name
                );
            }
        }

        let has_ref = meta
            .get("payment_reference")
            .and_then(|v| v.as_str());
        let has_url = meta.get("authorization_url").and_then(|v| v.as_str());
        let has_code = meta.get("access_code").and_then(|v| v.as_str());
        let has_ngn = meta.get("ngn_amount_minor").and_then(|v| v.as_i64());

        if let (Some(cached_ref), Some(cached_url), Some(cached_code), Some(cached_ngn)) =
            (has_ref, has_url, has_code, has_ngn)
        {
            // We have a previous checkout — verify its status on active provider.
            match payment_provider.verify_checkout(cached_ref).await {
                Ok(verify) => {
                    let provider_status = verify.status.to_ascii_lowercase();
                    match provider_status.as_str() {
                        // Still open — return the cached checkout to the user.
                        "pending" | "ongoing" | "processing" => {
                            tracing::info!(
                                intent_id = %intent_id,
                                payment_ref = cached_ref,
                                provider = provider_name,
                                "Returning cached pending provider checkout"
                            );
                            return Ok(InitializePaymentResponse {
                                intent_id,
                                authorization_url: cached_url.to_string(),
                                access_code: cached_code.to_string(),
                                payment_provider: provider_name.to_string(),
                                payment_reference: cached_ref.to_string(),
                                provider_status,
                                ngn_amount_minor: cached_ngn,
                            });
                        }
                        // Already paid — return cached so the frontend can
                        // proceed to the polling step.
                        "success" => {
                            tracing::info!(
                                intent_id = %intent_id,
                                payment_ref = cached_ref,
                                provider = provider_name,
                                "Provider checkout already succeeded — returning cached"
                            );
                            return Ok(InitializePaymentResponse {
                                intent_id,
                                authorization_url: cached_url.to_string(),
                                access_code: cached_code.to_string(),
                                payment_provider: provider_name.to_string(),
                                payment_reference: cached_ref.to_string(),
                                provider_status,
                                ngn_amount_minor: cached_ngn,
                            });
                        }
                        // Abandoned / failed / reversed — fall through to
                        // create a fresh checkout below.
                        _ => {
                            tracing::info!(
                                intent_id = %intent_id,
                                payment_ref = cached_ref,
                                provider_status = provider_status,
                                provider = provider_name,
                                "Previous checkout is not payable — creating new one"
                            );
                        }
                    }
                }
                Err(e) => {
                    // Verify failed (network issue or provider 404 for brand-new
                    // references).  If the reference was never actually created
                    // on the provider side, we'll get an error — safe to retry.
                    tracing::warn!(
                        intent_id = %intent_id,
                        payment_ref = cached_ref,
                        provider = provider_name,
                        error = %e,
                        "Failed to verify cached provider ref — will create new checkout"
                    );
                }
            }
        }
    }


    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("deta-settlement/1.0")
        .build()
        .unwrap_or_default();

    // Read usd_amount_cents from metadata (stored at intent creation time)
    let usd_amount_cents = metadata
        .as_ref()
        .and_then(|m| m.get("usd_amount_cents"))
        .and_then(|v| v.as_i64());

    let usd_cents = usd_amount_cents
        .filter(|&c| c > 0)
        .ok_or_else(|| anyhow::anyhow!(
            "Missing or invalid usd_amount_cents in intent metadata — \
             the frontend must send the USD value when creating the intent"
        ))?;

    let ngn_amount_minor = usd_cents_to_ngn_kobo(&http, usd_cents).await.map_err(|e| {
        tracing::error!(error = %e, "USD→NGN rate fetch failed");
        e
    })?;

    // ── Build unique provider reference ───────────────────────────────────────
    // Base: deta-{intent_id}; append attempt suffix when retried.
    let attempt: i32 = metadata
        .as_ref()
        .and_then(|m| m.get("payment_attempt"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;
    let next_attempt = attempt + 1;

    let payment_reference = if next_attempt == 1 {
        format!("deta-{intent_id}")
    } else {
        format!("deta-{intent_id}-{next_attempt}")
    };

    // ── Call provider to create a new checkout ────────────────────────────────
    let checkout = payment_provider
        .initialize_checkout(user_email, ngn_amount_minor, &payment_reference, callback_url)
        .await?;

    // ── Persist everything into metadata ──────────────────────────────────────
    // We store authorization_url + access_code so future calls can be served
    // from cache without hitting the provider again.
    sqlx::query(
        r#"
        UPDATE ramp_intents
        SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                'payment_provider', $1::text,
                'payment_reference', $2::text,
                'provider_status', 'pending',
                'authorization_url', $3::text,
                'access_code', $4::text,
                'ngn_amount_minor', $5::bigint,
                'payment_attempt', $6::int
            ),
            updated_at = NOW()
        WHERE id = $7
        "#,
    )
    .bind(provider_name)
    .bind(&checkout.reference)
    .bind(&checkout.authorization_url)
    .bind(&checkout.access_code)
    .bind(ngn_amount_minor)
    .bind(next_attempt)
    .bind(intent_id)
    .execute(pool)
    .await?;

    tracing::info!(
        intent_id = %intent_id,
        payment_ref = %checkout.reference,
        provider = provider_name,
        ngn_kobo = ngn_amount_minor,
        attempt = next_attempt,
        "Created new payment checkout"
    );

    Ok(InitializePaymentResponse {
        intent_id,
        authorization_url: checkout.authorization_url,
        access_code: checkout.access_code,
        payment_provider: provider_name.to_string(),
        payment_reference: checkout.reference.clone(),
        provider_status: "pending".to_string(),
        ngn_amount_minor,
    })
}

// ── Live crypto → NGN conversion ─────────────────────────────────────────────

/// Converts a USD amount (in cents) directly to NGN kobo.
/// Only needs one API call (USD → NGN exchange rate).
/// This is the fast path when the frontend already computed the USD value.
async fn usd_cents_to_ngn_kobo(
    http: &reqwest::Client,
    usd_cents: i64,
) -> anyhow::Result<i64> {
    let ngn_per_usd = fetch_ngn_rate(http).await?;

    // usd_cents / 100 = USD, × ngn_per_usd = NGN, × 100 = kobo
    // Simplifies to: usd_cents × ngn_per_usd (the 100s cancel out)
    let ngn_kobo = (usd_cents as f64 * ngn_per_usd).round() as i64;

    tracing::info!(
        usd_cents,
        ngn_per_usd,
        ngn_kobo,
        "usd_cents_to_ngn_kobo: conversion successful"
    );

    if ngn_kobo <= 0 {
        anyhow::bail!("Computed NGN kobo is zero or negative (usd_cents={usd_cents}, ngn_per_usd={ngn_per_usd})");
    }

    Ok(ngn_kobo)
}

/// Fetches the live USD → NGN exchange rate from ExchangeRate-API (free, no key).
async fn fetch_ngn_rate(http: &reqwest::Client) -> anyhow::Result<f64> {
    let fx_url = "https://open.er-api.com/v6/latest/USD";
    let fx_body: serde_json::Value = http.get(fx_url).send().await?.json().await?;
    fx_body["rates"]["NGN"]
        .as_f64()
        .ok_or_else(|| anyhow::anyhow!("ExchangeRate-API: missing NGN rate"))
}

// ── Bank account name resolution ──────────────────────────────────────────────

/// Resolves a Nigerian bank account number to an account name via the active
/// provider `/bank/resolve` endpoint. This is called by the frontend before the user
/// confirms their withdrawal bank details.
pub async fn resolve_bank_account(
    payment_provider: &dyn PaymentProvider,
    account_number: &str,
    bank_code: &str,
) -> anyhow::Result<BankResolveResponse> {
    let (account_name, resolved_account_number) = payment_provider
        .resolve_account_number(account_number, bank_code)
        .await?;

    Ok(BankResolveResponse {
        account_number: resolved_account_number,
        account_name,
    })
}
