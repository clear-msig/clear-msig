use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub(crate) enum ApiError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("rate limited")]
    RateLimited {
        retry_after: Duration,
        max_per_window: u32,
    },
    #[error("command failed")]
    CommandFailed {
        code: Option<i32>,
        stderr: String,
        stdout: String,
    },
    #[error("command timed out after {0:?}")]
    Timeout(Duration),
    #[error("invalid command output: {0}")]
    InvalidOutput(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::RateLimited { .. } => StatusCode::TOO_MANY_REQUESTS,
            ApiError::CommandFailed { .. } => StatusCode::BAD_GATEWAY,
            ApiError::Timeout(_) => StatusCode::GATEWAY_TIMEOUT,
            ApiError::InvalidOutput(_) => StatusCode::BAD_GATEWAY,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let body = match self {
            ApiError::BadRequest(message) => {
                serde_json::json!({ "error": message, "kind": "bad_request" })
            }
            ApiError::RateLimited {
                retry_after,
                max_per_window,
            } => serde_json::json!({
                "error": format!(
                    "rate limit exceeded ({max_per_window} per window); retry in {}s",
                    retry_after.as_secs()
                ),
                "kind": "rate_limited",
                "retry_after_secs": retry_after.as_secs(),
            }),
            ApiError::CommandFailed {
                code,
                stderr,
                stdout,
            } => serde_json::json!({
                "error": "clear-msig command failed",
                "kind": "command_failed",
                "code": code,
                "stderr": stderr,
                "stdout": stdout,
            }),
            ApiError::Timeout(duration) => serde_json::json!({
                "error": format!("command timed out after {:?}", duration),
                "kind": "timeout",
            }),
            ApiError::InvalidOutput(message) => serde_json::json!({
                "error": message,
                "kind": "invalid_output",
            }),
            ApiError::Internal(message) => {
                serde_json::json!({ "error": message, "kind": "internal" })
            }
        };

        (status, Json(body)).into_response()
    }
}
