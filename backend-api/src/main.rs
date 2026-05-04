use axum::{
    extract::{Path, Query, State},
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::{env, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};
use thiserror::Error;
use tokio::process::Command;
use tokio::time::timeout;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};
use tracing::{error, info};

#[derive(Clone)]
struct AppState {
    runner: Arc<CliRunner>,
    /// Per-pubkey rate limiter for pre-signed writes.
    rate_limiter: Arc<RateLimiter>,
}

#[derive(Clone)]
struct CliRunner {
    cli_bin: String,
    base_args: Vec<String>,
    timeout: Duration,
    default_dwallet_program: Option<String>,
    default_grpc_url: Option<String>,
    default_destination_rpc_url: Option<String>,
}

/// Bundle of pre-signed flags that the browser produces. `params_data_hex`
/// is optional because approve/cancel read params_data from the on-chain
/// Proposal account instead of taking it from the caller.
#[derive(Debug, Deserialize)]
struct PreSigned {
    /// Base58-encoded ed25519 public key of the signer.
    signer_pubkey: String,
    /// Hex-encoded 64-byte ed25519 signature.
    signature: String,
    /// Hex-encoded bytes the caller serialized into the message. Optional
    /// for approve/cancel; required for propose / intent add / update.
    #[serde(default)]
    params_data_hex: Option<String>,
    /// Unix timestamp at which the signed message expires. MUST match the
    /// `expiry` the CLI builds into the message, or the PreSignedMessageSigner
    /// verification step fails.
    expiry: i64,
}

impl PreSigned {
    fn ensure_valid(&self) -> Result<(), ApiError> {
        ensure_non_empty(&self.signer_pubkey, "signer_pubkey")?;
        ensure_non_empty(&self.signature, "signature")?;
        if let Some(p) = &self.params_data_hex {
            ensure_non_empty(p, "params_data_hex")?;
        }
        if self.expiry <= 0 {
            return Err(ApiError::BadRequest(
                "expiry must be a positive unix timestamp".into(),
            ));
        }
        Ok(())
    }

    /// A 6-character prefix of the signer pubkey, for structured-log
    /// correlation without leaking the full identity.
    fn actor_prefix(&self) -> String {
        self.signer_pubkey.chars().take(6).collect()
    }
}

/// Append global pre-signed flags to a CLI args vec. Called by every
/// handler that forwards a browser signature to the CLI.
fn push_pre_signed_flags(args: &mut Vec<String>, ps: &PreSigned) {
    args.push("--signer-pubkey".into());
    args.push(ps.signer_pubkey.clone());
    args.push("--signature".into());
    args.push(ps.signature.clone());
    if let Some(hex) = &ps.params_data_hex {
        args.push("--params-data".into());
        args.push(hex.clone());
    }
}

/// Per-pubkey token bucket, tokio-friendly (single Mutex around a
/// HashMap — fine at hackathon scale; we can swap for a sharded store
/// later without changing the trait surface).
struct RateLimiter {
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

