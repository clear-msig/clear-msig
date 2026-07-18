#![no_std]
#![cfg_attr(target_os = "solana", feature(register_tool))]
#![cfg_attr(target_os = "solana", register_tool(quasar))]
#![allow(unexpected_cfgs)]

use quasar_lang::prelude::*;

mod error;
pub use error::*;
mod instructions;
use instructions::*;
mod state;
pub use state::*;
pub mod chains;
pub mod utils;

#[cfg(test)]
mod tests;

declare_id!("53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v");

#[program]
pub mod clear_wallet {
    use super::*;

    #[instruction(discriminator = 0)]
    pub fn create_wallet(
        ctx: Ctx<CreateWallet>,
        approval_threshold: u8,
        cancellation_threshold: u8,
        timelock_seconds: u32,
        name: String<64>,
        proposers: Vec<[u8; 32], 16>,
        approvers: Vec<[u8; 32], 16>,
        policy_ciphertexts: &[u8],
    ) -> Result<(), ProgramError> {
        ctx.accounts.create(
            CreateWalletArgs {
                name,
                approval_threshold,
                cancellation_threshold,
                timelock_seconds,
                proposers,
                approvers,
                policy_ciphertexts,
            },
            &ctx.bumps,
        )
    }

    #[instruction(discriminator = 1)]
    pub fn propose(
        ctx: Ctx<Propose>,
        proposal_index: u64,
        expiry: i64,
        proposer_pubkey: [u8; 32],
        signature: [u8; 64],
        params_data: &[u8],
    ) -> Result<(), ProgramError> {
        ctx.accounts.propose(
            proposal_index,
            ProposeArgs {
                expiry,
                proposer_pubkey: &proposer_pubkey,
                signature: &signature,
                params_data,
            },
            &ctx.bumps,
        )
    }

    #[instruction(discriminator = 2)]
    pub fn approve(
        ctx: Ctx<Approve>,
        expiry: i64,
        approver_index: u8,
        signature: [u8; 64],
    ) -> Result<(), ProgramError> {
        ctx.accounts.approve(ApproveArgs {
            expiry,
            approver_index,
            signature: &signature,
        })
    }

    #[instruction(discriminator = 3)]
    pub fn cancel(
        ctx: Ctx<Cancel>,
        expiry: i64,
        canceller_index: u8,
        signature: [u8; 64],
    ) -> Result<(), ProgramError> {
        ctx.accounts.cancel(CancelArgs {
            expiry,
            canceller_index,
            signature: &signature,
        })
    }

    /// Execute meta-intents (AddIntent, RemoveIntent, UpdateIntent).
    /// Custom intents go through `ika_sign` instead.
    #[instruction(discriminator = 4)]
    pub fn execute(ctx: CtxWithRemaining<Execute>) -> Result<(), ProgramError> {
        ctx.accounts
            .execute(&ctx.bumps, ctx.remaining_accounts_passthrough())
    }

    #[instruction(discriminator = 5)]
    pub fn cleanup_proposal(ctx: Ctx<CleanupProposal>) -> Result<(), ProgramError> {
        ctx.accounts.cleanup()
    }

    #[instruction(discriminator = 16)]
    pub fn cleanup_typed_proposal(ctx: Ctx<CleanupTypedProposal>) -> Result<(), ProgramError> {
        ctx.accounts.cleanup()
    }

    #[instruction(discriminator = 17)]
    pub fn execute_typed_spl_escrow_release(
        ctx: Ctx<ExecuteTypedSplEscrowRelease>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_tokens: u64,
        escrow_id_hash: [u8; 32],
        milestone_id_hash: [u8; 32],
    ) -> Result<(), ProgramError> {
        ctx.accounts.execute_typed_spl_escrow_release(
            ExecuteTypedSplEscrowReleaseArgs {
                policy_commitment,
                envelope_hash,
                escrow_id_hash,
                milestone_id_hash,
                amount_tokens,
            },
            &ctx.bumps,
        )
    }

