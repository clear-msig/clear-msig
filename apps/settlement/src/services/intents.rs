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
use chrono::Utc;
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
        ChainFamily::Solana => "solana",
        ChainFamily::Evm => "evm",
        ChainFamily::Bitcoin => "bitcoin",
        ChainFamily::Zcash => "zcash",
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
        "solana" => Ok(ChainFamily::Solana),
        "evm" => Ok(ChainFamily::Evm),
        "bitcoin" => Ok(ChainFamily::Bitcoin),
        "zcash" => Ok(ChainFamily::Zcash),
        _ => anyhow::bail!("unknown chain_family: {value}"),
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn create_intent(
    pool: &PgPool,
    quote_provider: &dyn super::quotes::ExecutableQuoteProvider,
    payment_provider: &dyn PaymentProvider,
    onramp_max_usd_cents: i64,
    user_id: Uuid,
    request: &CreateRampIntentRequest,
    idempotency_key: &str,
    request_hash: &str,
) -> anyhow::Result<CreateRampIntentResponse> {
    let endpoint = "POST:/v1/ramp/intents";
    if request.intent_type == IntentType::Offramp {
        crate::domain::types::positive_amount_minor(request.asset_amount_minor)?;
    }

    if matches!(request.intent_type, IntentType::Onramp) {
        let usd_cents = request
            .usd_amount_cents
            .filter(|value| *value > 0)
            .ok_or_else(|| {
                anyhow::anyhow!("usd_amount_cents is required and must be greater than 0")
            })?;

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

    let executable_quote = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        quote_provider.quote(request),
    )
    .await??;
    executable_quote.validate(request, Utc::now().timestamp())?;
    let quoted_amount = executable_quote.asset_amount_minor;
    let estimated_ngn = executable_quote.fiat_amount_minor;
    let expires_at = chrono::DateTime::from_timestamp(executable_quote.expires_at, 0)
        .ok_or_else(|| anyhow::anyhow!("invalid executable quote expiry"))?;

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
    .bind(quoted_amount)
    .bind(request.source_wallet.as_deref())
    .bind(request.destination_wallet.as_deref())
    .bind(quote_id)
    .bind(bank_snapshot_id)
    .bind(active_policy_version)
    .bind({
        let mut meta = serde_json::json!({
            "request_source": "api", "executable_quote_version": 1,
            "executable_quote": executable_quote,
        });
        if let Some(usd_cents) = request.usd_amount_cents {
            meta["usd_amount_cents"] = serde_json::json!(usd_cents);
        }
        meta
    })
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO ramp_quotes (
            id, intent_id, quote_version, input_asset_symbol, input_asset_amount_minor,
            estimated_ngn_amount_minor, platform_fee_bps, network_fee_ngn_minor, expires_at, is_locked
        )
        VALUES ($1,$2,1,$3,$4,$5,0,0,$6,TRUE)
        "#,
    )
    .bind(quote_id)
    .bind(intent_id)
    .bind(&request.asset_symbol)
    .bind(quoted_amount)
    .bind(estimated_ngn)
    .bind(expires_at)
    .execute(&mut *tx)
    .await?;

    if let Some(snapshot_id) = bank_snapshot_id {
        let bank_code = request.bank_code.as_deref().unwrap_or("");
        let account_number = request.bank_account_number.as_deref().unwrap_or("");

        // Resolve account details and create recipient metadata (provider-dependent)
        // so payout dispatch has the best available recipient context.
        let (account_name, recipient_code) = if !bank_code.is_empty() && !account_number.is_empty()
        {
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
                    if name.is_empty() {
                        account_number
                    } else {
                        &name
                    },
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

pub async fn get_intent(
    pool: &PgPool,
    intent_id: Uuid,
    user_id: Uuid,
) -> anyhow::Result<Option<IntentDetailResponse>> {
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
        created_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("created_at")
            .to_rfc3339(),
        updated_at: row
            .get::<chrono::DateTime<chrono::Utc>, _>("updated_at")
            .to_rfc3339(),
    }))
}

pub async fn get_quote(
    pool: &PgPool,
    intent_id: Uuid,
) -> anyhow::Result<Option<WithdrawQuoteResponse>> {
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

/// Per-chain fallback treasury addresses. Used only when no
/// `ramp_treasury_mappings` row exists for the (chain_family, chain_id,
/// asset_symbol) tuple — production deployments are expected to seed
/// the mapping table; the fallbacks are an MVP convenience that lets
/// operators bring up a chain with one env var.
#[derive(Debug, Clone, Default)]
pub struct TreasuryFallbacks<'a> {
    pub solana: &'a str,
    pub evm: &'a str,
    pub bitcoin: &'a str,
    pub zcash: &'a str,
}

