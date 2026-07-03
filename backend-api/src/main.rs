use axum::{
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json, Router,
};
use serde_json::Value;
use std::{
    env,
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use tokio::process::Command;
use tokio::time::timeout;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};
use tracing::{error, info};

mod clearsign;
mod intents;
mod pro;
mod proposals;
mod wallet;

use pro::ProStore;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) runner: Arc<CliRunner>,
    /// Per-pubkey rate limiter for pre-signed writes.
    pub(crate) rate_limiter: Arc<RateLimiter>,
    pub(crate) pro_store: Arc<ProStore>,
}

#[derive(Clone)]
pub(crate) struct CliRunner {
    pub(crate) cli_bin: String,
    pub(crate) base_args: Vec<String>,
    pub(crate) timeout: Duration,
    pub(crate) default_dwallet_program: Option<String>,
    pub(crate) default_grpc_url: Option<String>,
    pub(crate) default_destination_rpc_url: Option<String>,
}

/// Per-pubkey token bucket, tokio-friendly (single Mutex around a
/// HashMap — fine at hackathon scale; we can swap for a sharded store
/// later without changing the trait surface).
pub(crate) struct RateLimiter {
    window: Duration,
    max_per_window: u32,
    buckets: tokio::sync::Mutex<std::collections::HashMap<String, BucketState>>,
}

struct BucketState {
    window_start: std::time::Instant,
    count: u32,
}

