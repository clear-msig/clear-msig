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

declare_id!("Abf68HjgGyaCqGtu2W9Tg7Kkz5iJoBvAb8e86M6xTkNJ");

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
    ) -> Result<(), ProgramError> {
        ctx.accounts.propose_typed(
            proposal_index,
            ProposeTypedArgs {
                expiry,
                action_kind,
                action_id: &action_id,
                nonce: &nonce,
                policy_commitment,
                payload_hash,
                envelope_hash,
                proposer_pubkey: &proposer_pubkey,
                signature: &signature,
            },
            &ctx.bumps,
        )
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
