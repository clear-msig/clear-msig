use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde_json::Value;

use crate::clearsign::{format_expiry, normalize_expiry_arg, PreSigned};
use crate::{
    ensure_base58, ensure_non_empty, ensure_non_empty_vec, ensure_wallet_name,
    resolve_trusted_runtime_value, ApiError, AppState,
};

mod typed_agent_risk;
mod typed_execution;
mod typed_lifecycle;
mod types;
mod validation;

use typed_agent_risk::{
    execute_typed_agent_risk_policy as build_typed_agent_risk_policy,
    execute_typed_agent_trade_settlement as build_typed_agent_trade_settlement,
};
use typed_execution::{
    execute_typed_agent_session_grant as build_typed_agent_session_grant,
    execute_typed_agent_trade_approval as build_typed_agent_trade_approval,
    execute_typed_chain_send as build_typed_chain_send,
    execute_typed_escrow_release as build_typed_escrow_release,
    execute_typed_escrow_return as build_typed_escrow_return,
    execute_typed_intent_governance as build_typed_intent_governance,
    execute_typed_sol_batch_send as build_typed_sol_batch_send,
    execute_typed_sol_send as build_typed_sol_send,
    execute_typed_wallet_policy_update as build_typed_wallet_policy_update,
};
use types::{
    ExecuteProposalRequest, ExecuteTypedAgentRiskPolicyRequest,
    ExecuteTypedAgentSessionGrantRequest, ExecuteTypedAgentTradeApprovalRequest,
    ExecuteTypedAgentTradeSettlementRequest, ExecuteTypedChainSendRequest,
    ExecuteTypedEscrowReleaseRequest, ExecuteTypedEscrowReturnRequest,
    ExecuteTypedIntentGovernanceRequest, ExecuteTypedSolBatchSendRequest,
    ExecuteTypedSolSendRequest, ExecuteTypedWalletPolicyUpdateRequest, PrepareApproveCancelRequest,
    PrepareProposalCreateRequest, PrepareTypedProposalCreateRequest, SignedApproveCancelRequest,
    SignedProposalCreateRequest, SignedTypedProposalCreateRequest,
};
pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/wallets/{name}/proposals",
            post(create_proposal).get(list_proposals),
        )
        .route(
            "/wallets/{name}/proposals/typed",
            post(create_typed_proposal),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/approve",
            post(approve_proposal),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-approve",
            post(approve_typed_proposal),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/cancel",
            post(cancel_proposal),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-cancel",
            post(cancel_typed_proposal),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/execute",
            post(execute_proposal),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-execute",
            post(execute_typed_proposal),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-escrow-release",
            post(execute_typed_escrow_release),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-escrow-return",
            post(execute_typed_escrow_return),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-sol-send",
            post(execute_typed_sol_send),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-wallet-policy-update",
            post(execute_typed_wallet_policy_update),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-intent-governance",
            post(execute_typed_intent_governance),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-chain-send",
            post(execute_typed_chain_send),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-sol-batch-send",
            post(execute_typed_sol_batch_send),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-agent-trade-approval",
            post(execute_typed_agent_trade_approval),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-agent-session-grant",
            post(execute_typed_agent_session_grant),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-agent-risk-policy",
            post(execute_typed_agent_risk_policy),
        )
        .route(
            "/wallets/{name}/proposals/{proposal}/typed-agent-trade-settlement",
            post(execute_typed_agent_trade_settlement),
        )
        .route("/proposals/{proposal}", get(show_proposal))
        .route("/proposals/{proposal}/cleanup", post(cleanup_proposal))
        .route(
            "/prepare/wallets/{name}/proposals/create",
            post(prepare_proposal_create),
        )
        .route(
            "/prepare/wallets/{name}/proposals/typed/create",
            post(prepare_typed_proposal_create),
        )
        .route(
            "/prepare/wallets/{name}/proposals/{proposal}/approve",
            post(prepare_proposal_approve),
        )
        .route(
            "/prepare/wallets/{name}/proposals/{proposal}/typed-approve",
            post(prepare_typed_proposal_approve),
        )
        .route(
            "/prepare/wallets/{name}/proposals/{proposal}/cancel",
            post(prepare_proposal_cancel),
        )
        .route(
            "/prepare/wallets/{name}/proposals/{proposal}/typed-cancel",
            post(prepare_typed_proposal_cancel),
        )
}

