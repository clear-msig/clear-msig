use std::env;

use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;

use crate::{ApiError, AppState};

#[derive(Serialize)]
struct VersionResponse {
    status: &'static str,
    service: &'static str,
    package_version: &'static str,
    environment: String,
    provider: &'static str,
    commit_sha: Option<String>,
    build_time: Option<String>,
    deployment_id: Option<String>,
    program: ProgramVersion,
    runtime: RuntimeVersion,
}

#[derive(Serialize)]
struct ProgramVersion {
    id: String,
    network: &'static str,
    rpc_provider: &'static str,
    expected_deployed_slot: Option<String>,
    expected_artifact_sha256: Option<String>,
}

#[derive(Serialize)]
struct RuntimeVersion {
    execution_mode: &'static str,
    execution_workers: usize,
    destination_receipt_storage: &'static str,
    ika_signing_assurance: &'static str,
    ika_distributed_signing: bool,
}

pub(crate) fn router() -> Router<AppState> {
    Router::new().route("/version", get(version))
}

async fn version(State(state): State<AppState>) -> Result<Json<VersionResponse>, ApiError> {
    Ok(Json(release_version(&state)))
}

fn release_version(state: &AppState) -> VersionResponse {
    VersionResponse {
        status: "ok",
        service: "clear-msig-backend",
        package_version: env!("CARGO_PKG_VERSION"),
        environment: first_env(&[
            "CLEAR_MSIG_ENV",
            "RAILWAY_ENVIRONMENT_NAME",
            "RAILWAY_ENVIRONMENT",
        ])
        .unwrap_or_else(|| "development".to_string()),
        provider: if env::var_os("RAILWAY_DEPLOYMENT_ID").is_some() {
            "railway"
        } else {
            "unknown"
        },
        commit_sha: first_env(&[
            "CLEAR_MSIG_GIT_COMMIT_SHA",
            "RAILWAY_GIT_COMMIT_SHA",
            "GITHUB_SHA",
        ]),
        build_time: first_env(&["CLEAR_MSIG_BUILD_TIME", "SOURCE_DATE_EPOCH"]),
        deployment_id: first_env(&["RAILWAY_DEPLOYMENT_ID", "CLEAR_MSIG_DEPLOYMENT_ID"]),
        program: ProgramVersion {
            id: state.runner.program_id.clone(),
            network: "solana-devnet",
            rpc_provider: rpc_provider(&state.runner.rpc_url),
            expected_deployed_slot: first_env(&["CLEAR_MSIG_PROGRAM_DEPLOY_SLOT"]),
            expected_artifact_sha256: first_env(&["CLEAR_MSIG_PROGRAM_SO_SHA256"]),
        },
        runtime: RuntimeVersion {
            execution_mode: state.runner.execution_mode(),
            execution_workers: state.runner.worker_limit,
            destination_receipt_storage: state.runner.destination_receipt_storage,
            ika_signing_assurance: state.runner.ika_signing_assurance.label(),
            ika_distributed_signing: state.runner.ika_signing_assurance.is_distributed(),
        },
    }
}

fn rpc_provider(rpc_url: &str) -> &'static str {
    let normalized = rpc_url.to_ascii_lowercase();
    if normalized.contains("alchemy.com") {
        "alchemy"
    } else if normalized.contains("quicknode") {
        "quicknode"
    } else if normalized.contains("helius") {
        "helius"
    } else if normalized.contains("ankr.com") {
        "ankr"
    } else if normalized.contains("solana.com") {
        "solana"
    } else {
        "custom"
    }
}

fn first_env(names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        env::var(name)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

#[cfg(test)]
mod tests {
    use super::{first_env, rpc_provider};

    #[test]
    fn first_env_ignores_empty_values() {
        std::env::set_var("CLEAR_MSIG_TEST_EMPTY", " ");
        std::env::set_var("CLEAR_MSIG_TEST_VALUE", "abc123");
        assert_eq!(
            first_env(&["CLEAR_MSIG_TEST_EMPTY", "CLEAR_MSIG_TEST_VALUE"]).as_deref(),
            Some("abc123")
        );
        std::env::remove_var("CLEAR_MSIG_TEST_EMPTY");
        std::env::remove_var("CLEAR_MSIG_TEST_VALUE");
    }

    #[test]
    fn rpc_provider_never_returns_endpoint_credentials() {
        let endpoint = "https://solana-devnet.g.alchemy.com/v2/private-key";
        let provider = rpc_provider(endpoint);

        assert_eq!(provider, "alchemy");
        assert!(!provider.contains("private-key"));
        assert!(!provider.contains("/v2/"));
        assert!(!provider.contains("://"));
    }
}