    async fn check(&self, pubkey: &str) -> Result<(), ApiError> {
        let mut buckets = self.buckets.lock().await;
        let now = std::time::Instant::now();
        let state = buckets
            .entry(pubkey.to_string())
            .or_insert(BucketState { window_start: now, count: 0 });
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
enum ApiError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("rate limited")]
    RateLimited { retry_after: Duration, max_per_window: u32 },
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
            ApiError::RateLimited { retry_after, max_per_window } => serde_json::json!({
                "error": format!(
                    "rate limit exceeded ({max_per_window} per window); retry in {}s",
                    retry_after.as_secs()
                ),
                "kind": "rate_limited",
                "retry_after_secs": retry_after.as_secs(),
            }),
            ApiError::CommandFailed { code, stderr, stdout } => serde_json::json!({
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
    async fn run_json(&self, args: Vec<String>) -> Result<Value, ApiError> {
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
            outcome = if parsed.is_ok() { "ok" } else { "invalid_output" },
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
    if out.is_empty() { "-".into() } else { out.join(" ") }
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

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    cli_bin: String,
}

#[derive(Deserialize)]
struct CreateWalletRequest {
    name: String,
    proposers: Vec<String>,
    approvers: Vec<String>,
    threshold: u8,
    cancellation_threshold: Option<u8>,
    timelock: Option<u32>,
    /// Encrypt ciphertext identifiers covering the policy fields
    /// (proposers / approvers / threshold). Forward-compat: today
    /// the CLI logs them and continues with plaintext; once the
    /// program adopts `#[encrypt_fn]` handlers these IDs replace
    /// the plaintext fields in the on-chain instruction.
    #[serde(default)]
    policy_ciphertexts: Vec<String>,
}

#[derive(Deserialize)]
struct AddChainRequest {
    chain: String,
    dwallet_program: Option<String>,
    grpc_url: Option<String>,
    existing_dwallet_pubkey: Option<String>,
    existing_dwallet_addr: Option<String>,
}

#[derive(Deserialize)]
struct ChainsQuery {
    dwallet_program: Option<String>,
}

// ── Submit shapes ──
//
// Every write route that on-chain requires an ed25519 signature takes a
// `PreSigned` blob. The browser computes the message client-side (or via
// `/prepare/*` — see the "Dry-run shapes" block below), signs it with the
// user's wallet, and posts the signature here.

#[derive(Deserialize)]
struct SignedIntentAddRequest {
    /// Path to an intent JSON file the CLI can read. For hackathon-grade
    /// simplicity we keep file-path input; Phase 3 will switch to inline
    /// JSON once the frontend builds the intent definition client-side.
    file: String,
    #[serde(flatten)]
    pre_signed: PreSigned,
}

#[derive(Deserialize)]
struct SignedIntentRemoveRequest {
    index: u8,
    #[serde(flatten)]
    pre_signed: PreSigned,
}

#[derive(Deserialize)]
struct SignedIntentUpdateRequest {
    index: u8,
    file: String,
    #[serde(flatten)]
    pre_signed: PreSigned,
}

#[derive(Deserialize)]
struct SignedProposalCreateRequest {
    intent_index: u8,
    #[serde(flatten)]
    pre_signed: PreSigned,
}

#[derive(Deserialize)]
struct SignedApproveCancelRequest {
    #[serde(flatten)]
    pre_signed: PreSigned,
}

// ── Dry-run shapes ──
//
// These are the inputs for `/prepare/*` routes. No signature yet; the
// backend forwards to the CLI with `--dry-run` and returns the
// DryRunDescriptor so the browser knows exactly which bytes to sign.

#[derive(Deserialize)]
struct PrepareIntentAddRequest {
    file: String,
    proposers: Vec<String>,
    approvers: Vec<String>,
    threshold: u8,
    cancellation_threshold: Option<u8>,
    timelock: Option<u32>,
    expiry: Option<String>,
    /// See `CreateWalletRequest::policy_ciphertexts`.
    #[serde(default)]
    policy_ciphertexts: Vec<String>,
}

#[derive(Deserialize)]
struct PrepareIntentRemoveRequest {
    index: u8,
    expiry: Option<String>,
}

#[derive(Deserialize)]
struct PrepareIntentUpdateRequest {
    index: u8,
    file: String,
    proposers: Vec<String>,
    approvers: Vec<String>,
    threshold: u8,
    cancellation_threshold: Option<u8>,
    timelock: Option<u32>,
    expiry: Option<String>,
    /// See `CreateWalletRequest::policy_ciphertexts`.
    #[serde(default)]
    policy_ciphertexts: Vec<String>,
}

#[derive(Deserialize)]
struct PrepareProposalCreateRequest {
    intent_index: u8,
    params: Vec<String>,
    expiry: Option<String>,
    /// Connected wallet's pubkey. Forwarded to the CLI as
    /// `--signer-pubkey` so the proposer / approver validation runs
    /// against the user's identity, not the relayer's filesystem
    /// keypair. Optional only for back-compat — without it the CLI
    /// falls back to its own keypair and any subsequent in-list
    /// check fails.
    actor_pubkey: Option<String>,
}

#[derive(Deserialize)]
struct PrepareApproveCancelRequest {
    expiry: Option<String>,
    /// See `PrepareProposalCreateRequest::actor_pubkey`.
    actor_pubkey: Option<String>,
}

#[derive(Deserialize)]
struct ExecuteProposalRequest {
    dwallet_program: Option<String>,
    grpc_url: Option<String>,
    rpc_url: Option<String>,
    broadcast: Option<bool>,
}

#[derive(Deserialize)]
struct MembershipQuery {
    address: String,
}

#[derive(Serialize)]
struct MembershipResponse {
    organizations: Vec<OrganizationMembership>,
}

#[derive(Serialize)]
struct OrganizationMembership {
    wallet: String,
    wallet_name: Option<String>,
    /// Pubkey (base58) of the address that created this wallet. Added
    /// 2026-05-03 with the creator-scoped PDA upgrade so the frontend
    /// can use the fast PDA-derivation path on subsequent reads.
    wallet_creator: Option<String>,
    roles: Vec<String>,
    intent_indexes: Vec<u8>,
}

#[derive(Deserialize)]
struct RpcConfigResponse {
    #[allow(dead_code)]
    commitment: Option<String>,
}

#[derive(Deserialize)]
struct RpcProgramAccountsResponse {
    result: Vec<RpcProgramAccount>,
}

#[derive(Deserialize)]
struct RpcProgramAccount {
    pubkey: String,
    account: RpcProgramAccountData,
}

#[derive(Deserialize)]
struct RpcProgramAccountData {
    data: (String, String),
}

#[derive(Default)]
struct MembershipAccumulator {
    wallet_name: Option<String>,
    wallet_creator: Option<String>,
    has_proposer: bool,
    has_approver: bool,
    intent_indexes: HashSet<u8>,
}

fn decode_base64_data(encoded: &str) -> Result<Vec<u8>, ApiError> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| ApiError::InvalidOutput(format!("invalid base64 account data: {e}")))
}

fn read_u8(data: &[u8], offset: &mut usize) -> Result<u8, ApiError> {
    let value = *data
        .get(*offset)
        .ok_or_else(|| ApiError::InvalidOutput(format!("unexpected EOF at {offset}")))?;
    *offset += 1;
    Ok(value)
}

fn read_u16_le(data: &[u8], offset: &mut usize) -> Result<u16, ApiError> {
    let bytes: [u8; 2] = data
        .get(*offset..*offset + 2)
        .ok_or_else(|| ApiError::InvalidOutput("unexpected EOF reading u16".into()))?
        .try_into()
        .map_err(|_| ApiError::InvalidOutput("invalid u16 slice".into()))?;
    *offset += 2;
    Ok(u16::from_le_bytes(bytes))
}

fn read_u32_le(data: &[u8], offset: &mut usize) -> Result<u32, ApiError> {
    let bytes: [u8; 4] = data
        .get(*offset..*offset + 4)
        .ok_or_else(|| ApiError::InvalidOutput("unexpected EOF reading u32".into()))?
        .try_into()
        .map_err(|_| ApiError::InvalidOutput("invalid u32 slice".into()))?;
    *offset += 4;
    Ok(u32::from_le_bytes(bytes))
}

fn read_address_bs58(data: &[u8], offset: &mut usize) -> Result<String, ApiError> {
    let bytes = data
        .get(*offset..*offset + 32)
        .ok_or_else(|| ApiError::InvalidOutput("unexpected EOF reading address".into()))?;
    *offset += 32;
    Ok(bs58::encode(bytes).into_string())
}

fn read_vec_addresses(data: &[u8], offset: &mut usize) -> Result<Vec<String>, ApiError> {
    let count = read_u32_le(data, offset)? as usize;
    let mut addresses = Vec::with_capacity(count);
    for _ in 0..count {
        addresses.push(read_address_bs58(data, offset)?);
    }
    Ok(addresses)
}

fn skip_raw_vec(data: &[u8], offset: &mut usize, element_size: usize) -> Result<(), ApiError> {
    let count = read_u32_le(data, offset)? as usize;
    let total = count
        .checked_mul(element_size)
        .ok_or_else(|| ApiError::InvalidOutput("overflow computing vec byte length".into()))?;
    let _ = data
        .get(*offset..*offset + total)
        .ok_or_else(|| ApiError::InvalidOutput("unexpected EOF skipping raw vec".into()))?;
    *offset += total;
    Ok(())
}

fn skip_u8_vec(data: &[u8], offset: &mut usize) -> Result<(), ApiError> {
    let count = read_u32_le(data, offset)? as usize;
    let _ = data
        .get(*offset..*offset + count)
        .ok_or_else(|| ApiError::InvalidOutput("unexpected EOF skipping byte vec".into()))?;
    *offset += count;
    Ok(())
}

/// Parse just the wallet name (and creator) from a serialized
/// ClearWallet account. Layout post creator-scoped PDA upgrade:
///
///   disc(1) + bump(1) + proposal_index(8) + intent_index(1)
///   + creator(32) + name_len(4) + name(...)
///
/// The creator field was added 2026-05-03; the offset shift is the
/// most likely source of "wallet name decodes as junk" if the
/// program is upgraded but this parser isn't.
fn parse_wallet_name(data: &[u8]) -> Result<Option<(String, String)>, ApiError> {
    if data.first().copied() != Some(1) {
        return Ok(None);
    }

    let mut offset = 1;
    let _bump = read_u8(data, &mut offset)?;
    offset += 8; // proposal_index
    let _intent_index = read_u8(data, &mut offset)?;
    let creator = read_address_bs58(data, &mut offset)?;
    let name_len = read_u32_le(data, &mut offset)? as usize;
    let name_bytes = data
        .get(offset..offset + name_len)
        .ok_or_else(|| ApiError::InvalidOutput("unexpected EOF reading wallet name".into()))?;
    let name = String::from_utf8_lossy(name_bytes).to_string();
    Ok(Some((name, creator)))
}

fn parse_intent_membership(data: &[u8]) -> Result<Option<(String, u8, Vec<String>, Vec<String>)>, ApiError> {
    if data.first().copied() != Some(2) {
        return Ok(None);
    }

    let mut offset = 1;
    let wallet = read_address_bs58(data, &mut offset)?;
    let _bump = read_u8(data, &mut offset)?;
    let intent_index = read_u8(data, &mut offset)?;
    let _intent_type = read_u8(data, &mut offset)?;
    let _chain_kind = read_u8(data, &mut offset)?;
    let _approved = read_u8(data, &mut offset)?;
    let _approval_threshold = read_u8(data, &mut offset)?;
    let _cancellation_threshold = read_u8(data, &mut offset)?;
    offset += 4; // timelock_seconds
    let _template_offset = read_u16_le(data, &mut offset)?;
    let _template_len = read_u16_le(data, &mut offset)?;
    let _tx_template_offset = read_u16_le(data, &mut offset)?;
    let _tx_template_len = read_u16_le(data, &mut offset)?;
    let _active_proposal_count = read_u16_le(data, &mut offset)?;

    let proposers = read_vec_addresses(data, &mut offset)?;
    let approvers = read_vec_addresses(data, &mut offset)?;

    // Struct sizes must match programs/clear-wallet/src/utils/definition.rs
    // exactly (all #[repr(C)] with alignment-1 PodU16/PodU64, so the layouts
    // are tight-packed). Drift here silently corrupts the membership scan
    // for any wallet that has a custom intent with non-empty vectors.
    skip_raw_vec(data, &mut offset, 14)?; // ParamEntry   = u8+PodU16+PodU16+u8+PodU64
    skip_raw_vec(data, &mut offset, 7)?;  // AccountEntry = bool+bool+u8+PodU16+PodU16
    skip_raw_vec(data, &mut offset, 9)?;  // InstructionEntry = u8 + 4*PodU16
    skip_raw_vec(data, &mut offset, 5)?;  // DataSegmentEntry = u8 + 2*PodU16
    skip_raw_vec(data, &mut offset, 5)?;  // SeedEntry        = u8 + 2*PodU16
    skip_u8_vec(data, &mut offset)?; // byte_pool

    Ok(Some((wallet, intent_index, proposers, approvers)))
}

/// Fetch program accounts matching a single-byte discriminator at offset 0.
///
/// We use `memcmp` with `{offset: 0, bytes: <b58(disc)>}` so the RPC
/// filters server-side, dropping proposal / ika_config / dwallet_ownership
/// accounts before they hit our deserialiser. On devnet with many wallets
/// this is the difference between a 50 KiB and a 5 MiB response per
/// `/memberships` call.
async fn fetch_program_accounts_by_disc(
    rpc_url: &str,
    program_id: &str,
    discriminator: u8,
) -> Result<Vec<RpcProgramAccount>, ApiError> {
    let client = reqwest::Client::new();
    let disc_bytes_b58 = bs58::encode([discriminator]).into_string();
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getProgramAccounts",
        "params": [
            program_id,
            {
                "encoding": "base64",
                "commitment": "confirmed",
                "filters": [
                    { "memcmp": { "offset": 0, "bytes": disc_bytes_b58 } }
                ]
            }
        ]
    });

    let response = client
        .post(rpc_url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| ApiError::Internal(format!("rpc request failed: {e}")))?;

    let status = response.status();
    let value: serde_json::Value = response
        .json()
        .await
        .map_err(|e| ApiError::InvalidOutput(format!("invalid rpc json response: {e}")))?;

    if !status.is_success() {
        return Err(ApiError::Internal(format!(
            "rpc request failed with status {status}: {value}"
        )));
    }

    if value.get("error").is_some() {
        return Err(ApiError::Internal(format!("rpc returned error: {value}")));
    }

    serde_json::from_value::<RpcProgramAccountsResponse>(value)
        .map(|v| v.result)
        .map_err(|e| ApiError::InvalidOutput(format!("failed to parse rpc program accounts: {e}")))
}

