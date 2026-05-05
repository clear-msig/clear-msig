use crate::providers::{PaymentProvider, PayoutRequest};
use sqlx::{PgPool, Row};
use tracing::{info, warn};
use uuid::Uuid;

pub async fn run_payout_dispatch_pass(pool: &PgPool, payment_provider: &dyn PaymentProvider) -> anyhow::Result<u64> {
    let mut tx = pool.begin().await?;

    let rows = sqlx::query(
        r#"
        SELECT i.id AS intent_id, i.asset_symbol, q.estimated_ngn_amount_minor,
               b.recipient_code, b.bank_code, b.account_number, b.account_name
        FROM ramp_intents i
        JOIN ramp_quotes q ON q.intent_id = i.id
        JOIN ramp_bank_snapshots b ON b.intent_id = i.id
        WHERE i.status = 'settlement_completed'
        ORDER BY i.created_at ASC
        LIMIT 20
        FOR UPDATE SKIP LOCKED
        "#,
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut processed = 0_u64;

    for row in rows {
        let intent_id: Uuid = row.get("intent_id");
        let amount_minor: i64 = row.get("estimated_ngn_amount_minor");
        let recipient_code: Option<String> = row.try_get("recipient_code").ok();
        let bank_code: Option<String> = row.try_get("bank_code").ok();
        let account_number: Option<String> = row.try_get("account_number").ok();
        let account_name: Option<String> = row.try_get("account_name").ok();
        let recipient_code = recipient_code.unwrap_or_default();

        let provider_name = payment_provider.name();

        if provider_name == "paystack" && recipient_code.trim().is_empty() {
            warn!(%intent_id, "Skipping payout: missing recipient_code in bank snapshot");
            continue;
        }

        if provider_name == "kora" {
            let missing_bank = bank_code
                .as_deref()
                .map(|value| value.trim().is_empty())
                .unwrap_or(true);
            let missing_account = account_number
                .as_deref()
                .map(|value| value.trim().is_empty())
                .unwrap_or(true);

            if missing_bank || missing_account {
                warn!(%intent_id, "Skipping payout: missing bank_code/account_number for Kora");
                continue;
            }
        }

        if amount_minor <= 0 {
            warn!(%intent_id, amount_minor, "Skipping payout: amount is non-positive");
            continue;
        }

        let transfer_reference = format!("ramp-offramp-{}", intent_id);

        let response = payment_provider
            .initiate_payout(&PayoutRequest {
                amount_minor,
                reference: transfer_reference.clone(),
                recipient_code: Some(recipient_code),
                bank_code,
                account_number,
                account_name,
            })
            .await?;

        sqlx::query(
            r#"
            INSERT INTO ramp_payouts (
                id, intent_id, transfer_reference, amount_minor, currency,
                provider_status, provider_payload, requested_at
            )
            VALUES ($1,$2,$3,$4,'NGN',$5,$6,NOW())
            ON CONFLICT (transfer_reference) DO NOTHING
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(intent_id)
        .bind(&transfer_reference)
        .bind(amount_minor)
        .bind(response.provider_status)
        .bind(response.provider_payload)
        .execute(&mut *tx)
        .await?;

        sqlx::query("UPDATE ramp_intents SET status = 'payout_in_progress', updated_at = NOW() WHERE id = $1")
            .bind(intent_id)
            .execute(&mut *tx)
            .await?;

        processed += 1;
    }

    tx.commit().await?;

    if processed > 0 {
        info!(processed, provider = payment_provider.name(), "Payout dispatch worker queued provider payouts");
    }

    Ok(processed)
}
