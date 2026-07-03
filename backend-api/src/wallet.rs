use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;

use crate::{
    ensure_base58_pubkey, ensure_chain, ensure_non_empty, ensure_non_empty_vec, ensure_wallet_name,
    ApiError, AppState,
};

const RPC_PROGRAM_SCAN_ATTEMPTS: usize = 4;

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

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/memberships", get(membership_lookup))
        .route("/wallets", post(create_wallet))
        .route("/wallets/{name}", get(show_wallet))
        .route("/wallets/{name}/chains", get(list_wallet_chains))
        .route("/wallets/{name}/chains/add", post(add_wallet_chain))
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
    for p in &body.proposers {
        ensure_base58_pubkey(p, "proposers entry")?;
    }
    for a in &body.approvers {
        ensure_base58_pubkey(a, "approvers entry")?;
    }
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

    let grpc_url = body
        .grpc_url
        .or_else(|| state.runner.default_grpc_url.clone());

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
        .and_then(|cfg| {
            cfg.get("program_id")
                .and_then(|v| v.as_str())
                .map(ToString::to_string)
        })
        .or_else(|| std::env::var("CLEAR_MSIG_PROGRAM_ID").ok())
        .unwrap_or_else(|| "Abf68HjgGyaCqGtu2W9Tg7Kkz5iJoBvAb8e86M6xTkNJ".to_string());

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
            if acc.wallet_name.is_none() {
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

fn push_policy_ciphertexts(args: &mut Vec<String>, ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    args.push("--policy-ciphertexts".to_string());
    args.push(ids.join(","));
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
    let len = read_u32_le(data, offset)? as usize;
    let mut out = Vec::with_capacity(len);
    for _ in 0..len {
        out.push(read_address_bs58(data, offset)?);
    }
    Ok(out)
}

fn skip_raw_vec(data: &[u8], offset: &mut usize, element_size: usize) -> Result<(), ApiError> {
    let len = read_u32_le(data, offset)? as usize;
    let bytes = len
        .checked_mul(element_size)
        .ok_or_else(|| ApiError::InvalidOutput("vector length overflow".into()))?;
    let end = offset
        .checked_add(bytes)
        .ok_or_else(|| ApiError::InvalidOutput("vector offset overflow".into()))?;
    if end > data.len() {
        return Err(ApiError::InvalidOutput(
            "unexpected EOF skipping vec".into(),
        ));
    }
    *offset = end;
    Ok(())
}

fn skip_u8_vec(data: &[u8], offset: &mut usize) -> Result<(), ApiError> {
    skip_raw_vec(data, offset, 1)
}

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

fn parse_intent_membership(
    data: &[u8],
) -> Result<Option<(String, u8, Vec<String>, Vec<String>)>, ApiError> {
    if data.first().copied() != Some(2) {
        return Ok(None);
    }

    let mut offset = 1;
    let wallet = read_address_bs58(data, &mut offset)?;
    let _bump = read_u8(data, &mut offset)?;
    let intent_index = read_u8(&data, &mut offset)?;
    let _intent_type = read_u8(data, &mut offset)?;
    let _chain_kind = read_u8(data, &mut offset)?;
    let _approved = read_u8(data, &mut offset)?;
    let _approval_threshold = read_u8(data, &mut offset)?;
    let _cancellation_threshold = read_u8(&data, &mut offset)?;
    offset += 4; // timelock_seconds
    let _template_offset = read_u16_le(data, &mut offset)?;
    let _template_len = read_u16_le(data, &mut offset)?;
    let _tx_template_offset = read_u16_le(data, &mut offset)?;
    let _tx_template_len = read_u16_le(data, &mut offset)?;
    let _active_proposal_count = read_u16_le(data, &mut offset)?;

    let proposers = read_vec_addresses(data, &mut offset)?;
    let approvers = read_vec_addresses(data, &mut offset)?;

    skip_raw_vec(data, &mut offset, 14)?;
    skip_raw_vec(data, &mut offset, 7)?;
    skip_raw_vec(data, &mut offset, 9)?;
    skip_raw_vec(data, &mut offset, 5)?;
    skip_raw_vec(data, &mut offset, 5)?;
    skip_u8_vec(&data, &mut offset)?;

    Ok(Some((wallet, intent_index, proposers, approvers)))
}

async fn fetch_program_accounts_by_disc(
    rpc_url: &str,
    program_id: &str,
    discriminator: u8,
) -> Result<Vec<RpcProgramAccount>, ApiError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| ApiError::Internal(format!("failed to build rpc client: {e}")))?;
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

    for attempt in 1..=RPC_PROGRAM_SCAN_ATTEMPTS {
        let response = match client.post(rpc_url).json(&payload).send().await {
            Ok(response) => response,
            Err(error) => {
                if attempt < RPC_PROGRAM_SCAN_ATTEMPTS && is_retryable_rpc_transport(&error) {
                    tracing::warn!(
                        attempt,
                        max_attempts = RPC_PROGRAM_SCAN_ATTEMPTS,
                        discriminator,
                        error = %error,
                        "retrying Solana program-account scan after transport failure"
                    );
                    tokio::time::sleep(rpc_retry_delay(attempt)).await;
                    continue;
                }
                return Err(ApiError::Internal(format!("rpc request failed: {error}")));
            }
        };

        let status = response.status();
        let value: serde_json::Value = response
            .json()
            .await
            .map_err(|e| ApiError::InvalidOutput(format!("invalid rpc json response: {e}")))?;

        if !status.is_success() {
            if attempt < RPC_PROGRAM_SCAN_ATTEMPTS && is_retryable_rpc_status(status) {
                tracing::warn!(
                    attempt,
                    max_attempts = RPC_PROGRAM_SCAN_ATTEMPTS,
                    discriminator,
                    status = %status,
                    "retrying Solana program-account scan after rpc status"
                );
                tokio::time::sleep(rpc_retry_delay(attempt)).await;
                continue;
            }
            return Err(ApiError::Internal(format!(
                "rpc request failed with status {status}: {value}"
            )));
        }

        if value.get("error").is_some() {
            if attempt < RPC_PROGRAM_SCAN_ATTEMPTS && is_retryable_rpc_json_error(&value) {
                tracing::warn!(
                    attempt,
                    max_attempts = RPC_PROGRAM_SCAN_ATTEMPTS,
                    discriminator,
                    error = %value,
                    "retrying Solana program-account scan after rpc error"
                );
                tokio::time::sleep(rpc_retry_delay(attempt)).await;
                continue;
            }
            return Err(ApiError::Internal(format!("rpc returned error: {value}")));
        }

        return serde_json::from_value::<RpcProgramAccountsResponse>(value)
            .map(|v| v.result)
            .map_err(|e| {
                ApiError::InvalidOutput(format!("failed to parse rpc program accounts: {e}"))
            });
    }

    Err(ApiError::Internal(format!(
        "rpc request failed after retrying program-account scan"
    )))
}

fn rpc_retry_delay(attempt: usize) -> Duration {
    Duration::from_millis(350 * attempt as u64)
}

fn is_retryable_rpc_transport(error: &reqwest::Error) -> bool {
    error.is_timeout() || error.is_connect() || error.is_request() || error.is_body()
}

fn is_retryable_rpc_status(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

fn is_retryable_rpc_json_error(value: &serde_json::Value) -> bool {
    let text = value.to_string().to_lowercase();
    [
        "timeout",
        "too many requests",
        "rate limit",
        "temporarily unavailable",
        "node is behind",
        "429",
        "500",
        "502",
        "503",
        "504",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}
