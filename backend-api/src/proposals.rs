use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde_json::Value;

use crate::clearsign::{format_expiry, normalize_expiry_arg, push_pre_signed_flags};
use crate::{
    ensure_base58, ensure_hex, ensure_non_empty, ensure_non_empty_vec, ensure_wallet_name,
    ApiError, AppState,
};

mod typed_execution;
mod types;
mod validation;

use typed_execution::{
    execute_typed_agent_session_grant_args, execute_typed_agent_trade_approval_args,
    execute_typed_chain_send_args, execute_typed_escrow_release_args,
    execute_typed_escrow_return_args, execute_typed_intent_governance_args,
    execute_typed_sol_batch_send_args, execute_typed_sol_send_args,
    execute_typed_wallet_policy_update_args,
};
use types::{
    ExecuteProposalRequest, ExecuteTypedAgentSessionGrantRequest,
    ExecuteTypedAgentTradeApprovalRequest, ExecuteTypedChainSendRequest,
    ExecuteTypedEscrowReleaseRequest, ExecuteTypedEscrowReturnRequest,
    ExecuteTypedIntentGovernanceRequest, ExecuteTypedSolBatchSendRequest,
    ExecuteTypedSolSendRequest, ExecuteTypedWalletPolicyUpdateRequest, PrepareApproveCancelRequest,
    PrepareProposalCreateRequest, PrepareTypedProposalCreateRequest, SignedApproveCancelRequest,
    SignedProposalCreateRequest, SignedTypedProposalCreateRequest,
};
use validation::{push_actor_pubkey, push_typed_pre_signed_flags, validate_typed_create_fields};

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
            "/wallets/{name}/proposals/{proposal}/execute/stream",
            get(stream_execute_proposal),
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
    state
        .rate_limiter
        .check(&body.pre_signed.signer_pubkey)
        .await?;
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

async fn create_typed_proposal(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<SignedTypedProposalCreateRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    validate_typed_create_fields(
        body.action_kind,
        &body.policy_commitment,
        &body.payload_hash,
        &body.envelope_hash,
        &body.action_id,
        &body.nonce,
    )?;
    body.pre_signed.ensure_valid()?;
    if body.pre_signed.signed_message_hex.is_none() {
        return Err(ApiError::BadRequest(
            "signed_message_hex is required for typed proposal create".into(),
        ));
    }
    state
        .rate_limiter
        .check(&body.pre_signed.signer_pubkey)
        .await?;

    let mut args = Vec::with_capacity(26);
    push_typed_pre_signed_flags(&mut args, &body.pre_signed);
    args.extend([
        "proposal".into(),
        "typed-create".into(),
        "--wallet".into(),
        name,
        "--intent-index".into(),
        body.intent_index.to_string(),
        "--action-kind".into(),
        body.action_kind.to_string(),
        "--policy-commitment".into(),
        body.policy_commitment,
        "--payload-hash".into(),
        body.payload_hash,
        "--envelope-hash".into(),
        body.envelope_hash,
        "--action-id".into(),
        body.action_id,
        "--nonce".into(),
        body.nonce,
        "--expiry".into(),
        format_expiry(body.pre_signed.expiry)?,
    ]);
    if let Some(policy_bytes_hex) = body.policy_bytes_hex {
        ensure_hex(&policy_bytes_hex, "policyBytesHex")?;
        args.extend(["--policy-bytes-hex".into(), policy_bytes_hex]);
    }
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
    if body.pre_signed.signed_message_hex.is_none() {
        return Err(ApiError::BadRequest(
            "signed_message_hex is required for typed proposal vote".into(),
        ));
    }
    state
        .rate_limiter
        .check(&body.pre_signed.signer_pubkey)
        .await?;

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

async fn approve_typed_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<SignedApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    typed_approve_or_cancel(state, name, proposal, body, true).await
}

async fn cancel_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<SignedApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;
    body.pre_signed.ensure_valid()?;
    state
        .rate_limiter
        .check(&body.pre_signed.signer_pubkey)
        .await?;

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

async fn cancel_typed_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<SignedApproveCancelRequest>,
) -> Result<Json<Value>, ApiError> {
    typed_approve_or_cancel(state, name, proposal, body, false).await
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
        args.push("--expiry".into());
        args.push(normalize_expiry_arg(&e)?);
    }
    Ok(Json(state.runner.run_json(args).await?))
}

