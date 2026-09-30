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

        if payout_success || payout_failure {
            let payout = sqlx::query("SELECT provider,amount_minor,currency FROM ramp_payouts WHERE transfer_reference=$1")
                .bind(reference).fetch_optional(&mut *tx).await?;
            processing_error = match payout {
                Some(row) => validate_payout_event(
                    &provider,
                    row.get::<Option<String>, _>("provider").as_deref(),
                    &payload,
                    payout_success,
                    row.get("amount_minor"),
                    &row.get::<String, _>("currency"),
                )
                .err()
                .map(|error| error.to_string()),
                None => Some("payout_reference_not_found".into()),
            };
        }

        if processing_error.is_some() {
            // Authenticated does not mean semantically matching. In particular,
            // Kora signs data, so its outer event label cannot override status.
        } else if payout_success {
            if reference.is_empty() {
                processing_error = Some("missing_reference_for_transfer_success".to_string());
            } else {
                match sqlx::query(
                    r#"
                    UPDATE ramp_payouts
                    SET provider_status = 'success', webhook_received_at = NOW(), provider_payload = $2
                    WHERE transfer_reference = $1 AND provider = $3 AND provider_status <> 'success'
                    "#,
                )
                .bind(reference)
                .bind(&payload)
                .bind(&provider)
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
                          AND i.status = 'payout_in_progress'
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
                    WHERE transfer_reference = $1 AND provider = $4 AND provider_status <> 'success'
                    "#,
                )
                .bind(reference)
                .bind(event_type.replace("transfer.", ""))
                .bind(&payload)
                .bind(&provider)
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
                          AND i.status = 'payout_in_progress'
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
                      AND intent_type = 'onramp'
                      AND status = 'awaiting_payment'
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

fn validate_payout_event(
    provider: &str,
    stored_provider: Option<&str>,
    payload: &serde_json::Value,
    success: bool,
    amount_minor: i64,
    currency: &str,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        stored_provider == Some(provider),
        "payout webhook provider mismatch"
    );
    let data = payload
        .get("data")
        .ok_or_else(|| anyhow::anyhow!("missing payout data"))?;
    let status = data
        .get("status")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("missing payout status"))?;
    anyhow::ensure!(
        if success {
            status == "success"
        } else {
            matches!(status, "failed" | "reversed")
        },
        "payout event/status mismatch"
    );
    anyhow::ensure!(
        data.get("currency").and_then(serde_json::Value::as_str) == Some(currency),
        "payout currency mismatch"
    );
    let amount = data
        .get("amount")
        .ok_or_else(|| anyhow::anyhow!("missing payout amount"))?;
    let reported = match provider {
        "paystack" => amount
            .as_i64()
            .ok_or_else(|| anyhow::anyhow!("invalid Paystack payout amount"))?,
        "kora" => i64::try_from(crate::services::deposit_proof::decimal_minor(
            &amount
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| amount.to_string()),
            2,
        )?)?,
        _ => anyhow::bail!("unsupported payout provider"),
    };
    anyhow::ensure!(
        amount_minor > 0 && reported == amount_minor,
        "payout amount mismatch"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_payout_event;
    use serde_json::json;
    #[test]
    fn payout_webhook_must_match_signed_status_provider_amount_and_currency() {
        let valid = json!({"data":{"status":"success","amount":"12.00","currency":"NGN"}});
        validate_payout_event("kora", Some("kora"), &valid, true, 1200, "NGN").unwrap();
        assert!(
            validate_payout_event("kora", Some("paystack"), &valid, true, 1200, "NGN").is_err()
        );
        assert!(validate_payout_event("kora", Some("kora"), &valid, true, 1201, "NGN").is_err());
        assert!(validate_payout_event("kora", Some("kora"), &valid, true, 1200, "USD").is_err());
        let mut failed = valid;
        failed["data"]["status"] = json!("failed");
        assert!(validate_payout_event("kora", Some("kora"), &failed, true, 1200, "NGN").is_err());
        validate_payout_event("kora", Some("kora"), &failed, false, 1200, "NGN").unwrap();
    }
}
