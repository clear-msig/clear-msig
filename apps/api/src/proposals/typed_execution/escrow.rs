use clear_msig_command_contract::{TokenPayment, TypedProposalExecution};

use super::{
    ensure_bounded_rows, ensure_bounded_text, ensure_positive_lamports, ensure_wallet_proposal,
    parse_positive_u128, validated_base58, validated_hash, validated_lamport_payment,
};
use crate::proposals::types::{
    ExecuteTypedCrossChainEscrowReleaseRequest, ExecuteTypedCrossChainEscrowReturnRequest,
    ExecuteTypedEscrowReleaseRequest, ExecuteTypedEscrowReturnRequest,
    ExecuteTypedPrivateEscrowReleaseRequest, ExecuteTypedPrivateEscrowReturnRequest,
    ExecuteTypedSplEscrowReleaseRequest, ExecuteTypedSplEscrowReturnRequest,
};
use crate::ApiError;

pub(in crate::proposals) fn execute_typed_escrow_release(
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

pub(in crate::proposals) fn execute_typed_escrow_return(
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

pub(in crate::proposals) fn execute_typed_spl_escrow_release(
    name: String,
    proposal: String,
    body: ExecuteTypedSplEscrowReleaseRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_bounded_text(&body.escrow_id, "escrowId")?;
    ensure_bounded_text(&body.milestone_id, "milestoneId")?;
    ensure_positive_lamports(body.amount_tokens, "amountTokens")?;
    Ok(TypedProposalExecution::SplEscrowRelease {
        wallet: name,
        proposal,
        mint: validated_base58(body.mint, "mint")?,
        source_token: validated_base58(body.source_token, "sourceToken")?,
        destination_token: validated_base58(body.destination_token, "destinationToken")?,
        recipient_owner: validated_base58(body.recipient_owner, "recipientOwner")?,
        amount_tokens: body.amount_tokens,
        escrow_id: body.escrow_id,
        milestone_id: body.milestone_id,
    })
}

pub(in crate::proposals) fn execute_typed_spl_escrow_return(
    name: String,
    proposal: String,
    body: ExecuteTypedSplEscrowReturnRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_bounded_text(&body.escrow_id, "escrowId")?;
    ensure_bounded_rows(body.returns.len(), "returns")?;
    let returns = body
        .returns
        .into_iter()
        .map(|row| {
            ensure_positive_lamports(row.amount_tokens, "returns.amountTokens")?;
            Ok(TokenPayment {
                destination_token: validated_base58(
                    row.destination_token,
                    "returns.destinationToken",
                )?,
                funder_owner: validated_base58(row.funder_owner, "returns.funderOwner")?,
                amount_tokens: row.amount_tokens,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    Ok(TypedProposalExecution::SplEscrowReturn {
        wallet: name,
        proposal,
        mint: validated_base58(body.mint, "mint")?,
        source_token: validated_base58(body.source_token, "sourceToken")?,
        escrow_id: body.escrow_id,
        returns,
    })
}

pub(in crate::proposals) fn execute_typed_cross_chain_escrow_release(
    name: String,
    proposal: String,
    body: ExecuteTypedCrossChainEscrowReleaseRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_remote_chain(body.chain_kind)?;
    ensure_bounded_text(&body.escrow_id, "escrowId")?;
    ensure_bounded_text(&body.milestone_id, "milestoneId")?;
    Ok(TypedProposalExecution::CrossChainEscrowRelease {
        wallet: name,
        proposal,
        chain_kind: body.chain_kind,
        amount_raw: parse_positive_u128(&body.amount_raw, "amountRaw")?,
        escrow_id: body.escrow_id,
        milestone_id: body.milestone_id,
        recipient_hash: validated_hash(body.recipient_hash, "recipientHash")?,
        asset_id_hash: validated_hash(body.asset_id_hash, "assetIdHash")?,
        route_hash: validated_hash(body.route_hash, "routeHash")?,
        settlement_artifact_hash: validated_hash(
            body.settlement_artifact_hash,
            "settlementArtifactHash",
        )?,
    })
}

pub(in crate::proposals) fn execute_typed_cross_chain_escrow_return(
    name: String,
    proposal: String,
    body: ExecuteTypedCrossChainEscrowReturnRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_remote_chain(body.chain_kind)?;
    ensure_bounded_text(&body.escrow_id, "escrowId")?;
    Ok(TypedProposalExecution::CrossChainEscrowReturn {
        wallet: name,
        proposal,
        chain_kind: body.chain_kind,
        amount_raw: parse_positive_u128(&body.amount_raw, "amountRaw")?,
        escrow_id: body.escrow_id,
        refund_recipient_hash: validated_hash(body.refund_recipient_hash, "refundRecipientHash")?,
        asset_id_hash: validated_hash(body.asset_id_hash, "assetIdHash")?,
        route_hash: validated_hash(body.route_hash, "routeHash")?,
        settlement_artifact_hash: validated_hash(
            body.settlement_artifact_hash,
            "settlementArtifactHash",
        )?,
    })
}

pub(in crate::proposals) fn execute_typed_private_escrow_release(
    name: String,
    proposal: String,
    body: ExecuteTypedPrivateEscrowReleaseRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_bounded_text(&body.escrow_id, "escrowId")?;
    ensure_bounded_text(&body.milestone_id, "milestoneId")?;
    Ok(TypedProposalExecution::PrivateEscrowRelease {
        wallet: name,
        proposal,
        amount_raw: parse_positive_u128(&body.amount_raw, "amountRaw")?,
        escrow_id: body.escrow_id,
        milestone_id: body.milestone_id,
        recipient_hash: validated_hash(body.recipient_hash, "recipientHash")?,
        asset_id_hash: validated_hash(body.asset_id_hash, "assetIdHash")?,
        private_evaluation_hash: validated_hash(
            body.private_evaluation_hash,
            "privateEvaluationHash",
        )?,
        settlement_artifact_hash: validated_hash(
            body.settlement_artifact_hash,
            "settlementArtifactHash",
        )?,
    })
}

pub(in crate::proposals) fn execute_typed_private_escrow_return(
    name: String,
    proposal: String,
    body: ExecuteTypedPrivateEscrowReturnRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_bounded_text(&body.escrow_id, "escrowId")?;
    Ok(TypedProposalExecution::PrivateEscrowReturn {
        wallet: name,
        proposal,
        amount_raw: parse_positive_u128(&body.amount_raw, "amountRaw")?,
        escrow_id: body.escrow_id,
        refund_recipient_hash: validated_hash(body.refund_recipient_hash, "refundRecipientHash")?,
        asset_id_hash: validated_hash(body.asset_id_hash, "assetIdHash")?,
        private_evaluation_hash: validated_hash(
            body.private_evaluation_hash,
            "privateEvaluationHash",
        )?,
        settlement_artifact_hash: validated_hash(
            body.settlement_artifact_hash,
            "settlementArtifactHash",
        )?,
    })
}

fn ensure_remote_chain(chain_kind: u8) -> Result<(), ApiError> {
    if matches!(chain_kind, 1..=5) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "chainKind must be a supported remote chain kind".into(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proposals::types::{ExecuteTypedEscrowReturnRow, ExecuteTypedSplEscrowReturnRow};
    use clear_msig_command_contract::LamportPayment;

    const VALID_PUBKEY: &str = "11111111111111111111111111111111";
    const VALID_HASH: &str = "8a58cb501c3269e8abe8f456629b04e12855131b2e8b1e6807749817d167a9d4";

    fn bad_request_message<T: core::fmt::Debug>(result: Result<T, ApiError>) -> String {
        match result {
            Err(ApiError::BadRequest(message)) => message,
            other => panic!("expected BadRequest, got {other:?}"),
        }
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
        assert!(matches!(
            execution,
            TypedProposalExecution::EscrowRelease {
                amount_lamports: 2_000_000,
                ..
            }
        ));
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
        assert!(matches!(
            execution,
            TypedProposalExecution::EscrowReturn { returns, .. }
                if returns == vec![
                    LamportPayment { recipient: VALID_PUBKEY.into(), amount_lamports: 1 },
                    LamportPayment { recipient: VALID_PUBKEY.into(), amount_lamports: 2 },
                ]
        ));
    }

    #[test]
    fn typed_spl_escrow_commands_preserve_exact_token_accounts() {
        let release = execute_typed_spl_escrow_release(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedSplEscrowReleaseRequest {
                mint: VALID_PUBKEY.into(),
                source_token: VALID_PUBKEY.into(),
                destination_token: VALID_PUBKEY.into(),
                recipient_owner: VALID_PUBKEY.into(),
                amount_tokens: 1_500_000,
                escrow_id: "escrow-1".into(),
                milestone_id: "milestone-1".into(),
            },
        )
        .unwrap();
        assert!(matches!(
            release,
            TypedProposalExecution::SplEscrowRelease {
                amount_tokens: 1_500_000,
                ..
            }
        ));

        let returned = execute_typed_spl_escrow_return(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedSplEscrowReturnRequest {
                mint: VALID_PUBKEY.into(),
                source_token: VALID_PUBKEY.into(),
                escrow_id: "escrow-1".into(),
                returns: vec![ExecuteTypedSplEscrowReturnRow {
                    destination_token: VALID_PUBKEY.into(),
                    funder_owner: VALID_PUBKEY.into(),
                    amount_tokens: 1_500_000,
                }],
            },
        )
        .unwrap();
        assert!(matches!(
            returned,
            TypedProposalExecution::SplEscrowReturn { returns, .. }
                if returns == vec![TokenPayment {
                    destination_token: VALID_PUBKEY.into(),
                    funder_owner: VALID_PUBKEY.into(),
                    amount_tokens: 1_500_000,
                }]
        ));
    }

    #[test]
    fn typed_remote_escrow_commands_validate_chain_amount_and_evidence() {
        let release = execute_typed_cross_chain_escrow_release(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedCrossChainEscrowReleaseRequest {
                chain_kind: 1,
                amount_raw: "2500000".into(),
                escrow_id: "escrow-remote".into(),
                milestone_id: "milestone-remote".into(),
                recipient_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
                route_hash: VALID_HASH.into(),
                settlement_artifact_hash: VALID_HASH.into(),
            },
        )
        .unwrap();
        assert!(matches!(
            release,
            TypedProposalExecution::CrossChainEscrowRelease {
                chain_kind: 1,
                amount_raw: 2_500_000,
                ..
            }
        ));

        let private = execute_typed_private_escrow_return(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedPrivateEscrowReturnRequest {
                amount_raw: "2500000".into(),
                escrow_id: "escrow-private".into(),
                refund_recipient_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
                private_evaluation_hash: VALID_HASH.into(),
                settlement_artifact_hash: VALID_HASH.into(),
            },
        )
        .unwrap();
        assert!(matches!(
            private,
            TypedProposalExecution::PrivateEscrowReturn {
                amount_raw: 2_500_000,
                ..
            }
        ));

        let bad_chain = bad_request_message(execute_typed_cross_chain_escrow_release(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedCrossChainEscrowReleaseRequest {
                chain_kind: 0,
                amount_raw: "1".into(),
                escrow_id: "escrow".into(),
                milestone_id: "milestone".into(),
                recipient_hash: VALID_HASH.into(),
                asset_id_hash: VALID_HASH.into(),
                route_hash: VALID_HASH.into(),
                settlement_artifact_hash: VALID_HASH.into(),
            },
        ));
        assert_eq!(bad_chain, "chainKind must be a supported remote chain kind");
    }
}