async fn prepare_typed_proposal_create(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<PrepareTypedProposalCreateRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    validate_typed_create_fields(
        body.action_kind,
        &body.policy_commitment,
        &body.payload_hash,
        &body.envelope_hash,
        &body.action_id,
        &body.nonce,
    )?;
    ensure_non_empty(&body.signable_text, "signable_text")?;
    let mut args = vec!["--dry-run".into()];
    push_actor_pubkey(&mut args, &body.actor_pubkey)?;
    args.extend([
        "proposal".into(),
        "typed-create".into(),
        "--wallet".into(),
        name,
        "--intent-index".into(),
        body.intent_index.to_string(),
        "--action-kind".into(),
        body.action_kind.to_string(),
        "--policy-commitment".into(),
        body.policy_commitment,
        "--payload-hash".into(),
        body.payload_hash,
        "--envelope-hash".into(),
        body.envelope_hash,
        "--action-id".into(),
        body.action_id,
        "--nonce".into(),
        body.nonce,
        "--signable-text".into(),
        body.signable_text,
    ]);
    if let Some(policy_bytes_hex) = body.policy_bytes_hex {
        ensure_hex(&policy_bytes_hex, "policyBytesHex")?;
        args.extend(["--policy-bytes-hex".into(), policy_bytes_hex]);
    }
    if let Some(e) = body.expiry {
        args.push("--expiry".into());
        args.push(normalize_expiry_arg(&e)?);
    }
    Ok(Json(state.runner.run_json(args).await?))
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
    let mut args = vec!["--dry-run".into()];
    push_actor_pubkey(&mut args, &body.actor_pubkey)?;
    args.extend([
        "proposal".into(),
        if is_approve {
            "approve".into()
        } else {
            "cancel".into()
        },
        "--wallet".into(),
        name,
        "--proposal".into(),
        proposal,
    ]);
    if let Some(e) = body.expiry {
        args.push("--expiry".into());
        args.push(normalize_expiry_arg(&e)?);
    }
    Ok(Json(state.runner.run_json(args).await?))
}

async fn prepare_typed_approve_or_cancel(
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
        if is_approve {
            "typed-approve".into()
        } else {
            "typed-cancel".into()
        },
        "--wallet".into(),
        name,
        "--proposal".into(),
        proposal,
    ]);
    Ok(Json(state.runner.run_json(args).await?))
}

async fn execute_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Json(body): Json<ExecuteProposalRequest>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;

    let args = build_execute_args(&state, name, proposal, body)?;
    Ok(Json(state.runner.run_json(args).await?))
}

async fn execute_typed_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;
    Ok(Json(
        state
            .runner
            .run_json(vec![
                "proposal".into(),
                "typed-execute".into(),
                "--wallet".into(),
                name,
                "--proposal".into(),
                proposal,
            ])
            .await?,
    ))
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
    let args = execute_typed_escrow_release_args(name, proposal, body)?;
    Ok(Json(state.runner.run_json(args).await?))
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
    let args = execute_typed_escrow_return_args(name, proposal, body)?;
    Ok(Json(state.runner.run_json(args).await?))
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
    let args = execute_typed_sol_send_args(name, proposal, body)?;
    Ok(Json(state.runner.run_json(args).await?))
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
    let args = execute_typed_wallet_policy_update_args(name, proposal, body)?;
    Ok(Json(state.runner.run_json(args).await?))
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
    let args = execute_typed_intent_governance_args(name, proposal, body)?;
    Ok(Json(state.runner.run_json(args).await?))
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
    let args = execute_typed_chain_send_args(
        name,
        proposal,
        body,
        state.runner.default_dwallet_program.clone(),
        state.runner.default_grpc_url.clone(),
        state.runner.default_destination_rpc_url.clone(),
    )?;
    Ok(Json(state.runner.run_json(args).await?))
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
    let args = execute_typed_sol_batch_send_args(name, proposal, body)?;
    Ok(Json(state.runner.run_json(args).await?))
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
    let args = execute_typed_agent_trade_approval_args(name, proposal, body)?;
    Ok(Json(state.runner.run_json(args).await?))
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
    let args = execute_typed_agent_session_grant_args(name, proposal, body)?;
    Ok(Json(state.runner.run_json(args).await?))
}

