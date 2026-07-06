use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;

use crate::clearsign::{format_expiry, push_pre_signed_flags, PreSigned};
use crate::{
    ensure_base58_pubkey, ensure_intent_filename, ensure_non_empty, ensure_non_empty_vec,
    ensure_wallet_name, ApiError, AppState,
};

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
struct PrepareIntentAddRequest {
    file: String,
    proposers: Vec<String>,
    approvers: Vec<String>,
    threshold: u8,
    cancellation_threshold: Option<u8>,
    timelock: Option<u32>,
    expiry: Option<String>,
    /// Encrypt ciphertext identifiers covering the policy fields.
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
    /// Encrypt ciphertext identifiers covering the policy fields.
    #[serde(default)]
    policy_ciphertexts: Vec<String>,
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/wallets/{name}/intents", get(list_intents))
        .route("/wallets/{name}/intents/add", post(add_intent))
        .route("/wallets/{name}/intents/remove", post(remove_intent))
        .route("/wallets/{name}/intents/update", post(update_intent))
        .route(
            "/prepare/wallets/{name}/intents/add",
            post(prepare_intent_add),
        )
        .route(
            "/prepare/wallets/{name}/intents/remove",
            post(prepare_intent_remove),
        )
        .route(
            "/prepare/wallets/{name}/intents/update",
            post(prepare_intent_update),
        )
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

async fn add_intent(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SignedIntentAddRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_intent_filename(&body.file, "file")?;
    body.pre_signed.ensure_valid()?;
    state
        .rate_limiter
        .check(&body.pre_signed.signer_pubkey)
        .await?;

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
    state
        .rate_limiter
        .check(&body.pre_signed.signer_pubkey)
        .await?;

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
    ensure_intent_filename(&body.file, "file")?;
    body.pre_signed.ensure_valid()?;
    state
        .rate_limiter
        .check(&body.pre_signed.signer_pubkey)
        .await?;

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

async fn prepare_intent_add(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<PrepareIntentAddRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_intent_filename(&body.file, "file")?;
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
    ensure_intent_filename(&body.file, "file")?;
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

fn push_policy_ciphertexts(args: &mut Vec<String>, ids: &[String]) {
    if ids.is_empty() {
        return;
    }
    args.push("--policy-ciphertexts".to_string());
    args.push(ids.join(","));
}
