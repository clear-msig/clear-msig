use crate::{ensure_base58, ensure_hex_exact_len, ensure_non_empty, ensure_wallet_name, ApiError};

use super::types::{
    ExecuteTypedAgentTradeApprovalRequest, ExecuteTypedChainSendRequest,
    ExecuteTypedEscrowReleaseRequest, ExecuteTypedEscrowReturnRequest,
    ExecuteTypedSolBatchSendRequest, ExecuteTypedSolSendRequest,
};

pub(super) fn execute_typed_escrow_release_args(
    name: String,
    proposal: String,
    body: ExecuteTypedEscrowReleaseRequest,
) -> Result<Vec<String>, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_non_empty(&body.escrow_id, "escrowId")?;
    ensure_non_empty(&body.milestone_id, "milestoneId")?;
    ensure_positive_lamports(body.amount_lamports, "amountLamports")?;

    let mut args = base_proposal_args("typed-escrow-release", name, proposal);
    args.extend([
        "--recipient".into(),
        validated_base58(body.recipient, "recipient")?,
        "--amount-lamports".into(),
        body.amount_lamports.to_string(),
        "--escrow-id".into(),
        body.escrow_id,
        "--milestone-id".into(),
        body.milestone_id,
    ]);
    Ok(args)
}

pub(super) fn execute_typed_escrow_return_args(
    name: String,
    proposal: String,
    body: ExecuteTypedEscrowReturnRequest,
) -> Result<Vec<String>, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_non_empty(&body.escrow_id, "escrowId")?;
    ensure_bounded_rows(body.returns.len(), "returns")?;

    let mut args = base_proposal_args("typed-escrow-return", name, proposal);
    args.extend(["--escrow-id".into(), body.escrow_id]);
    for row in body.returns {
        push_recipient_lamports(
            &mut args,
            "--return",
            row.recipient,
            row.amount_lamports,
            "returns.recipient",
            "returns.amountLamports",
        )?;
    }
    Ok(args)
}

pub(super) fn execute_typed_sol_send_args(
    name: String,
    proposal: String,
    body: ExecuteTypedSolSendRequest,
) -> Result<Vec<String>, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_positive_lamports(body.amount_lamports, "amountLamports")?;

    let mut args = base_proposal_args("typed-sol-send", name, proposal);
    args.extend([
        "--recipient".into(),
        validated_base58(body.recipient, "recipient")?,
        "--amount-lamports".into(),
        body.amount_lamports.to_string(),
    ]);
    Ok(args)
}

pub(super) fn execute_typed_chain_send_args(
    name: String,
    proposal: String,
    body: ExecuteTypedChainSendRequest,
) -> Result<Vec<String>, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    if body.chain_kind == 0 {
        return Err(ApiError::BadRequest(
            "chainKind must be a remote chain kind".into(),
        ));
    }
    let amount_raw = parse_positive_u128(&body.amount_raw, "amountRaw")?;
    let recipient_hash = validated_hash(body.recipient_hash, "recipientHash")?;
    let asset_id_hash = validated_hash(body.asset_id_hash, "assetIdHash")?;

    let mut args = base_proposal_args("typed-chain-send", name, proposal);
    args.extend([
        "--chain-kind".into(),
        body.chain_kind.to_string(),
        "--amount-raw".into(),
        amount_raw.to_string(),
        "--recipient-hash".into(),
        recipient_hash,
        "--asset-id-hash".into(),
        asset_id_hash,
    ]);
    Ok(args)
}

pub(super) fn execute_typed_sol_batch_send_args(
    name: String,
    proposal: String,
    body: ExecuteTypedSolBatchSendRequest,
) -> Result<Vec<String>, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_bounded_rows(body.payments.len(), "payments")?;

    let mut args = base_proposal_args("typed-sol-batch-send", name, proposal);
    for row in body.payments {
        push_recipient_lamports(
            &mut args,
            "--payment",
            row.recipient,
            row.amount_lamports,
            "payments.recipient",
            "payments.amountLamports",
        )?;
    }
    Ok(args)
}

