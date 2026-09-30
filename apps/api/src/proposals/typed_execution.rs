use crate::{
    ensure_base58, ensure_hex, ensure_hex_exact_len, ensure_intent_filename, ensure_wallet_name,
    resolve_trusted_runtime_value, ApiError,
};
use clear_msig_command_contract::{LamportPayment, TypedProposalExecution};

mod asset_policy;
mod escrow;

pub(super) use asset_policy::*;
pub(super) use escrow::*;

use super::types::{
    ExecuteTypedAgentSessionGrantRequest, ExecuteTypedAgentTradeApprovalRequest,
    ExecuteTypedChainSendRequest, ExecuteTypedIntentGovernanceRequest,
    ExecuteTypedRecurringScheduleRequest, ExecuteTypedRecurringTokenScheduleRequest,
    ExecuteTypedSolBatchSendRequest, ExecuteTypedSolSendRequest,
    ExecuteTypedWalletPolicyUpdateRequest,
};

pub(super) fn execute_typed_recurring_schedule(
    name: String,
    proposal: String,
    body: ExecuteTypedRecurringScheduleRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_bounded_text(&body.schedule_id, "scheduleId")?;
    ensure_positive_lamports(body.amount_lamports, "amountLamports")?;
    if body.interval_seconds < 3_600 {
        return Err(ApiError::BadRequest(
            "intervalSeconds must be at least 3600".into(),
        ));
    }
    if !(1..=1_000).contains(&body.payment_count) {
        return Err(ApiError::BadRequest(
            "paymentCount must be between 1 and 1000".into(),
        ));
    }
    if !matches!(body.status, 1 | 2) {
        return Err(ApiError::BadRequest("status must be 1 or 2".into()));
    }
    Ok(TypedProposalExecution::RecurringSchedule {
        wallet: name,
        proposal,
        schedule_id: body.schedule_id,
        recipient: validated_base58(body.recipient, "recipient")?,
        amount_lamports: body.amount_lamports,
        interval_seconds: body.interval_seconds,
        first_execution_at: body.first_execution_at,
        payment_count: body.payment_count,
        status: body.status,
    })
}

pub(super) fn execute_typed_recurring_token_schedule(
    name: String,
    proposal: String,
    body: ExecuteTypedRecurringTokenScheduleRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_bounded_text(&body.schedule_id, "scheduleId")?;
    ensure_positive_lamports(body.amount_tokens, "amountTokens")?;
    if body.interval_seconds < 3_600 {
        return Err(ApiError::BadRequest(
            "intervalSeconds must be at least 3600".into(),
        ));
    }
    if !(1..=1_000).contains(&body.payment_count) {
        return Err(ApiError::BadRequest(
            "paymentCount must be between 1 and 1000".into(),
        ));
    }
    if !matches!(body.status, 1 | 2) {
        return Err(ApiError::BadRequest("status must be 1 or 2".into()));
    }
    const DEVNET_USDC: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    if body.mint != DEVNET_USDC {
        return Err(ApiError::BadRequest(
            "mint must be issuer-published Solana devnet USDC".into(),
        ));
    }
    Ok(TypedProposalExecution::RecurringTokenSchedule {
        wallet: name,
        proposal,
        schedule_id: body.schedule_id,
        mint: validated_base58(body.mint, "mint")?,
        source_token: validated_base58(body.source_token, "sourceToken")?,
        destination_token: validated_base58(body.destination_token, "destinationToken")?,
        recipient_owner: validated_base58(body.recipient_owner, "recipientOwner")?,
        amount_tokens: body.amount_tokens,
        interval_seconds: body.interval_seconds,
        first_execution_at: body.first_execution_at,
        payment_count: body.payment_count,
        status: body.status,
    })
}

pub(super) fn execute_typed_sol_send(
    name: String,
    proposal: String,
    body: ExecuteTypedSolSendRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_positive_lamports(body.amount_lamports, "amountLamports")?;

    Ok(TypedProposalExecution::SolSend {
        wallet: name,
        proposal,
        recipient: validated_base58(body.recipient, "recipient")?,
        amount_lamports: body.amount_lamports,
    })
}

#[cfg(test)]
mod recurring_token_tests {
    use super::*;

