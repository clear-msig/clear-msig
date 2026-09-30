use super::*;
use crate::proposals::types::{
    ExecuteTypedAgentTradeApprovalRequest, ExecuteTypedChainSendRequest,
    ExecuteTypedIntentGovernanceRequest, ExecuteTypedSolBatchSendRow,
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
fn typed_chain_send_rejects_browser_ika_endpoint_substitution() {
    let error = bad_request_message(execute_typed_chain_send(
        "team".into(),
        VALID_PUBKEY.into(),
        ExecuteTypedChainSendRequest {
            chain_kind: 1,
            amount_raw: "1000".into(),
            recipient_hash: VALID_HASH.into(),
            asset_id_hash: VALID_HASH.into(),
            params_data_hex: Some("01020304".into()),
            dwallet_program: Some("11111111111111111111111111111111".into()),
            grpc_url: Some("https://attacker.example".into()),
            rpc_url: None,
            broadcast: Some(false),
        },
        Some(VALID_PUBKEY.into()),
        Some("https://ika.example".into()),
        Some("https://rpc.example".into()),
    ));
    assert!(error.contains("trusted backend"));
}

#[test]
fn typed_chain_send_rejects_destination_rpc_substitution() {
    for configured in [None, Some("https://rpc.example".to_string())] {
        let error = bad_request_message(execute_typed_chain_send(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedChainSendRequest {
                chain_kind: 1,
                amount_raw: "1000".into(),
                recipient_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
                params_data_hex: Some("01020304".into()),
                dwallet_program: None,
                grpc_url: None,
                rpc_url: Some("http://127.0.0.1:8080/internal".into()),
                broadcast: Some(true),
            },
            Some(VALID_PUBKEY.into()),
            Some("https://ika.example".into()),
            configured,
        ));
        assert!(error.contains("rpcUrl"));
        assert!(error.contains("trusted backend"));
    }
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
