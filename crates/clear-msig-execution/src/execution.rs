use crate::commands::proposal::ProposalAction;
use crate::config::CliGlobals;
use crate::{Command, ExecutionRequest};
use clear_msig_command_contract::TypedProposalExecution;

impl From<TypedProposalExecution> for ProposalAction {
    fn from(value: TypedProposalExecution) -> Self {
        match value {
            TypedProposalExecution::RecurringSchedule {
                wallet,
                proposal,
                schedule_id,
                recipient,
                amount_lamports,
                interval_seconds,
                first_execution_at,
                payment_count,
                status,
            } => Self::TypedRecurringSchedule {
                wallet,
                proposal,
                schedule_id,
                recipient,
                amount_lamports,
                interval_seconds,
                first_execution_at,
                payment_count,
                status,
            },
            TypedProposalExecution::RecurringPayment {
                wallet,
                intent,
                schedule_id,
                recipient,
            } => Self::RecurringPayment {
                wallet,
                intent,
                schedule_id,
                recipient,
            },
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
            } => Self::TypedRecurringTokenSchedule {
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
            },
            TypedProposalExecution::RecurringTokenPayment {
                wallet,
                intent,
                schedule_id,
                mint,
                source_token,
                destination_token,
                recipient_owner,
            } => Self::RecurringTokenPayment {
                wallet,
                intent,
                schedule_id,
                mint,
                source_token,
                destination_token,
                recipient_owner,
            },
            TypedProposalExecution::RecurringAssetSchedule {
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
            } => Self::TypedRecurringAssetSchedule {
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
            },
            TypedProposalExecution::RecurringAssetPayment {
                wallet,
                intent,
                schedule_id,
                mint,
                source_token,
                destination_token,
                recipient_owner,
            } => Self::RecurringAssetPayment {
                wallet,
                intent,
                schedule_id,
                mint,
                source_token,
                destination_token,
                recipient_owner,
            },
            TypedProposalExecution::EscrowRelease {
                wallet,
                proposal,
                recipient,
                amount_lamports,
                escrow_id,
                milestone_id,
            } => Self::TypedEscrowRelease {
                wallet,
                proposal,
                recipient,
                amount_lamports,
                escrow_id,
                milestone_id,
            },
            TypedProposalExecution::EscrowReturn {
                wallet,
                proposal,
                escrow_id,
                returns,
            } => Self::TypedEscrowReturn {
                wallet,
                proposal,
                escrow_id,
                returns: returns
                    .into_iter()
                    .map(|row| format!("{}:{}", row.recipient, row.amount_lamports))
                    .collect(),
            },
            TypedProposalExecution::SplEscrowRelease {
                wallet,
                proposal,
                mint,
                source_token,
                destination_token,
                recipient_owner,
                amount_tokens,
                escrow_id,
                milestone_id,
            } => Self::TypedSplEscrowRelease {
                wallet,
                proposal,
                mint,
                source_token,
                destination_token,
                recipient_owner,
                amount_tokens,
                escrow_id,
                milestone_id,
            },
            TypedProposalExecution::SplEscrowReturn {
                wallet,
                proposal,
                mint,
                source_token,
                escrow_id,
                returns,
            } => Self::TypedSplEscrowReturn {
                wallet,
                proposal,
                mint,
                source_token,
                escrow_id,
                returns: returns
                    .into_iter()
                    .map(|row| {
                        format!(
                            "{}:{}:{}",
                            row.destination_token, row.funder_owner, row.amount_tokens
                        )
                    })
                    .collect(),
            },
            TypedProposalExecution::CrossChainEscrowRelease {
                wallet,
                proposal,
                chain_kind,
                amount_raw,
                escrow_id,
                milestone_id,
                recipient_hash,
                asset_id_hash,
                route_hash,
                settlement_artifact_hash,
            } => Self::TypedCrossChainEscrowRelease {
                wallet,
                proposal,
                chain_kind,
                amount_raw,
                escrow_id,
                milestone_id,
                recipient_hash,
                asset_id_hash,
                route_hash,
                settlement_artifact_hash,
            },
            TypedProposalExecution::CrossChainEscrowReturn {
                wallet,
                proposal,
                chain_kind,
                amount_raw,
                escrow_id,
                refund_recipient_hash,
                asset_id_hash,
                route_hash,
                settlement_artifact_hash,
            } => Self::TypedCrossChainEscrowReturn {
                wallet,
                proposal,
                chain_kind,
                amount_raw,
                escrow_id,
                refund_recipient_hash,
                asset_id_hash,
                route_hash,
                settlement_artifact_hash,
            },
            TypedProposalExecution::PrivateEscrowRelease {
                wallet,
                proposal,
                amount_raw,
                escrow_id,
                milestone_id,
                recipient_hash,
                asset_id_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
            } => Self::TypedPrivateEscrowRelease {
                wallet,
                proposal,
                amount_raw,
                escrow_id,
                milestone_id,
                recipient_hash,
                asset_id_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
            },
            TypedProposalExecution::PrivateEscrowReturn {
                wallet,
                proposal,
                amount_raw,
                escrow_id,
                refund_recipient_hash,
                asset_id_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
            } => Self::TypedPrivateEscrowReturn {
                wallet,
                proposal,
                amount_raw,
                escrow_id,
                refund_recipient_hash,
                asset_id_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
            },
            TypedProposalExecution::SolSend {
                wallet,
                proposal,
                recipient,
                amount_lamports,
            } => Self::TypedSolSend {
                wallet,
                proposal,
                recipient,
                amount_lamports,
            },
            TypedProposalExecution::WalletPolicyUpdate {
                wallet,
                proposal,
                policy_bytes_hex,
                chain_kind,
            } => Self::TypedWalletPolicyUpdate {
                wallet,
                proposal,
                policy_bytes_hex,
                chain_kind,
            },
            TypedProposalExecution::AssetPolicyUpdate {
                wallet,
                proposal,
                policy_bytes_hex,
                chain_kind,
                scope_kind,
                decimals,
                asset_id,
                display_asset,
            } => Self::TypedAssetPolicyUpdate {
                wallet,
                proposal,
                policy_bytes_hex,
                chain_kind,
                scope_kind,
                decimals,
                asset_id,
                display_asset,
            },
            TypedProposalExecution::IntentGovernance {
                wallet,
                proposal,
                action_kind,
                target_index,
                new_intent_body_hex,
                file,
                proposers,
                approvers,
                threshold,
                cancellation_threshold,
                timelock,
            } => Self::TypedIntentGovernance {
                wallet,
                proposal,
                action_kind,
                target_index,
                new_intent_body_hex,
                file,
                proposers,
                approvers,
                threshold,
                cancellation_threshold,
                timelock,
            },
            TypedProposalExecution::ChainSend {
                wallet,
                proposal,
                chain_kind,
                amount_raw,
                recipient_hash,
                asset_id_hash,
            } => Self::TypedChainSend {
                wallet,
                proposal,
                chain_kind,
                amount_raw,
                recipient_hash,
                asset_id_hash,
            },
            TypedProposalExecution::ChainSendIka {
                wallet,
                proposal,
                chain_kind,
                amount_raw,
                recipient_hash,
                asset_id_hash,
                params_data_hex,
                dwallet_program,
                grpc_url,
                rpc_url,
                broadcast,
            } => Self::TypedChainSendIka {
                wallet,
                proposal,
                chain_kind,
                amount_raw,
                recipient_hash,
                asset_id_hash,
                params_data_hex,
                dwallet_program,
                grpc_url: grpc_url.unwrap_or_else(|| crate::ika::DEFAULT_GRPC_URL.to_string()),
                rpc_url,
                broadcast,
            },
            TypedProposalExecution::SolBatchSend {
                wallet,
                proposal,
                payments,
            } => Self::TypedSolBatchSend {
                wallet,
                proposal,
                payments: payments
                    .into_iter()
                    .map(|row| format!("{}:{}", row.recipient, row.amount_lamports))
                    .collect(),
            },
            TypedProposalExecution::AgentTradeApproval {
                wallet,
                proposal,
                amount_raw,
                agent_id_hash,
                venue_hash,
                market_hash,
                side_hash,
                asset_id_hash,
                max_leverage_x100,
                session_id_hash,
                route_hash,
                risk_check_hash,
            } => Self::TypedAgentTradeApproval {
                wallet,
                proposal,
                amount_raw,
                agent_id_hash,
                venue_hash,
                market_hash,
                side_hash,
                asset_id_hash,
                max_leverage_x100,
                session_id_hash,
                route_hash,
                risk_check_hash,
            },
            TypedProposalExecution::AgentSessionGrant {
                wallet,
                proposal,
                session_id_hash,
                agent_id_hash,
                venue_hash,
                market_hash,
                max_notional_raw,
                max_leverage_x100,
                expires_at,
                status,
            } => Self::TypedAgentSessionGrant {
                wallet,
                proposal,
                session_id_hash,
                agent_id_hash,
                venue_hash,
                market_hash,
                max_notional_raw,
                max_leverage_x100,
                expires_at,
                status,
            },
            TypedProposalExecution::AgentRiskPolicy {
                wallet,
                proposal,
                session_id_hash,
                oracle_policy_hash,
                max_loss_raw,
                status,
            } => Self::TypedAgentRiskPolicy {
                wallet,
                proposal,
                session_id_hash,
                oracle_policy_hash,
                max_loss_raw,
                status,
            },
            TypedProposalExecution::AgentTradeSettlement {
                wallet,
                proposal,
                session_id_hash,
                execution_id_hash,
                settlement_artifact_hash,
                oracle_policy_hash,
                closed_notional_raw,
                outcome,
                pnl_abs_raw,
                settlement_sequence,
            } => Self::TypedAgentTradeSettlement {
                wallet,
                proposal,
                session_id_hash,
                execution_id_hash,
                settlement_artifact_hash,
                oracle_policy_hash,
                closed_notional_raw,
                outcome,
                pnl_abs_raw,
                settlement_sequence,
            },
        }
    }
}

