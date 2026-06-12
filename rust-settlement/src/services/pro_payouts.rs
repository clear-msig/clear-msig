use anyhow::{anyhow, Context};
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::{
    contracts::api::{
        CreateProPayoutBatchRequest, LinkProPayoutProposalRequest, ProPayoutBatchResponse,
        ProPayoutItemResponse,
    },
    domain::types::ChainFamily,
};

const MAX_PAYOUT_ROWS: usize = 200;
const DEFAULT_NARRATION: &str = "Clear Pro payout";

#[derive(Debug, FromRow)]
struct BatchRow {
    id: Uuid,
    created_by: Uuid,
    wallet_name: String,
    wallet_address: Option<String>,
    chain_family: String,
    chain_id: String,
    asset_symbol: String,
    asset_amount_minor: i64,
    ngn_amount_minor: i64,
    payout_currency: String,
    status: String,
    proposal_address: Option<String>,
    proposal_status: Option<String>,
    reference: Option<String>,
    narration: Option<String>,
    failure_reason: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, FromRow)]
struct ItemRow {
    id: Uuid,
    batch_id: Uuid,
    row_index: i32,
    amount_minor: i64,
    bank_code: String,
    bank_account_number: String,
    account_name: Option<String>,
    customer_email: Option<String>,
    narration: Option<String>,
    reference: Option<String>,
    status: String,
    provider: String,
    provider_reference: String,
    provider_status: Option<String>,
    failure_reason: Option<String>,
    requested_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
}

pub async fn create_batch(
    pool: &PgPool,
    created_by: Uuid,
    request: &CreateProPayoutBatchRequest,
) -> anyhow::Result<ProPayoutBatchResponse> {
    validate_create_request(request)?;

    let batch_id = Uuid::new_v4();
    let chain_family = chain_family_slug(&request.chain_family);
    let ngn_amount_minor = request
        .items
        .iter()
        .map(|item| item.amount_minor)
        .try_fold(0_i64, |acc, value| acc.checked_add(value))
        .ok_or_else(|| anyhow!("payout total is too large"))?;
    let narration = request
        .narration
        .as_deref()
        .map(clean_optional)
        .filter(|value| !value.is_empty());
    let reference = request
        .reference
        .as_deref()
        .map(clean_optional)
        .filter(|value| !value.is_empty());
    let metadata = request
        .metadata
        .clone()
        .unwrap_or_else(|| serde_json::json!({}));

    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO pro_payout_batches (
            id, created_by, wallet_name, wallet_address, chain_family, chain_id,
            asset_symbol, asset_amount_minor, ngn_amount_minor, payout_currency,
            status, reference, narration, metadata
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'NGN','awaiting_proposal',$10,$11,$12)
        "#,
    )
    .bind(batch_id)
    .bind(created_by)
    .bind(clean_required(&request.wallet_name, "wallet_name")?)
    .bind(request.wallet_address.as_deref().map(clean_optional))
    .bind(chain_family)
    .bind(clean_required(&request.chain_id, "chain_id")?)
    .bind(clean_required(&request.asset_symbol, "asset_symbol")?)
    .bind(request.asset_amount_minor)
    .bind(ngn_amount_minor)
    .bind(reference.as_deref())
    .bind(narration.as_deref())
    .bind(&metadata)
    .execute(&mut *tx)
    .await?;

    for (index, item) in request.items.iter().enumerate() {
        let provider_reference = format!("clear-pro-{}-{:03}", batch_id.simple(), index + 1);
        let item_narration = item
            .narration
            .as_deref()
            .map(clean_optional)
            .filter(|value| !value.is_empty())
            .or_else(|| narration.clone());
        let item_reference = item
            .reference
            .as_deref()
            .map(clean_optional)
            .filter(|value| !value.is_empty());

        sqlx::query(
            r#"
            INSERT INTO pro_payout_items (
                id, batch_id, row_index, amount_minor, bank_code, bank_account_number,
                account_name, customer_email, narration, reference, status,
                provider, provider_reference
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending','kora',$11)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(batch_id)
        .bind(index as i32)
        .bind(item.amount_minor)
        .bind(clean_required(&item.bank_code, "bank_code")?)
        .bind(clean_required(&item.bank_account_number, "bank_account_number")?)
        .bind(item.account_name.as_deref().map(clean_optional))
        .bind(item.customer_email.as_deref().map(clean_optional))
        .bind(item_narration.as_deref())
        .bind(item_reference.as_deref())
        .bind(provider_reference)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    get_batch(pool, created_by, batch_id).await
}

pub async fn get_batch(
    pool: &PgPool,
    created_by: Uuid,
    batch_id: Uuid,
) -> anyhow::Result<ProPayoutBatchResponse> {
    let batch = sqlx::query_as::<_, BatchRow>(
        r#"
        SELECT id, created_by, wallet_name, wallet_address, chain_family, chain_id,
               asset_symbol, asset_amount_minor, ngn_amount_minor, payout_currency,
               status, proposal_address, proposal_status, reference, narration,
               failure_reason, created_at, updated_at, completed_at
        FROM pro_payout_batches
        WHERE id = $1 AND created_by = $2
        "#,
    )
    .bind(batch_id)
    .bind(created_by)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow!("payout batch not found"))?;

    let items = list_items(pool, batch_id).await?;
    Ok(response_from_rows(batch, items))
}

pub async fn link_proposal(
    pool: &PgPool,
    created_by: Uuid,
    batch_id: Uuid,
    request: &LinkProPayoutProposalRequest,
) -> anyhow::Result<ProPayoutBatchResponse> {
    let proposal_address = clean_required(&request.proposal_address, "proposal_address")?;
    validate_base58ish(&proposal_address, "proposal_address")?;

    let result = sqlx::query(
        r#"
        UPDATE pro_payout_batches
        SET proposal_address = $3,
            proposal_status = NULL,
            status = CASE
                WHEN status = 'awaiting_proposal' THEN 'awaiting_execution'
                ELSE status
            END,
            updated_at = NOW()
        WHERE id = $1 AND created_by = $2
          AND status NOT IN ('completed','cancelled')
        "#,
    )
    .bind(batch_id)
    .bind(created_by)
    .bind(&proposal_address)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        anyhow::bail!("payout batch not found or already finalized");
    }

    get_batch(pool, created_by, batch_id).await
}