impl RateLimiter {
    fn new(window: Duration, max_per_window: u32) -> Self {
        Self {
            window,
            max_per_window,
            buckets: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }

    pub(crate) async fn check(&self, pubkey: &str) -> Result<(), ApiError> {
        let mut buckets = self.buckets.lock().await;
        let now = std::time::Instant::now();
        let state = buckets.entry(pubkey.to_string()).or_insert(BucketState {
            window_start: now,
            count: 0,
        });
        if now.duration_since(state.window_start) > self.window {
            state.window_start = now;
            state.count = 0;
        }
        state.count += 1;
        if state.count > self.max_per_window {
            return Err(ApiError::RateLimited {
                retry_after: self.window - now.duration_since(state.window_start),
                max_per_window: self.max_per_window,
            });
        }
        Ok(())
    }
}

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

impl CliRunner {
    pub(crate) async fn run_json(&self, args: Vec<String>) -> Result<Value, ApiError> {
        let started = std::time::Instant::now();
        let subcommand = cli_subcommand_label(&args);
        let dry_run = args.iter().any(|a| a == "--dry-run");
        let actor_prefix = extract_actor_prefix(&args);

        let mut command = Command::new(&self.cli_bin);
        // Always apply backend-level base args (url/keypair/signer/etc.) first,
        // then append route-specific command args.
        command.args(&self.base_args).args(&args);

        let run_result = timeout(self.timeout, command.output()).await;
        let elapsed_ms = started.elapsed().as_millis() as u64;

        let output = match run_result {
            Err(_) => {
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
            Ok(Err(e)) => {
                tracing::error!(
                    subcommand,
                    dry_run,
                    actor = actor_prefix.as_deref().unwrap_or("-"),
                    elapsed_ms,
                    outcome = "spawn_error",
                    error = %e,
                    "clear-msig CLI invocation"
                );
                return Err(ApiError::Internal(format!("failed to launch command: {e}")));
            }
            Ok(Ok(output)) => output,
        };

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            // Truncate to keep tracing JSON small but still useful —
            // the CLI's anyhow chains can run into KB on a deep error.
            let stderr_preview = stderr.chars().take(800).collect::<String>();
            let stdout_preview = stdout.chars().take(400).collect::<String>();
            tracing::warn!(
                subcommand,
                dry_run,
                actor = actor_prefix.as_deref().unwrap_or("-"),
                elapsed_ms,
                outcome = "cli_error",
                code = output.status.code(),
                stderr = %stderr_preview,
                stdout = %stdout_preview,
                "clear-msig CLI invocation"
            );
            return Err(ApiError::CommandFailed {
                code: output.status.code(),
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

/// Extract a short subcommand label ("wallet create", "proposal approve")
/// from the CLI arg vector — used in structured logs.
fn cli_subcommand_label(args: &[String]) -> String {
    let mut out = Vec::with_capacity(2);
    let mut seen = 0;
    let known = ["wallet", "intent", "proposal", "config"];
    let mut i = 0;
    while i < args.len() && seen < 2 {
        let a = &args[i];
        if a.starts_with("--") {
            // Skip flag + its value (cheap heuristic; all our flags are --key value).
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

/// Return the first 6 chars of the signer pubkey in the argv, if any,
/// for log correlation without leaking the full identity.
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

pub(crate) fn ensure_non_empty(value: &str, field: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    Ok(())
}

pub(crate) fn current_unix_timestamp() -> Result<i64, ApiError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| ApiError::Internal(format!("system clock before unix epoch: {e}")))?;
    i64::try_from(duration.as_secs())
        .map_err(|_| ApiError::Internal("system clock timestamp out of range".into()))
}

pub(crate) fn ensure_hex(value: &str, field: &str) -> Result<(), ApiError> {
    let trimmed = value.trim();
    let hex = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    if hex.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    if hex.len() % 2 != 0 {
        return Err(ApiError::BadRequest(format!(
            "{field} must have an even number of hex characters"
        )));
    }
    if !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ApiError::BadRequest(format!("{field} must be hex encoded")));
    }
    Ok(())
}

pub(crate) fn ensure_hex_exact_len(
    value: &str,
    field: &str,
    expected_bytes: usize,
) -> Result<(), ApiError> {
    ensure_hex(value, field)?;
    let trimmed = value.trim();
    let hex = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    let got = hex.len() / 2;
    if got != expected_bytes {
        return Err(ApiError::BadRequest(format!(
            "{field} must be {expected_bytes} bytes, got {got}"
        )));
    }
    Ok(())
}

/// Intent-template filename validator. The CLI reads this with
/// `fs::read_to_string`, which means an unsanitized value here is
/// a file-existence oracle (and worse, a file-read leak via the
/// CLI's stderr propagation back through `CommandFailed`). We pin
/// to a basename-only allowlist so callers can only reach
/// templates the CLI is expected to load.
///
/// Rules:
///   - Optionally prefixed with `examples/intents/` — the canonical
///     location of the bundled intent templates the frontend sends.
///   - Basename (after the optional prefix) must end in `.json`.
///   - Basename allowed chars: `[A-Za-z0-9._-]` only — no shell
///     metacharacters, no whitespace, no further path separators.
///   - Total length capped at 80 bytes (room for the 17-char prefix
///     + a 63-char basename).
///   - Basename must not be `.` or `..` or start with a `.`.
///
/// SEC-3's earlier basename-only rule rejected the existing
/// frontend payload `examples/intents/btc_transfer.json` and broke
/// every addIntent call. We loosen to a fixed prefix (still
/// untouched by the user — the frontend hard-codes it), and keep
/// the basename validation strict so a file-existence oracle / read
/// leak via stderr can't be smuggled through.
pub(crate) fn ensure_intent_filename(value: &str, field: &str) -> Result<(), ApiError> {
    const ALLOWED_PREFIX: &str = "examples/intents/";

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    if trimmed.len() > 80 {
        return Err(ApiError::BadRequest(format!("{field} too long")));
    }

    let basename = trimmed.strip_prefix(ALLOWED_PREFIX).unwrap_or(trimmed);
    if basename.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    if basename.len() > 63 {
        return Err(ApiError::BadRequest(format!("{field} basename too long")));
    }
    if !basename.ends_with(".json") {
        return Err(ApiError::BadRequest(format!("{field} must end in .json")));
    }
    if basename.starts_with('.') || basename.contains("..") {
        return Err(ApiError::BadRequest(format!("{field} not permitted")));
    }
    if !basename
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err(ApiError::BadRequest(format!(
            "{field} contains disallowed characters"
        )));
    }
    Ok(())
}

/// Solana pubkey validator — base58 32-44 chars, the canonical
/// shape of an ed25519 pubkey on Solana. Tightens the existing
/// `ensure_non_empty` so individual entries in
/// `--proposers` / `--approvers` lists can't smuggle commas (which
/// would inject extra members), spaces, or arbitrary bytes.
pub(crate) fn ensure_base58_pubkey(value: &str, field: &str) -> Result<(), ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    if trimmed.len() < 32 || trimmed.len() > 44 {
        return Err(ApiError::BadRequest(format!(
            "{field} has wrong length for a Solana pubkey"
        )));
    }
    // Bitcoin / IPFS base58 alphabet — same one Solana uses.
    const ALPHABET: &[u8] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if !trimmed.bytes().all(|b| ALPHABET.contains(&b)) {
        return Err(ApiError::BadRequest(format!("{field} is not valid base58")));
    }
    let decoded = bs58::decode(trimmed)
        .into_vec()
        .map_err(|_| ApiError::BadRequest(format!("{field} is not valid base58")))?;
    if decoded.len() != 32 {
        return Err(ApiError::BadRequest(format!(
            "{field} must decode to a 32-byte Solana pubkey"
        )));
    }
    Ok(())
}

pub(crate) fn ensure_non_empty_vec(value: &[String], field: &str) -> Result<(), ApiError> {
    if value.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    if value.iter().any(|v| v.trim().is_empty()) {
        return Err(ApiError::BadRequest(format!(
            "{field} contains an empty value"
        )));
    }
    Ok(())
}

/// Validate a wallet name. The on-chain account stores the name as
/// `String<64>`, so the only hard constraint is the UTF-8 byte length.
/// We previously locked the charset to `[A-Za-z0-9_-]`, but that
/// blocked retail names like "Soccer Trip" / "Mum & Dad" and broke
/// the per-creator suffix the frontend appends for PDA uniqueness.
/// Names reach the CLI via tokio::process::Command::arg, which does
/// no shell expansion, so any UTF-8 string is safe.
///
/// Control characters are still rejected so a malicious caller can't
/// stuff CRLF / NUL into log lines or break the CLI's stderr framing.
pub(crate) fn ensure_wallet_name(value: &str, field: &str) -> Result<(), ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    if trimmed.len() > 64 {
        return Err(ApiError::BadRequest(format!(
            "{field} must be 64 characters or fewer"
        )));
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(ApiError::BadRequest(format!(
            "{field} must not contain control characters"
        )));
    }
    Ok(())
}

/// Validate a chain selector against the explicit allowlist. Anything
/// outside the known set is rejected before reaching the CLI subprocess.
pub(crate) fn ensure_chain(value: &str, field: &str) -> Result<(), ApiError> {
    const ALLOWED: &[&str] = &[
        "solana",
        "evm_1559",
        "evm_1559_erc20",
        "bitcoin_p2wpkh",
        "zcash_transparent",
        "hyperliquid_evm",
        "hyperliquid",
    ];
    let trimmed = value.trim();
    if !ALLOWED.contains(&trimmed) {
        return Err(ApiError::BadRequest(format!(
            "{field} must be one of: {}",
            ALLOWED.join(", ")
        )));
    }
    Ok(())
}

/// Validate a base58-encoded identifier (program ID, proposal PDA,
/// dWallet pubkey). Solana base58 alphabet rejects 0, O, I, l.
pub(crate) fn ensure_base58(
    value: &str,
    field: &str,
    min_len: usize,
    max_len: usize,
) -> Result<(), ApiError> {
    let trimmed = value.trim();
    if trimmed.len() < min_len || trimmed.len() > max_len {
        return Err(ApiError::BadRequest(format!(
            "{field} must be {min_len}–{max_len} characters of base58"
        )));
    }
    const BASE58: &str = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    if !trimmed.chars().all(|c| BASE58.contains(c)) {
        return Err(ApiError::BadRequest(format!(
            "{field} contains characters outside the base58 alphabet"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clearsign::PreSigned;

    #[test]
    fn ensure_chain_accepts_hyperliquid_aliases() {
        ensure_chain("hyperliquid_evm", "chain").unwrap();
        ensure_chain("hyperliquid", "chain").unwrap();
    }

    #[test]
    fn ensure_chain_rejects_unknown_chain() {
        let err = ensure_chain("sui", "chain").unwrap_err();
        match err {
            ApiError::BadRequest(message) => {
                assert!(message.contains("hyperliquid_evm"));
                assert!(message.contains("hyperliquid"));
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn ensure_hex_exact_len_rejects_malformed_signature() {
        let err = ensure_hex_exact_len("abc", "signature", 64).unwrap_err();
        assert!(matches!(err, ApiError::BadRequest(_)));

        let err = ensure_hex_exact_len("00", "signature", 64).unwrap_err();
        match err {
            ApiError::BadRequest(message) => assert!(message.contains("64 bytes")),
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn presigned_rejects_stale_expiry() {
        let ps = PreSigned {
            signer_pubkey: "11111111111111111111111111111111".to_string(),
            signature: "00".repeat(64),
            message_flavor: None,
            params_data_hex: Some("00".to_string()),
            expiry: current_unix_timestamp().unwrap(),
        };
        let err = ps.ensure_valid().unwrap_err();
        match err {
            ApiError::BadRequest(message) => assert!(message.contains("expired")),
            other => panic!("unexpected error: {other:?}"),
        }
    }
}

fn build_runner() -> CliRunner {
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

/// Build the CORS layer applied to every backend route.
///
/// `CLEAR_MSIG_ALLOWED_ORIGIN` is a comma-separated list of exact origins
/// the backend should accept (e.g.
/// `https://clearsig.xyz,https://www.clearsig.xyz`). When set, only those
/// origins can reach the API from a browser tab.
///
/// When unset (development), falls back to `CorsLayer::permissive()` so
/// `npm run dev` against `http://localhost:3001` still works without
/// configuration. Production deployments should always set the env.
fn build_cors_layer() -> CorsLayer {
    let raw = env::var("CLEAR_MSIG_ALLOWED_ORIGIN").ok();
    let trimmed = raw.as_deref().map(str::trim).unwrap_or("");

    if trimmed.is_empty() {
        info!("CORS: permissive (dev mode — set CLEAR_MSIG_ALLOWED_ORIGIN in production)");
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

    info!(
        count = origins.len(),
        "CORS: pinned to allow-list (browsers only — non-browser clients still pass since they don't send Origin)"
    );

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([axum::http::header::CONTENT_TYPE])
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Structured JSON logs on stdout; filter via RUST_LOG.
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "clear_msig_backend_api=info,tower_http=info".into()),
        )
        .with_target(true)
        .init();

    let runner = build_runner();

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

    // Every route here is open. Wallet bootstrap + chain binding do not
    // require an ed25519 multisig signature (those are the bootstrap
    // steps that *create* the proposer/approver list). They're paid by
    // the backend's sponsored-gas keypair just like every other write.
    // Rate limiting on `signer_pubkey` (or IP, for unsigned writes) is
    // the only abuse control.
    let app = Router::new()
        .merge(wallet::router())
        .nest("/v1/clearsign", clearsign::router())
        .nest("/v1/pro", pro::router())
        .merge(intents::router())
        .merge(proposals::router())
        .with_state(state)
        .layer(PropagateRequestIdLayer::x_request_id())
        .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
        .layer(build_cors_layer())
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
