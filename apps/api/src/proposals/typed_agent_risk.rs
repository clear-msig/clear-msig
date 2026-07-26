use clear_msig_command_contract::TypedProposalExecution;

use super::{
    typed_execution::{ensure_wallet_proposal, parse_positive_u128, validated_hash},
    types::{ExecuteTypedAgentRiskPolicyRequest, ExecuteTypedAgentTradeSettlementRequest},
};
use crate::ApiError;

pub(super) fn execute_typed_agent_risk_policy(
    name: String,
    proposal: String,
    body: ExecuteTypedAgentRiskPolicyRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    if body.status != 1 && body.status != 2 {
        return Err(ApiError::BadRequest("status must be 1 or 2".into()));
    }
    let max_loss_raw = body
        .max_loss_raw
        .trim()
        .parse::<u128>()
        .map_err(|_| ApiError::BadRequest("maxLossRaw must be an integer".into()))?;
    if body.status == 1 && max_loss_raw == 0 {
        return Err(ApiError::BadRequest(
            "active risk policies require positive maxLossRaw".into(),
        ));
    }
    Ok(TypedProposalExecution::AgentRiskPolicy {
        wallet: name,
        proposal,
        session_id_hash: validated_hash(body.session_id_hash, "sessionIdHash")?,
        oracle_policy_hash: validated_hash(body.oracle_policy_hash, "oraclePolicyHash")?,
        max_loss_raw,
        status: body.status,
    })
}

pub(super) fn execute_typed_agent_trade_settlement(
    name: String,
    proposal: String,
    body: ExecuteTypedAgentTradeSettlementRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    let closed_notional_raw = parse_positive_u128(&body.closed_notional_raw, "closedNotionalRaw")?;
    let pnl_abs_raw = body
        .pnl_abs_raw
        .trim()
        .parse::<u128>()
        .map_err(|_| ApiError::BadRequest("pnlAbsRaw must be an integer".into()))?;
    if !(1..=3).contains(&body.outcome) {
        return Err(ApiError::BadRequest(
            "outcome must be 1 (profit), 2 (loss), or 3 (flat)".into(),
        ));
    }
    if (body.outcome == 3 && pnl_abs_raw != 0) || (body.outcome != 3 && pnl_abs_raw == 0) {
        return Err(ApiError::BadRequest(
            "pnlAbsRaw does not match settlement outcome".into(),
        ));
    }
    Ok(TypedProposalExecution::AgentTradeSettlement {
        wallet: name,
        proposal,
        session_id_hash: validated_hash(body.session_id_hash, "sessionIdHash")?,
        execution_id_hash: validated_hash(body.execution_id_hash, "executionIdHash")?,
        settlement_artifact_hash: validated_hash(
            body.settlement_artifact_hash,
            "settlementArtifactHash",
        )?,
        oracle_policy_hash: validated_hash(body.oracle_policy_hash, "oraclePolicyHash")?,
        closed_notional_raw,
        outcome: body.outcome,
        pnl_abs_raw,
        settlement_sequence: body.settlement_sequence,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_PUBKEY: &str = "11111111111111111111111111111111";
    const VALID_HASH: &str = "1111111111111111111111111111111111111111111111111111111111111111";

    #[test]
    fn builds_closed_risk_and_settlement_commands() {
        let risk = execute_typed_agent_risk_policy(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedAgentRiskPolicyRequest {
                session_id_hash: VALID_HASH.into(),
                oracle_policy_hash: VALID_HASH.into(),
                max_loss_raw: "100000000".into(),
                status: 1,
            },
        )
        .unwrap();
        assert!(matches!(
            risk,
            TypedProposalExecution::AgentRiskPolicy {
                max_loss_raw: 100_000_000,
                status: 1,
                ..
            }
        ));

        let settlement = execute_typed_agent_trade_settlement(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedAgentTradeSettlementRequest {
                session_id_hash: VALID_HASH.into(),
                execution_id_hash: VALID_HASH.into(),
                settlement_artifact_hash: VALID_HASH.into(),
                oracle_policy_hash: VALID_HASH.into(),
                closed_notional_raw: "250000000".into(),
                outcome: 2,
                pnl_abs_raw: "50000000".into(),
                settlement_sequence: 7,
            },
        )
        .unwrap();
        assert!(matches!(
            settlement,
            TypedProposalExecution::AgentTradeSettlement {
                closed_notional_raw: 250_000_000,
                outcome: 2,
                pnl_abs_raw: 50_000_000,
                settlement_sequence: 7,
                ..
            }
        ));
    }

    #[test]
    fn rejects_inconsistent_settlement_pnl() {
        let error = execute_typed_agent_trade_settlement(
            "team".into(),
            VALID_PUBKEY.into(),
            ExecuteTypedAgentTradeSettlementRequest {
                session_id_hash: VALID_HASH.into(),
                execution_id_hash: VALID_HASH.into(),
                settlement_artifact_hash: VALID_HASH.into(),
                oracle_policy_hash: VALID_HASH.into(),
                closed_notional_raw: "1".into(),
                outcome: 3,
                pnl_abs_raw: "1".into(),
                settlement_sequence: 0,
            },
        )
        .expect_err("flat settlement with non-zero P/L must fail");
        assert!(error
            .to_string()
            .contains("pnlAbsRaw does not match settlement outcome"));
    }
}