    #[instruction(discriminator = 18)]
    pub fn execute_typed_spl_escrow_return(
        ctx: CtxWithRemaining<ExecuteTypedSplEscrowReturn>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        escrow_id_hash: [u8; 32],
        amount_tokens_le: &[u8],
    ) -> Result<(), ProgramError> {
        ctx.accounts.execute_typed_spl_escrow_return(
            ExecuteTypedSplEscrowReturnArgs {
                policy_commitment,
                envelope_hash,
                escrow_id_hash,
                amount_tokens_le,
            },
            &ctx.bumps,
            ctx.remaining_accounts_passthrough(),
        )
    }

    #[instruction(discriminator = 19)]
    pub fn execute_typed_cross_chain_escrow_release(
        ctx: Ctx<ExecuteTypedCrossChainEscrowRelease>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        chain_kind: u8,
        amount_raw_le: [u8; 16],
        escrow_id_hash: [u8; 32],
        milestone_id_hash: [u8; 32],
        recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        route_hash: [u8; 32],
        tx_template_hash: [u8; 32],
        settlement_artifact_hash: [u8; 32],
    ) -> Result<(), ProgramError> {
        ctx.accounts.execute_typed_cross_chain_escrow_release(
            ExecuteTypedCrossChainEscrowReleaseArgs {
                policy_commitment,
                envelope_hash,
                chain_kind,
                amount_raw_le,
                escrow_id_hash,
                milestone_id_hash,
                recipient_hash,
                asset_id_hash,
                route_hash,
                tx_template_hash,
                settlement_artifact_hash,
            },
        )
    }

    #[instruction(discriminator = 20)]
    pub fn execute_typed_cross_chain_escrow_return(
        ctx: Ctx<ExecuteTypedCrossChainEscrowReturn>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        chain_kind: u8,
        amount_raw_le: [u8; 16],
        escrow_id_hash: [u8; 32],
        refund_recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        route_hash: [u8; 32],
        tx_template_hash: [u8; 32],
        settlement_artifact_hash: [u8; 32],
    ) -> Result<(), ProgramError> {
        ctx.accounts.execute_typed_cross_chain_escrow_return(
            ExecuteTypedCrossChainEscrowReturnArgs {
                policy_commitment,
                envelope_hash,
                chain_kind,
                amount_raw_le,
                escrow_id_hash,
                refund_recipient_hash,
                asset_id_hash,
                route_hash,
                tx_template_hash,
                settlement_artifact_hash,
            },
        )
    }

    #[instruction(discriminator = 21)]
    pub fn execute_typed_private_escrow_release(
        ctx: Ctx<ExecuteTypedPrivateEscrowRelease>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_raw_le: [u8; 16],
        escrow_id_hash: [u8; 32],
        milestone_id_hash: [u8; 32],
        recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        policy_ciphertexts_hash: [u8; 32],
        private_evaluation_hash: [u8; 32],
        settlement_artifact_hash: [u8; 32],
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .execute_typed_private_escrow_release(ExecuteTypedPrivateEscrowReleaseArgs {
                policy_commitment,
                envelope_hash,
                amount_raw_le,
                escrow_id_hash,
                milestone_id_hash,
                recipient_hash,
                asset_id_hash,
                policy_ciphertexts_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
            })
    }

    #[instruction(discriminator = 22)]
    pub fn execute_typed_private_escrow_return(
        ctx: Ctx<ExecuteTypedPrivateEscrowReturn>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_raw_le: [u8; 16],
        escrow_id_hash: [u8; 32],
        refund_recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        policy_ciphertexts_hash: [u8; 32],
        private_evaluation_hash: [u8; 32],
        settlement_artifact_hash: [u8; 32],
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .execute_typed_private_escrow_return(ExecuteTypedPrivateEscrowReturnArgs {
                policy_commitment,
                envelope_hash,
                amount_raw_le,
                escrow_id_hash,
                refund_recipient_hash,
                asset_id_hash,
                policy_ciphertexts_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
            })
    }

    #[instruction(discriminator = 23)]
    pub fn execute_typed_agent_trade_approval(
        ctx: Ctx<ExecuteTypedAgentTradeApproval>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_raw_le: [u8; 16],
        agent_id_hash: [u8; 32],
        venue_hash: [u8; 32],
        market_hash: [u8; 32],
        side_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        max_leverage_x100: u32,
        session_id_hash: [u8; 32],
        route_hash: [u8; 32],
        risk_check_hash: [u8; 32],
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .execute_typed_agent_trade_approval(ExecuteTypedAgentTradeApprovalArgs {
                policy_commitment,
                envelope_hash,
                amount_raw_le,
                agent_id_hash,
                venue_hash,
                market_hash,
                side_hash,
                asset_id_hash,
                max_leverage_x100,
                session_id_hash,
                route_hash,
                risk_check_hash,
            })
    }