    fn request(mint: &str) -> ExecuteTypedRecurringTokenScheduleRequest {
        ExecuteTypedRecurringTokenScheduleRequest {
            schedule_id: "payroll-1".into(),
            mint: mint.into(),
            source_token: "11111111111111111111111111111111".into(),
            destination_token: "11111111111111111111111111111111".into(),
            recipient_owner: "11111111111111111111111111111111".into(),
            amount_tokens: 1_250_000,
            interval_seconds: 86_400,
            first_execution_at: 1_800_000_000,
            payment_count: 12,
            status: 1,
        }
    }

    #[test]
    fn recurring_token_boundary_allows_only_devnet_usdc() {
        let usdc = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
        assert!(execute_typed_recurring_token_schedule(
            "Team".into(),
            "11111111111111111111111111111111".into(),
            request(usdc),
        )
        .is_ok());
        assert!(execute_typed_recurring_token_schedule(
            "Team".into(),
            "11111111111111111111111111111111".into(),
            request("11111111111111111111111111111111"),
        )
        .is_err());
    }
}

pub(super) fn execute_typed_wallet_policy_update(
    name: String,
    proposal: String,
    body: ExecuteTypedWalletPolicyUpdateRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_optional_hex(&body.policy_bytes_hex, "policyBytesHex")?;

    Ok(TypedProposalExecution::WalletPolicyUpdate {
        wallet: name,
        proposal,
        policy_bytes_hex: body.policy_bytes_hex,
        chain_kind: body.chain_kind,
    })
}

pub(super) fn execute_typed_intent_governance(
    name: String,
    proposal: String,
    body: ExecuteTypedIntentGovernanceRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    if let Some(action_kind) = body.action_kind {
        if !matches!(action_kind, 3..=5) {
            return Err(ApiError::BadRequest(
                "actionKind must be 3 (add_member), 4 (remove_member), or 5 (change_threshold)"
                    .into(),
            ));
        }
    }
    let mut file = None;
    let mut proposers = None;
    let mut approvers = None;
    let mut threshold = None;
    if let Some(hex) = body.new_intent_body_hex {
        ensure_optional_hex(&hex, "newIntentBodyHex")?;
        if body.target_index.is_none() {
            return Err(ApiError::BadRequest(
                "targetIndex is required with newIntentBodyHex".into(),
            ));
        }
        return Ok(TypedProposalExecution::IntentGovernance {
            wallet: name,
            proposal,
            action_kind: body.action_kind,
            target_index: body.target_index,
            new_intent_body_hex: Some(hex),
            file,
            proposers,
            approvers,
            threshold,
            cancellation_threshold: body.cancellation_threshold.unwrap_or(1),
            timelock: body.timelock.unwrap_or(0),
        });
    } else if body.file.is_none() {
        // With no explicit rebuild input, the CLI resumes from the execution
        // payload committed in the on-chain typed proposal.
    } else {
        if body.target_index.is_none() {
            return Err(ApiError::BadRequest(
                "targetIndex is required when building from file".into(),
            ));
        }
        file = body.file;
        ensure_intent_filename(file.as_deref().unwrap_or_default(), "file")?;
        let validated_proposers = body.proposers.ok_or_else(|| {
            ApiError::BadRequest("proposers is required when building from file".into())
        })?;
        validate_members(&validated_proposers, "proposers")?;
        proposers = Some(validated_proposers);
        let validated_approvers = body.approvers.ok_or_else(|| {
            ApiError::BadRequest("approvers is required when building from file".into())
        })?;
        validate_members(&validated_approvers, "approvers")?;
        approvers = Some(validated_approvers);
        threshold = Some(body.threshold.ok_or_else(|| {
            ApiError::BadRequest("threshold is required when building from file".into())
        })?);
    }
    Ok(TypedProposalExecution::IntentGovernance {
        wallet: name,
        proposal,
        action_kind: body.action_kind,
        target_index: body.target_index,
        new_intent_body_hex: None,
        file,
        proposers,
        approvers,
        threshold,
        cancellation_threshold: body.cancellation_threshold.unwrap_or(1),
        timelock: body.timelock.unwrap_or(0),
    })
}