pub(super) fn execute_typed_agent_trade_approval_args(
    name: String,
    proposal: String,
    body: ExecuteTypedAgentTradeApprovalRequest,
) -> Result<Vec<String>, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    let amount_raw = parse_positive_u128(&body.amount_raw, "amountRaw")?;
    if body.max_leverage_x100 == 0 {
        return Err(ApiError::BadRequest(
            "maxLeverageX100 must be greater than zero".into(),
        ));
    }
    let venue_hash = validated_hash(body.venue_hash, "venueHash")?;
    let market_hash = validated_hash(body.market_hash, "marketHash")?;
    let side_hash = validated_hash(body.side_hash, "sideHash")?;
    let asset_id_hash = validated_hash(body.asset_id_hash, "assetIdHash")?;
    let session_id_hash = validated_hash(body.session_id_hash, "sessionIdHash")?;
    let route_hash = validated_hash(body.route_hash, "routeHash")?;
    let risk_check_hash = validated_hash(body.risk_check_hash, "riskCheckHash")?;

    let mut args = base_proposal_args("typed-agent-trade-approval", name, proposal);
    args.extend([
        "--amount-raw".into(),
        amount_raw.to_string(),
        "--venue-hash".into(),
        venue_hash,
        "--market-hash".into(),
        market_hash,
        "--side-hash".into(),
        side_hash,
        "--asset-id-hash".into(),
        asset_id_hash,
        "--max-leverage-x100".into(),
        body.max_leverage_x100.to_string(),
        "--session-id-hash".into(),
        session_id_hash,
        "--route-hash".into(),
        route_hash,
        "--risk-check-hash".into(),
        risk_check_hash,
    ]);
    Ok(args)
}

fn ensure_wallet_proposal(name: &str, proposal: &str) -> Result<(), ApiError> {
    ensure_wallet_name(name, "name")?;
    ensure_base58(proposal, "proposal", 32, 88)?;
    Ok(())
}