async fn membership_lookup(
    State(state): State<AppState>,
    Query(query): Query<MembershipQuery>,
) -> Result<Json<MembershipResponse>, ApiError> {
    ensure_non_empty(&query.address, "address")?;

    let target_address = query.address.trim().to_string();

    let mut rpc_url: Option<String> = None;
    let mut i = 0usize;
    while i + 1 < state.runner.base_args.len() {
        if state.runner.base_args[i] == "--url" {
            rpc_url = Some(state.runner.base_args[i + 1].clone());
            break;
        }
        i += 1;
    }

    let rpc_url = rpc_url.unwrap_or_else(|| "https://api.devnet.solana.com".to_string());

    let program_id = state
        .runner
        .run_json(vec!["config".to_string(), "show".to_string()])
        .await
        .ok()
        .and_then(|cfg| cfg.get("program_id").and_then(|v| v.as_str()).map(ToString::to_string))
        .unwrap_or_else(|| "ahVmthS8EwXMpckBQdxGeHmbFghxoqKBaFjSCizcvFL".to_string());

    // Two narrow scans instead of one fat one. Filter each by discriminator
    // at offset 0 so the RPC only returns the kind of account we care about.
    let wallet_accounts =
        fetch_program_accounts_by_disc(&rpc_url, &program_id, /* ClearWallet */ 1).await?;
    let intent_accounts =
        fetch_program_accounts_by_disc(&rpc_url, &program_id, /* Intent */ 2).await?;

    let mut wallets: std::collections::BTreeMap<String, MembershipAccumulator> =
        std::collections::BTreeMap::new();

    for account in wallet_accounts {
        let data = decode_base64_data(&account.account.data.0)?;
        if let Some((name, creator)) = parse_wallet_name(&data)? {
            let entry = wallets.entry(account.pubkey).or_default();
            entry.wallet_name = Some(name);
            entry.wallet_creator = Some(creator);
        }
    }

    for account in intent_accounts {
        let data = decode_base64_data(&account.account.data.0)?;
        if let Some((wallet, intent_index, proposers, approvers)) = parse_intent_membership(&data)?
        {
            let is_proposer = proposers.iter().any(|addr| addr == &target_address);
            let is_approver = approvers.iter().any(|addr| addr == &target_address);
            if is_proposer || is_approver {
                let entry = wallets.entry(wallet).or_default();
                entry.intent_indexes.insert(intent_index);
                if is_proposer {
                    entry.has_proposer = true;
                }
                if is_approver {
                    entry.has_approver = true;
                }
            }
        }
    }

    let organizations = wallets
        .into_iter()
        .filter_map(|(wallet, acc)| {
            if !acc.has_proposer && !acc.has_approver {
                return None;
            }

            let mut roles = Vec::new();
            if acc.has_proposer {
                roles.push("proposer".to_string());
            }
            if acc.has_approver {
                roles.push("approver".to_string());
            }

            let mut intent_indexes: Vec<u8> = acc.intent_indexes.into_iter().collect();
            intent_indexes.sort_unstable();

            Some(OrganizationMembership {
                wallet,
                wallet_name: acc.wallet_name,
                wallet_creator: acc.wallet_creator,
                roles,
                intent_indexes,
            })
        })
        .collect();

    Ok(Json(MembershipResponse { organizations }))
}