pub async fn verify_proposal_execution(
    pool: &PgPool,
    backend_api_url: &str,
    created_by: Uuid,
    batch_id: Uuid,
) -> anyhow::Result<ProPayoutBatchResponse> {
    let batch = sqlx::query_as::<_, BatchRow>(
        r#"
        SELECT id, created_by, wallet_name, wallet_address, chain_family, chain_id,
               asset_symbol, asset_amount_minor, ngn_amount_minor, payout_currency,
               status, proposal_address, proposal_status, reference, narration,
               failure_reason, created_at, updated_at, completed_at
        FROM pro_payout_batches
        WHERE id = $1 AND created_by = $2
        "#,
    )
    .bind(batch_id)
    .bind(created_by)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow!("payout batch not found"))?;

    if matches!(batch.status.as_str(), "completed" | "cancelled") {
        return get_batch(pool, created_by, batch_id).await;
    }

    let proposal_address = batch
        .proposal_address
        .as_deref()
        .ok_or_else(|| anyhow!("proposal_address must be linked before verification"))?;
    let proposal_snapshot = fetch_proposal(backend_api_url, proposal_address).await?;
    let proposal_status = extract_proposal_status(&proposal_snapshot)
        .unwrap_or_else(|| "unknown".to_string());
    let executed = proposal_status.eq_ignore_ascii_case("executed");

    let next_status = if executed {
        "ready_for_disbursement"
    } else {
        "awaiting_execution"
    };

    sqlx::query(
        r#"
        UPDATE pro_payout_batches
        SET proposal_status = $2,
            proposal_snapshot = $3,
            proposal_verified_at = CASE WHEN $4 THEN NOW() ELSE proposal_verified_at END,
            status = $5,
            updated_at = NOW()
        WHERE id = $1
        "#,
    )
    .bind(batch_id)
    .bind(&proposal_status)
    .bind(&proposal_snapshot)
    .bind(executed)
    .bind(next_status)
    .execute(pool)
    .await?;

    get_batch(pool, created_by, batch_id).await
}

pub async fn refresh_batch_status(pool: &PgPool, batch_id: Uuid) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        WITH counts AS (
            SELECT
                COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                COUNT(*) AS total
            FROM pro_payout_items
            WHERE batch_id = $1
        )
        UPDATE pro_payout_batches b
        SET status = CASE
                WHEN counts.total > 0 AND counts.completed = counts.total THEN 'completed'
                WHEN counts.failed > 0 AND counts.completed > 0 THEN 'partially_failed'
                WHEN counts.failed = counts.total AND counts.total > 0 THEN 'failed'
                WHEN b.status = 'ready_for_disbursement' THEN 'disbursing'
                ELSE b.status
            END,
            completed_at = CASE
                WHEN counts.total > 0 AND counts.completed = counts.total THEN NOW()
                ELSE b.completed_at
            END,
            updated_at = NOW()
        FROM counts
        WHERE b.id = $1
        "#,
    )
    .bind(batch_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn list_items(pool: &PgPool, batch_id: Uuid) -> anyhow::Result<Vec<ItemRow>> {
    Ok(sqlx::query_as::<_, ItemRow>(
        r#"
        SELECT id, batch_id, row_index, amount_minor, bank_code, bank_account_number,
               account_name, customer_email, narration, reference, status, provider,
               provider_reference, provider_status, failure_reason, requested_at, completed_at
        FROM pro_payout_items
        WHERE batch_id = $1
        ORDER BY row_index ASC
        "#,
    )
    .bind(batch_id)
    .fetch_all(pool)
    .await?)
}

async fn fetch_proposal(backend_api_url: &str, proposal_address: &str) -> anyhow::Result<Value> {
    let base = backend_api_url.trim_end_matches('/');
    if base.is_empty() {
        anyhow::bail!("CLEAR_MSIG_BACKEND_API_URL is required for proposal verification");
    }
    let url = format!("{base}/proposals/{proposal_address}");
    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .context("failed to query Clear multisig proposal")?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!("proposal verification failed ({status}): {body}");
    }
    serde_json::from_str(&body).with_context(|| format!("invalid proposal response: {body}"))
}

