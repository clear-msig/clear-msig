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
          AND i.intent_type = 'offramp'
          AND t.is_finalized = TRUE
          AND t.verifier_version = 1
          AND t.chain_family = i.chain_family AND t.chain_id = i.chain_id
          AND t.asset_symbol = i.asset_symbol AND t.amount_minor = i.asset_amount_minor
          AND t.sender_wallet = i.source_wallet
          AND t.recipient_wallet = i.metadata->>'deposit_treasury_address'
          AND t.deposit_reference = i.metadata->>'deposit_reference'
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
