use serde_json::Value;
use std::{env, sync::Arc, time::Duration};
use tokio::{sync::Semaphore, time::timeout};

use crate::ApiError;

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const DEFAULT_WORKER_LIMIT: usize = 8;
const CANCELLATION_DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone)]
pub(crate) struct CliRunner {
    execution_globals: clear_msig_cli::config::CliGlobals,
    pub(crate) rpc_url: String,
    pub(crate) program_id: String,
    pub(crate) timeout: Duration,
    pub(crate) worker_limit: usize,
    workers: Arc<Semaphore>,
    pub(crate) default_dwallet_program: Option<String>,
    pub(crate) default_grpc_url: Option<String>,
    pub(crate) default_destination_rpc_url: Option<String>,
}

impl CliRunner {
    pub(crate) fn execution_mode(&self) -> &'static str {
        "in_process_cancellable"
    }

    pub(crate) async fn run_typed_proposal(
        &self,
        execution: clear_msig_command_contract::TypedProposalExecution,
    ) -> Result<Value, ApiError> {
        let subcommand = execution.label().to_string();
        let request = clear_msig_cli::prepare_typed_proposal_execution(
            self.execution_globals.clone(),
            execution,
        )
        .map_err(|error| {
            ApiError::Internal(format!(
                "backend generated an invalid typed execution: {error}"
            ))
        })?;
        self.run_request(request, subcommand, false, None).await
    }

    pub(crate) async fn run_typed_lifecycle(
        &self,
        context: clear_msig_command_contract::TypedExecutionContext,
        lifecycle: clear_msig_command_contract::TypedProposalLifecycle,
    ) -> Result<Value, ApiError> {
        let subcommand = lifecycle.label().to_string();
        let dry_run = matches!(
            context,
            clear_msig_command_contract::TypedExecutionContext::DryRun { .. }
        );
        let actor_prefix = match &context {
            clear_msig_command_contract::TypedExecutionContext::DryRun { actor_pubkey } => {
                actor_pubkey
                    .as_deref()
                    .map(|value| value.chars().take(6).collect())
            }
            clear_msig_command_contract::TypedExecutionContext::PreSigned {
                signer_pubkey, ..
            } => Some(signer_pubkey.chars().take(6).collect()),
            clear_msig_command_contract::TypedExecutionContext::Backend => None,
        };
        let request = clear_msig_cli::prepare_typed_proposal_lifecycle(
            self.execution_globals.clone(),
            context,
            lifecycle,
        )
        .map_err(|error| {
            ApiError::Internal(format!(
                "backend generated an invalid typed lifecycle: {error}"
            ))
        })?;
        self.run_request(request, subcommand, dry_run, actor_prefix)
            .await
    }

    pub(crate) async fn run_direct(
        &self,
        context: clear_msig_command_contract::DirectExecutionContext,
        command: clear_msig_command_contract::DirectCommand,
    ) -> Result<Value, ApiError> {
        let subcommand = command.label().to_string();
        let dry_run = matches!(
            context,
            clear_msig_command_contract::DirectExecutionContext::DryRun { .. }
        );
        let actor_prefix = match &context {
            clear_msig_command_contract::DirectExecutionContext::DryRun { actor_pubkey } => {
                actor_pubkey
                    .as_deref()
                    .map(|value| value.chars().take(6).collect())
            }
            clear_msig_command_contract::DirectExecutionContext::PreSigned {
                signer_pubkey,
                ..
            } => Some(signer_pubkey.chars().take(6).collect()),
            clear_msig_command_contract::DirectExecutionContext::Backend => None,
        };
        let request = clear_msig_cli::prepare_direct_command(
            self.execution_globals.clone(),
            context,
            command,
        )
        .map_err(|error| {
            ApiError::Internal(format!(
                "backend generated an invalid direct command: {error}"
            ))
        })?;
        self.run_request(request, subcommand, dry_run, actor_prefix)
            .await
    }

    async fn run_request(
        &self,
        request: clear_msig_cli::ExecutionRequest,
        subcommand: String,
        dry_run: bool,
        actor_prefix: Option<String>,
    ) -> Result<Value, ApiError> {
        let started = std::time::Instant::now();
        let workers = self.workers.clone();
        let permit = timeout(self.timeout, workers.acquire_owned())
            .await
            .map_err(|_| ApiError::Timeout(self.timeout))?
            .map_err(|_| ApiError::Internal("in-process execution pool is closed".into()))?;
        let control = request.cancellation_handle();
        let mut worker = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            clear_msig_cli::execute_request(request)
        });
        let remaining = self.timeout.saturating_sub(started.elapsed());
        let result = match timeout(remaining, &mut worker).await {
            Ok(result) => Some(result),
            Err(_) => {
                control.cancel();
                let drained = timeout(CANCELLATION_DRAIN_TIMEOUT, &mut worker)
                    .await
                    .is_ok();
                tracing::warn!(
                    subcommand,
                    dry_run,
                    actor = actor_prefix.as_deref().unwrap_or("-"),
                    elapsed_ms = started.elapsed().as_millis() as u64,
                    drained,
                    outcome = "timeout_cancelled",
                    "clear-msig in-process invocation"
                );
                return Err(ApiError::Timeout(self.timeout));
            }
        };
        let elapsed_ms = started.elapsed().as_millis() as u64;
        let value = match result.expect("completed worker result") {
            Err(error) => {
                return Err(ApiError::Internal(format!(
                    "execution worker failed: {error}"
                )));
            }
            Ok(Err(error)) => {
                tracing::warn!(
                    subcommand,
                    dry_run,
                    actor = actor_prefix.as_deref().unwrap_or("-"),
                    elapsed_ms,
                    outcome = "execution_error",
                    error = %error,
                    "clear-msig in-process invocation"
                );
                return Err(ApiError::CommandFailed {
                    code: None,
                    stderr: format!("{error:#}"),
                    stdout: String::new(),
                });
            }
            Ok(Ok(value)) => value,
        };

        validate_response_size(&value)?;
        tracing::info!(
            subcommand,
            dry_run,
            actor = actor_prefix.as_deref().unwrap_or("-"),
            elapsed_ms,
            outcome = "ok",
            "clear-msig in-process invocation"
        );
        Ok(value)
    }
}

