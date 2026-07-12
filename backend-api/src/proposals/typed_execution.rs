use crate::{
    ensure_base58, ensure_hex, ensure_hex_exact_len, ensure_intent_filename, ensure_wallet_name,
    ApiError,
};
use clear_msig_cli::{LamportPayment, TypedProposalExecution};

use super::types::{
    ExecuteTypedAgentSessionGrantRequest, ExecuteTypedAgentTradeApprovalRequest,
    ExecuteTypedChainSendRequest, ExecuteTypedEscrowReleaseRequest,
    ExecuteTypedEscrowReturnRequest, ExecuteTypedIntentGovernanceRequest,
    ExecuteTypedSolBatchSendRequest, ExecuteTypedSolSendRequest,
    ExecuteTypedWalletPolicyUpdateRequest,
};

pub(super) fn execute_typed_escrow_release(
    name: String,
    proposal: String,
    body: ExecuteTypedEscrowReleaseRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_bounded_text(&body.escrow_id, "escrowId")?;
    ensure_bounded_text(&body.milestone_id, "milestoneId")?;
    ensure_positive_lamports(body.amount_lamports, "amountLamports")?;

    Ok(TypedProposalExecution::EscrowRelease {
        wallet: name,
        proposal,
        recipient: validated_base58(body.recipient, "recipient")?,
        amount_lamports: body.amount_lamports,
        escrow_id: body.escrow_id,
        milestone_id: body.milestone_id,
    })
}