pub fn prepare_typed_proposal_execution(
    globals: CliGlobals,
    execution: TypedProposalExecution,
) -> Result<ExecutionRequest, String> {
    execution.validate_boundary()?;
    Ok(ExecutionRequest::new(
        globals,
        Command::Proposal {
            action: execution.into(),
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::{prepare_typed_proposal_execution, TypedProposalExecution};
    use crate::commands::proposal::ProposalAction;
    use crate::config::CliGlobals;
    use clear_msig_command_contract::LamportPayment;

    #[test]
    fn typed_boundary_rejects_oversized_values() {
        let execution = TypedProposalExecution::WalletPolicyUpdate {
            wallet: "team".into(),
            proposal: "11111111111111111111111111111111".into(),
            policy_bytes_hex: "a".repeat(16 * 1024 + 1),
            chain_kind: 0,
        };
        assert!(prepare_typed_proposal_execution(CliGlobals::default(), execution).is_err());
    }

    #[test]
    fn typed_boundary_rejects_unbounded_collections() {
        let execution = TypedProposalExecution::IntentGovernance {
            wallet: "team".into(),
            proposal: "11111111111111111111111111111111".into(),
            action_kind: Some(3),
            target_index: Some(3),
            new_intent_body_hex: None,
            file: Some("intent.json".into()),
            proposers: Some((0..256).map(|index| format!("proposer-{index}")).collect()),
            approvers: None,
            threshold: Some(1),
            cancellation_threshold: 1,
            timelock: 0,
        };
        assert!(prepare_typed_proposal_execution(CliGlobals::default(), execution).is_err());
    }

    #[test]
    fn sol_send_maps_to_the_specialized_handler_action() {
        let action: ProposalAction = TypedProposalExecution::SolSend {
            wallet: "team".into(),
            proposal: "proposal".into(),
            recipient: "recipient".into(),
            amount_lamports: 42,
        }
        .into();
        assert!(matches!(
            action,
            ProposalAction::TypedSolSend {
                wallet,
                proposal,
                recipient,
                amount_lamports: 42,
            } if wallet == "team" && proposal == "proposal" && recipient == "recipient"
        ));
    }

    #[test]
    fn batch_payments_are_encoded_only_inside_the_execution_adapter() {
        let action: ProposalAction = TypedProposalExecution::SolBatchSend {
            wallet: "team".into(),
            proposal: "proposal".into(),
            payments: vec![LamportPayment {
                recipient: "recipient".into(),
                amount_lamports: 42,
            }],
        }
        .into();
        assert!(matches!(
            action,
            ProposalAction::TypedSolBatchSend { payments, .. }
                if payments == ["recipient:42"]
        ));
    }

    #[test]
    fn ika_execution_applies_the_cli_default_grpc_endpoint() {
        let action: ProposalAction = TypedProposalExecution::ChainSendIka {
            wallet: "team".into(),
            proposal: "proposal".into(),
            chain_kind: 2,
            amount_raw: 42,
            recipient_hash: "recipient-hash".into(),
            asset_id_hash: "asset-hash".into(),
            params_data_hex: "00".into(),
            dwallet_program: "dwallet".into(),
            grpc_url: None,
            rpc_url: None,
            broadcast: false,
        }
        .into();
        assert!(matches!(
            action,
            ProposalAction::TypedChainSendIka { grpc_url, .. }
                if grpc_url == crate::ika::DEFAULT_GRPC_URL
        ));
    }
}
