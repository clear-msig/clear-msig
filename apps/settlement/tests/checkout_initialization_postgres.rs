//! Checkout race/crash tests run only against an explicitly supplied local DB.
use async_trait::async_trait;
use rust_settlement::{
    providers::{
        PaymentProvider, PayoutRequest, PayoutResponse, ProviderBank, ProviderCheckout,
        ProviderVerifiedCheckout,
    },
    services::intents::initialize_payment,
    signer::engine::SignerEngine,
};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tokio::sync::{Notify, Semaphore};
use uuid::Uuid;

#[path = "support/config.rs"]
mod config;

#[derive(Clone, Copy)]
enum Outcome {
    Complete,
    Hold,
    Unknown,
    PaidBeforeResponse,
    WrongReference,
}
struct CheckoutMock {
    pool: PgPool,
    outcome: Outcome,
    calls: AtomicUsize,
    verify_calls: AtomicUsize,
    started: Notify,
    release: Semaphore,
}
impl CheckoutMock {
    fn new(pool: &PgPool, outcome: Outcome) -> Self {
        Self {
            pool: pool.clone(),
            outcome,
            calls: AtomicUsize::new(0),
            verify_calls: AtomicUsize::new(0),
            started: Notify::new(),
            release: Semaphore::new(0),
        }
    }
}
#[async_trait]
impl PaymentProvider for CheckoutMock {
    fn name(&self) -> &'static str {
        "paystack"
    }
    async fn initialize_checkout(
        &self,
        _: &str,
        amount: i64,
        reference: &str,
        _: Option<&str>,
    ) -> anyhow::Result<ProviderCheckout> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let metadata: Value = sqlx::query_scalar(
            "SELECT metadata FROM ramp_intents WHERE metadata->>'payment_reference'=$1",
        )
        .bind(reference)
        .fetch_one(&self.pool)
        .await?;
        assert_eq!(metadata["checkout_initialization_state"], "initializing");
        assert_eq!(metadata["payment_provider"], self.name());
        assert_eq!(metadata["ngn_amount_minor"], amount);
        self.started.notify_one();
        match self.outcome {
            Outcome::Hold => {
                let permit = self.release.acquire().await?;
                permit.forget();
            }
            Outcome::Unknown => anyhow::bail!("simulated timeout after remote acceptance"),
            Outcome::PaidBeforeResponse => {
                sqlx::query("UPDATE ramp_intents SET status='payment_confirmed',metadata=metadata||jsonb_build_object('provider_status','success') WHERE metadata->>'payment_reference'=$1")
                    .bind(reference).execute(&self.pool).await?;
            }
            Outcome::Complete | Outcome::WrongReference => {}
        }
        Ok(ProviderCheckout {
            reference: if matches!(self.outcome, Outcome::WrongReference) {
                "different-reference".into()
            } else {
                reference.to_string()
            },
            authorization_url: "https://checkout.example.invalid/test-only".to_string(),
            access_code: "test-only-access".to_string(),
        })
    }
    async fn verify_checkout(&self, _: &str) -> anyhow::Result<ProviderVerifiedCheckout> {
        self.verify_calls.fetch_add(1, Ordering::SeqCst);
        anyhow::bail!("verification is unavailable and must not cause a second checkout")
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
        anyhow::bail!("not used")
    }
}

async fn isolated_pool(url: &str) -> anyhow::Result<(PgPool, PgPool, String)> {
    let parsed = reqwest::Url::parse(url)?;
    anyhow::ensure!(
        matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]")),
        "checkout tests require a local disposable DB"
    );
    let admin = PgPoolOptions::new().max_connections(2).connect(url).await?;
    let schema = format!("checkout_test_{}", Uuid::new_v4().simple());
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

async fn new_intent(pool: &PgPool, owner: Uuid) -> anyhow::Result<Uuid> {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO ramp_intents(id,user_id,intent_type,status,chain_family,chain_id,asset_symbol,asset_amount_minor,destination_wallet,fee_config_version,metadata) VALUES($1,$2,'onramp','awaiting_payment','solana','devnet','SOL',100,'destination',1,$3)")
        .bind(id).bind(owner).bind(json!({"executable_quote_version":1,"executable_quote":{
            "provider":"mock-price","provider_quote_id":"price-1","request_hash":"fixture","chain_family":"solana",
            "chain_id":"devnet","asset_symbol":"SOL","asset_amount_minor":100,"fiat_currency":"NGN",
            "fiat_amount_minor":1200,"expires_at":chrono::Utc::now().timestamp()+300
        }})).execute(pool).await?;
    Ok(id)
}