async fn create_proposal(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SignedProposalCreateRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    body.pre_signed.ensure_valid()?;
    if body.pre_signed.params_data_hex.is_none() {
        return Err(ApiError::BadRequest(
            "params_data_hex is required for proposal create — build it via /prepare first".into(),
        ));
    }

    let rate_limit_key = body.pre_signed.signer_pubkey.clone();
    let expiry = format_expiry(body.pre_signed.expiry)?;
    let command = clear_msig_command_contract::DirectCommand::ProposalCreate {
        wallet: name,
        intent_index: body.intent_index,
        params: Vec::new(),
        expiry: Some(expiry),
    };
    run_direct_proposal(
        state,
        presigned_context(body.pre_signed),
        command,
        Some(&rate_limit_key),
    )
    .await
}

async fn create_typed_proposal(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SignedTypedProposalCreateRequest>,
) -> Result<Json<Value>, ApiError> {
    run_typed_lifecycle(state, typed_lifecycle::signed_create(name, body)?).await
}

async fn list_proposals(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    let command = clear_msig_command_contract::DirectCommand::ProposalList { wallet: name };
    run_direct_proposal(
        state,
        clear_msig_command_contract::DirectExecutionContext::Backend,
        command,
        None,
    )
    .await
}

async fn show_proposal(
    State(state): State<AppState>,
    Path(proposal): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_base58(&proposal, "proposal", 32, 88)?;
    let command = clear_msig_command_contract::DirectCommand::ProposalShow { proposal };
    run_direct_proposal(
        state,
        clear_msig_command_contract::DirectExecutionContext::Backend,
        command,
        None,
    )
    .await
}

async fn approve_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<SignedApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;
    body.pre_signed.ensure_valid()?;
    if body.pre_signed.signed_message_hex.is_none() {
        return Err(ApiError::BadRequest(
            "signed_message_hex is required for typed proposal vote".into(),
        ));
    }
    let rate_limit_key = body.pre_signed.signer_pubkey.clone();
    let expiry = format_expiry(body.pre_signed.expiry)?;
    let command = clear_msig_command_contract::DirectCommand::ProposalApprove {
        wallet: name,
        proposal,
        expiry: Some(expiry),
    };
    run_direct_proposal(
        state,
        presigned_context(body.pre_signed),
        command,
        Some(&rate_limit_key),
    )
    .await
}

async fn approve_typed_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<SignedApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    run_typed_lifecycle(
        state,
        typed_lifecycle::signed_vote(name, proposal, body, typed_lifecycle::VoteKind::Approve)?,
    )
    .await
}

async fn cancel_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<SignedApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;
    body.pre_signed.ensure_valid()?;
    let rate_limit_key = body.pre_signed.signer_pubkey.clone();
    let expiry = format_expiry(body.pre_signed.expiry)?;
    let command = clear_msig_command_contract::DirectCommand::ProposalCancel {
        wallet: name,
        proposal,
        expiry: Some(expiry),
    };
    run_direct_proposal(
        state,
        presigned_context(body.pre_signed),
        command,
        Some(&rate_limit_key),
    )
    .await
}

async fn cancel_typed_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<SignedApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    run_typed_lifecycle(
        state,
        typed_lifecycle::signed_vote(name, proposal, body, typed_lifecycle::VoteKind::Cancel)?,
    )
    .await
}

async fn prepare_proposal_create(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<PrepareProposalCreateRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_non_empty_vec(&body.params, "params")?;
    for p in &body.params {
        ensure_non_empty(p, "param item")?;
    }
    let actor_pubkey = validate_actor_pubkey(body.actor_pubkey)?;
    let expiry = body
        .expiry
        .map(|value| normalize_expiry_arg(&value))
        .transpose()?;
    let command = clear_msig_command_contract::DirectCommand::ProposalCreate {
        wallet: name,
        intent_index: body.intent_index,
        params: body.params,
        expiry,
    };
    run_direct_proposal(
        state,
        clear_msig_command_contract::DirectExecutionContext::DryRun { actor_pubkey },
        command,
        None,
    )
    .await
}

async fn prepare_typed_proposal_create(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<PrepareTypedProposalCreateRequest>,
) -> Result<Json<Value>, ApiError> {
    run_typed_lifecycle(state, typed_lifecycle::prepare_create(name, body)?).await
}

async fn prepare_proposal_approve(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<PrepareApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    prepare_approve_or_cancel(state, name, proposal, body, true).await
}

async fn prepare_typed_proposal_approve(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<PrepareApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    prepare_typed_approve_or_cancel(state, name, proposal, body, true).await
}

async fn prepare_proposal_cancel(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<PrepareApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    prepare_approve_or_cancel(state, name, proposal, body, false).await
}

