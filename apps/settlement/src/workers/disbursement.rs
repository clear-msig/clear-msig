use sqlx::{PgPool, Row};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::{
    domain::types::ChainFamily,
    signer::engine::{AssetTransferRequest, SignerEngine},
};

fn parse_chain_family(value: &str) -> anyhow::Result<ChainFamily> {
    match value {
        "solana" => Ok(ChainFamily::Solana),
        "evm" => Ok(ChainFamily::Evm),
        "bitcoin" => Ok(ChainFamily::Bitcoin),
        "zcash" => Ok(ChainFamily::Zcash),
        _ => anyhow::bail!("unsupported chain family: {value}"),
    }
}

pub async fn run_disbursement_pass(
    pool: &PgPool,
    signer: &SignerEngine,
    payment_provider: &dyn crate::providers::PaymentProvider,
) -> anyhow::Result<u64> {
    let mut tx = pool.begin().await?;

    let rows = sqlx::query(
        r#"
        SELECT id, chain_family, chain_id, asset_symbol, asset_amount_minor, destination_wallet, metadata
        FROM ramp_intents
        WHERE intent_type = 'onramp'
          AND status = 'payment_confirmed'
          AND metadata->>'executable_quote_version' = '1'
          AND NOT EXISTS (SELECT 1 FROM ramp_disbursements d WHERE d.intent_id = ramp_intents.id)
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
        "#,
    )
    .fetch_all(&mut *tx)
    .await?;

    if !rows.is_empty() {
        info!(
            queued = rows.len(),
            "Disbursement worker picked payment_confirmed intents"
        );
    }

    // Persist the attempt boundary BEFORE any remote signing/broadcast.
    // A crash/uncertain outcome leaves settlement_in_progress for explicit
    // reconciliation; it must never be picked as a fresh payment again.
    for row in &rows {
        let intent_id: Uuid = row.get("id");
        sqlx::query(
            "UPDATE ramp_intents SET status='settlement_in_progress', updated_at=NOW() WHERE id=$1",
        )
        .bind(intent_id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    let mut processed = 0_u64;

    for row in rows {
        let mut tx = pool.begin().await?;
        let intent_id: Uuid = row.get("id");
        let chain_family_str: String = row.get("chain_family");
        let chain_id: String = row.get("chain_id");
        let asset_symbol: String = row.get("asset_symbol");
        let amount_minor: i64 = row.get("asset_amount_minor");
        let destination_wallet: Option<String> = row.try_get("destination_wallet").ok();
        let metadata: serde_json::Value = row
            .try_get("metadata")
            .unwrap_or_else(|_| serde_json::json!({}));

        info!(
            %intent_id,
            chain_family = %chain_family_str,
            chain_id = %chain_id,
            asset_symbol = %asset_symbol,
            amount_minor,
            "Processing disbursement intent"
        );

        let destination_wallet = match destination_wallet {
            Some(wallet) if !wallet.trim().is_empty() => wallet,
            _ => {
                warn!(%intent_id, "Disbursement skipped: missing destination wallet");
                sqlx::query(
                    "UPDATE ramp_intents SET status = 'manual_review_required', updated_at = NOW(), metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('failure_reason', 'missing_destination_wallet') WHERE id = $1",
                )
                .bind(intent_id)
                .execute(&mut *tx)
                .await?;
                tx.commit().await?;
                continue;
            }
        };

        let chain_family = match parse_chain_family(&chain_family_str) {
            Ok(value) => value,
            Err(error) => {
                warn!(%intent_id, error = %error, "Disbursement moved to manual review: unsupported chain family");
                sqlx::query(
                    "UPDATE ramp_intents SET status = 'manual_review_required', updated_at = NOW(), metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('failure_reason', $2) WHERE id = $1",
                )
                .bind(intent_id)
                .bind(error.to_string())
                .execute(&mut *tx)
                .await?;
                tx.commit().await?;
                continue;
            }
        };

        let payment_result = async {
            anyhow::ensure!(
                metadata
                    .get("payment_provider")
                    .and_then(serde_json::Value::as_str)
                    == Some(payment_provider.name()),
                "payment provider mismatch"
            );
            let reference = metadata
                .get("payment_reference")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| anyhow::anyhow!("missing payment reference"))?;
            let quote: crate::services::quotes::ExecutableQuote = serde_json::from_value(
                metadata
                    .get("executable_quote")
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("missing executable quote"))?,
            )?;
            anyhow::ensure!(
                quote.asset_amount_minor == amount_minor
                    && quote.asset_symbol == asset_symbol
                    && quote.chain_id == chain_id
                    && quote.chain_family == chain_family,
                "immutable quote does not match disbursement"
            );
            let payment = payment_provider.verify_checkout(reference).await?;
            payment.verify_payment(reference, quote.fiat_amount_minor, &quote.fiat_currency)?;
            payment.verify_funding_deadline(quote.expires_at, chrono::Utc::now().timestamp())
        }
        .await;
        if let Err(error) = payment_result {
            sqlx::query("UPDATE ramp_intents SET status='manual_review_required', updated_at=NOW(), metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('failure_reason',$2) WHERE id=$1")
                .bind(intent_id).bind(format!("payment reconciliation failed: {error}")).execute(&mut *tx).await?;
            tx.commit().await?;
            continue;
        }

        let token_address = metadata
            .get("token_address")
            .and_then(|value| value.as_str())
            .map(str::to_string);

        let transfer = signer
            .transfer(&AssetTransferRequest {
                chain_family,
                chain_id: chain_id.clone(),
                asset_symbol: asset_symbol.clone(),
                amount_minor,
                recipient_wallet: destination_wallet.clone(),
                token_address,
            })
            .await;

        match transfer {
            Ok(result) => {
                info!(%intent_id, tx_hash = %result.tx_hash, finalized = result.finalized, "Disbursement signer transfer succeeded");
                sqlx::query(
                    r#"
                    INSERT INTO ramp_disbursements (
                        id, intent_id, chain_family, chain_id, asset_symbol, amount_minor,
                        recipient_wallet, tx_hash, status, requested_at, confirmed_at
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $9 THEN 'success' ELSE 'submitted' END,NOW(),CASE WHEN $9 THEN NOW() ELSE NULL END)
                    ON CONFLICT (intent_id) DO NOTHING
                    "#,
                )
                .bind(Uuid::new_v4())
                .bind(intent_id)
                .bind(&chain_family_str)
                .bind(&chain_id)
                .bind(&asset_symbol)
                .bind(amount_minor)
                .bind(&destination_wallet)
                .bind(&result.tx_hash)
                .bind(result.finalized)
                .execute(&mut *tx)
                .await?;

                sqlx::query(
                    r#"
                    INSERT INTO ramp_chain_transfers (
                        id, intent_id, chain_family, chain_id, tx_hash, event_index,
                        sender_wallet, asset_symbol, amount_minor, confirmations, is_finalized,
                        detected_at, confirmed_at
                    )
                    VALUES ($1,$2,$3,$4,$5,0,'treasury',$6,$7,1,$8,NOW(),CASE WHEN $8 THEN NOW() ELSE NULL END)
                    ON CONFLICT (chain_family, chain_id, tx_hash, event_index)
                    DO NOTHING
                    "#,
                )
                .bind(Uuid::new_v4())
                .bind(intent_id)
                .bind(&chain_family_str)
                .bind(&chain_id)
                .bind(&result.tx_hash)
                .bind(&asset_symbol)
                .bind(amount_minor)
                .bind(result.finalized)
                .execute(&mut *tx)
                .await?;

                sqlx::query("UPDATE ramp_intents SET status = CASE WHEN $2 THEN 'settlement_completed' ELSE 'settlement_in_progress' END, updated_at = NOW() WHERE id = $1")
                    .bind(intent_id)
                    .bind(result.finalized)
                    .execute(&mut *tx)
                    .await?;

                sqlx::query(
                    r#"
                    INSERT INTO ramp_outbox_events (id, aggregate_type, aggregate_id, event_type, payload)
                    VALUES ($1,'intent',$2,CASE WHEN $4 THEN 'asset_disbursed' ELSE 'asset_transfer_submitted' END,$3)
                    "#,
                )
                .bind(Uuid::new_v4())
                .bind(intent_id)
                .bind(serde_json::json!({
                    "intent_id": intent_id,
                    "tx_hash": result.tx_hash,
                    "finalized": result.finalized,
                    "chain_family": chain_family_str,
                    "chain_id": chain_id,
                    "asset_symbol": asset_symbol,
                    "amount_minor": amount_minor,
                    "recipient_wallet": destination_wallet,
                }))
                .bind(result.finalized)
                .execute(&mut *tx)
                .await?;

                sqlx::query(
                    r#"
                    INSERT INTO ramp_audit_events (id, actor_type, action, entity_type, entity_id, metadata)
                    VALUES ($1,'system',CASE WHEN $4 THEN 'asset_disbursed' ELSE 'asset_transfer_submitted' END,'intent',$2,$3)
                    "#,
                )
                .bind(Uuid::new_v4())
                .bind(intent_id)
                .bind(serde_json::json!({
                    "tx_hash": result.tx_hash,
                    "finalized": result.finalized,
                    "chain_family": chain_family_str,
                    "chain_id": chain_id,
                }))
                .bind(result.finalized)
                .execute(&mut *tx)
                .await?;

                processed += 1;
            }
            Err(error) => {
                error!(%intent_id, error = %error, "Disbursement signer failed");
                sqlx::query(
                    "UPDATE ramp_intents SET status = 'manual_review_required', updated_at = NOW(), metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('failure_reason', $2) WHERE id = $1",
                )
                .bind(intent_id)
                .bind(error.to_string())
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
    }

    if processed > 0 {
        info!(
            processed,
            "Disbursement worker signed and broadcast asset payouts"
        );
    }

    Ok(processed)
}
