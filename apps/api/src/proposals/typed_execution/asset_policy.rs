use super::{
    ensure_optional_hex, ensure_wallet_proposal, execute_typed_recurring_token_schedule,
    validated_base58,
};
use crate::{
    proposals::types::{
        ExecuteTypedAssetPolicyUpdateRequest, ExecuteTypedRecurringTokenScheduleRequest,
    },
    ApiError,
};
use clear_msig_command_contract::TypedProposalExecution;

pub(in crate::proposals) fn execute_typed_recurring_asset_schedule(
    name: String,
    proposal: String,
    body: ExecuteTypedRecurringTokenScheduleRequest,
) -> Result<TypedProposalExecution, ApiError> {
    let execution = execute_typed_recurring_token_schedule(name, proposal, body)?;
    match execution {
        TypedProposalExecution::RecurringTokenSchedule {
            wallet,
            proposal,
            schedule_id,
            mint,
            source_token,
            destination_token,
            recipient_owner,
            amount_tokens,
            interval_seconds,
            first_execution_at,
            payment_count,
            status,
        } => Ok(TypedProposalExecution::RecurringAssetSchedule {
            wallet,
            proposal,
            schedule_id,
            mint,
            source_token,
            destination_token,
            recipient_owner,
            amount_tokens,
            interval_seconds,
            first_execution_at,
            payment_count,
            status,
        }),
        _ => unreachable!("recurring token builder returned wrong variant"),
    }
}

pub(in crate::proposals) fn execute_typed_asset_policy_update(
    name: String,
    proposal: String,
    body: ExecuteTypedAssetPolicyUpdateRequest,
) -> Result<TypedProposalExecution, ApiError> {
    ensure_wallet_proposal(&name, &proposal)?;
    ensure_optional_hex(&body.policy_bytes_hex, "policyBytesHex")?;
    if body.chain_kind != 0 || body.scope_kind != 1 || body.decimals != 6 {
        return Err(ApiError::BadRequest(
            "USDC asset policy must use Solana chain 0, SPL scope 1, and 6 decimals".into(),
        ));
    }
    const DEVNET_USDC: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    if body.asset_id != DEVNET_USDC || body.display_asset != "USDC" {
        return Err(ApiError::BadRequest(
            "asset policy must target issuer-published Solana devnet USDC".into(),
        ));
    }
    Ok(TypedProposalExecution::AssetPolicyUpdate {
        wallet: name,
        proposal,
        policy_bytes_hex: body.policy_bytes_hex,
        chain_kind: body.chain_kind,
        scope_kind: body.scope_kind,
        decimals: body.decimals,
        asset_id: validated_base58(body.asset_id, "assetId")?,
        display_asset: body.display_asset,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ExecuteTypedAssetPolicyUpdateRequest {
        ExecuteTypedAssetPolicyUpdateRequest {
            policy_bytes_hex: "43535032".into(),
            chain_kind: 0,
            scope_kind: 1,
            decimals: 6,
            asset_id: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".into(),
            display_asset: "USDC".into(),
        }
    }

    #[test]
    fn asset_policy_boundary_rejects_scope_substitution() {
        let proposal = "11111111111111111111111111111111".to_string();
        assert!(
            execute_typed_asset_policy_update("Team".into(), proposal.clone(), request(),).is_ok()
        );

        let mut wrong_mint = request();
        wrong_mint.asset_id = proposal.clone();
        assert!(
            execute_typed_asset_policy_update("Team".into(), proposal.clone(), wrong_mint,)
                .is_err()
        );

        let mut wrong_decimals = request();
        wrong_decimals.decimals = 9;
        assert!(
            execute_typed_asset_policy_update("Team".into(), proposal, wrong_decimals,).is_err()
        );
    }
}
