use crate::validate_values;

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

    pub fn validate_boundary(&self) -> Result<(), String> {
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
        validate_values("typed execution", values)
    }
}

#[cfg(test)]
mod tests {
    use super::TypedProposalExecution;

    #[test]
    fn rejects_unbounded_execution_collections() {
        let execution = TypedProposalExecution::IntentGovernance {
            wallet: "team".into(),
            proposal: "proposal".into(),
            action_kind: Some(3),
            target_index: None,
            new_intent_body_hex: None,
            file: None,
            proposers: Some((0..256).map(|index| format!("p-{index}")).collect()),
            approvers: None,
            threshold: Some(1),
            cancellation_threshold: 1,
            timelock: 0,
        };
        assert!(execution.validate_boundary().is_err());
    }
}