    /// Grant or revoke a bounded agent trading session (ClearSign AgentSessionGrant).
    #[instruction(discriminator = 28)]
    pub fn execute_typed_agent_session_grant(
        ctx: Ctx<ExecuteTypedAgentSessionGrant>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        session_id_hash: [u8; 32],
        agent_id_hash: [u8; 32],
        venue_hash: [u8; 32],
        market_hash: [u8; 32],
        max_notional_raw_le: [u8; 16],
        max_leverage_x100: u32,
        expires_at: i64,
        status: u8,
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .execute_typed_agent_session_grant(ExecuteTypedAgentSessionGrantArgs {
                policy_commitment,
                envelope_hash,
                session_id_hash,
                agent_id_hash,
                venue_hash,
                market_hash,
                max_notional_raw_le,
                max_leverage_x100,
                expires_at,
                status,
            })
    }

    /// Configure or pause the loss/oracle policy for one agent session.
    #[instruction(discriminator = 29)]
    pub fn execute_typed_agent_risk_policy(
        ctx: Ctx<ExecuteTypedAgentRiskPolicy>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        session_id_hash: [u8; 32],
        oracle_policy_hash: [u8; 32],
        max_loss_raw_le: [u8; 16],
        status: u8,
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .execute_typed_agent_risk_policy(ExecuteTypedAgentRiskPolicyArgs {
                policy_commitment,
                envelope_hash,
                session_id_hash,
                oracle_policy_hash,
                max_loss_raw_le,
                status,
            })
    }

    /// Close agent exposure using an owner-approved, artifact-bound settlement.
    #[instruction(discriminator = 30)]
    pub fn execute_typed_agent_trade_settlement(
        ctx: Ctx<ExecuteTypedAgentTradeSettlement>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        session_id_hash: [u8; 32],
        execution_id_hash: [u8; 32],
        settlement_artifact_hash: [u8; 32],
        oracle_policy_hash: [u8; 32],
        closed_notional_raw_le: [u8; 16],
        outcome: u8,
        pnl_abs_raw_le: [u8; 16],
        settlement_sequence: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .execute_typed_agent_trade_settlement(ExecuteTypedAgentTradeSettlementArgs {
                policy_commitment,
                envelope_hash,
                session_id_hash,
                execution_id_hash,
                settlement_artifact_hash,
                oracle_policy_hash,
                closed_notional_raw_le,
                outcome,
                pnl_abs_raw_le,
                settlement_sequence,
            })
    }

    #[instruction(discriminator = 24)]
    pub fn execute_typed_chain_send(
        ctx: Ctx<ExecuteTypedChainSend>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        chain_kind: u8,
        amount_raw_le: [u8; 16],
        recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        tx_template_hash: [u8; 32],
    ) -> Result<(), ProgramError> {
        ctx.accounts.execute_typed_chain_send(
            ExecuteTypedChainSendArgs {
                policy_commitment,
                envelope_hash,
                chain_kind,
                amount_raw_le,
                recipient_hash,
                asset_id_hash,
                tx_template_hash,
            },
            &ctx.bumps,
        )
    }

    #[instruction(discriminator = 25)]
    pub fn ika_sign_typed_chain_send(
        ctx: Ctx<IkaSignTypedChainSend>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        chain_kind: u8,
        amount_raw_le: [u8; 16],
        recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        tx_template_hash: [u8; 32],
        message_approval_bump: u8,
        cpi_authority_bump: u8,
        blake2b_hashes: [u8; 96],
        params_data: &[u8],
    ) -> Result<(), ProgramError> {
        ctx.accounts.ika_sign_typed_chain_send(
            IkaSignTypedChainSendArgs {
                policy_commitment,
                envelope_hash,
                chain_kind,
                amount_raw_le,
                recipient_hash,
                asset_id_hash,
                tx_template_hash,
                message_approval_bump,
                cpi_authority_bump,
                blake2b_hashes,
                params_data,
            },
            &ctx.bumps,
        )
    }

