use axum::Router;
use std::{env, net::SocketAddr, sync::Arc, time::Duration};
use tower_http::{
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};
use tracing::{error, info};

mod clearsign;
mod cors;
mod error;
mod intents;
mod pro;
mod proposals;
mod rate_limit;
mod runner;
mod state;
mod validation;
mod wallet;

pub(crate) use error::ApiError;
pub(crate) use rate_limit::RateLimiter;
pub(crate) use state::AppState;
pub(crate) use validation::{
    current_unix_timestamp, ensure_base58, ensure_base58_pubkey, ensure_chain, ensure_hex,
    ensure_hex_exact_len, ensure_intent_filename, ensure_non_empty, ensure_non_empty_vec,
    ensure_wallet_name,
};

use pro::ProStore;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "clear_msig_backend_api=info,tower_http=info".into()),
        )
        .with_target(true)
        .init();

    let runner = runner::build_runner();

    let rate_limit_window_secs = env::var("CLEAR_MSIG_RATE_LIMIT_WINDOW_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(60);
    let rate_limit_max = env::var("CLEAR_MSIG_RATE_LIMIT_MAX_PER_WINDOW")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(30);

    let pro_store_path = pro::default_store_path();

    info!(
        cli_bin = %runner.cli_bin,
        pro_store_path = %pro_store_path.display(),
        rate_limit_window_secs,
        rate_limit_max,
        "starting backend adapter"
    );

    let state = AppState {
        runner: Arc::new(runner),
        rate_limiter: Arc::new(RateLimiter::new(
            Duration::from_secs(rate_limit_window_secs),
            rate_limit_max,
        )),
        pro_store: Arc::new(ProStore::new(pro_store_path)),
    };

    let app = Router::new()
        .merge(wallet::router())
        .nest("/v1/clearsign", clearsign::router())
        .nest("/v1/pro", pro::router())
        .merge(intents::router())
        .merge(proposals::router())
        .with_state(state)
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(cors::build_cors_layer())
        .layer(TraceLayer::new_for_http());

    let bind = env::var("BACKEND_API_BIND").unwrap_or_else(|_| "127.0.0.1:8080".to_string());
    let addr: SocketAddr = bind
        .parse()
        .map_err(|e| anyhow::anyhow!("invalid BACKEND_API_BIND '{bind}': {e}"))?;

    info!(%addr, "backend adapter listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    if let Err(error) = axum::serve(listener, app).await {
        error!(%error, "server failed");
        return Err(anyhow::anyhow!("server failed: {error}"));
    }

    Ok(())
}