/// Convert a Unix expiry timestamp into the `YYYY-MM-DD HH:MM:SS` form
/// the CLI expects on `--expiry`. This is the mirror of the CLI's
/// `message::parse_expiry`. We do it here (rather than accepting a string
/// from the client) so the CLI always receives a well-formed value.
fn format_expiry(unix_ts: i64) -> Result<String, ApiError> {
    let secs_per_day: i64 = 86400;
    let mut days = unix_ts / secs_per_day;
    let day_secs = ((unix_ts % secs_per_day) + secs_per_day) % secs_per_day;
    if unix_ts < 0 && day_secs > 0 {
        days -= 1;
    }
    let hour = day_secs / 3600;
    let min = (day_secs % 3600) / 60;
    let sec = day_secs % 60;
    let adj = days + 719468;
    let era = if adj >= 0 { adj } else { adj - 146096 } / 146097;
    let doe = adj - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    if !(1970..=9999).contains(&year) {
        return Err(ApiError::BadRequest(format!(
            "expiry timestamp {unix_ts} resolves to year {year}, out of supported range"
        )));
    }
    Ok(format!("{year:04}-{m:02}-{d:02} {hour:02}:{min:02}:{sec:02}"))
}

fn ensure_non_empty(value: &str, field: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    Ok(())
}