    #[instruction(discriminator = 26)]
    pub fn execute_typed_wallet_policy_update(
        ctx: Ctx<ExecuteTypedWalletPolicyUpdate>,
        current_policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        chain_kind: u8,
        new_policy_bytes: Vec<u8, 2048>,
    ) -> Result<(), ProgramError> {
        ctx.accounts.execute_typed_wallet_policy_update(
            ExecuteTypedWalletPolicyUpdateArgs {
                current_policy_commitment,
                envelope_hash,
                chain_kind,
                new_policy_bytes,
            },
            &ctx.bumps,
        )
    }

    /// Typed ClearSign executor for membership / threshold / timelock changes.
    /// Rewrites the target intent body after verifying the governance payload hash.
    #[instruction(discriminator = 27)]
    pub fn execute_typed_intent_governance(
        ctx: Ctx<ExecuteTypedIntentGovernance>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        action_kind: u8,
        target_intent_index: u8,
        new_intent_body: &[u8],
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .execute_typed_intent_governance(ExecuteTypedIntentGovernanceArgs {
                policy_commitment,
                envelope_hash,
                action_kind,
                target_intent_index,
                new_intent_body,
            })
    }

    #[instruction(discriminator = 6)]
    pub fn bind_dwallet(
        ctx: Ctx<BindDwallet>,
        chain_kind: u8,
        user_pubkey: [u8; 32],
        signature_scheme: u16,
        cpi_authority_bump: u8,
    ) -> Result<(), ProgramError> {
        ctx.accounts.bind(BindDwalletArgs {
            chain_kind,
            user_pubkey,
            signature_scheme,
            cpi_authority_bump,
        })
    }

    #[instruction(discriminator = 7)]
    pub fn ika_sign(
        ctx: Ctx<IkaSign>,
        message_approval_bump: u8,
        cpi_authority_bump: u8,
        blake2b_hashes: [u8; 96],
    ) -> Result<(), ProgramError> {
        ctx.accounts.ika_sign(IkaSignArgs {
            message_approval_bump,
            cpi_authority_bump,
            blake2b_hashes,
        })
    }

    #[instruction(discriminator = 8)]
    pub fn propose_typed(
        ctx: Ctx<ProposeTyped>,
        proposal_index: u64,
        expiry: i64,
        action_kind: u8,
        policy_commitment: [u8; 32],
        payload_hash: [u8; 32],
        envelope_hash: [u8; 32],
        proposer_pubkey: [u8; 32],
        signature: [u8; 64],
        action_id: [u8; 32],
        nonce: [u8; 32],
        policy_bytes: Vec<u8, 2048>,
        clear_text: &[u8],
    ) -> Result<(), ProgramError> {
        let _ = (
            proposal_index,
            expiry,
            action_kind,
            policy_commitment,
            payload_hash,
            envelope_hash,
            proposer_pubkey,
            signature,
            action_id,
            nonce,
            policy_bytes,
            clear_text,
        );
        ctx.accounts.propose_typed()
    }

    /// Creates a typed proposal from canonical intent bytes. The program
    /// derives both the execution payload hash and readable signing document;
    /// callers cannot provide either independently.
    #[instruction(discriminator = 31)]
    pub fn propose_typed_v4(
        ctx: Ctx<ProposeTyped>,
        proposal_index: u64,
        signature: [u8; 64],
        policy_bytes: Vec<u8, 2048>,
        canonical_intent: &[u8],
    ) -> Result<(), ProgramError> {
        ctx.accounts.propose_typed_v4(
            proposal_index,
            ProposeTypedV4Args {
                signature: &signature,
                policy_bytes,
                canonical_intent,
            },
            &ctx.bumps,
        )
    }

