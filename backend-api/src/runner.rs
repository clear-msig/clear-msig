use serde_json::Value;
use std::{env, path::PathBuf, time::Duration};
use tokio::{io::AsyncReadExt, process::Command, time::timeout};

use crate::ApiError;

pub(crate) const MAX_CHILD_OUTPUT_BYTES: u64 = 1024 * 1024;

#[derive(Clone)]
pub(crate) struct CliRunner {
    pub(crate) cli_bin: String,
    pub(crate) base_args: Vec<String>,
    pub(crate) timeout: Duration,
    pub(crate) default_dwallet_program: Option<String>,
    pub(crate) default_grpc_url: Option<String>,
    pub(crate) default_destination_rpc_url: Option<String>,
}

impl CliRunner {
    pub(crate) fn validated_invocation(&self, args: &[String]) -> Result<Vec<String>, ApiError> {
        let invocation = self
            .base_args
            .iter()
            .chain(args.iter())
            .cloned()
            .collect::<Vec<_>>();
        clear_msig_command_contract::validate_invocation_args(&invocation).map_err(|error| {
            ApiError::Internal(format!(
                "backend generated an invalid CLI invocation: {error}"
            ))
        })?;
        Ok(invocation)
    }

    pub(crate) async fn run_json(&self, args: Vec<String>) -> Result<Value, ApiError> {
        let started = std::time::Instant::now();
        let subcommand = cli_subcommand_label(&args);
        let dry_run = args.iter().any(|a| a == "--dry-run");
        let actor_prefix = extract_actor_prefix(&args);

        let invocation = self.validated_invocation(&args)?;

        let mut command = Command::new(&self.cli_bin);
        command
            .args(&invocation)
            .kill_on_drop(true)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| ApiError::Internal(format!("failed to launch command: {error}")))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ApiError::Internal("child process did not expose stdout".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| ApiError::Internal("child process did not expose stderr".into()))?;
        let stdout_task = tokio::spawn(read_bounded(stdout));
        let stderr_task = tokio::spawn(read_bounded(stderr));
        let run_result = timeout(self.timeout, child.wait()).await;
        let elapsed_ms = started.elapsed().as_millis() as u64;

        let status = match run_result {
            Err(_) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                stdout_task.abort();
                stderr_task.abort();
                tracing::warn!(
                    subcommand,
                    dry_run,
                    actor = actor_prefix.as_deref().unwrap_or("-"),
                    elapsed_ms,
                    outcome = "timeout",
                    "clear-msig CLI invocation"
                );
                return Err(ApiError::Timeout(self.timeout));
            }
            Ok(Err(error)) => {
                stdout_task.abort();
                stderr_task.abort();
                tracing::error!(
                    subcommand,
                    dry_run,
                    actor = actor_prefix.as_deref().unwrap_or("-"),
                    elapsed_ms,
                    outcome = "spawn_error",
                    error = %error,
                    "clear-msig CLI invocation"
                );
                return Err(ApiError::Internal(format!(
                    "failed to wait for command: {error}"
                )));
            }
            Ok(Ok(status)) => status,
        };

        let stdout = String::from_utf8_lossy(&join_output(stdout_task).await?).to_string();
        let stderr = String::from_utf8_lossy(&join_output(stderr_task).await?).to_string();

        if !status.success() {
            let stderr_preview = stderr.chars().take(800).collect::<String>();
            let stdout_preview = stdout.chars().take(400).collect::<String>();
            tracing::warn!(
                subcommand,
                dry_run,
                actor = actor_prefix.as_deref().unwrap_or("-"),
                elapsed_ms,
                outcome = "cli_error",
                code = status.code(),
                stderr = %stderr_preview,
                stdout = %stdout_preview,
                "clear-msig CLI invocation"
            );
            return Err(ApiError::CommandFailed {
                code: status.code(),
                stderr,
                stdout,
            });
        }

        let parsed = serde_json::from_str::<Value>(&stdout)
            .map_err(|e| ApiError::InvalidOutput(format!("stdout is not valid JSON: {e}")));

        tracing::info!(
            subcommand,
            dry_run,
            actor = actor_prefix.as_deref().unwrap_or("-"),
            elapsed_ms,
            outcome = if parsed.is_ok() {
                "ok"
            } else {
                "invalid_output"
            },
            "clear-msig CLI invocation"
        );

        parsed
    }
}