pub(super) fn execute_typed_chain_send(
    name: String,
    proposal: String,
    body: ExecuteTypedChainSendRequest,
    default_dwallet_program: Option<String>,
    default_grpc_url: Option<String>,
    default_rpc_url: Option<String>,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    if body.chain_kind == 0 {
        return Err(ApiError::BadRequest(
            "chainKind must be a remote chain kind".into(),
        ));
    }
    let amount_raw = parse_positive_u128(&body.amount_raw, "amountRaw")?;
    let recipient_hash = validated_hash(body.recipient_hash, "recipientHash")?;
    let asset_id_hash = validated_hash(body.asset_id_hash, "assetIdHash")?;

    let typed_ika = body.params_data_hex.is_some()
        || body.dwallet_program.is_some()
        || body.grpc_url.is_some()
        || body.rpc_url.is_some()
        || body.broadcast.unwrap_or(false);
    if typed_ika {
        if !matches!(body.chain_kind, 1..=5) {
            return Err(ApiError::BadRequest(
                "typed Ika chain send currently supports chain kinds 1 through 5".into(),
            ));
        }
        let params_data_hex = body.params_data_hex.ok_or_else(|| {
            ApiError::BadRequest("paramsDataHex is required for typed Ika chain send".into())
        })?;
        ensure_hex(&params_data_hex, "paramsDataHex")?;
        ensure_max_value_bytes(&params_data_hex, "paramsDataHex")?;
        let dwallet_program = resolve_trusted_runtime_value(
            body.dwallet_program,
            default_dwallet_program,
            "dwalletProgram",
        )?
        .ok_or_else(|| {
            ApiError::BadRequest("dwalletProgram is required for typed Ika chain send".into())
        })?;
        ensure_bounded_text(&dwallet_program, "dwalletProgram")?;
        let grpc_url = resolve_trusted_runtime_value(body.grpc_url, default_grpc_url, "grpcUrl")?;
        if let Some(grpc_url) = &grpc_url {
            ensure_bounded_text(grpc_url, "grpcUrl")?;
        }
        let rpc_url = resolve_trusted_runtime_value(body.rpc_url, default_rpc_url, "rpcUrl")?;
        if let Some(rpc_url) = &rpc_url {
            ensure_bounded_text(rpc_url, "rpcUrl")?;
        }
        return Ok(TypedProposalExecution::ChainSendIka {
            wallet: name,
            proposal,
            chain_kind: body.chain_kind,
            amount_raw,
            recipient_hash,
            asset_id_hash,
            params_data_hex,
            dwallet_program,
            grpc_url,
            rpc_url,
            broadcast: body.broadcast.unwrap_or(false),
        });
    }
    Ok(TypedProposalExecution::ChainSend {
        wallet: name,
        proposal,
        chain_kind: body.chain_kind,
        amount_raw,
        recipient_hash,
        asset_id_hash,
    })
}

