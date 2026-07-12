use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::Value;

use crate::clearsign::{format_expiry, normalize_expiry_arg, PreSigned};
use crate::{
    ensure_base58_pubkey, ensure_intent_filename, ensure_non_empty_vec, ensure_wallet_name,
    ApiError, AppState,
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
    run_intent_command(
        &state,
        clear_msig_cli::DirectExecutionContext::Backend,
        clear_msig_cli::DirectCommand::IntentList { wallet: name },
        None,
    )
    .await
}

async fn add_intent(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SignedIntentAddRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_intent_filename(&body.file, "file")?;
    body.pre_signed.ensure_valid()?;

    let expiry = format_expiry(body.pre_signed.expiry)?;
    let rate_key = body.pre_signed.signer_pubkey.clone();
    let context = presigned_context(body.pre_signed);
    let command = clear_msig_cli::DirectCommand::IntentAdd {
        wallet: name,
        file: Some(body.file),
        proposers: Vec::new(),
        approvers: Vec::new(),
        threshold: None,
        cancellation_threshold: 1,
        timelock: 0,
        expiry: Some(expiry),
        policy_ciphertexts: Vec::new(),
    };
    run_intent_command(&state, context, command, Some(&rate_key)).await
}

async fn remove_intent(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SignedIntentRemoveRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    body.pre_signed.ensure_valid()?;

    let expiry = format_expiry(body.pre_signed.expiry)?;
    let rate_key = body.pre_signed.signer_pubkey.clone();
    let context = presigned_context(body.pre_signed);
    let command = clear_msig_cli::DirectCommand::IntentRemove {
        wallet: name,
        index: body.index,
        expiry: Some(expiry),
    };
    run_intent_command(&state, context, command, Some(&rate_key)).await
}

async fn update_intent(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SignedIntentUpdateRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_intent_filename(&body.file, "file")?;
    body.pre_signed.ensure_valid()?;

    let expiry = format_expiry(body.pre_signed.expiry)?;
    let rate_key = body.pre_signed.signer_pubkey.clone();
    let context = presigned_context(body.pre_signed);
    let command = clear_msig_cli::DirectCommand::IntentUpdate {
        wallet: name,
        index: body.index,
        file: Some(body.file),
        proposers: Vec::new(),
        approvers: Vec::new(),
        threshold: None,
        cancellation_threshold: 1,
        timelock: 0,
        expiry: Some(expiry),
        policy_ciphertexts: Vec::new(),
    };
    run_intent_command(&state, context, command, Some(&rate_key)).await
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
    let expiry = body
        .expiry
        .map(|value| normalize_expiry_arg(&value))
        .transpose()?;
    let command = clear_msig_cli::DirectCommand::IntentAdd {
        wallet: name,
        file: Some(body.file),
        proposers: body.proposers,
        approvers: body.approvers,
        threshold: Some(body.threshold),
        cancellation_threshold: body.cancellation_threshold.unwrap_or(1),
        timelock: body.timelock.unwrap_or(0),
        expiry,
        policy_ciphertexts: body.policy_ciphertexts,
    };
    run_intent_command(
        &state,
        clear_msig_cli::DirectExecutionContext::DryRun { actor_pubkey: None },
        command,
        None,
    )
    .await
}

async fn prepare_intent_remove(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<PrepareIntentRemoveRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    let expiry = body
        .expiry
        .map(|value| normalize_expiry_arg(&value))
        .transpose()?;
    let command = clear_msig_cli::DirectCommand::IntentRemove {
        wallet: name,
        index: body.index,
        expiry,
    };
    run_intent_command(
        &state,
        clear_msig_cli::DirectExecutionContext::DryRun { actor_pubkey: None },
        command,
        None,
    )
    .await
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
    let expiry = body
        .expiry
        .map(|value| normalize_expiry_arg(&value))
        .transpose()?;
    let command = clear_msig_cli::DirectCommand::IntentUpdate {
        wallet: name,
        index: body.index,
        file: Some(body.file),
        proposers: body.proposers,
        approvers: body.approvers,
        threshold: Some(body.threshold),
        cancellation_threshold: body.cancellation_threshold.unwrap_or(1),
        timelock: body.timelock.unwrap_or(0),
        expiry,
        policy_ciphertexts: body.policy_ciphertexts,
    };
    run_intent_command(
        &state,
        clear_msig_cli::DirectExecutionContext::DryRun { actor_pubkey: None },
        command,
        None,
    )
    .await
}

fn presigned_context(pre_signed: PreSigned) -> clear_msig_cli::DirectExecutionContext {
    clear_msig_cli::DirectExecutionContext::PreSigned {
        signer_pubkey: pre_signed.signer_pubkey,
        signature: pre_signed.signature,
        params_data: pre_signed.params_data_hex,
        message_flavor: pre_signed.message_flavor,
        signed_message: pre_signed.signed_message_hex,
    }
}

async fn run_intent_command(
    state: &AppState,
    context: clear_msig_cli::DirectExecutionContext,
    command: clear_msig_cli::DirectCommand,
    rate_limit_key: Option<&str>,
) -> Result<Json<Value>, ApiError> {
    if let Some(key) = rate_limit_key {
        state.rate_limiter.check(key).await?;
    }
    Ok(Json(state.runner.run_direct(context, command).await?))
}
