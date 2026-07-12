use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    ensure_base58_pubkey, ensure_chain, ensure_non_empty, ensure_non_empty_vec, ensure_wallet_name,
    ApiError, AppState,
};

mod membership;

use membership::{lookup_memberships, MembershipQuery, MembershipResponse};

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    execution_mode: &'static str,
    execution_workers: usize,
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
        execution_mode: state.runner.execution_mode(),
        execution_workers: state.runner.worker_limit,
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

    let command = clear_msig_cli::DirectCommand::WalletCreate {
        name: body.name,
        proposers: body.proposers,
        approvers: body.approvers,
        threshold: body.threshold,
        cancellation_threshold: body.cancellation_threshold.unwrap_or(1),
        timelock: body.timelock.unwrap_or(0),
        policy_ciphertexts: body.policy_ciphertexts,
    };
    Ok(Json(
        state
            .runner
            .run_direct(clear_msig_cli::DirectExecutionContext::Backend, command)
            .await?,
    ))
}

async fn show_wallet(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    let command = clear_msig_cli::DirectCommand::WalletShow { name };
    Ok(Json(
        state
            .runner
            .run_direct(clear_msig_cli::DirectExecutionContext::Backend, command)
            .await?,
    ))
}

async fn list_wallet_chains(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(query): Query<ChainsQuery>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    if let Some(program) = &query.dwallet_program {
        ensure_non_empty(program, "dwallet_program")?;
    }
    let command = clear_msig_cli::DirectCommand::WalletChains {
        wallet: name,
        dwallet_program: query.dwallet_program,
    };
    Ok(Json(
        state
            .runner
            .run_direct(clear_msig_cli::DirectExecutionContext::Backend, command)
            .await?,
    ))
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

    if let Some(grpc_url) = &grpc_url {
        ensure_non_empty(grpc_url, "grpc_url")?;
    }
    if let Some(value) = &body.existing_dwallet_pubkey {
        ensure_non_empty(value, "existing_dwallet_pubkey")?;
    }
    if let Some(value) = &body.existing_dwallet_addr {
        ensure_non_empty(value, "existing_dwallet_addr")?;
    }
    let command = clear_msig_cli::DirectCommand::WalletAddChain {
        wallet: name,
        chain: body.chain,
        dwallet_program,
        grpc_url,
        existing_dwallet_pubkey: body.existing_dwallet_pubkey,
        existing_dwallet_addr: body.existing_dwallet_addr,
    };
    Ok(Json(
        state
            .runner
            .run_direct(clear_msig_cli::DirectExecutionContext::Backend, command)
            .await?,
    ))
}

async fn membership_lookup(
    State(state): State<AppState>,
    Query(query): Query<MembershipQuery>,
) -> Result<Json<MembershipResponse>, ApiError> {
    Ok(Json(lookup_memberships(&state, query.address).await?))
}
