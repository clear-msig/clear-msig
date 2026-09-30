//! Run only against an explicitly supplied isolated local test database.
use async_trait::async_trait;
use axum::{extract::State, routing::post, Json, Router};
use rust_settlement::{
    contracts::api::ChainTransferConfirmationRequest,
    domain::types::ChainFamily,
    providers::{
        PaymentProvider, PayoutRequest, PayoutResponse, ProviderBank, ProviderCheckout,
        ProviderVerifiedCheckout,
    },
    services::{deposits::confirm_deposit, webhook_inbox::insert_webhook_event},
    workers::{
        chain_confirmation::run_chain_confirmation_pass, payout_dispatch::run_payout_dispatch_pass,
    },
};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use uuid::Uuid;
#[path = "support/config.rs"]
mod config;

struct PaymentMock(AtomicUsize);
#[async_trait]
impl PaymentProvider for PaymentMock {
    fn name(&self) -> &'static str {
        "paystack"
    }
    async fn initialize_checkout(
        &self,
        _: &str,
        _: i64,
        _: &str,
        _: Option<&str>,
    ) -> anyhow::Result<ProviderCheckout> {
        anyhow::bail!("not used")
    }
    async fn verify_checkout(&self, _: &str) -> anyhow::Result<ProviderVerifiedCheckout> {
        anyhow::bail!("not used")
    }
    async fn resolve_account_number(&self, _: &str, _: &str) -> anyhow::Result<(String, String)> {
        anyhow::bail!("not used")
    }
    async fn create_transfer_recipient(&self, _: &str, _: &str, _: &str) -> anyhow::Result<String> {
        anyhow::bail!("not used")
    }
    async fn list_banks(&self, _: &str) -> anyhow::Result<Vec<ProviderBank>> {
        anyhow::bail!("not used")
    }
    async fn initiate_payout(&self, _: &PayoutRequest) -> anyhow::Result<PayoutResponse> {
        self.0.fetch_add(1, Ordering::SeqCst);
        anyhow::bail!("simulated timeout after provider acceptance")
    }
}

#[derive(Clone)]
struct RpcFixture {
    intent: Uuid,
    finalized: Arc<AtomicBool>,
    calls: Arc<AtomicUsize>,
}
async fn mock_rpc(State(f): State<RpcFixture>, Json(request): Json<Value>) -> Json<Value> {
    f.calls.fetch_add(1, Ordering::SeqCst);
    let result = match request["method"].as_str().unwrap() {
        "eth_chainId" => json!("0xaa36a7"),
        "eth_getTransactionByHash" => {
            json!({"hash":format!("0x{}","33".repeat(32)),"from":format!("0x{}","11".repeat(20)),"to":format!("0x{}","22".repeat(20)),"value":"0x64","input":format!("0x{}",hex::encode(format!("clearsig-ramp:{}",f.intent))),"blockHash":"0xblock"})
        }
        "eth_getTransactionReceipt" => {
            json!({"transactionHash":format!("0x{}","33".repeat(32)),"status":"0x1","blockNumber":"0x10","blockHash":"0xblock"})
        }
        "eth_getBlockByNumber" if request["params"][0] == "finalized" => {
            json!({"number":if f.finalized.load(Ordering::SeqCst){"0x10"}else{"0xf"}})
        }
        "eth_getBlockByNumber" => json!({"number":"0x10","hash":"0xblock","timestamp":"0x100"}),
        other => panic!("unexpected method {other}"),
    };
    Json(json!({"jsonrpc":"2.0","id":1,"result":result}))
}

async fn isolated_pool(url: &str) -> anyhow::Result<(PgPool, PgPool, String)> {
    let parsed = reqwest::Url::parse(url)?;
    anyhow::ensure!(
        matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")),
        "security integration tests require a local disposable DB"
    );
    let admin = PgPoolOptions::new().max_connections(2).connect(url).await?;
    let schema = format!("settlement_test_{}", Uuid::new_v4().simple());
    sqlx::raw_sql(&format!("CREATE SCHEMA {schema}"))
        .execute(&admin)
        .await?;
    let search_path = format!("SET search_path TO {schema},public");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .after_connect(move |connection, _| {
            let command = search_path.clone();
            Box::pin(async move {
                sqlx::query(&command).execute(connection).await?;
                Ok(())
            })
        })
        .connect(url)
        .await?;
    // Migration 0001 historically referenced the old application users table;
    // migration 0002 removes those FKs. Isolate that legacy prerequisite.
    sqlx::raw_sql("CREATE TABLE users(id UUID PRIMARY KEY)")
        .execute(&pool)
        .await?;
    let first = include_str!("../migrations/0001_ramp_core.sql")
        .replace("CREATE EXTENSION IF NOT EXISTS pgcrypto;", "");
    sqlx::raw_sql(&first).execute(&pool).await?;
    sqlx::raw_sql(include_str!("../migrations/0002_clear_msig_chains.sql"))
        .execute(&pool)
        .await?;
    sqlx::raw_sql(include_str!(
        "../migrations/0003_verified_deposit_evidence.sql"
    ))
    .execute(&pool)
    .await?;
    Ok((admin, pool, schema))
}