async fn prepare_typed_proposal_cancel(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<PrepareApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    prepare_typed_approve_or_cancel(state, name, proposal, body, false).await
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
    let actor_pubkey = validate_actor_pubkey(body.actor_pubkey)?;
    let expiry = body
        .expiry
        .map(|value| normalize_expiry_arg(&value))
        .transpose()?;
    let command = if is_approve {
        clear_msig_command_contract::DirectCommand::ProposalApprove {
            wallet: name,
            proposal,
            expiry,
        }
    } else {
        clear_msig_command_contract::DirectCommand::ProposalCancel {
            wallet: name,
            proposal,
            expiry,
        }
    };
    run_direct_proposal(
        state,
        clear_msig_command_contract::DirectExecutionContext::DryRun { actor_pubkey },
        command,
        None,
    )
    .await
}

async fn prepare_typed_approve_or_cancel(
    state: AppState,
    name: String,
    proposal: String,
    body: PrepareApproveCancelRequest,
    is_approve: bool,
) -> Result<Json<Value>, ApiError> {
    let vote = if is_approve {
        typed_lifecycle::VoteKind::Approve
    } else {
        typed_lifecycle::VoteKind::Cancel
    };
    run_typed_lifecycle(
        state,
        typed_lifecycle::prepare_vote(name, proposal, body, vote)?,
    )
    .await
}

async fn run_typed_lifecycle(
    state: AppState,
    invocation: typed_lifecycle::LifecycleInvocation,
) -> Result<Json<Value>, ApiError> {
    if let Some(key) = invocation.rate_limit_key.as_deref() {
        state.rate_limiter.check(key).await?;
    }
    Ok(Json(
        state
            .runner
            .run_typed_lifecycle(invocation.context, invocation.lifecycle)
            .await?,
    ))
}

async fn execute_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteProposalRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;

    let command = build_execute_command(&state, name, proposal, body)?;
    run_direct_proposal(
        state,
        clear_msig_command_contract::DirectExecutionContext::Backend,
        command,
        None,
    )
    .await
}

async fn execute_typed_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    run_typed_lifecycle(state, typed_lifecycle::execute(name, proposal)?).await
}

async fn execute_typed_escrow_release(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteTypedEscrowReleaseRequest>,
) -> Result<Json<Value>, ApiError> {
    state
        .rate_limiter
        .check(&format!("execute:escrow-release:{name}"))
        .await?;
    let execution = build_typed_escrow_release(name, proposal, body)?;
    Ok(Json(state.runner.run_typed_proposal(execution).await?))
}

async fn execute_typed_escrow_return(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteTypedEscrowReturnRequest>,
) -> Result<Json<Value>, ApiError> {
    state
        .rate_limiter
        .check(&format!("execute:escrow-return:{name}"))
        .await?;
    let execution = build_typed_escrow_return(name, proposal, body)?;
    Ok(Json(state.runner.run_typed_proposal(execution).await?))
}

async fn execute_typed_sol_send(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteTypedSolSendRequest>,
) -> Result<Json<Value>, ApiError> {
    state
        .rate_limiter
        .check(&format!("execute:sol-send:{name}"))
        .await?;
    let execution = build_typed_sol_send(name, proposal, body)?;
    Ok(Json(state.runner.run_typed_proposal(execution).await?))
}

async fn execute_typed_wallet_policy_update(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteTypedWalletPolicyUpdateRequest>,
) -> Result<Json<Value>, ApiError> {
    state
        .rate_limiter
        .check(&format!("execute:wallet-policy:{name}"))
        .await?;
    let execution = build_typed_wallet_policy_update(name, proposal, body)?;
    Ok(Json(state.runner.run_typed_proposal(execution).await?))
}

async fn execute_typed_intent_governance(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteTypedIntentGovernanceRequest>,
) -> Result<Json<Value>, ApiError> {
    state
        .rate_limiter
        .check(&format!("execute:governance:{name}"))
        .await?;
    let execution = build_typed_intent_governance(name, proposal, body)?;
    Ok(Json(state.runner.run_typed_proposal(execution).await?))
}

async fn execute_typed_chain_send(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteTypedChainSendRequest>,
) -> Result<Json<Value>, ApiError> {
    // Ika broadcast is the expensive path — rate-limit tightly per wallet name.
    state
        .rate_limiter
        .check(&format!("execute:chain-send:{name}"))
        .await?;
    let execution = build_typed_chain_send(
        name,
        proposal,
        body,
        state.runner.default_dwallet_program.clone(),
        state.runner.default_grpc_url.clone(),
        state.runner.default_destination_rpc_url.clone(),
    )?;
    Ok(Json(state.runner.run_typed_proposal(execution).await?))
}

async fn execute_typed_sol_batch_send(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteTypedSolBatchSendRequest>,
) -> Result<Json<Value>, ApiError> {
    state
        .rate_limiter
        .check(&format!("execute:sol-batch:{name}"))
        .await?;
    let execution = build_typed_sol_batch_send(name, proposal, body)?;
    Ok(Json(state.runner.run_typed_proposal(execution).await?))
}

