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
    anyhow::ensure!(
        signature_valid,
        "unverified webhooks cannot enter the delivery inbox"
    );
    let result = sqlx::query(
        r#"
        INSERT INTO ramp_webhook_inbox (
            id, provider, provider_event_id, event_type, dedupe_key, signature_valid, payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (provider, dedupe_key) DO UPDATE
        SET provider_event_id = EXCLUDED.provider_event_id,
            event_type = EXCLUDED.event_type,
            signature_valid = TRUE,
            payload = EXCLUDED.payload,
            received_at = NOW(),
            processed_at = NULL,
            processing_error = NULL
        WHERE ramp_webhook_inbox.signature_valid = FALSE
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn invalid_signature_is_rejected_before_any_database_access() {
        // A lazy pool has no database connection. This test succeeds only if
        // the authentication check precedes SQL execution.
        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://unused:unused@127.0.0.1:1/unused")
            .unwrap();
        let error = insert_webhook_event(
            &pool,
            "paystack",
            Some("123"),
            "charge.success",
            "charge.success:123",
            false,
            &serde_json::json!({}),
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("unverified webhooks"));
    }
}