fn base_proposal_args(command: &str, name: String, proposal: String) -> Vec<String> {
    vec![
        "proposal".into(),
        command.into(),
        "--wallet".into(),
        name,
        "--proposal".into(),
        proposal,
    ]
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

fn push_recipient_lamports(
    args: &mut Vec<String>,
    flag: &str,
    recipient: String,
    amount_lamports: u64,
    recipient_field: &str,
    amount_field: &str,
) -> Result<(), ApiError> {
    let recipient = validated_base58(recipient, recipient_field)?;
    ensure_positive_lamports(amount_lamports, amount_field)?;
    args.push(flag.into());
    args.push(format!("{recipient}:{amount_lamports}"));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proposals::types::{
        ExecuteTypedAgentTradeApprovalRequest, ExecuteTypedChainSendRequest,
        ExecuteTypedEscrowReturnRow, ExecuteTypedSolBatchSendRow,
    };

    const VALID_PUBKEY: &str = "11111111111111111111111111111111";
    const VALID_HASH: &str = "8a58cb501c3269e8abe8f456629b04e12855131b2e8b1e6807749817d167a9d4";

    fn bad_request_message(result: Result<Vec<String>, ApiError>) -> String {
        match result {
            Err(ApiError::BadRequest(message)) => message,
            other => panic!("expected BadRequest, got {other:?}"),
        }
    }

    #[test]
    fn typed_sol_send_args_match_cli_shape() {
        let args = execute_typed_sol_send_args(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedSolSendRequest {
                recipient: VALID_PUBKEY.into(),
                amount_lamports: 1_000_000,
            },
        )
        .unwrap();

        assert_eq!(
            args,
            vec![
                "proposal",
                "typed-sol-send",
                "--wallet",
                "team",
                "--proposal",
                VALID_PUBKEY,
                "--recipient",
                VALID_PUBKEY,
                "--amount-lamports",
                "1000000",
            ]
        );
    }

    #[test]
    fn typed_escrow_release_args_match_cli_shape() {
        let args = execute_typed_escrow_release_args(
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
            args,
            vec![
                "proposal",
                "typed-escrow-release",
                "--wallet",
                "team",
                "--proposal",
                VALID_PUBKEY,
                "--recipient",
                VALID_PUBKEY,
                "--amount-lamports",
                "2000000",
                "--escrow-id",
                "escrow-1",
                "--milestone-id",
                "milestone-1",
            ]
        );
    }

    #[test]
    fn typed_chain_send_args_match_cli_shape() {
        let args = execute_typed_chain_send_args(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedChainSendRequest {
                chain_kind: 1,
                amount_raw: "1000000000000000000".into(),
                recipient_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
            },
        )
        .unwrap();

        assert_eq!(
            args,
            vec![
                "proposal",
                "typed-chain-send",
                "--wallet",
                "team",
                "--proposal",
                VALID_PUBKEY,
                "--chain-kind",
                "1",
                "--amount-raw",
                "1000000000000000000",
                "--recipient-hash",
                VALID_HASH,
                "--asset-id-hash",
                VALID_HASH,
            ]
        );
    }

    #[test]
    fn typed_chain_send_rejects_sol_chain_kind() {
        let error = bad_request_message(execute_typed_chain_send_args(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedChainSendRequest {
                chain_kind: 0,
                amount_raw: "1".into(),
                recipient_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
            },
        ));
        assert_eq!(error, "chainKind must be a remote chain kind");
    }

    #[test]
    fn typed_escrow_return_args_validate_and_format_rows() {
        let args = execute_typed_escrow_return_args(
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
            args,
            vec![
                "proposal",
                "typed-escrow-return",
                "--wallet",
                "team",
                "--proposal",
                VALID_PUBKEY,
                "--escrow-id",
                "escrow-1",
                "--return",
                "11111111111111111111111111111111:1",
                "--return",
                "11111111111111111111111111111111:2",
            ]
        );
    }

    #[test]
    fn typed_batch_send_args_reject_empty_and_oversized_rows() {
        let empty = bad_request_message(execute_typed_sol_batch_send_args(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedSolBatchSendRequest { payments: vec![] },
        ));
        assert_eq!(empty, "payments must include at least one recipient");

        let oversized = bad_request_message(execute_typed_sol_batch_send_args(
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
    fn typed_agent_trade_approval_args_match_cli_shape() {
        let args = execute_typed_agent_trade_approval_args(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedAgentTradeApprovalRequest {
                amount_raw: "250000000".into(),
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
            args,
            vec![
                "proposal",
                "typed-agent-trade-approval",
                "--wallet",
                "team",
                "--proposal",
                VALID_PUBKEY,
                "--amount-raw",
                "250000000",
                "--venue-hash",
                VALID_HASH,
                "--market-hash",
                VALID_HASH,
                "--side-hash",
                VALID_HASH,
                "--asset-id-hash",
                VALID_HASH,
                "--max-leverage-x100",
                "250",
                "--session-id-hash",
                VALID_HASH,
                "--route-hash",
                VALID_HASH,
                "--risk-check-hash",
                VALID_HASH,
            ]
        );
    }

    #[test]
    fn typed_routes_reject_zero_lamports() {
        let send = bad_request_message(execute_typed_sol_send_args(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedSolSendRequest {
                recipient: VALID_PUBKEY.into(),
                amount_lamports: 0,
            },
        ));
        assert_eq!(send, "amountLamports must be greater than zero");

        let batch = bad_request_message(execute_typed_sol_batch_send_args(
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

        let agent = bad_request_message(execute_typed_agent_trade_approval_args(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedAgentTradeApprovalRequest {
                amount_raw: "0".into(),
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
