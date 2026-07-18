use crate::validate_values;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LamportPayment {
    pub recipient: String,
    pub amount_lamports: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenPayment {
    pub destination_token: String,
    pub funder_owner: String,
    pub amount_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypedProposalExecution {
    RecurringSchedule {
        wallet: String,
        proposal: String,
        schedule_id: String,
        recipient: String,
        amount_lamports: u64,
        interval_seconds: u32,
        first_execution_at: i64,
        payment_count: u32,
        status: u8,
    },
    RecurringPayment {
        wallet: String,
        intent: String,
        schedule_id: String,
        recipient: String,
    },
    RecurringTokenSchedule {
        wallet: String,
        proposal: String,
        schedule_id: String,
        mint: String,
        source_token: String,
        destination_token: String,
        recipient_owner: String,
        amount_tokens: u64,
        interval_seconds: u32,
        first_execution_at: i64,
        payment_count: u32,
        status: u8,
    },
    RecurringTokenPayment {
        wallet: String,
        intent: String,
        schedule_id: String,
        mint: String,
        source_token: String,
        destination_token: String,
        recipient_owner: String,
    },
    RecurringAssetSchedule {
        wallet: String,
        proposal: String,
        schedule_id: String,
        mint: String,
        source_token: String,
        destination_token: String,
        recipient_owner: String,
        amount_tokens: u64,
        interval_seconds: u32,
        first_execution_at: i64,
        payment_count: u32,
        status: u8,
    },
    RecurringAssetPayment {
        wallet: String,
        intent: String,
        schedule_id: String,
        mint: String,
        source_token: String,
        destination_token: String,
        recipient_owner: String,
    },
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
    SplEscrowRelease {
        wallet: String,
        proposal: String,
        mint: String,
        source_token: String,
        destination_token: String,
        recipient_owner: String,
        amount_tokens: u64,
        escrow_id: String,
        milestone_id: String,
    },
    SplEscrowReturn {
        wallet: String,
        proposal: String,
        mint: String,
        source_token: String,
        escrow_id: String,
        returns: Vec<TokenPayment>,
    },
    CrossChainEscrowRelease {
        wallet: String,
        proposal: String,
        chain_kind: u8,
        amount_raw: u128,
        escrow_id: String,
        milestone_id: String,
        recipient_hash: String,
        asset_id_hash: String,
        route_hash: String,
        settlement_artifact_hash: String,
    },
    CrossChainEscrowReturn {
        wallet: String,
        proposal: String,
        chain_kind: u8,
        amount_raw: u128,
        escrow_id: String,
        refund_recipient_hash: String,
        asset_id_hash: String,
        route_hash: String,
        settlement_artifact_hash: String,
    },
    PrivateEscrowRelease {
        wallet: String,
        proposal: String,
        amount_raw: u128,
        escrow_id: String,
        milestone_id: String,
        recipient_hash: String,
        asset_id_hash: String,
        private_evaluation_hash: String,
        settlement_artifact_hash: String,
    },
    PrivateEscrowReturn {
        wallet: String,
        proposal: String,
        amount_raw: u128,
        escrow_id: String,
        refund_recipient_hash: String,
        asset_id_hash: String,
        private_evaluation_hash: String,
        settlement_artifact_hash: String,
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
    AssetPolicyUpdate {
        wallet: String,
        proposal: String,
        policy_bytes_hex: String,
        chain_kind: u8,
        scope_kind: u8,
        decimals: u8,
        asset_id: String,
        display_asset: String,
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
    AgentRiskPolicy {
        wallet: String,
        proposal: String,
        session_id_hash: String,
        oracle_policy_hash: String,
        max_loss_raw: u128,
        status: u8,
    },
    AgentTradeSettlement {
        wallet: String,
        proposal: String,
        session_id_hash: String,
        execution_id_hash: String,
        settlement_artifact_hash: String,
        oracle_policy_hash: String,
        closed_notional_raw: u128,
        outcome: u8,
        pnl_abs_raw: u128,
        settlement_sequence: u64,
    },
}

impl TypedProposalExecution {
    pub fn label(&self) -> &'static str {
        match self {
            Self::RecurringSchedule { .. } => "proposal typed-recurring-schedule",
            Self::RecurringPayment { .. } => "proposal recurring-payment",
            Self::RecurringTokenSchedule { .. } => "proposal typed-recurring-token-schedule",
            Self::RecurringTokenPayment { .. } => "proposal recurring-token-payment",
            Self::RecurringAssetSchedule { .. } => "proposal typed-recurring-asset-schedule",
            Self::RecurringAssetPayment { .. } => "proposal recurring-asset-payment",
            Self::EscrowRelease { .. } => "proposal typed-escrow-release",
            Self::EscrowReturn { .. } => "proposal typed-escrow-return",
            Self::SplEscrowRelease { .. } => "proposal typed-spl-escrow-release",
            Self::SplEscrowReturn { .. } => "proposal typed-spl-escrow-return",
            Self::CrossChainEscrowRelease { .. } => "proposal typed-cross-chain-escrow-release",
            Self::CrossChainEscrowReturn { .. } => "proposal typed-cross-chain-escrow-return",
            Self::PrivateEscrowRelease { .. } => "proposal typed-private-escrow-release",
            Self::PrivateEscrowReturn { .. } => "proposal typed-private-escrow-return",
            Self::SolSend { .. } => "proposal typed-sol-send",
            Self::WalletPolicyUpdate { .. } => "proposal typed-wallet-policy-update",
            Self::AssetPolicyUpdate { .. } => "proposal typed-asset-policy-update",
            Self::IntentGovernance { .. } => "proposal typed-intent-governance",
            Self::ChainSend { .. } => "proposal typed-chain-send",
            Self::ChainSendIka { .. } => "proposal typed-chain-send-ika",
            Self::SolBatchSend { .. } => "proposal typed-sol-batch-send",
            Self::AgentTradeApproval { .. } => "proposal typed-agent-trade-approval",
            Self::AgentSessionGrant { .. } => "proposal typed-agent-session-grant",
            Self::AgentRiskPolicy { .. } => "proposal typed-agent-risk-policy",
            Self::AgentTradeSettlement { .. } => "proposal typed-agent-trade-settlement",
        }
    }

    pub fn validate_boundary(&self) -> Result<(), String> {
        let mut values = Vec::new();
        match self {
            Self::RecurringSchedule {
                wallet,
                proposal,
                schedule_id,
                recipient,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                schedule_id.as_str(),
                recipient.as_str(),
            ]),
            Self::RecurringPayment {
                wallet,
                intent,
                schedule_id,
                recipient,
            } => values.extend([
                wallet.as_str(),
                intent.as_str(),
                schedule_id.as_str(),
                recipient.as_str(),
            ]),
            Self::RecurringTokenSchedule {
                wallet,
                proposal,
                schedule_id,
                mint,
                source_token,
                destination_token,
                recipient_owner,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                schedule_id.as_str(),
                mint.as_str(),
                source_token.as_str(),
                destination_token.as_str(),
                recipient_owner.as_str(),
            ]),
            Self::RecurringTokenPayment {
                wallet,
                intent,
                schedule_id,
                mint,
                source_token,
                destination_token,
                recipient_owner,
            } => values.extend([
                wallet.as_str(),
                intent.as_str(),
                schedule_id.as_str(),
                mint.as_str(),
                source_token.as_str(),
                destination_token.as_str(),
                recipient_owner.as_str(),
            ]),
            Self::RecurringAssetSchedule {
                wallet,
                proposal,
                schedule_id,
                mint,
                source_token,
                destination_token,
                recipient_owner,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                schedule_id.as_str(),
                mint.as_str(),
                source_token.as_str(),
                destination_token.as_str(),
                recipient_owner.as_str(),
            ]),
            Self::RecurringAssetPayment {
                wallet,
                intent,
                schedule_id,
                mint,
                source_token,
                destination_token,
                recipient_owner,
            } => values.extend([
                wallet.as_str(),
                intent.as_str(),
                schedule_id.as_str(),
                mint.as_str(),
                source_token.as_str(),
                destination_token.as_str(),
                recipient_owner.as_str(),
            ]),
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
            Self::SplEscrowRelease {
                wallet,
                proposal,
                mint,
                source_token,
                destination_token,
                recipient_owner,
                escrow_id,
                milestone_id,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                mint.as_str(),
                source_token.as_str(),
                destination_token.as_str(),
                recipient_owner.as_str(),
                escrow_id.as_str(),
                milestone_id.as_str(),
            ]),
            Self::SplEscrowReturn {
                wallet,
                proposal,
                mint,
                source_token,
                escrow_id,
                returns,
            } => {
                values.extend([
                    wallet.as_str(),
                    proposal.as_str(),
                    mint.as_str(),
                    source_token.as_str(),
                    escrow_id.as_str(),
                ]);
                values.extend(
                    returns.iter().flat_map(|row| {
                        [row.destination_token.as_str(), row.funder_owner.as_str()]
                    }),
                );
            }
            Self::CrossChainEscrowRelease {
                wallet,
                proposal,
                escrow_id,
                milestone_id,
                recipient_hash,
                asset_id_hash,
                route_hash,
                settlement_artifact_hash,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                escrow_id.as_str(),
                milestone_id.as_str(),
                recipient_hash.as_str(),
                asset_id_hash.as_str(),
                route_hash.as_str(),
                settlement_artifact_hash.as_str(),
            ]),
            Self::CrossChainEscrowReturn {
                wallet,
                proposal,
                escrow_id,
                refund_recipient_hash,
                asset_id_hash,
                route_hash,
                settlement_artifact_hash,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                escrow_id.as_str(),
                refund_recipient_hash.as_str(),
                asset_id_hash.as_str(),
                route_hash.as_str(),
                settlement_artifact_hash.as_str(),
            ]),
            Self::PrivateEscrowRelease {
                wallet,
                proposal,
                escrow_id,
                milestone_id,
                recipient_hash,
                asset_id_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                escrow_id.as_str(),
                milestone_id.as_str(),
                recipient_hash.as_str(),
                asset_id_hash.as_str(),
                private_evaluation_hash.as_str(),
                settlement_artifact_hash.as_str(),
            ]),
            Self::PrivateEscrowReturn {
                wallet,
                proposal,
                escrow_id,
                refund_recipient_hash,
                asset_id_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                escrow_id.as_str(),
                refund_recipient_hash.as_str(),
                asset_id_hash.as_str(),
                private_evaluation_hash.as_str(),
                settlement_artifact_hash.as_str(),
            ]),
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
            Self::AssetPolicyUpdate {
                wallet,
                proposal,
                policy_bytes_hex,
                asset_id,
                display_asset,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                policy_bytes_hex.as_str(),
                asset_id.as_str(),
                display_asset.as_str(),
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
            Self::AgentRiskPolicy {
                wallet,
                proposal,
                session_id_hash,
                oracle_policy_hash,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                session_id_hash.as_str(),
                oracle_policy_hash.as_str(),
            ]),
            Self::AgentTradeSettlement {
                wallet,
                proposal,
                session_id_hash,
                execution_id_hash,
                settlement_artifact_hash,
                oracle_policy_hash,
                ..
            } => values.extend([
                wallet.as_str(),
                proposal.as_str(),
                session_id_hash.as_str(),
                execution_id_hash.as_str(),
                settlement_artifact_hash.as_str(),
                oracle_policy_hash.as_str(),
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