fn validate_response_size(value: &Value) -> Result<(), ApiError> {
    let size = serde_json::to_vec(value)
        .map_err(|error| ApiError::InvalidOutput(format!("response is not serializable: {error}")))?
        .len();
    if size > MAX_RESPONSE_BYTES {
        return Err(ApiError::InvalidOutput(format!(
            "in-process response exceeded {MAX_RESPONSE_BYTES} bytes"
        )));
    }
    Ok(())
}

pub(crate) fn build_runner() -> CliRunner {
    let url = non_empty_env("CLEAR_MSIG_URL");
    let keypair = non_empty_env("CLEAR_MSIG_KEYPAIR");
    let signer = non_empty_env("CLEAR_MSIG_SIGNER");
    let execution_globals = clear_msig_cli::config::CliGlobals {
        url: url.clone(),
        keypair: keypair.clone(),
        signer: signer.clone(),
        ..Default::default()
    };
    let rpc_url = url.unwrap_or_else(|| {
        "https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH".to_string()
    });
    let program_id = non_empty_env("CLEAR_MSIG_PROGRAM_ID")
        .unwrap_or_else(|| "53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v".to_string());

    let timeout_secs = env::var("CLEAR_MSIG_CMD_TIMEOUT_SECS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(120);
    let worker_limit = env::var("CLEAR_MSIG_EXECUTION_WORKERS")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_WORKER_LIMIT);

    let default_dwallet_program = env::var("CLEAR_MSIG_DEFAULT_DWALLET_PROGRAM")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let default_grpc_url = env::var("CLEAR_MSIG_DEFAULT_GRPC_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let default_destination_rpc_url = env::var("CLEAR_MSIG_DEFAULT_DEST_RPC_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    CliRunner {
        execution_globals,
        rpc_url,
        program_id,
        timeout: Duration::from_secs(timeout_secs),
        worker_limit,
        workers: Arc::new(Semaphore::new(worker_limit)),
        default_dwallet_program,
        default_grpc_url,
        default_destination_rpc_url,
    }
}

fn non_empty_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::{build_runner, validate_response_size, MAX_RESPONSE_BYTES};

    #[test]
    fn rejects_structured_responses_above_the_boundary_limit() {
        let value = serde_json::json!({ "data": "x".repeat(MAX_RESPONSE_BYTES) });
        assert!(validate_response_size(&value).is_err());
    }

    #[test]
    fn exposes_typed_runtime_network_configuration() {
        let runner = build_runner();
        assert!(!runner.rpc_url.is_empty());
        assert!(!runner.program_id.is_empty());
        assert_eq!(runner.execution_mode(), "in_process_cancellable");
    }
}
