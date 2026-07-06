use axum::http::HeaderValue;
use std::env;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tracing::{error, info};

pub(crate) fn build_cors_layer() -> CorsLayer {
    let raw = env::var("CLEAR_MSIG_ALLOWED_ORIGIN").ok();
    let trimmed = raw.as_deref().map(str::trim).unwrap_or("");

    if trimmed.is_empty() {
        info!("CORS: permissive (dev mode - set CLEAR_MSIG_ALLOWED_ORIGIN in production)");
        return CorsLayer::permissive();
    }

    let origins: Vec<HeaderValue> = trimmed
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter_map(|origin| match HeaderValue::from_str(origin) {
            Ok(v) => Some(v),
            Err(e) => {
                error!(?origin, error = %e, "skipping malformed CORS origin");
                None
            }
        })
        .collect();

    if origins.is_empty() {
        info!("CORS: permissive (no parsable origins in CLEAR_MSIG_ALLOWED_ORIGIN)");
        return CorsLayer::permissive();
    }

    info!(count = origins.len(), "CORS: pinned to allow-list");

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([axum::http::header::CONTENT_TYPE])
}