#[tokio::test]
async fn checkout_initialization_is_durable_single_attempt_and_monotonic() -> anyhow::Result<()> {
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
    let owner = Uuid::new_v4();
    let signer = SignerEngine::new(&config::test_config(url));
    let intent = new_intent(pool, owner).await?;
    let provider = Arc::new(CheckoutMock::new(pool, Outcome::Hold));
    let first = {
        let pool = pool.clone();
        let provider = provider.clone();
        let signer = signer.clone();
        tokio::spawn(async move {
            initialize_payment(
                &pool,
                provider.as_ref(),
                &signer,
                false,
                intent,
                owner,
                "test@example.invalid",
                None,
            )
            .await
        })
    };
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        provider.started.notified(),
    )
    .await?;
    assert!(initialize_payment(
        pool,
        provider.as_ref(),
        &signer,
        false,
        intent,
        owner,
        "test@example.invalid",
        None
    )
    .await
    .is_err());
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
    provider.release.add_permits(1);
    let response = first.await??;
    let replay = initialize_payment(
        pool,
        provider.as_ref(),
        &signer,
        false,
        intent,
        owner,
        "test@example.invalid",
        None,
    )
    .await?;
    assert_eq!(response.payment_reference, replay.payment_reference);
    assert_eq!(response.authorization_url, replay.authorization_url);
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
    assert_eq!(provider.verify_calls.load(Ordering::SeqCst), 0);
    assert!(initialize_payment(
        pool,
        provider.as_ref(),
        &signer,
        false,
        intent,
        Uuid::new_v4(),
        "test@example.invalid",
        None
    )
    .await
    .is_err());
    // A cached checkout does not bypass a now-expired immutable quote.
    sqlx::query("UPDATE ramp_intents SET metadata=jsonb_set(metadata,'{executable_quote,expires_at}','1') WHERE id=$1").bind(intent).execute(pool).await?;
    assert!(initialize_payment(
        pool,
        provider.as_ref(),
        &signer,
        false,
        intent,
        owner,
        "test@example.invalid",
        None
    )
    .await
    .unwrap_err()
    .to_string()
    .contains("expired"));
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);

    for outcome in [Outcome::Unknown, Outcome::WrongReference] {
        let intent = new_intent(pool, owner).await?;
        let provider = CheckoutMock::new(pool, outcome);
        for _ in 0..2 {
            assert!(initialize_payment(
                pool,
                &provider,
                &signer,
                false,
                intent,
                owner,
                "test@example.invalid",
                None
            )
            .await
            .is_err());
        }
        assert_eq!(provider.calls.load(Ordering::SeqCst), 1);
        let marker: String = sqlx::query_scalar(
            "SELECT metadata->>'checkout_initialization_state' FROM ramp_intents WHERE id=$1",
        )
        .bind(intent)
        .fetch_one(pool)
        .await?;
        assert_eq!(marker, "unknown");
    }

    let intent = new_intent(pool, owner).await?;
    let provider = CheckoutMock::new(pool, Outcome::PaidBeforeResponse);
    assert!(initialize_payment(
        pool,
        &provider,
        &signer,
        false,
        intent,
        owner,
        "test@example.invalid",
        None
    )
    .await
    .is_err());
    let status: String = sqlx::query_scalar("SELECT status FROM ramp_intents WHERE id=$1")
        .bind(intent)
        .fetch_one(pool)
        .await?;
    let provider_status: String =
        sqlx::query_scalar("SELECT metadata->>'provider_status' FROM ramp_intents WHERE id=$1")
            .bind(intent)
            .fetch_one(pool)
            .await?;
    assert_eq!(status, "payment_confirmed");
    assert_eq!(provider_status, "success");
    assert!(initialize_payment(
        pool,
        &provider,
        &signer,
        false,
        intent,
        owner,
        "test@example.invalid",
        None
    )
    .await
    .is_err());
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);

    // A process disappearing after remote acceptance must leave its reservation.
    let intent = new_intent(pool, owner).await?;
    let provider = Arc::new(CheckoutMock::new(pool, Outcome::Hold));
    let task = {
        let pool = pool.clone();
        let provider = provider.clone();
        let signer = signer.clone();
        tokio::spawn(async move {
            initialize_payment(
                &pool,
                provider.as_ref(),
                &signer,
                false,
                intent,
                owner,
                "test@example.invalid",
                None,
            )
            .await
        })
    };
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        provider.started.notified(),
    )
    .await?;
    task.abort();
    let _ = task.await;
    assert!(initialize_payment(
        pool,
        provider.as_ref(),
        &signer,
        false,
        intent,
        owner,
        "test@example.invalid",
        None
    )
    .await
    .is_err());
    assert_eq!(provider.calls.load(Ordering::SeqCst), 1);

    // Expiry before initial invocation never creates a payable checkout.
    let intent = new_intent(pool, owner).await?;
    sqlx::query("UPDATE ramp_intents SET metadata=jsonb_set(metadata,'{executable_quote,expires_at}','1') WHERE id=$1").bind(intent).execute(pool).await?;
    let provider = CheckoutMock::new(pool, Outcome::Complete);
    assert!(initialize_payment(
        pool,
        &provider,
        &signer,
        false,
        intent,
        owner,
        "test@example.invalid",
        None
    )
    .await
    .is_err());
    assert_eq!(provider.calls.load(Ordering::SeqCst), 0);
    Ok(())
}
