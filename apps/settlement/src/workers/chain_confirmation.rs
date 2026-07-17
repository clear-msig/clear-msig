use sqlx::PgPool;
use tracing::info;

pub async fn run_chain_confirmation_pass(pool: &PgPool) -> anyhow::Result<u64> {
    let updated = sqlx::query(
        r#"
        UPDATE ramp_intents i
        SET status = 'settlement_completed', updated_at = NOW()
        FROM ramp_chain_transfers t
        WHERE i.id = t.intent_id
          AND i.status = 'awaiting_user_transfer_confirmation'
          AND t.is_finalized = TRUE
        "#,
    )
    .execute(pool)
    .await?;

    let count = updated.rows_affected();
    if count > 0 {
        info!(
            updated_intents = count,
            "Chain confirmation worker advanced intents"
        );
    }

    Ok(count)
}