async fn stream_execute_proposal(
    State(state): State<AppState>,
    Path((name, proposal)): Path<(String, String)>,
    Query(body): Query<ExecuteProposalRequest>,
) -> Result<
    axum::response::sse::Sse<
        impl futures_core::Stream<
            Item = std::result::Result<axum::response::sse::Event, std::convert::Infallible>,
        >,
    >,
    ApiError,
> {
    use axum::response::sse::{Event, KeepAlive, Sse};
    use futures_util::StreamExt;

    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;
    let args = build_execute_args(&state, name, proposal, body)?;
    let invocation = state.runner.validated_invocation(&args)?;

    let (tx, rx) = tokio::sync::mpsc::channel::<Event>(32);
    let runner = state.runner.clone();
    tokio::spawn(async move {
        use std::process::Stdio;
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
        use tokio::process::Command;

        use crate::runner::MAX_CHILD_OUTPUT_BYTES;

        let mut cmd = Command::new(&runner.cli_bin);
        cmd.args(&invocation)
            .kill_on_drop(true)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let child =
            match cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    let _ = tx
                        .send(Event::default().event("error").data(
                            serde_json::json!({ "error": format!("spawn: {e}") }).to_string(),
                        ))
                        .await;
                    return;
                }
            };
        let mut child = child;
        let stderr =
            match child.stderr.take() {
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

        let tx_err = tx.clone();
        let stderr_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr.take(MAX_CHILD_OUTPUT_BYTES)).lines();
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

        let stdout_task = tokio::spawn(async move {
            if let Some(stdout) = stdout {
                let mut buf = Vec::new();
                let result = stdout
                    .take(MAX_CHILD_OUTPUT_BYTES + 1)
                    .read_to_end(&mut buf)
                    .await;
                (result, buf)
            } else {
                (Ok(0), Vec::new())
            }
        });

        let status =
            match tokio::time::timeout(runner.timeout, child.wait()).await {
                Err(_) => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    stdout_task.abort();
                    stderr_task.abort();
                    let _ = tx
                        .send(Event::default().event("error").data(
                            serde_json::json!({ "error": "execution timed out" }).to_string(),
                        ))
                        .await;
                    return;
                }
                Ok(result) => match result {
                    Ok(s) => s,
                    Err(e) => {
                        stdout_task.abort();
                        stderr_task.abort();
                        let _ = tx
                            .send(Event::default().event("error").data(
                                serde_json::json!({ "error": format!("wait: {e}") }).to_string(),
                            ))
                            .await;
                        return;
                    }
                },
            };

        let stdout_bytes =
            match stdout_task.await {
                Ok((Ok(_), bytes)) if bytes.len() as u64 <= MAX_CHILD_OUTPUT_BYTES => bytes,
                _ => {
                    stderr_task.abort();
                    let _ = tx
                    .send(Event::default().event("error").data(
                        serde_json::json!({ "error": "invalid or oversized command output" })
                            .to_string(),
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
                .send(
                    Event::default().event("error").data(
                        serde_json::json!({
                            "code": status.code(),
                            "stdout": stdout_str,
                        })
                        .to_string(),
                    ),
                )
                .await;
        }
    });

    let stream = tokio_stream::wrappers::ReceiverStream::new(rx)
        .map(std::result::Result::<_, std::convert::Infallible>::Ok);
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

fn build_execute_args(
    state: &AppState,
    name: String,
    proposal: String,
    body: ExecuteProposalRequest,
) -> Result<Vec<String>, ApiError> {
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

    let grpc_url = body
        .grpc_url
        .or_else(|| state.runner.default_grpc_url.clone());
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
    }

    Ok(args)
}

async fn typed_approve_or_cancel(
    state: AppState,
    name: String,
    proposal: String,
    body: SignedApproveCancelRequest,
    is_approve: bool,
) -> Result<Json<Value>, ApiError> {
    ensure_wallet_name(&name, "name")?;
    ensure_base58(&proposal, "proposal", 32, 88)?;
    body.pre_signed.ensure_valid()?;
    state
        .rate_limiter
        .check(&body.pre_signed.signer_pubkey)
        .await?;

    let mut args = Vec::with_capacity(10);
    push_typed_pre_signed_flags(&mut args, &body.pre_signed);
    args.extend([
        "proposal".into(),
        if is_approve {
            "typed-approve".into()
        } else {
            "typed-cancel".into()
        },
        "--wallet".into(),
        name,
        "--proposal".into(),
        proposal,
    ]);
    Ok(Json(state.runner.run_json(args).await?))
}