fn ensure_non_empty_vec(value: &[String], field: &str) -> Result<(), ApiError> {
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
fn ensure_wallet_name(value: &str, field: &str) -> Result<(), ApiError> {
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
fn ensure_chain(value: &str, field: &str) -> Result<(), ApiError> {
    const ALLOWED: &[&str] = &[
        "solana",
        "evm_1559",
        "evm_1559_erc20",
        "bitcoin_p2wpkh",
        "zcash_transparent",
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
fn ensure_base58(value: &str, field: &str, min_len: usize, max_len: usize) -> Result<(), ApiError> {
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

async fn health(State(state): State<AppState>) -> Result<Json<HealthResponse>, ApiError> {
    Ok(Json(HealthResponse {
        status: "ok",
        cli_bin: state.runner.cli_bin.clone(),
    }))
}

async fn create_wallet(
    State(state): State<AppState>,
    Json(body): Json<CreateWalletRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_non_empty(&body.name, "name")?;
    ensure_non_empty_vec(&body.proposers, "proposers")?;
    ensure_non_empty_vec(&body.approvers, "approvers")?;
    if body.threshold == 0 {
        return Err(ApiError::BadRequest("threshold must be >= 1".into()));
    }

    let mut args = vec![
        "wallet".to_string(),
        "create".to_string(),
        "--name".to_string(),
        body.name,
        "--proposers".to_string(),
        body.proposers.join(","),
        "--approvers".to_string(),
        body.approvers.join(","),
        "--threshold".to_string(),
        body.threshold.to_string(),
    ];

    args.extend([
        "--cancellation-threshold".to_string(),
        body.cancellation_threshold.unwrap_or(1).to_string(),
        "--timelock".to_string(),
        body.timelock.unwrap_or(0).to_string(),
    ]);

    push_policy_ciphertexts(&mut args, &body.policy_ciphertexts);

    Ok(Json(state.runner.run_json(args).await?))
}

/// Append the optional `--policy-ciphertexts` CLI flag if any
/// identifiers were sent. The CLI's clap parser uses
/// `value_delimiter = ','`, so we hand it a single comma-joined
/// argument and let it split. Identifiers must look like
/// `ct_<hex>` (the shape Encrypt's gRPC service emits).
fn push_policy_ciphertexts(args: &mut Vec<String>, ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    args.push("--policy-ciphertexts".to_string());
    args.push(ids.join(","));
}

/// Forward the connected wallet's pubkey to the CLI as
/// `--signer-pubkey`. Only used in dry-run prepare paths so the CLI's
/// proposer / approver validation runs against the user's identity
/// rather than the relayer's filesystem keypair (which is never in
/// the on-chain approver list and so always fails the check).
///
/// Validates the base58 length so a malformed pubkey from the
/// frontend gets a clean 400 instead of a confusing CLI error.
fn push_actor_pubkey(
    args: &mut Vec<String>,
    actor: &Option<String>,
) -> Result<(), ApiError> {
    let Some(pk) = actor.as_deref() else {
        return Ok(());
    };
    let trimmed = pk.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    ensure_base58(trimmed, "actor_pubkey", 32, 44)?;
    args.push("--signer-pubkey".to_string());
    args.push(trimmed.to_string());
    Ok(())
}

async fn show_wallet(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    Ok(Json(
        state
            .runner
            .run_json(vec![
                "wallet".to_string(),
                "show".to_string(),
                "--name".to_string(),
                name,
            ])
            .await?,
    ))
}

async fn list_wallet_chains(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(query): Query<ChainsQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    let mut args = vec![
        "wallet".to_string(),
        "chains".to_string(),
        "--wallet".to_string(),
        name,
    ];
    if let Some(program) = query.dwallet_program {
        ensure_non_empty(&program, "dwallet_program")?;
        args.push("--dwallet-program".to_string());
        args.push(program);
    }
    Ok(Json(state.runner.run_json(args).await?))
}

async fn add_wallet_chain(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<AddChainRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_chain(&body.chain, "chain")?;

    let dwallet_program = body
        .dwallet_program
        .or_else(|| state.runner.default_dwallet_program.clone())
        .ok_or_else(|| {
            ApiError::BadRequest(
                "dwallet_program is required (set in request or CLEAR_MSIG_DEFAULT_DWALLET_PROGRAM)"
                    .into(),
            )
        })?;
    ensure_non_empty(&dwallet_program, "dwallet_program")?;

    let grpc_url = body.grpc_url.or_else(|| state.runner.default_grpc_url.clone());

    let mut args = vec![
        "wallet".to_string(),
        "add-chain".to_string(),
        "--wallet".to_string(),
        name,
        "--chain".to_string(),
        body.chain,
        "--dwallet-program".to_string(),
        dwallet_program,
    ];

    if let Some(grpc_url) = grpc_url {
        ensure_non_empty(&grpc_url, "grpc_url")?;
        args.push("--grpc-url".to_string());
        args.push(grpc_url);
    }
    if let Some(value) = body.existing_dwallet_pubkey {
        ensure_non_empty(&value, "existing_dwallet_pubkey")?;
        args.push("--existing-dwallet-pubkey".to_string());
        args.push(value);
    }
    if let Some(value) = body.existing_dwallet_addr {
        ensure_non_empty(&value, "existing_dwallet_addr")?;
        args.push("--existing-dwallet-addr".to_string());
        args.push(value);
    }

    Ok(Json(state.runner.run_json(args).await?))
}

async fn list_intents(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    Ok(Json(
        state
            .runner
            .run_json(vec![
                "intent".to_string(),
                "list".to_string(),
                "--wallet".to_string(),
                name,
            ])
            .await?,
    ))
}

// ── Signed submit routes ──
//
// Each of these:
//   1. Validates the pre-signed payload.
//   2. Rate-limits on signer_pubkey.
//   3. Invokes the CLI with `--signer-pubkey / --signature / --params-data`
//      so the CLI's PreSignedMessageSigner verifies and submits.
//
// The CLI itself re-builds the message from (wallet state, intent,
// params_data, expiry) and compares `ed25519_verify(pubkey, msg, sig)` —
// if the browser signed different bytes, we fail loudly before spending
// SOL on a tx the chain would reject.

async fn add_intent(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SignedIntentAddRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_non_empty(&body.file, "file")?;
    body.pre_signed.ensure_valid()?;
    state.rate_limiter.check(&body.pre_signed.signer_pubkey).await?;

    let mut args = Vec::with_capacity(16);
    push_pre_signed_flags(&mut args, &body.pre_signed);
    args.extend([
        "intent".into(),
        "add".into(),
        "--wallet".into(),
        name,
        "--file".into(),
        body.file,
        "--expiry".into(),
        format_expiry(body.pre_signed.expiry)?,
    ]);
    Ok(Json(state.runner.run_json(args).await?))
}

async fn remove_intent(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SignedIntentRemoveRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    body.pre_signed.ensure_valid()?;
    state.rate_limiter.check(&body.pre_signed.signer_pubkey).await?;

    let mut args = Vec::with_capacity(12);
    push_pre_signed_flags(&mut args, &body.pre_signed);
    args.extend([
        "intent".into(),
        "remove".into(),
        "--wallet".into(),
        name,
        "--index".into(),
        body.index.to_string(),
        "--expiry".into(),
        format_expiry(body.pre_signed.expiry)?,
    ]);
    Ok(Json(state.runner.run_json(args).await?))
}

async fn update_intent(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SignedIntentUpdateRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_non_empty(&body.file, "file")?;
    body.pre_signed.ensure_valid()?;
    state.rate_limiter.check(&body.pre_signed.signer_pubkey).await?;

    let mut args = Vec::with_capacity(14);
    push_pre_signed_flags(&mut args, &body.pre_signed);
    args.extend([
        "intent".into(),
        "update".into(),
        "--wallet".into(),
        name,
        "--index".into(),
        body.index.to_string(),
        "--file".into(),
        body.file,
        "--expiry".into(),
        format_expiry(body.pre_signed.expiry)?,
    ]);
    Ok(Json(state.runner.run_json(args).await?))
}

async fn create_proposal(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SignedProposalCreateRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    body.pre_signed.ensure_valid()?;
    state.rate_limiter.check(&body.pre_signed.signer_pubkey).await?;
    if body.pre_signed.params_data_hex.is_none() {
        return Err(ApiError::BadRequest(
            "params_data_hex is required for proposal create — build it via /prepare first".into(),
        ));
    }

    let mut args = Vec::with_capacity(14);
    push_pre_signed_flags(&mut args, &body.pre_signed);
    args.extend([
        "proposal".into(),
        "create".into(),
        "--wallet".into(),
        name,
        "--intent-index".into(),
        body.intent_index.to_string(),
        "--expiry".into(),
        format_expiry(body.pre_signed.expiry)?,
    ]);
    Ok(Json(state.runner.run_json(args).await?))
}

async fn list_proposals(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    Ok(Json(
        state
            .runner
            .run_json(vec![
                "proposal".to_string(),
                "list".to_string(),
                "--wallet".to_string(),
                name,
            ])
            .await?,
    ))
}

async fn show_proposal(
    State(state): State<AppState>,
    Path(proposal): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_base58(&proposal, "proposal", 32, 88)?;
    Ok(Json(
        state
            .runner
            .run_json(vec![
                "proposal".to_string(),
                "show".to_string(),
                "--proposal".to_string(),
                proposal,
            ])
            .await?,
    ))
}

async fn approve_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<SignedApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;
    body.pre_signed.ensure_valid()?;
    state.rate_limiter.check(&body.pre_signed.signer_pubkey).await?;

    let mut args = Vec::with_capacity(12);
    push_pre_signed_flags(&mut args, &body.pre_signed);
    args.extend([
        "proposal".into(),
        "approve".into(),
        "--wallet".into(),
        name,
        "--proposal".into(),
        proposal,
        "--expiry".into(),
        format_expiry(body.pre_signed.expiry)?,
    ]);
    Ok(Json(state.runner.run_json(args).await?))
}

async fn cancel_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<SignedApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;
    body.pre_signed.ensure_valid()?;
    state.rate_limiter.check(&body.pre_signed.signer_pubkey).await?;

    let mut args = Vec::with_capacity(12);
    push_pre_signed_flags(&mut args, &body.pre_signed);
    args.extend([
        "proposal".into(),
        "cancel".into(),
        "--wallet".into(),
        name,
        "--proposal".into(),
        proposal,
        "--expiry".into(),
        format_expiry(body.pre_signed.expiry)?,
    ]);
    Ok(Json(state.runner.run_json(args).await?))
}

// ─────────────────────────── /prepare/* dry-run routes ───────────────────
//
// These call the CLI with `--dry-run`. The CLI rebuilds the exact message
// the signed submit-path would rebuild, prints a `DryRunDescriptor` JSON,
// and exits without sending a transaction. The browser consumes
// `message_hex` → `wallet.signMessage(bytes)` → POST back to the signed
// submit route above.
//
// Keeping these separate from the submit routes (rather than a
// `Prefer: dry-run` header) gives us cleaner route-level rate limiting
// and logging semantics, and lets us pre-validate inputs separately.

async fn prepare_intent_add(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<PrepareIntentAddRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_non_empty(&body.file, "file")?;
    ensure_non_empty_vec(&body.proposers, "proposers")?;
    ensure_non_empty_vec(&body.approvers, "approvers")?;
    if body.threshold == 0 {
        return Err(ApiError::BadRequest("threshold must be >= 1".into()));
    }
    let mut args = vec!["--dry-run".into()];
    args.extend([
        "intent".into(),
        "add".into(),
        "--wallet".into(),
        name,
        "--file".into(),
        body.file,
        "--proposers".into(),
        body.proposers.join(","),
        "--approvers".into(),
        body.approvers.join(","),
        "--threshold".into(),
        body.threshold.to_string(),
        "--cancellation-threshold".into(),
        body.cancellation_threshold.unwrap_or(1).to_string(),
        "--timelock".into(),
        body.timelock.unwrap_or(0).to_string(),
    ]);
    if let Some(e) = body.expiry {
        ensure_non_empty(&e, "expiry")?;
        args.push("--expiry".into());
        args.push(e);
    }
    push_policy_ciphertexts(&mut args, &body.policy_ciphertexts);
    Ok(Json(state.runner.run_json(args).await?))
}

async fn prepare_intent_remove(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<PrepareIntentRemoveRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    let mut args = vec!["--dry-run".into()];
    args.extend([
        "intent".into(),
        "remove".into(),
        "--wallet".into(),
        name,
        "--index".into(),
        body.index.to_string(),
    ]);
    if let Some(e) = body.expiry {
        ensure_non_empty(&e, "expiry")?;
        args.push("--expiry".into());
        args.push(e);
    }
    Ok(Json(state.runner.run_json(args).await?))
}

async fn prepare_intent_update(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<PrepareIntentUpdateRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_non_empty(&body.file, "file")?;
    ensure_non_empty_vec(&body.proposers, "proposers")?;
    ensure_non_empty_vec(&body.approvers, "approvers")?;
    if body.threshold == 0 {
        return Err(ApiError::BadRequest("threshold must be >= 1".into()));
    }
    let mut args = vec!["--dry-run".into()];
    args.extend([
        "intent".into(),
        "update".into(),
        "--wallet".into(),
        name,
        "--index".into(),
        body.index.to_string(),
        "--file".into(),
        body.file,
        "--proposers".into(),
        body.proposers.join(","),
        "--approvers".into(),
        body.approvers.join(","),
        "--threshold".into(),
        body.threshold.to_string(),
        "--cancellation-threshold".into(),
        body.cancellation_threshold.unwrap_or(1).to_string(),
        "--timelock".into(),
        body.timelock.unwrap_or(0).to_string(),
    ]);
    if let Some(e) = body.expiry {
        ensure_non_empty(&e, "expiry")?;
        args.push("--expiry".into());
        args.push(e);
    }
    push_policy_ciphertexts(&mut args, &body.policy_ciphertexts);
    Ok(Json(state.runner.run_json(args).await?))
}

async fn prepare_proposal_create(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<PrepareProposalCreateRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_non_empty_vec(&body.params, "params")?;
    let mut args = vec!["--dry-run".into()];
    push_actor_pubkey(&mut args, &body.actor_pubkey)?;
    args.extend([
        "proposal".into(),
        "create".into(),
        "--wallet".into(),
        name,
        "--intent-index".into(),
        body.intent_index.to_string(),
    ]);
    for p in body.params {
        ensure_non_empty(&p, "param item")?;
        args.push("--param".into());
        args.push(p);
    }
    if let Some(e) = body.expiry {
        ensure_non_empty(&e, "expiry")?;
        args.push("--expiry".into());
        args.push(e);
    }
    Ok(Json(state.runner.run_json(args).await?))
}

async fn prepare_proposal_approve(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<PrepareApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    prepare_approve_or_cancel(state, name, proposal, body, /* is_approve */ true).await
}

async fn prepare_proposal_cancel(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<PrepareApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    prepare_approve_or_cancel(state, name, proposal, body, /* is_approve */ false).await
}

async fn prepare_approve_or_cancel(
    state: AppState,
    name: String,
    proposal: String,
    body: PrepareApproveCancelRequest,
    is_approve: bool,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;
    let mut args = vec!["--dry-run".into()];
    push_actor_pubkey(&mut args, &body.actor_pubkey)?;
    args.extend([
        "proposal".into(),
        if is_approve { "approve".into() } else { "cancel".into() },
        "--wallet".into(),
        name,
        "--proposal".into(),
        proposal,
    ]);
    if let Some(e) = body.expiry {
        ensure_non_empty(&e, "expiry")?;
        args.push("--expiry".into());
        args.push(e);
    }
    Ok(Json(state.runner.run_json(args).await?))
}

async fn execute_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteProposalRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;

    let mut args = vec![
        "proposal".to_string(),
        "execute".to_string(),
        "--wallet".to_string(),
        name,
        "--proposal".to_string(),
        proposal,
    ];

    let dwallet_program = body
        .dwallet_program
        .or_else(|| state.runner.default_dwallet_program.clone());
    if let Some(dwallet_program) = dwallet_program {
        ensure_non_empty(&dwallet_program, "dwallet_program")?;
        args.push("--dwallet-program".to_string());
        args.push(dwallet_program);
    }

    let grpc_url = body.grpc_url.or_else(|| state.runner.default_grpc_url.clone());
    if let Some(grpc_url) = grpc_url {
        ensure_non_empty(&grpc_url, "grpc_url")?;
        args.push("--grpc-url".to_string());
        args.push(grpc_url);
    }
    let rpc_url = body
        .rpc_url
        .or_else(|| state.runner.default_destination_rpc_url.clone());
    if let Some(rpc_url) = rpc_url {
        ensure_non_empty(&rpc_url, "rpc_url")?;
        args.push("--rpc-url".to_string());
        args.push(rpc_url);
    }
    if body.broadcast.unwrap_or(false) {
        args.push("--broadcast".to_string());
        args.push("true".to_string());
    }

    Ok(Json(state.runner.run_json(args).await?))
}

// ─────────────────────────── SSE streaming execute ─────────────────────
//
// `proposal execute` with `--broadcast` is the 4-stage flow:
//   Solana ika_sign tx → gRPC presign → gRPC sign → destination broadcast.
// Each stage takes seconds. A single JSON response means the UI sits
// staring at a spinner for 15-30 seconds with no feedback. Streaming
// the CLI's stderr line-by-line as Server-Sent Events lets the frontend
// animate the signing pipeline in real-time.
//
// The CLI already prints `✓ foo` / `→ bar` lines to stderr at each
// stage, so the backend just pipes them straight through as SSE
// `progress` events, then emits a final `done` event with the parsed
// stdout JSON, or `error` if the CLI failed.

async fn stream_execute_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Query(body): Query<ExecuteProposalRequest>,
) -> Result<axum::response::sse::Sse<
    impl futures_core::Stream<Item = std::result::Result<axum::response::sse::Event, std::convert::Infallible>>,
>, ApiError> {
    use axum::response::sse::{Event, KeepAlive, Sse};

    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;

    // Same arg assembly as the JSON execute route.
    let mut args = vec![
        "proposal".to_string(),
        "execute".to_string(),
        "--wallet".to_string(),
        name,
        "--proposal".to_string(),
        proposal,
    ];
    let dwallet_program = body
        .dwallet_program
        .or_else(|| state.runner.default_dwallet_program.clone());
    if let Some(v) = dwallet_program {
        ensure_non_empty(&v, "dwallet_program")?;
        args.push("--dwallet-program".into());
        args.push(v);
    }
    let grpc_url = body.grpc_url.or_else(|| state.runner.default_grpc_url.clone());
    if let Some(v) = grpc_url {
        ensure_non_empty(&v, "grpc_url")?;
        args.push("--grpc-url".into());
        args.push(v);
    }
    let rpc_url = body
        .rpc_url
        .or_else(|| state.runner.default_destination_rpc_url.clone());
    if let Some(v) = rpc_url {
        ensure_non_empty(&v, "rpc_url")?;
        args.push("--rpc-url".into());
        args.push(v);
    }
    if body.broadcast.unwrap_or(false) {
        args.push("--broadcast".into());
        args.push("true".into());
    }

    let (tx, rx) = tokio::sync::mpsc::channel::<Event>(32);
    let runner = state.runner.clone();
    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        use tokio::process::Command;
        use std::process::Stdio;

        let mut cmd = Command::new(&runner.cli_bin);
        cmd.args(&runner.base_args)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = tx
                    .send(
                        Event::default().event("error").data(
                            serde_json::json!({ "error": format!("spawn: {e}") }).to_string(),
                        ),
                    )
                    .await;
                return;
            }
        };
        let mut child = child;
        let stderr = match child.stderr.take() {
            Some(s) => s,
            None => {
                let _ = tx
                    .send(Event::default().event("error").data(
                        serde_json::json!({ "error": "missing stderr pipe" }).to_string(),
                    ))
                    .await;
                return;
            }
        };
        let stdout = child.stdout.take();

        // Stream stderr line-by-line as `progress` events.
        let tx_err = tx.clone();
        let stderr_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx_err
                    .send(
                        Event::default()
                            .event("progress")
                            .data(serde_json::json!({ "line": line }).to_string()),
                    )
                    .await;
            }
        });

        // Collect stdout fully — JSON final result.
        let stdout_bytes = if let Some(mut stdout) = stdout {
            use tokio::io::AsyncReadExt;
            let mut buf = Vec::new();
            let _ = stdout.read_to_end(&mut buf).await;
            buf
        } else {
            Vec::new()
        };

        let status = match child.wait().await {
            Ok(s) => s,
            Err(e) => {
                let _ = tx
                    .send(Event::default().event("error").data(
                        serde_json::json!({ "error": format!("wait: {e}") }).to_string(),
                    ))
                    .await;
                return;
            }
        };

        let _ = stderr_task.await;

        let stdout_str = String::from_utf8_lossy(&stdout_bytes).to_string();
        if status.success() {
            let parsed: serde_json::Value = serde_json::from_str(&stdout_str)
                .unwrap_or_else(|_| serde_json::json!({ "raw_stdout": stdout_str }));
            let _ = tx
                .send(Event::default().event("done").data(parsed.to_string()))
                .await;
        } else {
            let _ = tx
                .send(Event::default().event("error").data(
                    serde_json::json!({
                        "code": status.code(),
                        "stdout": stdout_str,
                    })
                    .to_string(),
                ))
                .await;
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx).map(std::result::Result::<_, std::convert::Infallible>::Ok);
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

