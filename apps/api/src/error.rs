use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use std::time::Duration;
use thiserror::Error;

use crate::runtime::is_production_runtime;

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
        let expose_internal_details = !is_production_runtime();
        let status = match &self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::RateLimited { .. } => StatusCode::TOO_MANY_REQUESTS,
            ApiError::CommandFailed { .. } => StatusCode::BAD_GATEWAY,
            ApiError::Timeout(_) => StatusCode::GATEWAY_TIMEOUT,
            ApiError::InvalidOutput(_) => StatusCode::BAD_GATEWAY,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = self.response_body(expose_internal_details);

        (status, Json(body)).into_response()
    }
}

impl ApiError {
    fn response_body(self, expose_internal_details: bool) -> serde_json::Value {
        match self {
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
            } => {
                let mut body = serde_json::json!({
                    "error": "clear-msig command failed",
                    "kind": "command_failed",
                    "code": code,
                });
                if expose_internal_details {
                    body["stderr"] = stderr.into();
                    body["stdout"] = stdout.into();
                }
                body
            }
            ApiError::Timeout(duration) => serde_json::json!({
                "error": format!("command timed out after {:?}", duration),
                "kind": "timeout",
            }),
            ApiError::InvalidOutput(message) => serde_json::json!({
                "error": if expose_internal_details { message } else { "invalid backend response".to_string() },
                "kind": "invalid_output",
            }),
            ApiError::Internal(message) => {
                serde_json::json!({
                    "error": if expose_internal_details { message } else { "internal service error".to_string() },
                    "kind": "internal"
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_execution_errors_redact_internal_details() {
        let body = ApiError::CommandFailed {
            code: Some(1),
            stderr: "secret signer path".to_string(),
            stdout: "sensitive command output".to_string(),
        }
        .response_body(false);

        assert_eq!(body["kind"], "command_failed");
        assert_eq!(body["code"], 1);
        assert!(body.get("stderr").is_none());
        assert!(body.get("stdout").is_none());
    }

    #[test]
    fn development_execution_errors_preserve_diagnostics() {
        let body = ApiError::CommandFailed {
            code: Some(1),
            stderr: "stderr details".to_string(),
            stdout: "stdout details".to_string(),
        }
        .response_body(true);

        assert_eq!(body["stderr"], "stderr details");
        assert_eq!(body["stdout"], "stdout details");
    }
}
