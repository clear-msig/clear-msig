use sqlx::{PgPool, Row};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::{
    domain::types::ChainFamily,
    signer::engine::{AssetTransferRequest, SignerEngine},
};

fn parse_chain_family(value: &str) -> anyhow::Result<ChainFamily> {
    match value {
        "evm" => Ok(ChainFamily::Evm),
        "sui" => Ok(ChainFamily::Sui),
        _ => anyhow::bail!("unsupported chain family: {value}"),
    }
}

pub async fn run_disbursement_pass(pool: &PgPool, signer: &SignerEngine) -> anyhow::Result<u64> {
    let mut tx = pool.begin().await?;

    let rows = sqlx::query(
        r#"
        SELECT id, chain_family, chain_id, asset_symbol, asset_amount_minor, destination_wallet, metadata
        FROM ramp_intents
        WHERE intent_type = 'onramp'
          AND status = 'payment_confirmed'
        ORDER BY created_at ASC
        LIMIT 20
        FOR UPDATE SKIP LOCKED
        "#,
    )
    .fetch_all(&mut *tx)
    .await?;

    if !rows.is_empty() {
        info!(queued = rows.len(), "Disbursement worker picked payment_confirmed intents");
    }

    let mut processed = 0_u64;

    for row in rows {
        let intent_id: Uuid = row.get("id");
        let chain_family_str: String = row.get("chain_family");
        let chain_id: String = row.get("chain_id");
        let asset_symbol: String = row.get("asset_symbol");
        let amount_minor: i64 = row.get("asset_amount_minor");
        let destination_wallet: Option<String> = row.try_get("destination_wallet").ok();
        let metadata: serde_json::Value = row.try_get("metadata").unwrap_or_else(|_| serde_json::json!({}));

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
                continue;
            }
        };

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
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'success',NOW(),CASE WHEN $9 THEN NOW() ELSE NULL END)
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

                sqlx::query("UPDATE ramp_intents SET status = 'settlement_completed', updated_at = NOW() WHERE id = $1")
                    .bind(intent_id)
                    .execute(&mut *tx)
                    .await?;

                sqlx::query(
                    r#"
                    INSERT INTO ramp_outbox_events (id, aggregate_type, aggregate_id, event_type, payload)
                    VALUES ($1,'intent',$2,'asset_disbursed',$3)
                    "#,
                )
                .bind(Uuid::new_v4())
                .bind(intent_id)
                .bind(serde_json::json!({
                    "intent_id": intent_id,
                    "tx_hash": result.tx_hash,
                    "chain_family": chain_family_str,
                    "chain_id": chain_id,
                    "asset_symbol": asset_symbol,
                    "amount_minor": amount_minor,
                    "recipient_wallet": destination_wallet,
                }))
                .execute(&mut *tx)
                .await?;

                sqlx::query(
                    r#"
                    INSERT INTO ramp_audit_events (id, actor_type, action, entity_type, entity_id, metadata)
                    VALUES ($1,'system','asset_disbursed','intent',$2,$3)
                    "#,
                )
                .bind(Uuid::new_v4())
                .bind(intent_id)
                .bind(serde_json::json!({
                    "tx_hash": result.tx_hash,
                    "chain_family": chain_family_str,
                    "chain_id": chain_id,
                }))
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
    }

    tx.commit().await?;

    if processed > 0 {
        info!(processed, "Disbursement worker signed and broadcast asset payouts");
    }

    Ok(processed)
}