pub async fn prepare_signature(
    pool: &PgPool,
    intent_id: Uuid,
    user_id: Uuid,
    fallbacks: TreasuryFallbacks<'_>,
) -> anyhow::Result<PrepareSignatureResponse> {
    let mut tx = pool.begin().await?;

    let intent_row = sqlx::query(
        r#"
        SELECT chain_family, chain_id, asset_symbol, status
        FROM ramp_intents
        WHERE id = $1 AND user_id = $2
          AND metadata->>'executable_quote_version' = '1'
          AND EXISTS (SELECT 1 FROM ramp_quotes q WHERE q.intent_id = ramp_intents.id AND q.is_locked = TRUE AND q.expires_at > NOW())
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
        let fallback = match chain_family.as_str() {
            "solana" => fallbacks.solana,
            "evm" => fallbacks.evm,
            "bitcoin" => fallbacks.bitcoin,
            "zcash" => fallbacks.zcash,
            other => anyhow::bail!("Unsupported chain_family for treasury lookup: {other}"),
        };

        if fallback.trim().is_empty() {
            anyhow::bail!(
                "Treasury mapping not configured for {chain_family}/{chain_id}/{asset_symbol} \
                 and no fallback TREASURY_*_ADDRESS env var is set"
            )
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
        "UPDATE ramp_intents SET status = 'awaiting_user_transfer_confirmation', updated_at = NOW(), metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('deposit_treasury_address',$2::text,'deposit_reference',$3::text) WHERE id = $1",
    )
    .bind(intent_id)
    .bind(&treasury_address)
    .bind(format!("clearsig-ramp:{intent_id}"))
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(PrepareSignatureResponse {
        intent_id,
        treasury_address,
        deposit_reference: format!("clearsig-ramp:{intent_id}"),
        chain_family: parse_chain_family(&chain_family)?,
        chain_id,
        asset_symbol,
        status: IntentStatus::AwaitingUserTransferConfirmation,
    })
}

// ── Onramp: Provider payment initialisation ───────────────────────────────────

// Returns the active provider hosted checkout URL and the reference.
#[allow(clippy::too_many_arguments)]
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
    // Serialize the local decision, then commit the reference BEFORE making a
    // payable checkout. A crashed or timed-out attempt is never a fresh retry.
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        r#"
        SELECT status, asset_amount_minor, asset_symbol, chain_family, chain_id, metadata
        FROM ramp_intents
        WHERE id = $1 AND user_id = $2 AND intent_type = 'onramp'
        FOR UPDATE
        "#,
    )
    .bind(intent_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| anyhow::anyhow!("Intent not found"))?;

    let current_status: String = row.get("status");
    anyhow::ensure!(
        current_status == "awaiting_payment",
        "Intent is not awaiting payment; refresh its status before retrying"
    );
    let amount_minor: i64 = row.get("asset_amount_minor");
    let asset_symbol: String = row.get("asset_symbol");
    let chain_family = parse_chain_family(&row.get::<String, _>("chain_family"))?;
    let chain_id: String = row.get("chain_id");
    let metadata: serde_json::Value = row
        .get::<Option<serde_json::Value>, _>("metadata")
        .unwrap_or_else(|| serde_json::json!({}));
    anyhow::ensure!(
        metadata
            .get("executable_quote_version")
            .and_then(serde_json::Value::as_u64)
            == Some(1),
        "intent has no executable quote; create a new intent"
    );
    let executable_quote: super::quotes::ExecutableQuote =
        serde_json::from_value(metadata.get("executable_quote").cloned().ok_or_else(|| {
            anyhow::anyhow!("intent has no executable quote; create a new intent")
        })?)?;
    // Check before cached returns as well. A stale checkout link must not be
    // offered again merely because it was once initialized successfully.
    anyhow::ensure!(
        executable_quote.expires_at > Utc::now().timestamp(),
        "executable quote has expired; do not pay the old checkout"
    );
    let ngn_amount_minor = executable_quote.fiat_amount_minor;
    anyhow::ensure!(
        ngn_amount_minor > 0
            && executable_quote.fiat_currency == "NGN"
            && executable_quote.asset_amount_minor == amount_minor
            && executable_quote.asset_symbol == asset_symbol
            && executable_quote.chain_family == chain_family
            && executable_quote.chain_id == chain_id,
        "executable quote does not match intent"
    );
    let provider_name = payment_provider.name();
    if let Some(existing_provider) = metadata
        .get("payment_provider")
        .and_then(serde_json::Value::as_str)
    {
        anyhow::ensure!(
            existing_provider == provider_name,
            "Intent checkout provider mismatch; reconcile the existing checkout before retrying"
        );
    }
    if let Some(reference) = metadata
        .get("payment_reference")
        .and_then(serde_json::Value::as_str)
    {
        anyhow::ensure!(
            !reference.is_empty()
                && metadata
                    .get("payment_provider")
                    .and_then(serde_json::Value::as_str)
                    == Some(provider_name)
                && metadata
                    .get("ngn_amount_minor")
                    .and_then(serde_json::Value::as_i64)
                    == Some(ngn_amount_minor),
            "Existing checkout does not match this intent; manual reconciliation required"
        );
        let state = metadata
            .get("checkout_initialization_state")
            .and_then(serde_json::Value::as_str);
        anyhow::ensure!(
            matches!(state, None | Some("ready")),
            "Checkout initialization is pending or its outcome is unknown; check status before retrying"
        );
        if let (Some(url), Some(code)) = (
            metadata
                .get("authorization_url")
                .and_then(serde_json::Value::as_str)
                .filter(|v| !v.is_empty()),
            metadata
                .get("access_code")
                .and_then(serde_json::Value::as_str),
        ) {
            let response = InitializePaymentResponse {
                intent_id,
                authorization_url: url.to_string(),
                access_code: code.to_string(),
                payment_provider: provider_name.to_string(),
                payment_reference: reference.to_string(),
                provider_status: metadata
                    .get("provider_status")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("pending")
                    .to_string(),
                ngn_amount_minor,
            };
            tx.commit().await?;
            // Never create another checkout on a verify API timeout. Workers
            // reconcile payment independently before any treasury disbursement.
            return Ok(response);
        }
        anyhow::bail!(
            "Checkout outcome is unknown; manual reconciliation required before retrying"
        );
    }
    anyhow::ensure!(
        metadata.get("payment_reference").is_none()
            && metadata.get("checkout_initialization_state").is_none()
            && metadata.get("authorization_url").is_none()
            && metadata.get("access_code").is_none()
            && metadata
                .get("payment_attempt")
                .is_none_or(|attempt| attempt.as_i64() == Some(0)),
        "Previous checkout attempt is incomplete; manual reconciliation required"
    );

    if enable_treasury_liquidity_check {
        let token_address = metadata
            .get("token_address")
            .and_then(serde_json::Value::as_str);
        let liquidity = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            signer_engine.has_sufficient_balance(
                chain_family,
                &chain_id,
                &asset_symbol,
                amount_minor,
                token_address,
            ),
        )
        .await;
        anyhow::ensure!(matches!(liquidity, Ok(Ok(true))), "Unable to verify sufficient treasury liquidity; check the transfer status before retrying");
    }

    anyhow::ensure!(
        executable_quote.expires_at > Utc::now().timestamp(),
        "Executable quote expired before checkout initialization; create a new intent"
    );
    let payment_reference = format!("deta-{intent_id}");
    sqlx::query(
        r#"UPDATE ramp_intents SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'payment_provider',$2::text,'payment_reference',$3::text,'ngn_amount_minor',$4::bigint,
            'provider_status','unknown','checkout_initialization_state','initializing','payment_attempt',1
        ), updated_at = NOW() WHERE id=$1"#,
    )
    .bind(intent_id).bind(provider_name).bind(&payment_reference).bind(ngn_amount_minor)
    .execute(&mut *tx).await?;
    tx.commit().await?;

    let attempt = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        payment_provider.initialize_checkout(
            user_email,
            ngn_amount_minor,
            &payment_reference,
            callback_url,
        ),
    )
    .await;
    let checkout = match attempt {
        Ok(Ok(checkout))
            if checkout.reference == payment_reference
                && !checkout.authorization_url.is_empty() =>
        {
            checkout
        }
        // Even an explicit remote error can arrive after remote acceptance.
        // Persist uncertainty and require reconciliation, never a new reference.
        _ => {
            sqlx::query("UPDATE ramp_intents SET metadata=metadata || jsonb_build_object('checkout_initialization_state','unknown'),updated_at=NOW() WHERE id=$1 AND user_id=$2 AND status='awaiting_payment' AND metadata->>'payment_reference'=$3 AND metadata->>'checkout_initialization_state'='initializing'")
                .bind(intent_id).bind(user_id).bind(&payment_reference).execute(pool).await?;
            anyhow::bail!("Checkout outcome is unknown; check status or reconcile this payment before retrying");
        }
    };

    // A fast webhook may already have advanced the intent. In that case, do
    // not replace its metadata with a stale pending result or offer payment again.
    let saved = sqlx::query(
        r#"UPDATE ramp_intents SET metadata=metadata || jsonb_build_object(
            'authorization_url',$4::text,'access_code',$5::text,
            'provider_status','pending','checkout_initialization_state','ready'
        ),updated_at=NOW()
        WHERE id=$1 AND user_id=$2 AND status='awaiting_payment'
          AND metadata->>'payment_reference'=$3 AND metadata->>'payment_provider'=$6
          AND metadata->>'checkout_initialization_state'='initializing'"#,
    )
    .bind(intent_id)
    .bind(user_id)
    .bind(&payment_reference)
    .bind(&checkout.authorization_url)
    .bind(&checkout.access_code)
    .bind(provider_name)
    .execute(pool)
    .await?;
    anyhow::ensure!(
        saved.rows_affected() == 1,
        "Payment state changed during checkout initialization; refresh its status before retrying"
    );
    anyhow::ensure!(
        executable_quote.expires_at > Utc::now().timestamp(),
        "Executable quote expired during checkout initialization; do not pay the old checkout"
    );

    Ok(InitializePaymentResponse {
        intent_id,
        authorization_url: checkout.authorization_url,
        access_code: checkout.access_code,
        payment_provider: provider_name.to_string(),
        payment_reference,
        provider_status: "pending".to_string(),
        ngn_amount_minor,
    })
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
