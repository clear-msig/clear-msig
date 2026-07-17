use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn insert_webhook_event(
    pool: &PgPool,
    provider: &str,
    provider_event_id: Option<&str>,
    event_type: &str,
    dedupe_key: &str,
    signature_valid: bool,
    payload: &Value,
) -> anyhow::Result<bool> {
    let result = sqlx::query(
        r#"
        INSERT INTO ramp_webhook_inbox (
            id, provider, provider_event_id, event_type, dedupe_key, signature_valid, payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (provider, dedupe_key) DO NOTHING
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(provider)
    .bind(provider_event_id)
    .bind(event_type)
    .bind(dedupe_key)
    .bind(signature_valid)
    .bind(payload)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() == 1)
}