async fn cleanup_proposal(
    State(state): State<AppState>,
    Path(proposal): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_base58(&proposal, "proposal", 32, 88)?;
    Ok(Json(
        state
            .runner
            .run_json(vec![
                "proposal".to_string(),
                "cleanup".to_string(),
                "--proposal".to_string(),
                proposal,
            ])
            .await?,
    ))
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
/// `https://clear-msig.vercel.app,https://staging.clear-msig.app`). When
/// set, only those origins can reach the API from a browser tab.
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

    info!(
        cli_bin = %runner.cli_bin,
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
    };

    // Every route here is open. Wallet bootstrap + chain binding do not
    // require an ed25519 multisig signature (those are the bootstrap
    // steps that *create* the proposer/approver list). They're paid by
    // the backend's sponsored-gas keypair just like every other write.
    // Rate limiting on `signer_pubkey` (or IP, for unsigned writes) is
    // the only abuse control.
    let app = Router::new()
        .route("/health", get(health))
        .route("/memberships", get(membership_lookup))
        .route("/wallets", post(create_wallet))
        .route("/wallets/{name}", get(show_wallet))
        .route("/wallets/{name}/chains", get(list_wallet_chains))
        .route("/wallets/{name}/chains/add", post(add_wallet_chain))
        .route("/wallets/{name}/intents", get(list_intents))
        .route("/wallets/{name}/intents/add", post(add_intent))
        .route("/wallets/{name}/intents/remove", post(remove_intent))
        .route("/wallets/{name}/intents/update", post(update_intent))
        .route("/wallets/{name}/proposals", post(create_proposal).get(list_proposals))
        .route(
            "/wallets/{name}/proposals/{proposal}/approve",
            post(approve_proposal),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/cancel",
            post(cancel_proposal),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/execute",
            post(execute_proposal),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/execute/stream",
            get(stream_execute_proposal),
        )
        .route("/proposals/{proposal}", get(show_proposal))
        .route("/proposals/{proposal}/cleanup", post(cleanup_proposal))
        // Dry-run mirrors of the signed-submit routes. Given the same
        // inputs (minus signature/signer_pubkey) they return the exact
        // bytes the wallet must sign.
        .route("/prepare/wallets/{name}/intents/add", post(prepare_intent_add))
        .route("/prepare/wallets/{name}/intents/remove", post(prepare_intent_remove))
        .route("/prepare/wallets/{name}/intents/update", post(prepare_intent_update))
        .route(
            "/prepare/wallets/{name}/proposals/create",
            post(prepare_proposal_create),
        )
        .route(
            "/prepare/wallets/{name}/proposals/{proposal}/approve",
            post(prepare_proposal_approve),
        )
        .route(
            "/prepare/wallets/{name}/proposals/{proposal}/cancel",
            post(prepare_proposal_cancel),
        )
        .with_state(state)
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
