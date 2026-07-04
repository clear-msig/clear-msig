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
    Ok(Json(lookup_memberships(&state, query.address).await?))
}

fn push_policy_ciphertexts(args: &mut Vec<String>, ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    args.push("--policy-ciphertexts".to_string());
    args.push(ids.join(","));
}
