use crate::commands::proposal::ProposalAction;
use crate::config::CliGlobals;
use crate::{Command, ExecutionRequest};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LamportPayment {
    pub recipient: String,
    pub amount_lamports: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypedProposalExecution {
    EscrowRelease {
        wallet: String,
        proposal: String,
        recipient: String,
        amount_lamports: u64,
        escrow_id: String,
        milestone_id: String,
    },
    EscrowReturn {
        wallet: String,
        proposal: String,
        escrow_id: String,
        returns: Vec<LamportPayment>,
    },
    SolSend {
        wallet: String,
        proposal: String,
        recipient: String,
        amount_lamports: u64,
    },
    WalletPolicyUpdate {
        wallet: String,
        proposal: String,
        policy_bytes_hex: String,
        chain_kind: u8,
    },
    IntentGovernance {
        wallet: String,
        proposal: String,
        action_kind: Option<u8>,
        target_index: Option<u8>,
        new_intent_body_hex: Option<String>,
        file: Option<String>,
        proposers: Option<Vec<String>>,
        approvers: Option<Vec<String>>,
        threshold: Option<u8>,
        cancellation_threshold: u8,
        timelock: u32,
    },
    ChainSend {
        wallet: String,
        proposal: String,
        chain_kind: u8,
        amount_raw: u128,
        recipient_hash: String,
        asset_id_hash: String,
    },
    ChainSendIka {
        wallet: String,
        proposal: String,
        chain_kind: u8,
        amount_raw: u128,
        recipient_hash: String,
        asset_id_hash: String,
        params_data_hex: String,
        dwallet_program: String,
        grpc_url: Option<String>,
        rpc_url: Option<String>,
        broadcast: bool,
    },
    SolBatchSend {
        wallet: String,
        proposal: String,
        payments: Vec<LamportPayment>,
    },
    AgentTradeApproval {
        wallet: String,
        proposal: String,
        amount_raw: u128,
        agent_id_hash: String,
        venue_hash: String,
        market_hash: String,
        side_hash: String,
        asset_id_hash: String,
        max_leverage_x100: u32,
        session_id_hash: String,
        route_hash: String,
        risk_check_hash: String,
    },
    AgentSessionGrant {
        wallet: String,
        proposal: String,
        session_id_hash: String,
        agent_id_hash: String,
        venue_hash: String,
        market_hash: String,
        max_notional_raw: u128,
        max_leverage_x100: u32,
        expires_at: i64,
        status: u8,
    },
}

impl TypedProposalExecution {
    pub fn label(&self) -> &'static str {
        match self {
            Self::EscrowRelease { .. } => "proposal typed-escrow-release",
            Self::EscrowReturn { .. } => "proposal typed-escrow-return",
            Self::SolSend { .. } => "proposal typed-sol-send",
            Self::WalletPolicyUpdate { .. } => "proposal typed-wallet-policy-update",
            Self::IntentGovernance { .. } => "proposal typed-intent-governance",
            Self::ChainSend { .. } => "proposal typed-chain-send",
            Self::ChainSendIka { .. } => "proposal typed-chain-send-ika",
            Self::SolBatchSend { .. } => "proposal typed-sol-batch-send",
            Self::AgentTradeApproval { .. } => "proposal typed-agent-trade-approval",
            Self::AgentSessionGrant { .. } => "proposal typed-agent-session-grant",
        }
    }

    fn validate_boundary(&self) -> Result<(), String> {
        const MAX_VALUES: usize = 256;
        const MAX_VALUE_BYTES: usize = 16 * 1024;

        let values = self.string_values();
        if values.len() > MAX_VALUES {
            return Err(format!(
                "typed execution has too many string values: {}",
                values.len()
            ));
        }
        for value in values {
            if value.len() > MAX_VALUE_BYTES {
                return Err("typed execution value exceeds the size limit".into());
            }
            if value
                .chars()
                .any(|character| matches!(character, '\0' | '\n' | '\r'))
            {
                return Err("typed execution values cannot contain control separators".into());
            }
        }
        Ok(())
    }

    fn string_values(&self) -> Vec<&str> {
        let mut values = Vec::new();
        match self {
            Self::EscrowRelease {
                wallet,
                proposal,
                recipient,
                escrow_id,
                milestone_id,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                recipient.as_str(),
                escrow_id.as_str(),
                milestone_id.as_str(),
            ]),
            Self::EscrowReturn {
                wallet,
                proposal,
                escrow_id,
                returns,
            } => {
                values.extend([wallet.as_str(), proposal.as_str(), escrow_id.as_str()]);
                values.extend(returns.iter().map(|row| row.recipient.as_str()));
            }
            Self::SolSend {
                wallet,
                proposal,
                recipient,
                ..
            } => values.extend([wallet.as_str(), proposal.as_str(), recipient.as_str()]),
            Self::WalletPolicyUpdate {
                wallet,
                proposal,
                policy_bytes_hex,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                policy_bytes_hex.as_str(),
            ]),
            Self::IntentGovernance {
                wallet,
                proposal,
                new_intent_body_hex,
                file,
                proposers,
                approvers,
                ..
            } => {
                values.extend([wallet.as_str(), proposal.as_str()]);
                values.extend(new_intent_body_hex.iter().map(String::as_str));
                values.extend(file.iter().map(String::as_str));
                values.extend(proposers.iter().flatten().map(String::as_str));
                values.extend(approvers.iter().flatten().map(String::as_str));
            }
            Self::ChainSend {
                wallet,
                proposal,
                recipient_hash,
                asset_id_hash,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                recipient_hash.as_str(),
                asset_id_hash.as_str(),
            ]),
            Self::ChainSendIka {
                wallet,
                proposal,
                recipient_hash,
                asset_id_hash,
                params_data_hex,
                dwallet_program,
                grpc_url,
                rpc_url,
                ..
            } => {
                values.extend([
                    wallet.as_str(),
                    proposal.as_str(),
                    recipient_hash.as_str(),
                    asset_id_hash.as_str(),
                    params_data_hex.as_str(),
                    dwallet_program.as_str(),
                ]);
                values.extend(grpc_url.iter().map(String::as_str));
                values.extend(rpc_url.iter().map(String::as_str));
            }
            Self::SolBatchSend {
                wallet,
                proposal,
                payments,
            } => {
                values.extend([wallet.as_str(), proposal.as_str()]);
                values.extend(payments.iter().map(|row| row.recipient.as_str()));
            }
            Self::AgentTradeApproval {
                wallet,
                proposal,
                agent_id_hash,
                venue_hash,
                market_hash,
                side_hash,
                asset_id_hash,
                session_id_hash,
                route_hash,
                risk_check_hash,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                agent_id_hash.as_str(),
                venue_hash.as_str(),
                market_hash.as_str(),
                side_hash.as_str(),
                asset_id_hash.as_str(),
                session_id_hash.as_str(),
                route_hash.as_str(),
                risk_check_hash.as_str(),
            ]),
            Self::AgentSessionGrant {
                wallet,
                proposal,
                session_id_hash,
                agent_id_hash,
                venue_hash,
                market_hash,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                session_id_hash.as_str(),
                agent_id_hash.as_str(),
                venue_hash.as_str(),
                market_hash.as_str(),
            ]),
        }
        values
    }
}

impl From<TypedProposalExecution> for ProposalAction {
    fn from(value: TypedProposalExecution) -> Self {
        match value {
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
        }
    }
}

pub fn prepare_typed_proposal_execution(
    globals: CliGlobals,
    execution: TypedProposalExecution,
) -> Result<ExecutionRequest, String> {
    execution.validate_boundary()?;
    Ok(ExecutionRequest {
        globals,
        command: Command::Proposal {
            action: execution.into(),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{prepare_typed_proposal_execution, LamportPayment, TypedProposalExecution};
    use crate::commands::proposal::ProposalAction;
    use crate::config::CliGlobals;

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
    fn batch_payments_are_encoded_only_inside_the_cli_adapter() {
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