pub(super) fn execute_typed_escrow_return(
    name: String,
    proposal: String,
    body: ExecuteTypedEscrowReturnRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_bounded_text(&body.escrow_id, "escrowId")?;
    ensure_bounded_rows(body.returns.len(), "returns")?;

    let returns = body
        .returns
        .into_iter()
        .map(|row| {
            validated_lamport_payment(
                row.recipient,
                row.amount_lamports,
                "returns.recipient",
                "returns.amountLamports",
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(TypedProposalExecution::EscrowReturn {
        wallet: name,
        proposal,
        escrow_id: body.escrow_id,
        returns,
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
        let dwallet_program = body
            .dwallet_program
            .or(default_dwallet_program)
            .ok_or_else(|| {
                ApiError::BadRequest("dwalletProgram is required for typed Ika chain send".into())
            })?;
        ensure_bounded_text(&dwallet_program, "dwalletProgram")?;
        let grpc_url = body.grpc_url.or(default_grpc_url);
        if let Some(grpc_url) = &grpc_url {
            ensure_bounded_text(grpc_url, "grpcUrl")?;
        }
        let rpc_url = body.rpc_url.or(default_rpc_url);
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

fn ensure_wallet_proposal(name: &str, proposal: &str) -> Result<(), ApiError> {
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

fn parse_positive_u128(value: &str, field: &str) -> Result<u128, ApiError> {
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

fn validated_hash(value: String, field: &str) -> Result<String, ApiError> {
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
mod tests {
    use super::*;
    use crate::proposals::types::{
        ExecuteTypedAgentTradeApprovalRequest, ExecuteTypedChainSendRequest,
        ExecuteTypedEscrowReturnRow, ExecuteTypedIntentGovernanceRequest,
        ExecuteTypedSolBatchSendRow,
    };

    const VALID_PUBKEY: &str = "11111111111111111111111111111111";
    const VALID_HASH: &str = "8a58cb501c3269e8abe8f456629b04e12855131b2e8b1e6807749817d167a9d4";

    fn bad_request_message<T: std::fmt::Debug>(result: Result<T, ApiError>) -> String {
        match result {
            Err(ApiError::BadRequest(message)) => message,
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn typed_sol_send_builds_typed_command() {
        let execution = execute_typed_sol_send(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedSolSendRequest {
                recipient: VALID_PUBKEY.into(),
                amount_lamports: 1_000_000,
            },
        )
        .unwrap();

        assert_eq!(
            execution,
            TypedProposalExecution::SolSend {
                wallet: "team".into(),
                proposal: VALID_PUBKEY.into(),
                recipient: VALID_PUBKEY.into(),
                amount_lamports: 1_000_000,
            }
        );
    }

    #[test]
    fn typed_escrow_release_builds_typed_command() {
        let execution = execute_typed_escrow_release(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedEscrowReleaseRequest {
                recipient: VALID_PUBKEY.into(),
                amount_lamports: 2_000_000,
                escrow_id: "escrow-1".into(),
                milestone_id: "milestone-1".into(),
            },
        )
        .unwrap();

        assert_eq!(
            execution,
            TypedProposalExecution::EscrowRelease {
                wallet: "team".into(),
                proposal: VALID_PUBKEY.into(),
                recipient: VALID_PUBKEY.into(),
                amount_lamports: 2_000_000,
                escrow_id: "escrow-1".into(),
                milestone_id: "milestone-1".into(),
            }
        );
    }

    #[test]
    fn typed_chain_send_builds_typed_command() {
        let execution = execute_typed_chain_send(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedChainSendRequest {
                chain_kind: 1,
                amount_raw: "1000000000000000000".into(),
                recipient_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
                params_data_hex: None,
                dwallet_program: None,
                grpc_url: None,
                rpc_url: None,
                broadcast: None,
            },
            None,
            None,
            None,
        )
        .unwrap();

        assert_eq!(
            execution,
            TypedProposalExecution::ChainSend {
                wallet: "team".into(),
                proposal: VALID_PUBKEY.into(),
                chain_kind: 1,
                amount_raw: 1_000_000_000_000_000_000,
                recipient_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
            }
        );
    }

    #[test]
    fn typed_intent_governance_builds_typed_command() {
        let execution = execute_typed_intent_governance(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedIntentGovernanceRequest {
                action_kind: Some(5),
                target_index: Some(3),
                new_intent_body_hex: Some("020304".into()),
                file: None,
                proposers: None,
                approvers: None,
                threshold: None,
                cancellation_threshold: None,
                timelock: None,
            },
        )
        .unwrap();

        assert_eq!(
            execution,
            TypedProposalExecution::IntentGovernance {
                wallet: "team".into(),
                proposal: VALID_PUBKEY.into(),
                action_kind: Some(5),
                target_index: Some(3),
                new_intent_body_hex: Some("020304".into()),
                file: None,
                proposers: None,
                approvers: None,
                threshold: None,
                cancellation_threshold: 1,
                timelock: 0,
            }
        );
    }

    #[test]
    fn typed_intent_governance_rejects_unknown_action_kind() {
        let error = bad_request_message(execute_typed_intent_governance(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedIntentGovernanceRequest {
                action_kind: Some(9),
                target_index: Some(3),
                new_intent_body_hex: Some("020304".into()),
                file: None,
                proposers: None,
                approvers: None,
                threshold: None,
                cancellation_threshold: None,
                timelock: None,
            },
        ));
        assert_eq!(
            error,
            "actionKind must be 3 (add_member), 4 (remove_member), or 5 (change_threshold)"
        );
    }

    #[test]
    fn typed_intent_governance_can_resume_from_committed_proposal_payload() {
        let execution = execute_typed_intent_governance(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedIntentGovernanceRequest {
                action_kind: None,
                target_index: None,
                new_intent_body_hex: None,
                file: None,
                proposers: None,
                approvers: None,
                threshold: None,
                cancellation_threshold: None,
                timelock: None,
            },
        )
        .unwrap();

        assert_eq!(
            execution,
            TypedProposalExecution::IntentGovernance {
                wallet: "team".into(),
                proposal: VALID_PUBKEY.into(),
                action_kind: None,
                target_index: None,
                new_intent_body_hex: None,
                file: None,
                proposers: None,
                approvers: None,
                threshold: None,
                cancellation_threshold: 1,
                timelock: 0,
            }
        );
    }

    #[test]
    fn typed_chain_send_ika_resolves_defaults_into_typed_command() {
        let execution = execute_typed_chain_send(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedChainSendRequest {
                chain_kind: 5,
                amount_raw: "42000000000000000".into(),
                recipient_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
                params_data_hex: Some("01020304".into()),
                dwallet_program: None,
                grpc_url: None,
                rpc_url: None,
                broadcast: Some(true),
            },
            Some(VALID_PUBKEY.into()),
            Some("https://ika.example".into()),
            Some("https://rpc.example".into()),
        )
        .unwrap();

        assert_eq!(
            execution,
            TypedProposalExecution::ChainSendIka {
                wallet: "team".into(),
                proposal: VALID_PUBKEY.into(),
                chain_kind: 5,
                amount_raw: 42_000_000_000_000_000,
                recipient_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
                params_data_hex: "01020304".into(),
                dwallet_program: VALID_PUBKEY.into(),
                grpc_url: Some("https://ika.example".into()),
                rpc_url: Some("https://rpc.example".into()),
                broadcast: true,
            }
        );
    }

    #[test]
    fn typed_chain_send_ika_allows_all_remote_send_kinds() {
        for chain_kind in [1, 2, 3, 4, 5] {
            let execution = execute_typed_chain_send(
                "team".into(),
                VALID_PUBKEY.into(),
                ExecuteTypedChainSendRequest {
                    chain_kind,
                    amount_raw: "1000".into(),
                    recipient_hash: VALID_HASH.into(),
                    asset_id_hash: VALID_HASH.into(),
                    params_data_hex: Some("01020304".into()),
                    dwallet_program: None,
                    grpc_url: None,
                    rpc_url: None,
                    broadcast: Some(false),
                },
                Some(VALID_PUBKEY.into()),
                Some("https://ika.example".into()),
                Some("https://rpc.example".into()),
            )
            .unwrap();

            assert!(matches!(
                execution,
                TypedProposalExecution::ChainSendIka {
                    chain_kind: actual,
                    ..
                } if actual == chain_kind
            ));
        }
    }

    #[test]
    fn typed_chain_send_rejects_sol_chain_kind() {
        let error = bad_request_message(execute_typed_chain_send(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedChainSendRequest {
                chain_kind: 0,
                amount_raw: "1".into(),
                recipient_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
                params_data_hex: None,
                dwallet_program: None,
                grpc_url: None,
                rpc_url: None,
                broadcast: None,
            },
            None,
            None,
            None,
        ));
        assert_eq!(error, "chainKind must be a remote chain kind");
    }

    #[test]
    fn typed_escrow_return_validates_typed_rows() {
        let execution = execute_typed_escrow_return(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedEscrowReturnRequest {
                escrow_id: "escrow-1".into(),
                returns: vec![
                    ExecuteTypedEscrowReturnRow {
                        recipient: VALID_PUBKEY.into(),
                        amount_lamports: 1,
                    },
                    ExecuteTypedEscrowReturnRow {
                        recipient: VALID_PUBKEY.into(),
                        amount_lamports: 2,
                    },
                ],
            },
        )
        .unwrap();

        assert_eq!(
            execution,
            TypedProposalExecution::EscrowReturn {
                wallet: "team".into(),
                proposal: VALID_PUBKEY.into(),
                escrow_id: "escrow-1".into(),
                returns: vec![
                    LamportPayment {
                        recipient: VALID_PUBKEY.into(),
                        amount_lamports: 1,
                    },
                    LamportPayment {
                        recipient: VALID_PUBKEY.into(),
                        amount_lamports: 2,
                    },
                ],
            }
        );
    }

    #[test]
    fn typed_batch_send_rejects_empty_and_oversized_rows() {
        let empty = bad_request_message(execute_typed_sol_batch_send(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedSolBatchSendRequest { payments: vec![] },
        ));
        assert_eq!(empty, "payments must include at least one recipient");

        let oversized = bad_request_message(execute_typed_sol_batch_send(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedSolBatchSendRequest {
                payments: (0..17)
                    .map(|_| ExecuteTypedSolBatchSendRow {
                        recipient: VALID_PUBKEY.into(),
                        amount_lamports: 1,
                    })
                    .collect(),
            },
        ));
        assert_eq!(oversized, "payments supports at most 16 recipients");
    }

    #[test]
    fn typed_agent_trade_approval_builds_typed_command() {
        let execution = execute_typed_agent_trade_approval(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedAgentTradeApprovalRequest {
                amount_raw: "250000000".into(),
                agent_id_hash: VALID_HASH.into(),
                venue_hash: VALID_HASH.into(),
                market_hash: VALID_HASH.into(),
                side_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
                max_leverage_x100: 250,
                session_id_hash: VALID_HASH.into(),
                route_hash: VALID_HASH.into(),
                risk_check_hash: VALID_HASH.into(),
            },
        )
        .unwrap();

        assert_eq!(
            execution,
            TypedProposalExecution::AgentTradeApproval {
                wallet: "team".into(),
                proposal: VALID_PUBKEY.into(),
                amount_raw: 250_000_000,
                agent_id_hash: VALID_HASH.into(),
                venue_hash: VALID_HASH.into(),
                market_hash: VALID_HASH.into(),
                side_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
                max_leverage_x100: 250,
                session_id_hash: VALID_HASH.into(),
                route_hash: VALID_HASH.into(),
                risk_check_hash: VALID_HASH.into(),
            }
        );
    }

    #[test]
    fn typed_agent_session_grant_and_revoke_preserve_numeric_policy() {
        let grant = execute_typed_agent_session_grant(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedAgentSessionGrantRequest {
                session_id_hash: VALID_HASH.into(),
                agent_id_hash: VALID_HASH.into(),
                venue_hash: VALID_HASH.into(),
                market_hash: VALID_HASH.into(),
                max_notional_raw: "250000000".into(),
                max_leverage_x100: 250,
                expires_at: 1_800_000_000,
                status: 1,
            },
        )
        .unwrap();
        assert!(matches!(
            grant,
            TypedProposalExecution::AgentSessionGrant {
                max_notional_raw: 250_000_000,
                max_leverage_x100: 250,
                status: 1,
                ..
            }
        ));

        let revoke = execute_typed_agent_session_grant(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedAgentSessionGrantRequest {
                session_id_hash: VALID_HASH.into(),
                agent_id_hash: VALID_HASH.into(),
                venue_hash: VALID_HASH.into(),
                market_hash: VALID_HASH.into(),
                max_notional_raw: "0".into(),
                max_leverage_x100: 0,
                expires_at: 0,
                status: 2,
            },
        )
        .unwrap();
        assert!(matches!(
            revoke,
            TypedProposalExecution::AgentSessionGrant {
                max_notional_raw: 0,
                max_leverage_x100: 0,
                status: 2,
                ..
            }
        ));
    }

    #[test]
    fn typed_routes_reject_zero_lamports() {
        let send = bad_request_message(execute_typed_sol_send(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedSolSendRequest {
                recipient: VALID_PUBKEY.into(),
                amount_lamports: 0,
            },
        ));
        assert_eq!(send, "amountLamports must be greater than zero");

        let batch = bad_request_message(execute_typed_sol_batch_send(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedSolBatchSendRequest {
                payments: vec![ExecuteTypedSolBatchSendRow {
                    recipient: VALID_PUBKEY.into(),
                    amount_lamports: 0,
                }],
            },
        ));
        assert_eq!(batch, "payments.amountLamports must be greater than zero");

        let agent = bad_request_message(execute_typed_agent_trade_approval(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedAgentTradeApprovalRequest {
                amount_raw: "0".into(),
                agent_id_hash: VALID_HASH.into(),
                venue_hash: VALID_HASH.into(),
                market_hash: VALID_HASH.into(),
                side_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
                max_leverage_x100: 250,
                session_id_hash: VALID_HASH.into(),
                route_hash: VALID_HASH.into(),
                risk_check_hash: VALID_HASH.into(),
            },
        ));
        assert_eq!(agent, "amountRaw must be greater than zero");
    }
}
