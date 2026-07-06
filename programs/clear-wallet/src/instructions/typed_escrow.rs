use core::mem::MaybeUninit;

use quasar_lang::{cpi::Seed, prelude::*, remaining::RemainingAccounts};

use crate::{
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::{
        intent::Intent, proposal::ProposalStatus, typed_proposal::TypedProposal,
        wallet::ClearWallet,
    },
    utils::clearsign::{
        hash_release_milestone_payload, hash_return_escrow_sol_payload_iter, ClearSignActionKind,
        ClearSignAmount,
    },
};

const SOL_ASSET: &[u8] = b"SOL";

#[derive(Accounts)]
pub struct ExecuteTypedEscrowRelease<'info> {
    pub wallet: Account<ClearWallet<'info>>,
    #[cfg_attr(target_os = "solana", allow(quasar::writable_no_authority))]
    #[account(
        mut,
        seeds = [b"vault", wallet],
        bump,
    )]
    pub vault: &'info mut UncheckedAccount,
    #[account(
        mut,
        has_one = wallet,
        constraint = intent.is_approved() @ WalletError::IntentNotApproved,
    )]
    pub intent: Account<Intent<'info>>,
    #[account(
        mut,
        has_one = wallet,
        has_one = intent,
        constraint = proposal.status == ProposalStatus::Approved @ WalletError::ProposalNotApproved
    )]
    pub proposal: Account<TypedProposal<'info>>,
    #[account(mut)]
    pub recipient: &'info mut UncheckedAccount,
    pub system_program: &'info Program<System>,
}

pub struct ExecuteTypedEscrowReleaseArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub escrow_id_hash: [u8; 32],
    pub milestone_id_hash: [u8; 32],
    pub amount_lamports: u64,
}

#[derive(Accounts)]
pub struct ExecuteTypedEscrowReturn<'info> {
    pub wallet: Account<ClearWallet<'info>>,
    #[cfg_attr(target_os = "solana", allow(quasar::writable_no_authority))]
    #[account(
        mut,
        seeds = [b"vault", wallet],
        bump,
    )]
    pub vault: &'info mut UncheckedAccount,
    #[account(
        mut,
        has_one = wallet,
        constraint = intent.is_approved() @ WalletError::IntentNotApproved,
    )]
    pub intent: Account<Intent<'info>>,
    #[account(
        mut,
        has_one = wallet,
        has_one = intent,
        constraint = proposal.status == ProposalStatus::Approved @ WalletError::ProposalNotApproved
    )]
    pub proposal: Account<TypedProposal<'info>>,
    pub system_program: &'info Program<System>,
}

pub struct ExecuteTypedEscrowReturnArgs<'a> {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub escrow_id_hash: [u8; 32],
    pub amount_lamports_le: &'a [u8],
}

impl<'info> ExecuteTypedEscrowRelease<'info> {
    pub fn execute_typed_escrow_release(
        &mut self,
        args: ExecuteTypedEscrowReleaseArgs,
        bumps: &ExecuteTypedEscrowReleaseBumps,
    ) -> Result<(), ProgramError> {
        let amount = ClearSignAmount {
            asset: SOL_ASSET,
            raw_amount: args.amount_lamports as u128,
        };
        let payload_hash = hash_release_milestone_payload(
            &args.escrow_id_hash,
            &args.milestone_id_hash,
            self.recipient.address().as_ref(),
            &amount,
        );
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            ClearSignActionKind::ReleaseMilestone.code(),
            args.policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;
        let vault_seeds = self.vault_seeds(bumps);
        transfer_lamports(
            self.vault.to_account_view(),
            self.recipient.to_account_view(),
            self.system_program,
            &vault_seeds,
            args.amount_lamports,
        )?;
        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}

impl<'info> ExecuteTypedEscrowReturn<'info> {
    pub fn execute_typed_escrow_return(
        &mut self,
        args: ExecuteTypedEscrowReturnArgs<'_>,
        bumps: &ExecuteTypedEscrowReturnBumps,
        remaining: RemainingAccounts,
    ) -> Result<(), ProgramError> {
        require!(
            !args.amount_lamports_le.is_empty(),
            ProgramError::InvalidInstructionData
        );
        require!(
            args.amount_lamports_le.len() % 8 == 0,
            ProgramError::InvalidInstructionData
        );
        let return_count = args.amount_lamports_le.len() / 8;
        require!(return_count > 0, ProgramError::InvalidInstructionData);
        require!(return_count <= 16, WalletError::TooManyAccounts);

        let mut funders: [MaybeUninit<AccountView>; 16] =
            unsafe { MaybeUninit::uninit().assume_init() };
        let mut remaining_iter = remaining.iter();
        for index in 0..return_count {
            let account = remaining_iter
                .next()
                .ok_or(ProgramError::NotEnoughAccountKeys)??;
            funders[index].write(account);
        }
        require!(
            remaining_iter.next().is_none(),
            WalletError::AccountCountMismatch
        );

        let payload_hash = hash_return_escrow_sol_payload_iter(
            &args.escrow_id_hash,
            (0..return_count).map(|index| {
                let funder = unsafe { funders[index].assume_init_ref() };
                (
                    funder.address().as_ref(),
                    read_amount(args.amount_lamports_le, index),
                )
            }),
        );
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            ClearSignActionKind::ReturnEscrowFunds.code(),
            args.policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;

        let vault = self.vault.to_account_view();
        let vault_seeds = self.vault_seeds(bumps);
        for index in 0..return_count {
            let funder = unsafe { funders[index].assume_init_ref() };
            transfer_lamports(
                vault,
                funder,
                self.system_program,
                &vault_seeds,
                read_amount(args.amount_lamports_le, index),
            )?;
        }

        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}

fn read_amount(amounts_le: &[u8], index: usize) -> u64 {
    let offset = index * 8;
    u64::from_le_bytes([
        amounts_le[offset],
        amounts_le[offset + 1],
        amounts_le[offset + 2],
        amounts_le[offset + 3],
        amounts_le[offset + 4],
        amounts_le[offset + 5],
        amounts_le[offset + 6],
        amounts_le[offset + 7],
    ])
}

fn transfer_lamports(
    vault: &AccountView,
    recipient: &AccountView,
    system_program: &Program<System>,
    vault_seeds: &[Seed],
    amount: u64,
) -> Result<(), ProgramError> {
    require!(amount > 0, ProgramError::InvalidInstructionData);
    require!(vault.is_writable(), ProgramError::Immutable);
    require!(recipient.is_writable(), ProgramError::Immutable);
    system_program
        .transfer(vault, recipient, amount)
        .invoke_signed(vault_seeds)
}