pub(super) fn execute_typed_sol_batch_send(
    name: String,
    proposal: String,
    body: ExecuteTypedSolBatchSendRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_bounded_rows(body.payments.len(), "payments")?;

    let payments = body
        .payments
        .into_iter()
        .map(|row| {
            validated_lamport_payment(
                row.recipient,
                row.amount_lamports,
                "payments.recipient",
                "payments.amountLamports",
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(TypedProposalExecution::SolBatchSend {
        wallet: name,
        proposal,
        payments,
    })
}

pub(super) fn execute_typed_agent_trade_approval(
    name: String,
    proposal: String,
    body: ExecuteTypedAgentTradeApprovalRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    let amount_raw = parse_positive_u128(&body.amount_raw, "amountRaw")?;
    if body.max_leverage_x100 == 0 {
        return Err(ApiError::BadRequest(
            "maxLeverageX100 must be greater than zero".into(),
        ));
    }
    let venue_hash = validated_hash(body.venue_hash, "venueHash")?;
    let agent_id_hash = validated_hash(body.agent_id_hash, "agentIdHash")?;
    let market_hash = validated_hash(body.market_hash, "marketHash")?;
    let side_hash = validated_hash(body.side_hash, "sideHash")?;
    let asset_id_hash = validated_hash(body.asset_id_hash, "assetIdHash")?;
    let session_id_hash = validated_hash(body.session_id_hash, "sessionIdHash")?;
    let route_hash = validated_hash(body.route_hash, "routeHash")?;
    let risk_check_hash = validated_hash(body.risk_check_hash, "riskCheckHash")?;

    Ok(TypedProposalExecution::AgentTradeApproval {
        wallet: name,
        proposal,
        amount_raw,
        agent_id_hash,
        venue_hash,
        market_hash,
        side_hash,
        asset_id_hash,
        max_leverage_x100: body.max_leverage_x100,
        session_id_hash,
        route_hash,
        risk_check_hash,
    })
}

pub(super) fn execute_typed_agent_session_grant(
    name: String,
    proposal: String,
    body: ExecuteTypedAgentSessionGrantRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    if body.status != 1 && body.status != 2 {
        return Err(ApiError::BadRequest("status must be 1 or 2".into()));
    }
    let max_notional = body
        .max_notional_raw
        .trim()
        .parse::<u128>()
        .map_err(|_| ApiError::BadRequest("maxNotionalRaw must be an integer".into()))?;
    if body.status == 1 && (max_notional == 0 || body.max_leverage_x100 == 0) {
        return Err(ApiError::BadRequest(
            "active sessions require positive maxNotionalRaw and maxLeverageX100".into(),
        ));
    }
    Ok(TypedProposalExecution::AgentSessionGrant {
        wallet: name,
        proposal,
        session_id_hash: validated_hash(body.session_id_hash, "sessionIdHash")?,
        agent_id_hash: validated_hash(body.agent_id_hash, "agentIdHash")?,
        venue_hash: validated_hash(body.venue_hash, "venueHash")?,
        market_hash: validated_hash(body.market_hash, "marketHash")?,
        max_notional_raw: max_notional,
        max_leverage_x100: body.max_leverage_x100,
        expires_at: body.expires_at,
        status: body.status,
    })
}

pub(super) fn ensure_wallet_proposal(name: &str, proposal: &str) -> Result<(), ApiError> {
    ensure_wallet_name(name, "name")?;
    ensure_base58(proposal, "proposal", 32, 88)?;
    Ok(())
}

fn ensure_optional_hex(value: &str, field: &str) -> Result<(), ApiError> {
    ensure_max_value_bytes(value, field)?;
    let trimmed = value.trim();
    let hex = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    if hex.is_empty() {
        return Ok(());
    }
    ensure_hex(value, field)
}

fn ensure_bounded_text(value: &str, field: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError::BadRequest(format!("{field} must not be empty")));
    }
    ensure_max_value_bytes(value, field)
}

fn ensure_max_value_bytes(value: &str, field: &str) -> Result<(), ApiError> {
    if value.len() > 16 * 1024 {
        return Err(ApiError::BadRequest(format!(
            "{field} must be 16384 bytes or fewer"
        )));
    }
    if value
        .chars()
        .any(|character| matches!(character, '\0' | '\n' | '\r'))
    {
        return Err(ApiError::BadRequest(format!(
            "{field} must not contain control separators"
        )));
    }
    Ok(())
}

fn validate_members(values: &[String], field: &str) -> Result<(), ApiError> {
    if values.is_empty() || values.len() > 64 {
        return Err(ApiError::BadRequest(format!(
            "{field} must contain between 1 and 64 members"
        )));
    }
    for value in values {
        ensure_base58(value, field, 32, 44)?;
    }
    Ok(())
}

fn ensure_positive_lamports(amount: u64, field: &str) -> Result<(), ApiError> {
    if amount == 0 {
        return Err(ApiError::BadRequest(format!(
            "{field} must be greater than zero"
        )));
    }
    Ok(())
}

fn ensure_bounded_rows(len: usize, field: &str) -> Result<(), ApiError> {
    if len == 0 {
        return Err(ApiError::BadRequest(format!(
            "{field} must include at least one recipient"
        )));
    }
    if len > 16 {
        return Err(ApiError::BadRequest(format!(
            "{field} supports at most 16 recipients"
        )));
    }
    Ok(())
}

pub(super) fn parse_positive_u128(value: &str, field: &str) -> Result<u128, ApiError> {
    let parsed = value
        .trim()
        .parse::<u128>()
        .map_err(|_| ApiError::BadRequest(format!("{field} must be a positive integer")))?;
    if parsed == 0 {
        return Err(ApiError::BadRequest(format!(
            "{field} must be greater than zero"
        )));
    }
    Ok(parsed)
}

fn validated_base58(value: String, field: &str) -> Result<String, ApiError> {
    ensure_base58(&value, field, 32, 44)?;
    Ok(value)
}

pub(super) fn validated_hash(value: String, field: &str) -> Result<String, ApiError> {
    ensure_hex_exact_len(&value, field, 32)?;
    Ok(value.trim().to_lowercase())
}

fn validated_lamport_payment(
    recipient: String,
    amount_lamports: u64,
    recipient_field: &str,
    amount_field: &str,
) -> Result<LamportPayment, ApiError> {
    let recipient = validated_base58(recipient, recipient_field)?;
    ensure_positive_lamports(amount_lamports, amount_field)?;
    Ok(LamportPayment {
        recipient,
        amount_lamports,
    })
}

#[cfg(test)]
mod tests;
