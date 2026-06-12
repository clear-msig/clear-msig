use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use tracing::{error, info};
use uuid::Uuid;

use crate::{kora::client::KoraClient, services::pro_payouts};

#[derive(Debug, FromRow)]
struct DispatchItem {
    id: Uuid,
    batch_id: Uuid,
    amount_minor: i64,
    bank_code: String,
    bank_account_number: String,
    account_name: Option<String>,
    customer_email: Option<String>,
    narration: Option<String>,
    provider_reference: String,
    batch_narration: Option<String>,
    claimed_at: DateTime<Utc>,
}

pub async fn run_pro_payout_dispatch_pass(pool: &PgPool, kora_client: &KoraClient) -> anyhow::Result<u64> {
    let mut processed = 0_u64;

    loop {
        let item = claim_next_item(pool).await?;
        let Some(item) = item else {
            break;
        };

        let narration = pro_payouts::default_narration(
            item.narration
                .as_deref()
                .or(item.batch_narration.as_deref()),
        );
        let account_name = item
            .account_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Clear multisig recipient");
        let customer_email = item
            .customer_email
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{}@clear.local", item.provider_reference));

        let result = kora_client
            .disburse_bank_account(
                &item.provider_reference,
                item.amount_minor,
                &item.bank_code,
                &item.bank_account_number,
                account_name,
                &customer_email,
                &narration,
            )
            .await;

        match result {
            Ok(response) => {
                let provider_status = response
                    .data
                    .as_ref()
                    .map(|row| row.status.clone())
                    .unwrap_or_else(|| if response.status { "processing".to_string() } else { "failed".to_string() });
                let completed = provider_status.eq_ignore_ascii_case("success")
                    || provider_status.eq_ignore_ascii_case("successful")
                    || provider_status.eq_ignore_ascii_case("completed");
                let next_status = if completed { "completed" } else { "disbursing" };

                sqlx::query(
                    r#"
                    UPDATE pro_payout_items
                    SET status = $2,
                        provider_status = $3,
                        provider_payload = $4,
                        completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE completed_at END,
                        updated_at = NOW()
                    WHERE id = $1
                    "#,
                )
                .bind(item.id)
                .bind(next_status)
                .bind(provider_status)
                .bind(serde_json::to_value(response)?)
                .execute(pool)
                .await?;
            }
            Err(err) => {
                error!(
                    item_id = %item.id,
                    batch_id = %item.batch_id,
                    error = %err,
                    "Kora Pro payout dispatch failed"
                );
                sqlx::query(
                    r#"
                    UPDATE pro_payout_items
                    SET status = 'failed',
                        provider_status = 'failed',
                        failure_reason = $2,
                        updated_at = NOW()
                    WHERE id = $1
                    "#,
                )
                .bind(item.id)
                .bind(err.to_string())
                .execute(pool)
                .await?;
            }
        }

        pro_payouts::refresh_batch_status(pool, item.batch_id).await?;
        processed += 1;

        if processed >= 25 {
            break;
        }
    }

    if processed > 0 {
        info!(processed, "Pro payout dispatch worker handled payout rows");
    }

    Ok(processed)
}

async fn claim_next_item(pool: &PgPool) -> anyhow::Result<Option<DispatchItem>> {
    Ok(sqlx::query_as::<_, DispatchItem>(
        r#"
        WITH next_item AS (
            SELECT i.id
            FROM pro_payout_items i
            JOIN pro_payout_batches b ON b.id = i.batch_id
            WHERE i.status = 'pending'
              AND b.status IN ('ready_for_disbursement','disbursing')
            ORDER BY b.created_at ASC, i.row_index ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        UPDATE pro_payout_items i
        SET status = 'disbursing',
            requested_at = COALESCE(i.requested_at, NOW()),
            updated_at = NOW()
        FROM next_item, pro_payout_batches b
        WHERE i.id = next_item.id
          AND b.id = i.batch_id
        RETURNING i.id, i.batch_id, i.amount_minor, i.bank_code, i.bank_account_number,
                  i.account_name, i.customer_email, i.narration, i.provider_reference,
                  b.narration AS batch_narration, i.requested_at AS claimed_at
        "#,
    )
    .fetch_optional(pool)
    .await?)
}