async fn read_bounded<R>(reader: R) -> std::io::Result<Vec<u8>>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut bytes = Vec::new();
    reader
        .take(MAX_CHILD_OUTPUT_BYTES + 1)
        .read_to_end(&mut bytes)
        .await?;
    Ok(bytes)
}

async fn join_output(
    task: tokio::task::JoinHandle<std::io::Result<Vec<u8>>>,
) -> Result<Vec<u8>, ApiError> {
    let bytes = task
        .await
        .map_err(|error| ApiError::Internal(format!("child output task failed: {error}")))?
        .map_err(|error| ApiError::Internal(format!("failed to read child output: {error}")))?;
    if bytes.len() as u64 > MAX_CHILD_OUTPUT_BYTES {
        return Err(ApiError::InvalidOutput(format!(
            "child output exceeded {MAX_CHILD_OUTPUT_BYTES} bytes"
        )));
    }
    Ok(bytes)
}

pub(crate) fn build_runner() -> CliRunner {
    let workspace_root = env::var("CLEAR_MSIG_WORKSPACE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let default_cli = workspace_root
        .join("target")
        .join("debug")
        .join("clear-msig");
    let cli_bin = env::var("CLEAR_MSIG_BIN")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| default_cli.to_string_lossy().to_string());

    let mut base_args = Vec::new();

    if let Ok(url) = env::var("CLEAR_MSIG_URL") {
        if !url.trim().is_empty() {
            base_args.push("--url".to_string());
            base_args.push(url);
        }
    }
    if let Ok(keypair) = env::var("CLEAR_MSIG_KEYPAIR") {
        if !keypair.trim().is_empty() {
            base_args.push("--keypair".to_string());
            base_args.push(keypair);
        }
    }
    if let Ok(signer) = env::var("CLEAR_MSIG_SIGNER") {
        if !signer.trim().is_empty() {
            base_args.push("--signer".to_string());
            base_args.push(signer);
        }
    }

    let timeout_secs = env::var("CLEAR_MSIG_CMD_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(120);

    let default_dwallet_program = env::var("CLEAR_MSIG_DEFAULT_DWALLET_PROGRAM")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let default_grpc_url = env::var("CLEAR_MSIG_DEFAULT_GRPC_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let default_destination_rpc_url = env::var("CLEAR_MSIG_DEFAULT_DEST_RPC_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    CliRunner {
        cli_bin,
        base_args,
        timeout: Duration::from_secs(timeout_secs),
        default_dwallet_program,
        default_grpc_url,
        default_destination_rpc_url,
    }
}

fn cli_subcommand_label(args: &[String]) -> String {
    let mut out = Vec::with_capacity(2);
    let mut seen = 0;
    let known = ["wallet", "intent", "proposal", "config"];
    let mut i = 0;
    while i < args.len() && seen < 2 {
        let a = &args[i];
        if a.starts_with("--") {
            i += 2;
            continue;
        }
        if seen == 0 && !known.contains(&a.as_str()) {
            i += 1;
            continue;
        }
        out.push(a.as_str());
        seen += 1;
        i += 1;
    }
    if out.is_empty() {
        "-".into()
    } else {
        out.join(" ")
    }
}

fn extract_actor_prefix(args: &[String]) -> Option<String> {
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if a == "--signer-pubkey" {
            if let Some(v) = it.next() {
                return Some(v.chars().take(6).collect());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{join_output, read_bounded, MAX_CHILD_OUTPUT_BYTES};
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    async fn rejects_child_output_above_the_process_boundary_limit() {
        let capacity = (MAX_CHILD_OUTPUT_BYTES + 1) as usize;
        let (mut writer, reader) = tokio::io::duplex(capacity);
        let read_task = tokio::spawn(read_bounded(reader));
        writer.write_all(&vec![b'x'; capacity]).await.unwrap();
        drop(writer);

        assert!(join_output(read_task).await.is_err());
    }
}