#[tokio::test]
async fn settlement_auth_proof_replay_poisoning_and_crash_boundaries() -> anyhow::Result<()> {
    let Ok(url) = std::env::var("CLEAR_MSIG_TEST_DATABASE_URL") else {
        eprintln!(
            "SKIPPED: set CLEAR_MSIG_TEST_DATABASE_URL to an isolated local PostgreSQL database"
        );
        return Ok(());
    };
    let (admin, pool, schema) = isolated_pool(&url).await?;
    let result = exercise(&pool, &url).await;
    pool.close().await;
    sqlx::raw_sql(&format!("DROP SCHEMA {schema} CASCADE"))
        .execute(&admin)
        .await?;
    admin.close().await;
    result
}

async fn exercise(pool: &PgPool, url: &str) -> anyhow::Result<()> {
    // A previously poisoned unsigned notification cannot suppress a valid retry.
    sqlx::query("INSERT INTO ramp_webhook_inbox(id,provider,event_type,dedupe_key,signature_valid,payload) VALUES($1,'paystack','charge.success','dedupe',FALSE,'{}')").bind(Uuid::new_v4()).execute(pool).await?;
    assert!(
        insert_webhook_event(
            pool,
            "paystack",
            Some("123"),
            "charge.success",
            "dedupe",
            true,
            &json!({"verified":true})
        )
        .await?
    );
    assert!(
        !insert_webhook_event(
            pool,
            "paystack",
            Some("123"),
            "charge.success",
            "dedupe",
            true,
            &json!({"verified":false})
        )
        .await?
    );
    let stored: Value =
        sqlx::query_scalar("SELECT payload FROM ramp_webhook_inbox WHERE dedupe_key='dedupe'")
            .fetch_one(pool)
            .await?;
    assert_eq!(stored, json!({"verified":true}));

    let intent = Uuid::new_v4();
    let owner = Uuid::new_v4();
    let quote = Uuid::new_v4();
    let source = format!("0x{}", "11".repeat(20));
    let treasury = format!("0x{}", "22".repeat(20));
    let hash = format!("0x{}", "33".repeat(32));
    sqlx::query("INSERT INTO ramp_intents(id,user_id,intent_type,status,chain_family,chain_id,asset_symbol,asset_amount_minor,source_wallet,quote_id,fee_config_version,metadata) VALUES($1,$2,'offramp','awaiting_user_transfer_confirmation','evm','11155111','ETH',100,$3,$4,1,$5)")
        .bind(intent).bind(owner).bind(&source).bind(quote).bind(json!({"deposit_treasury_address":treasury,"deposit_reference":format!("clearsig-ramp:{intent}"),"executable_quote_version":1,"executable_quote":{"provider":"mock","provider_quote_id":"q","request_hash":"test","chain_family":"evm","chain_id":"11155111","asset_symbol":"ETH","asset_amount_minor":100,"fiat_currency":"NGN","fiat_amount_minor":1200,"expires_at":1000}})).execute(pool).await?;
    let f = RpcFixture {
        intent,
        finalized: Arc::new(AtomicBool::new(false)),
        calls: Arc::new(AtomicUsize::new(0)),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let app = Router::new()
        .route("/", post(mock_rpc))
        .with_state(f.clone());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let mut config = config::test_config(url);
    config.evm_rpc_url = format!("http://{address}/");
    let claim = ChainTransferConfirmationRequest {
        intent_id: intent,
        chain_family: ChainFamily::Evm,
        chain_id: "11155111".into(),
        tx_hash: hash.clone(),
        event_index: 0,
        sender_wallet: source.clone(),
        asset_symbol: "ETH".into(),
        amount_minor: 100,
        confirmations: 999,
        finalized: true,
    };
    assert!(confirm_deposit(pool, &config, Uuid::new_v4(), &claim)
        .await
        .is_err());
    assert_eq!(f.calls.load(Ordering::SeqCst), 0);
    assert!(
        confirm_deposit(pool, &config, owner, &claim).await.is_err(),
        "caller finality bypassed independently fetched chain state"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM ramp_chain_transfers")
            .fetch_one(pool)
            .await?,
        0
    );
    f.finalized.store(true, Ordering::SeqCst);
    confirm_deposit(pool, &config, owner, &claim).await?;
    confirm_deposit(pool, &config, owner, &claim).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM ramp_chain_transfers")
            .fetch_one(pool)
            .await?,
        1
    );
    // Legacy finality flags and mismatched evidence never advance the intent.
    for assignment in [
        "verifier_version=NULL",
        "amount_minor=99",
        "recipient_wallet='other'",
        "deposit_reference='other'",
        "chain_id='1'",
        "asset_symbol='OTHER'",
        "sender_wallet='other'",
    ] {
        sqlx::raw_sql(&format!("UPDATE ramp_chain_transfers SET {assignment}"))
            .execute(pool)
            .await?;
        assert_eq!(run_chain_confirmation_pass(pool).await?, 0, "{assignment}");
        sqlx::query("UPDATE ramp_chain_transfers SET verifier_version=1,amount_minor=100,recipient_wallet=$1,deposit_reference=$2,chain_id='11155111',asset_symbol='ETH',sender_wallet=$3")
            .bind(&treasury).bind(format!("clearsig-ramp:{intent}")).bind(&source).execute(pool).await?;
    }
    sqlx::query("UPDATE ramp_chain_transfers SET verifier_version=NULL")
        .execute(pool)
        .await?;
    assert_eq!(run_chain_confirmation_pass(pool).await?, 0);
    sqlx::query("UPDATE ramp_chain_transfers SET verifier_version=1")
        .execute(pool)
        .await?;
    assert_eq!(run_chain_confirmation_pass(pool).await?, 1);
    assert_eq!(run_chain_confirmation_pass(pool).await?, 0);
    sqlx::query("INSERT INTO ramp_quotes(id,intent_id,quote_version,input_asset_symbol,input_asset_amount_minor,estimated_ngn_amount_minor,platform_fee_bps,expires_at,is_locked) VALUES($1,$2,1,'ETH',100,1200,0,NOW()+INTERVAL '5 minutes',TRUE)").bind(quote).bind(intent).execute(pool).await?;
    sqlx::query("INSERT INTO ramp_bank_snapshots(id,intent_id,snapshot_version,bank_code,account_number,recipient_code) VALUES($1,$2,1,'bank','account','recipient')").bind(Uuid::new_v4()).bind(intent).execute(pool).await?;
    sqlx::query("UPDATE ramp_intents SET bank_snapshot_id=(SELECT id FROM ramp_bank_snapshots WHERE intent_id=$1) WHERE id=$1").bind(intent).execute(pool).await?;
    let provider = PaymentMock(AtomicUsize::new(0));
    assert!(run_payout_dispatch_pass(pool, &provider).await.is_err());
    assert_eq!(provider.0.load(Ordering::SeqCst), 1);
    assert_eq!(
        run_payout_dispatch_pass(pool, &provider).await?,
        0,
        "unknown payout must never be resubmitted"
    );
    assert_eq!(provider.0.load(Ordering::SeqCst), 1);
    let state: String = sqlx::query_scalar("SELECT status FROM ramp_intents WHERE id=$1")
        .bind(intent)
        .fetch_one(pool)
        .await?;
    assert_eq!(state, "payout_in_progress");
    let persisted: String =
        sqlx::query_scalar("SELECT provider_status FROM ramp_payouts WHERE intent_id=$1")
            .bind(intent)
            .fetch_one(pool)
            .await?;
    assert_eq!(persisted, "unknown");
    let reference = format!("ramp-offramp-{intent}");
    insert_webhook_event(pool,"kora",Some("wrong-provider"),"transfer.success","wrong-provider",true,&json!({"data":{"reference":reference,"status":"success","amount":"12.00","currency":"NGN"}})).await?;
    rust_settlement::workers::webhook_processing::run_webhook_processing_pass(pool).await?;
    let state: String = sqlx::query_scalar("SELECT status FROM ramp_intents WHERE id=$1")
        .bind(intent)
        .fetch_one(pool)
        .await?;
    assert_eq!(state, "payout_in_progress");
    insert_webhook_event(
        pool,
        "paystack",
        Some("paid"),
        "transfer.success",
        "paid",
        true,
        &json!({"data":{"reference":reference,"status":"success","amount":1200,"currency":"NGN"}}),
    )
    .await?;
    rust_settlement::workers::webhook_processing::run_webhook_processing_pass(pool).await?;
    let state: String = sqlx::query_scalar("SELECT status FROM ramp_intents WHERE id=$1")
        .bind(intent)
        .fetch_one(pool)
        .await?;
    assert_eq!(state, "payout_completed");
    insert_webhook_event(
        pool,
        "paystack",
        Some("late-failure"),
        "transfer.failed",
        "late-failure",
        true,
        &json!({"data":{"reference":reference,"status":"failed","amount":1200,"currency":"NGN"}}),
    )
    .await?;
    rust_settlement::workers::webhook_processing::run_webhook_processing_pass(pool).await?;
    let state: String = sqlx::query_scalar("SELECT status FROM ramp_intents WHERE id=$1")
        .bind(intent)
        .fetch_one(pool)
        .await?;
    assert_eq!(state, "payout_completed");
    server.abort();
    Ok(())
}