fn extract_proposal_status(value: &Value) -> Option<String> {
    value
        .get("status")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            value
                .get("data")
                .and_then(|data| data.get("status"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn response_from_rows(batch: BatchRow, items: Vec<ItemRow>) -> ProPayoutBatchResponse {
    ProPayoutBatchResponse {
        id: batch.id,
        created_by: batch.created_by,
        wallet_name: batch.wallet_name,
        wallet_address: batch.wallet_address,
        chain_family: batch.chain_family,
        chain_id: batch.chain_id,
        asset_symbol: batch.asset_symbol,
        asset_amount_minor: batch.asset_amount_minor,
        ngn_amount_minor: batch.ngn_amount_minor,
        payout_currency: batch.payout_currency,
        status: batch.status,
        proposal_address: batch.proposal_address,
        proposal_status: batch.proposal_status,
        reference: batch.reference,
        narration: batch.narration,
        failure_reason: batch.failure_reason,
        created_at: batch.created_at.to_rfc3339(),
        updated_at: batch.updated_at.to_rfc3339(),
        completed_at: batch.completed_at.map(|value| value.to_rfc3339()),
        items: items
            .into_iter()
            .map(|item| ProPayoutItemResponse {
                id: item.id,
                batch_id: item.batch_id,
                row_index: item.row_index,
                amount_minor: item.amount_minor,
                bank_code: item.bank_code,
                bank_account_number: item.bank_account_number,
                account_name: item.account_name,
                customer_email: item.customer_email,
                narration: item.narration,
                reference: item.reference,
                status: item.status,
                provider: item.provider,
                provider_reference: item.provider_reference,
                provider_status: item.provider_status,
                failure_reason: item.failure_reason,
                requested_at: item.requested_at.map(|value| value.to_rfc3339()),
                completed_at: item.completed_at.map(|value| value.to_rfc3339()),
            })
            .collect(),
    }
}

fn validate_create_request(request: &CreateProPayoutBatchRequest) -> anyhow::Result<()> {
    clean_required(&request.wallet_name, "wallet_name")?;
    clean_required(&request.chain_id, "chain_id")?;
    clean_required(&request.asset_symbol, "asset_symbol")?;

    if request.asset_amount_minor <= 0 {
        anyhow::bail!("asset_amount_minor must be greater than 0");
    }
    if request.items.is_empty() {
        anyhow::bail!("at least one payout item is required");
    }
    if request.items.len() > MAX_PAYOUT_ROWS {
        anyhow::bail!("a payout batch cannot exceed {MAX_PAYOUT_ROWS} rows");
    }

    for (index, item) in request.items.iter().enumerate() {
        if item.amount_minor <= 0 {
            anyhow::bail!("items[{index}].amount_minor must be greater than 0");
        }
        clean_required(&item.bank_code, &format!("items[{index}].bank_code"))?;
        let account_number =
            clean_required(&item.bank_account_number, &format!("items[{index}].bank_account_number"))?;
        if !account_number.chars().all(|ch| ch.is_ascii_digit()) {
            anyhow::bail!("items[{index}].bank_account_number must contain digits only");
        }
        if !(10..=16).contains(&account_number.len()) {
            anyhow::bail!("items[{index}].bank_account_number must be 10 to 16 digits");
        }
    }

    Ok(())
}

fn chain_family_slug(chain_family: &ChainFamily) -> &'static str {
    match chain_family {
        ChainFamily::Solana => "solana",
        ChainFamily::Evm => "evm",
        ChainFamily::Bitcoin => "bitcoin",
        ChainFamily::Zcash => "zcash",
    }
}

fn clean_required(value: &str, field: &str) -> anyhow::Result<String> {
    let cleaned = clean_optional(value);
    if cleaned.is_empty() {
        anyhow::bail!("{field} is required");
    }
    Ok(cleaned)
}

fn clean_optional(value: &str) -> String {
    value.trim().chars().take(180).collect()
}

fn validate_base58ish(value: &str, field: &str) -> anyhow::Result<()> {
    if !(32..=88).contains(&value.len()) {
        anyhow::bail!("{field} must be a valid proposal address");
    }
    if !value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() && !"0OIl".contains(ch))
    {
        anyhow::bail!("{field} must be base58");
    }
    Ok(())
}

pub fn default_narration(value: Option<&str>) -> String {
    value
        .map(clean_optional)
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| DEFAULT_NARRATION.to_string())
}