async fn execute_typed_agent_trade_approval(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteTypedAgentTradeApprovalRequest>,
) -> Result<Json<Value>, ApiError> {
    state
        .rate_limiter
        .check(&format!("execute:agent-trade:{name}"))
        .await?;
    let execution = build_typed_agent_trade_approval(name, proposal, body)?;
    Ok(Json(state.runner.run_typed_proposal(execution).await?))
}

async fn execute_typed_agent_session_grant(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteTypedAgentSessionGrantRequest>,
) -> Result<Json<Value>, ApiError> {
    state
        .rate_limiter
        .check(&format!("execute:agent-session:{name}"))
        .await?;
    let execution = build_typed_agent_session_grant(name, proposal, body)?;
    Ok(Json(state.runner.run_typed_proposal(execution).await?))
}

async fn execute_typed_agent_risk_policy(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteTypedAgentRiskPolicyRequest>,
) -> Result<Json<Value>, ApiError> {
    state
        .rate_limiter
        .check(&format!("execute:agent-risk:{name}"))
        .await?;
    let execution = build_typed_agent_risk_policy(name, proposal, body)?;
    Ok(Json(state.runner.run_typed_proposal(execution).await?))
}

async fn execute_typed_agent_trade_settlement(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteTypedAgentTradeSettlementRequest>,
) -> Result<Json<Value>, ApiError> {
    state
        .rate_limiter
        .check(&format!("execute:agent-settlement:{name}"))
        .await?;
    let execution = build_typed_agent_trade_settlement(name, proposal, body)?;
    Ok(Json(state.runner.run_typed_proposal(execution).await?))
}

async fn cleanup_proposal(
    State(state): State<AppState>,
    Path(proposal): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ensure_base58(&proposal, "proposal", 32, 88)?;
    let command = clear_msig_command_contract::DirectCommand::ProposalCleanup { proposal };
    run_direct_proposal(
        state,
        clear_msig_command_contract::DirectExecutionContext::Backend,
        command,
        None,
    )
    .await
}

fn build_execute_command(
    state: &AppState,
    name: String,
    proposal: String,
    body: ExecuteProposalRequest,
) -> Result<clear_msig_command_contract::DirectCommand, ApiError> {
    let dwallet_program = resolve_trusted_runtime_value(
        body.dwallet_program,
        state.runner.default_dwallet_program.clone(),
        "dwallet_program",
    )?;
    if let Some(dwallet_program) = &dwallet_program {
        ensure_non_empty(dwallet_program, "dwallet_program")?;
    }

    let grpc_url = resolve_trusted_runtime_value(
        body.grpc_url,
        state.runner.default_grpc_url.clone(),
        "grpc_url",
    )?;
    if let Some(grpc_url) = &grpc_url {
        ensure_non_empty(grpc_url, "grpc_url")?;
    }
    let rpc_url = body
        .rpc_url
        .or_else(|| state.runner.default_destination_rpc_url.clone());
    if let Some(rpc_url) = &rpc_url {
        ensure_non_empty(rpc_url, "rpc_url")?;
    }
    Ok(
        clear_msig_command_contract::DirectCommand::ProposalExecute {
            wallet: name,
            proposal,
            dwallet_program,
            grpc_url,
            rpc_url,
            broadcast: body.broadcast.unwrap_or(false),
        },
    )
}

fn presigned_context(pre_signed: PreSigned) -> clear_msig_command_contract::DirectExecutionContext {
    clear_msig_command_contract::DirectExecutionContext::PreSigned {
        signer_pubkey: pre_signed.signer_pubkey,
        signature: pre_signed.signature,
        params_data: pre_signed.params_data_hex,
        message_flavor: pre_signed.message_flavor,
        signed_message: pre_signed.signed_message_hex,
    }
}

fn validate_actor_pubkey(actor_pubkey: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(actor_pubkey) = actor_pubkey else {
        return Ok(None);
    };
    let actor_pubkey = actor_pubkey.trim();
    if actor_pubkey.is_empty() {
        return Ok(None);
    }
    ensure_base58(actor_pubkey, "actor_pubkey", 32, 44)?;
    Ok(Some(actor_pubkey.to_string()))
}

async fn run_direct_proposal(
    state: AppState,
    context: clear_msig_command_contract::DirectExecutionContext,
    command: clear_msig_command_contract::DirectCommand,
    rate_limit_key: Option<&str>,
) -> Result<Json<Value>, ApiError> {
    if let Some(key) = rate_limit_key {
        state.rate_limiter.check(key).await?;
    }
    Ok(Json(state.runner.run_direct(context, command).await?))
}