    /// Configure or revoke a threshold-approved recurring SOL schedule.
    #[instruction(discriminator = 32)]
    pub fn execute_typed_recurring_schedule(
        ctx: Ctx<ExecuteTypedRecurringSchedule>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        schedule_id_hash: [u8; 32],
        recipient: [u8; 32],
        amount_lamports: u64,
        interval_seconds: u32,
        first_execution_at: i64,
        payment_count: u32,
        status: u8,
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .execute_typed_recurring_schedule(ExecuteTypedRecurringScheduleArgs {
                policy_commitment,
                envelope_hash,
                schedule_id_hash,
                recipient,
                amount_lamports,
                interval_seconds,
                first_execution_at,
                payment_count,
                status,
            })
    }

    /// Execute one due recurring payment. Any relayer may submit this; the
    /// program-owned schedule is the authority and advances atomically.
    #[instruction(discriminator = 33)]
    pub fn execute_recurring_payment(
        ctx: Ctx<ExecuteRecurringPayment>,
        schedule_id_hash: [u8; 32],
    ) -> Result<(), ProgramError> {
        ctx.accounts
            .execute_recurring_payment(schedule_id_hash, &ctx.bumps)
    }

    #[instruction(discriminator = 9)]
    pub fn approve_typed(
        ctx: Ctx<ApproveTyped>,
        approver_index: u8,
        signature: [u8; 64],
    ) -> Result<(), ProgramError> {
        ctx.accounts.approve_typed(ApproveTypedArgs {
            approver_index,
            signature: &signature,
        })
    }

    #[instruction(discriminator = 10)]
    pub fn cancel_typed(
        ctx: Ctx<CancelTyped>,
        canceller_index: u8,
        signature: [u8; 64],
    ) -> Result<(), ProgramError> {
        ctx.accounts.cancel_typed(CancelTypedArgs {
            canceller_index,
            signature: &signature,
        })
    }

    #[instruction(discriminator = 11)]
    pub fn execute_typed(
        ctx: Ctx<ExecuteTyped>,
        action_kind: u8,
        policy_commitment: [u8; 32],
        payload_hash: [u8; 32],
        envelope_hash: [u8; 32],
    ) -> Result<(), ProgramError> {
        ctx.accounts.execute_typed(ExecuteTypedArgs {
            action_kind,
            policy_commitment,
            payload_hash,
            envelope_hash,
        })
    }

    #[instruction(discriminator = 12)]
    pub fn execute_typed_escrow_release(
        ctx: Ctx<ExecuteTypedEscrowRelease>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_lamports: u64,
        escrow_id_hash: [u8; 32],
        milestone_id_hash: [u8; 32],
    ) -> Result<(), ProgramError> {
        ctx.accounts.execute_typed_escrow_release(
            ExecuteTypedEscrowReleaseArgs {
                policy_commitment,
                envelope_hash,
                escrow_id_hash,
                milestone_id_hash,
                amount_lamports,
            },
            &ctx.bumps,
        )
    }

    #[instruction(discriminator = 13)]
    pub fn execute_typed_escrow_return(
        ctx: CtxWithRemaining<ExecuteTypedEscrowReturn>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        escrow_id_hash: [u8; 32],
        amount_lamports_le: &[u8],
    ) -> Result<(), ProgramError> {
        ctx.accounts.execute_typed_escrow_return(
            ExecuteTypedEscrowReturnArgs {
                policy_commitment,
                envelope_hash,
                escrow_id_hash,
                amount_lamports_le,
            },
            &ctx.bumps,
            ctx.remaining_accounts_passthrough(),
        )
    }

    #[instruction(discriminator = 14)]
    pub fn execute_typed_sol_send(
        ctx: Ctx<ExecuteTypedSolSend>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_lamports: u64,
    ) -> Result<(), ProgramError> {
        ctx.accounts.execute_typed_sol_send(
            ExecuteTypedSolSendArgs {
                policy_commitment,
                envelope_hash,
                amount_lamports,
            },
            &ctx.bumps,
        )
    }

    #[instruction(discriminator = 15)]
    pub fn execute_typed_sol_batch_send(
        ctx: CtxWithRemaining<ExecuteTypedSolBatchSend>,
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_lamports_le: &[u8],
    ) -> Result<(), ProgramError> {
        ctx.accounts.execute_typed_sol_batch_send(
            ExecuteTypedSolBatchSendArgs {
                policy_commitment,
                envelope_hash,
                amount_lamports_le,
            },
            &ctx.bumps,
            ctx.remaining_accounts_passthrough(),
        )
    }
}
