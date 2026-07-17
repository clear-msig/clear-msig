use sqlx::{PgPool, Row};
use tracing::{error, info, warn};

pub async fn run_webhook_processing_pass(pool: &PgPool) -> anyhow::Result<u64> {
    let mut tx = pool.begin().await?;

    let events = sqlx::query(
        r#"
                SELECT id, provider, event_type, payload
        FROM ramp_webhook_inbox
                WHERE provider IN ('paystack', 'kora')
          AND signature_valid = TRUE
          AND processed_at IS NULL
        ORDER BY received_at ASC
        LIMIT 50
        FOR UPDATE SKIP LOCKED
        "#,
    )
    .fetch_all(&mut *tx)
    .await?;

    if !events.is_empty() {
        info!(
            queued = events.len(),
            "Webhook processing worker picked inbox events"
        );
    }

    let mut processed = 0_u64;

    for event in events {
        let event_id: uuid::Uuid = event.get("id");
        let provider: String = event.get("provider");
        let event_type: String = event.get("event_type");
        let payload: serde_json::Value = event.get("payload");

        info!(%event_id, event_type = %event_type, "Processing webhook inbox event");

        let reference = payload
            .get("data")
            .and_then(|value| value.get("reference"))
            .and_then(|value| value.as_str())
            .or_else(|| {
                payload
                    .get("data")
                    .and_then(|value| value.get("transaction_reference"))
                    .and_then(|value| value.as_str())
            })
            .unwrap_or_default();

        let payment_success = matches!(event_type.as_str(), "charge.success" | "charge.completed")
            || event_type.eq_ignore_ascii_case("charge.successful")
            || event_type.eq_ignore_ascii_case("payment.success")
            || event_type.eq_ignore_ascii_case("transaction.success");
        let payout_success = event_type.eq_ignore_ascii_case("transfer.success")
            || event_type.eq_ignore_ascii_case("disbursement.success")
            || event_type.eq_ignore_ascii_case("payout.success");
        let payout_failure = matches!(event_type.as_str(), "transfer.failed" | "transfer.reversed")
            || event_type.eq_ignore_ascii_case("disbursement.failed")
            || event_type.eq_ignore_ascii_case("payout.failed");

        let mut processing_error: Option<String> = None;

        if payout_success {
            if reference.is_empty() {
                processing_error = Some("missing_reference_for_transfer_success".to_string());
            } else {
                match sqlx::query(
                    r#"
                    UPDATE ramp_payouts
                    SET provider_status = 'success', webhook_received_at = NOW(), provider_payload = $2
                    WHERE transfer_reference = $1
                    "#,
                )
                .bind(reference)
                .bind(&payload)
                .execute(&mut *tx)
                .await
                {
                    Ok(result) => {
                        if result.rows_affected() == 0 {
                            warn!(%event_id, reference = %reference, "transfer.success webhook matched no payout row");
                            processing_error = Some("transfer_success_reference_not_found".to_string());
                        }
                    }
                    Err(err) => {
                        error!(%event_id, reference = %reference, error = %err, "Failed updating payout for transfer.success");
                        processing_error = Some(format!("transfer_success_update_failed: {err}"));
                    }
                }

                if processing_error.is_none() {
                    match sqlx::query(
                        r#"
                        UPDATE ramp_intents i
                        SET status = 'payout_completed', updated_at = NOW(), completed_at = NOW()
                        FROM ramp_payouts p
                        WHERE p.transfer_reference = $1
                          AND p.intent_id = i.id
                        "#,
                    )
                    .bind(reference)
                    .execute(&mut *tx)
                    .await
                    {
                        Ok(result) => {
                            if result.rows_affected() == 0 {
                                warn!(%event_id, reference = %reference, "transfer.success updated payout but matched no intent");
                                processing_error =
                                    Some("transfer_success_intent_not_found".to_string());
                            }
                        }
                        Err(err) => {
                            error!(%event_id, reference = %reference, error = %err, "Failed updating intent for transfer.success");
                            processing_error =
                                Some(format!("transfer_success_intent_update_failed: {err}"));
                        }
                    }
                }
            }
        } else if payout_failure {
            if reference.is_empty() {
                processing_error = Some("missing_reference_for_transfer_failure".to_string());
            } else {
                match sqlx::query(
                    r#"
                    UPDATE ramp_payouts
                    SET provider_status = $2, webhook_received_at = NOW(), provider_payload = $3
                    WHERE transfer_reference = $1
                    "#,
                )
                .bind(reference)
                .bind(event_type.replace("transfer.", ""))
                .bind(&payload)
                .execute(&mut *tx)
                .await
                {
                    Ok(result) => {
                        if result.rows_affected() == 0 {
                            warn!(%event_id, reference = %reference, "transfer failure webhook matched no payout row");
                            processing_error =
                                Some("transfer_failure_reference_not_found".to_string());
                        }
                    }
                    Err(err) => {
                        error!(%event_id, reference = %reference, error = %err, "Failed updating payout for transfer failure webhook");
                        processing_error = Some(format!("transfer_failure_update_failed: {err}"));
                    }
                }

                if processing_error.is_none() {
                    match sqlx::query(
                        r#"
                        UPDATE ramp_intents i
                        SET status = 'failed', updated_at = NOW()
                        FROM ramp_payouts p
                        WHERE p.transfer_reference = $1
                          AND p.intent_id = i.id
                        "#,
                    )
                    .bind(reference)
                    .execute(&mut *tx)
                    .await
                    {
                        Ok(result) => {
                            if result.rows_affected() == 0 {
                                warn!(%event_id, reference = %reference, "transfer failure updated payout but matched no intent");
                                processing_error =
                                    Some("transfer_failure_intent_not_found".to_string());
                            }
                        }
                        Err(err) => {
                            error!(%event_id, reference = %reference, error = %err, "Failed updating intent for transfer failure webhook");
                            processing_error =
                                Some(format!("transfer_failure_intent_update_failed: {err}"));
                        }
                    }
                }
            }
        } else if payment_success {
            if reference.is_empty() {
                processing_error = Some("missing_reference_for_charge_success".to_string());
            } else {
                match sqlx::query(
                    r#"
                    UPDATE ramp_intents
                    SET status = 'payment_confirmed', updated_at = NOW()
                    WHERE metadata ->> 'payment_provider' = $2
                      AND metadata ->> 'payment_reference' = $1
                    "#,
                )
                .bind(reference)
                .bind(&provider)
                .execute(&mut *tx)
                .await
                {
                    Ok(result) => {
                        if result.rows_affected() == 0 {
                            warn!(%event_id, reference = %reference, provider = %provider, "payment success webhook matched no intent by reference");
                            processing_error =
                                Some("charge_success_reference_not_found".to_string());
                        }
                    }
                    Err(err) => {
                        error!(%event_id, reference = %reference, error = %err, "Failed updating intent for charge.success");
                        processing_error = Some(format!("charge_success_update_failed: {err}"));
                    }
                }
            }
        } else {
            warn!(%event_id, provider = %provider, event_type = %event_type, "Ignoring unsupported webhook event type");
            processing_error = Some(format!("unsupported_event_type:{event_type}"));
        }

        sqlx::query("UPDATE ramp_webhook_inbox SET processed_at = NOW(), processing_error = $2 WHERE id = $1")
            .bind(event_id)
            .bind(processing_error.as_deref())
            .execute(&mut *tx)
            .await?;

        if let Some(err) = processing_error {
            warn!(%event_id, error = %err, "Webhook event processed with recoverable issue");
        } else {
            info!(%event_id, "Webhook event processed successfully");
        }

        processed += 1;
    }

    tx.commit().await?;

    if processed > 0 {
        info!(processed, "Webhook processing worker handled inbox events");
    }

    Ok(processed)
}
