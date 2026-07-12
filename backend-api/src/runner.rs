use serde_json::Value;
use std::{env, sync::Arc, time::Duration};
use tokio::{sync::Semaphore, time::timeout};

use crate::ApiError;

const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const DEFAULT_WORKER_LIMIT: usize = 8;

#[derive(Clone)]
pub(crate) struct CliRunner {
    pub(crate) base_args: Vec<String>,
    execution_globals: clear_msig_cli::config::CliGlobals,
    pub(crate) timeout: Duration,
    pub(crate) worker_limit: usize,
    workers: Arc<Semaphore>,
    pub(crate) default_dwallet_program: Option<String>,
    pub(crate) default_grpc_url: Option<String>,
    pub(crate) default_destination_rpc_url: Option<String>,
}

impl CliRunner {
    pub(crate) fn execution_mode(&self) -> &'static str {
        "in_process_bounded"
    }

    pub(crate) fn prepare_request(
        &self,
        args: &[String],
    ) -> Result<clear_msig_cli::ExecutionRequest, ApiError> {
        let invocation = self
            .base_args
            .iter()
            .chain(args.iter())
            .cloned()
            .collect::<Vec<_>>();
        clear_msig_cli::prepare_execution(&invocation).map_err(|error| {
            ApiError::Internal(format!(
                "backend generated an invalid core invocation: {error}"
            ))
        })
    }

    pub(crate) async fn run_json(&self, args: Vec<String>) -> Result<Value, ApiError> {
        let subcommand = cli_subcommand_label(&args);
        let dry_run = args.iter().any(|argument| argument == "--dry-run");
        let actor_prefix = extract_actor_prefix(&args);
        let request = self.prepare_request(&args)?;
        self.run_request(request, subcommand, dry_run, actor_prefix)
            .await
    }

    pub(crate) async fn run_typed_proposal(
        &self,
        execution: clear_msig_cli::TypedProposalExecution,
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
        context: clear_msig_cli::TypedExecutionContext,
        lifecycle: clear_msig_cli::TypedProposalLifecycle,
    ) -> Result<Value, ApiError> {
        let subcommand = lifecycle.label().to_string();
        let dry_run = matches!(
            context,
            clear_msig_cli::TypedExecutionContext::DryRun { .. }
        );
        let actor_prefix = match &context {
            clear_msig_cli::TypedExecutionContext::DryRun { actor_pubkey } => actor_pubkey
                .as_deref()
                .map(|value| value.chars().take(6).collect()),
            clear_msig_cli::TypedExecutionContext::PreSigned { signer_pubkey, .. } => {
                Some(signer_pubkey.chars().take(6).collect())
            }
            clear_msig_cli::TypedExecutionContext::Backend => None,
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
        context: clear_msig_cli::DirectExecutionContext,
        command: clear_msig_cli::DirectCommand,
    ) -> Result<Value, ApiError> {
        let subcommand = command.label().to_string();
        let dry_run = matches!(
            context,
            clear_msig_cli::DirectExecutionContext::DryRun { .. }
        );
        let actor_prefix = match &context {
            clear_msig_cli::DirectExecutionContext::DryRun { actor_pubkey } => actor_pubkey
                .as_deref()
                .map(|value| value.chars().take(6).collect()),
            clear_msig_cli::DirectExecutionContext::PreSigned { signer_pubkey, .. } => {
                Some(signer_pubkey.chars().take(6).collect())
            }
            clear_msig_cli::DirectExecutionContext::Backend => None,
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

        let execution = async move {
            let permit = workers
                .acquire_owned()
                .await
                .map_err(|_| ApiError::Internal("in-process execution pool is closed".into()))?;
            tokio::task::spawn_blocking(move || {
                let _permit = permit;
                clear_msig_cli::execute_request(request)
            })
            .await
            .map_err(|error| ApiError::Internal(format!("execution worker failed: {error}")))?
            .map_err(|error| ApiError::CommandFailed {
                code: None,
                stderr: format!("{error:#}"),
                stdout: String::new(),
            })
        };

        let result = timeout(self.timeout, execution).await;
        let elapsed_ms = started.elapsed().as_millis() as u64;
        let value = match result {
            Err(_) => {
                tracing::warn!(
                    subcommand,
                    dry_run,
                    actor = actor_prefix.as_deref().unwrap_or("-"),
                    elapsed_ms,
                    outcome = "timeout_worker_continues_bounded",
                    "clear-msig in-process invocation"
                );
                return Err(ApiError::Timeout(self.timeout));
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
                return Err(error);
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
    let mut base_args = Vec::new();
    push_optional_global(&mut base_args, "--url", url);
    push_optional_global(&mut base_args, "--keypair", keypair);
    push_optional_global(&mut base_args, "--signer", signer);

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
        base_args,
        execution_globals,
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

fn push_optional_global(args: &mut Vec<String>, flag: &str, value: Option<String>) {
    if let Some(value) = value {
        args.push(flag.to_string());
        args.push(value);
    }
}

fn cli_subcommand_label(args: &[String]) -> String {
    let mut output = Vec::with_capacity(2);
    let mut seen = 0;
    let known = ["wallet", "intent", "proposal", "config"];
    let mut index = 0;
    while index < args.len() && seen < 2 {
        let argument = &args[index];
        if argument.starts_with("--") {
            index += 2;
            continue;
        }
        if seen == 0 && !known.contains(&argument.as_str()) {
            index += 1;
            continue;
        }
        output.push(argument.as_str());
        seen += 1;
        index += 1;
    }
    if output.is_empty() {
        "-".into()
    } else {
        output.join(" ")
    }
}

fn extract_actor_prefix(args: &[String]) -> Option<String> {
    let mut arguments = args.iter();
    while let Some(argument) = arguments.next() {
        if argument == "--signer-pubkey" {
            if let Some(value) = arguments.next() {
                return Some(value.chars().take(6).collect());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{build_runner, validate_response_size, MAX_RESPONSE_BYTES};

    #[test]
    fn rejects_structured_responses_above_the_boundary_limit() {
        let value = serde_json::json!({ "data": "x".repeat(MAX_RESPONSE_BYTES) });
        assert!(validate_response_size(&value).is_err());
    }

    #[tokio::test]
    async fn executes_config_show_without_a_child_process() {
        let runner = build_runner();
        let value = runner
            .run_json(vec!["config".into(), "show".into()])
            .await
            .unwrap();
        assert!(value.get("config_path").is_some());
        assert_eq!(runner.execution_mode(), "in_process_bounded");
    }
}
