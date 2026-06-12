use axum::{
    extract::Request,
    http::{HeaderValue, Method},
    middleware::Next,
    response::Response,
};
use rust_settlement::{
    app_state::AppState,
    config::AppConfig,
    db,
    http::handlers::build_router,
    kora::client::KoraClient,
    providers::build_payment_provider,
    signer::engine::SignerEngine,
    workers::{chain_confirmation, disbursement, payout_dispatch, pro_payout_dispatch, webhook_processing},
};
use std::net::SocketAddr;
use std::time::Duration;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tracing::{error, info};

async fn log_requests(request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let started = std::time::Instant::now();

    let response = next.run(request).await;

    info!(
        method = %method,
        path = %path,
        status = response.status().as_u16(),
        latency_ms = started.elapsed().as_millis(),
        "HTTP request"
    );

    response
}

fn build_cors_layer() -> anyhow::Result<CorsLayer> {
    let allowed = std::env::var("RAMP_ALLOWED_ORIGIN")
        .or_else(|_| std::env::var("CLEAR_MSIG_ALLOWED_ORIGIN"))
        .map_err(|_| {
            anyhow::anyhow!(
                "RAMP_ALLOWED_ORIGIN or CLEAR_MSIG_ALLOWED_ORIGIN is required for settlement CORS"
            )
        })?;
    let origins: Vec<HeaderValue> = allowed
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .filter_map(|origin| match HeaderValue::from_str(origin) {
            Ok(value) => Some(value),
            Err(error) => {
                tracing::warn!(%origin, %error, "Skipping malformed CORS origin");
                None
            }
        })
        .collect();

    if origins.is_empty() {
        anyhow::bail!(
            "RAMP_ALLOWED_ORIGIN or CLEAR_MSIG_ALLOWED_ORIGIN must contain at least one valid origin"
        );
    }

    Ok(CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env file if present (no-op in production where vars are injected directly)
    dotenvy::dotenv().ok();

    let config = AppConfig::from_env()?;

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "rust_settlement=info,axum=info".to_string()),
        )
        .init();

    let pool = db::create_pool(&config.database_url)?;
    let kora_client = KoraClient::new(config.kora_base_url.clone(), config.kora_secret_key.clone());
    let payment_provider = build_payment_provider(&config)?;
    let signer_engine = SignerEngine::new(&config);

    let state = AppState {
        pool: pool.clone(),
        config: config.clone(),
        kora_client: kora_client.clone(),
        payment_provider: payment_provider.clone(),
        signer_engine: signer_engine.clone(),
    };

    let app = build_router(state)
        .layer(build_cors_layer()?)
        .layer(axum::middleware::from_fn(log_requests));

    let chain_pool = pool.clone();
    let payout_pool = pool.clone();
    let webhook_pool = pool.clone();
    let disbursement_pool = pool.clone();
    let pro_payout_pool = pool.clone();
    let pro_payout_kora = kora_client.clone();
    let payout_provider = payment_provider.clone();
    let disbursement_signer = signer_engine.clone();
    let poll_interval = config.worker_poll_interval_ms;

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(poll_interval));
        loop {
            ticker.tick().await;
            if let Err(err) = chain_confirmation::run_chain_confirmation_pass(&chain_pool).await {
                error!(error = %err, "Chain confirmation worker pass failed");
            }
        }
    });

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(poll_interval));
        loop {
            ticker.tick().await;
            if let Err(err) =
                pro_payout_dispatch::run_pro_payout_dispatch_pass(&pro_payout_pool, &pro_payout_kora).await
            {
                error!(error = %err, "Pro payout dispatch worker pass failed");
            }
        }
    });

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(poll_interval));
        loop {
            ticker.tick().await;
            if let Err(err) = disbursement::run_disbursement_pass(&disbursement_pool, &disbursement_signer).await {
                error!(error = %err, "Disbursement worker pass failed");
            }
        }
    });

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(poll_interval));
        loop {
            ticker.tick().await;
            if let Err(err) = payout_dispatch::run_payout_dispatch_pass(&payout_pool, payout_provider.as_ref()).await {
                error!(error = %err, "Payout dispatch worker pass failed");
            }
        }
    });

    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_millis(poll_interval));
        loop {
            ticker.tick().await;
            if let Err(err) = webhook_processing::run_webhook_processing_pass(&webhook_pool).await {
                error!(error = %err, "Webhook processing worker pass failed");
            }
        }
    });

    let address: SocketAddr = config.bind_addr.parse()?;

    info!(%address, "Starting rust-settlement");

    let listener = tokio::net::TcpListener::bind(address).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
