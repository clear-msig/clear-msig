use core::mem::MaybeUninit;

use quasar_lang::prelude::*;
use quasar_lang::remaining::RemainingAccounts;

use crate::{
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::{
        intent::Intent, proposal::ProposalStatus, typed_proposal::TypedProposal,
        wallet::ClearWallet,
    },
    utils::clearsign::{
        hash_release_token_milestone_payload, hash_return_token_escrow_payload_iter,
        ClearSignActionKind, ClearSignAmount,
    },
};

const SPL_TOKEN_ID: Address = address!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_ACCOUNT_LEN: usize = 165;
const TOKEN_MINT_OFFSET: usize = 0;
const TOKEN_OWNER_OFFSET: usize = 32;
const TOKEN_STATE_OFFSET: usize = 108;
const TOKEN_ACCOUNT_STATE_INITIALIZED: u8 = 1;
const TOKEN_ACCOUNT_STATE_FROZEN: u8 = 2;

#[derive(Accounts)]
pub struct ExecuteTypedSplEscrowRelease<'info> {
    pub wallet: Account<ClearWallet<'info>>,
    #[account(
        seeds = [b"vault", wallet],
        bump,
    )]
    pub vault: &'info UncheckedAccount,
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
    pub mint: &'info UncheckedAccount,
    #[account(mut)]
    pub source_token: &'info mut UncheckedAccount,
    #[account(mut)]
    pub destination_token: &'info mut UncheckedAccount,
    pub recipient_owner: &'info UncheckedAccount,
    pub token_program: &'info UncheckedAccount,
}

pub struct ExecuteTypedSplEscrowReleaseArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub escrow_id_hash: [u8; 32],
    pub milestone_id_hash: [u8; 32],
    pub amount_tokens: u64,
}

#[derive(Accounts)]
pub struct ExecuteTypedSplEscrowReturn<'info> {
    pub wallet: Account<ClearWallet<'info>>,
    #[account(
        seeds = [b"vault", wallet],
        bump,
    )]
    pub vault: &'info UncheckedAccount,
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
    pub mint: &'info UncheckedAccount,
    #[account(mut)]
    pub source_token: &'info mut UncheckedAccount,
    pub token_program: &'info UncheckedAccount,
}

pub struct ExecuteTypedSplEscrowReturnArgs<'a> {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub escrow_id_hash: [u8; 32],
    pub amount_tokens_le: &'a [u8],
}

impl<'info> ExecuteTypedSplEscrowRelease<'info> {
    pub fn execute_typed_spl_escrow_release(
        &mut self,
        args: ExecuteTypedSplEscrowReleaseArgs,
        bumps: &ExecuteTypedSplEscrowReleaseBumps,
    ) -> Result<(), ProgramError> {
        require!(args.amount_tokens > 0, ProgramError::InvalidInstructionData);
        require!(
            *self.token_program.address() == SPL_TOKEN_ID,
            ProgramError::IncorrectProgramId
        );
        require!(
            self.source_token.to_account_view().owned_by(&SPL_TOKEN_ID),
            ProgramError::IncorrectProgramId
        );
        require!(
            self.destination_token
                .to_account_view()
                .owned_by(&SPL_TOKEN_ID),
            ProgramError::IncorrectProgramId
        );
        let source_mint =
            token_account_address(self.source_token.to_account_view(), TOKEN_MINT_OFFSET)?;
        let destination_mint =
            token_account_address(self.destination_token.to_account_view(), TOKEN_MINT_OFFSET)?;
        let source_owner =
            token_account_address(self.source_token.to_account_view(), TOKEN_OWNER_OFFSET)?;
        let destination_owner =
            token_account_address(self.destination_token.to_account_view(), TOKEN_OWNER_OFFSET)?;
        require_keys_eq!(
            source_mint,
            *self.mint.address(),
            WalletError::AccountAddressMismatch
        );
        require_keys_eq!(
            destination_mint,
            *self.mint.address(),
            WalletError::AccountAddressMismatch
        );
        require_keys_eq!(
            source_owner,
            *self.vault.address(),
            WalletError::AccountAddressMismatch
        );
        require_keys_eq!(
            destination_owner,
            *self.recipient_owner.address(),
            WalletError::AccountAddressMismatch
        );
        require!(
            token_account_state(self.source_token.to_account_view())?
                == TOKEN_ACCOUNT_STATE_INITIALIZED,
            ProgramError::UninitializedAccount
        );
        require!(
            token_account_state(self.destination_token.to_account_view())?
                == TOKEN_ACCOUNT_STATE_INITIALIZED,
            ProgramError::UninitializedAccount
        );

        let amount = ClearSignAmount {
            asset: self.mint.address().as_ref(),
            raw_amount: args.amount_tokens as u128,
        };
        let payload_hash = hash_release_token_milestone_payload(
            &args.escrow_id_hash,
            &args.milestone_id_hash,
            self.mint.address().as_ref(),
            self.source_token.address().as_ref(),
            self.destination_token.address().as_ref(),
            self.recipient_owner.address().as_ref(),
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
        transfer_tokens(
            self.token_program,
            self.source_token,
            self.destination_token,
            self.vault,
            &vault_seeds,
            args.amount_tokens,
        )?;
        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}

impl<'info> ExecuteTypedSplEscrowReturn<'info> {
    pub fn execute_typed_spl_escrow_return(
        &mut self,
        args: ExecuteTypedSplEscrowReturnArgs<'_>,
        bumps: &ExecuteTypedSplEscrowReturnBumps,
        remaining: RemainingAccounts,
    ) -> Result<(), ProgramError> {
        require!(
            !args.amount_tokens_le.is_empty(),
            ProgramError::InvalidInstructionData
        );
        require!(
            args.amount_tokens_le.len() % 8 == 0,
            ProgramError::InvalidInstructionData
        );
        let return_count = args.amount_tokens_le.len() / 8;
        require!(return_count > 0, ProgramError::InvalidInstructionData);
        require!(return_count <= 16, WalletError::TooManyAccounts);
        require!(
            *self.token_program.address() == SPL_TOKEN_ID,
            ProgramError::IncorrectProgramId
        );
        require!(
            self.source_token.to_account_view().owned_by(&SPL_TOKEN_ID),
            ProgramError::IncorrectProgramId
        );
        let source_mint =
            token_account_address(self.source_token.to_account_view(), TOKEN_MINT_OFFSET)?;
        let source_owner =
            token_account_address(self.source_token.to_account_view(), TOKEN_OWNER_OFFSET)?;
        require_keys_eq!(
            source_mint,
            *self.mint.address(),
            WalletError::AccountAddressMismatch
        );
        require_keys_eq!(
            source_owner,
            *self.vault.address(),
            WalletError::AccountAddressMismatch
        );
        require!(
            token_account_state(self.source_token.to_account_view())?
                == TOKEN_ACCOUNT_STATE_INITIALIZED,
            ProgramError::UninitializedAccount
        );

        let mut destinations: [MaybeUninit<AccountView>; 16] =
            unsafe { MaybeUninit::uninit().assume_init() };
        let mut funders: [MaybeUninit<AccountView>; 16] =
            unsafe { MaybeUninit::uninit().assume_init() };
        let mut remaining_iter = remaining.iter();
        for index in 0..return_count {
            let destination = remaining_iter
                .next()
                .ok_or(ProgramError::NotEnoughAccountKeys)??;
            let funder = remaining_iter
                .next()
                .ok_or(ProgramError::NotEnoughAccountKeys)??;
            require!(destination.is_writable(), ProgramError::Immutable);
            require!(
                destination.owned_by(&SPL_TOKEN_ID),
                ProgramError::IncorrectProgramId
            );
            require_keys_eq!(
                token_account_address(&destination, TOKEN_MINT_OFFSET)?,
                *self.mint.address(),
                WalletError::AccountAddressMismatch
            );
            require_keys_eq!(
                token_account_address(&destination, TOKEN_OWNER_OFFSET)?,
                *funder.address(),
                WalletError::AccountAddressMismatch
            );
            require!(
                token_account_state(&destination)? == TOKEN_ACCOUNT_STATE_INITIALIZED,
                ProgramError::UninitializedAccount
            );
            destinations[index].write(destination);
            funders[index].write(funder);
        }
        require!(
            remaining_iter.next().is_none(),
            WalletError::AccountCountMismatch
        );

        let payload_hash = hash_return_token_escrow_payload_iter(
            &args.escrow_id_hash,
            self.mint.address().as_ref(),
            self.source_token.address().as_ref(),
            (0..return_count).map(|index| {
                let destination = unsafe { destinations[index].assume_init_ref() };
                let funder = unsafe { funders[index].assume_init_ref() };
                (
                    destination.address().as_ref(),
                    funder.address().as_ref(),
                    read_amount(args.amount_tokens_le, index),
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

        let vault_seeds = self.vault_seeds(bumps);
        let source = self.source_token.to_account_view();
        let authority = self.vault.to_account_view();
        for index in 0..return_count {
            let destination = unsafe { destinations[index].assume_init_ref() };
            transfer_tokens_view(
                self.token_program,
                source,
                destination,
                authority,
                &vault_seeds,
                read_amount(args.amount_tokens_le, index),
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

fn transfer_tokens(
    token_program: &UncheckedAccount,
    source: &UncheckedAccount,
    destination: &UncheckedAccount,
    authority: &UncheckedAccount,
    vault_seeds: &[Seed],
    amount: u64,
) -> Result<(), ProgramError> {
    transfer_tokens_view(
        token_program,
        source.to_account_view(),
        destination.to_account_view(),
        authority.to_account_view(),
        vault_seeds,
        amount,
    )
}

fn transfer_tokens_view(
    token_program: &UncheckedAccount,
    source: &AccountView,
    destination: &AccountView,
    authority: &AccountView,
    vault_seeds: &[Seed],
    amount: u64,
) -> Result<(), ProgramError> {
    let mut cpi = DynCpiCall::<3, 9>::new(token_program.address());
    cpi.push_account(source, false, true)?;
    cpi.push_account(destination, false, true)?;
    cpi.push_account(authority, true, false)?;
    let data = cpi.data_mut() as *mut u8;
    unsafe {
        *data = 3;
        core::ptr::copy_nonoverlapping(amount.to_le_bytes().as_ptr(), data.add(1), 8);
    }
    cpi.set_data_len(9)?;
    cpi.invoke_signed(vault_seeds)
}

fn token_account_address(account: &AccountView, offset: usize) -> Result<Address, ProgramError> {
    require!(
        account.data_len() >= TOKEN_ACCOUNT_LEN,
        ProgramError::AccountDataTooSmall
    );
    let data = unsafe { account.borrow_unchecked() };
    Ok(Address::new_from_array(
        data[offset..offset + 32]
            .try_into()
            .map_err(|_| ProgramError::InvalidAccountData)?,
    ))
}

fn token_account_state(account: &AccountView) -> Result<u8, ProgramError> {
    require!(
        account.data_len() >= TOKEN_ACCOUNT_LEN,
        ProgramError::AccountDataTooSmall
    );
    let data = unsafe { account.borrow_unchecked() };
    let state = data[TOKEN_STATE_OFFSET];
    require!(
        state != TOKEN_ACCOUNT_STATE_FROZEN,
        ProgramError::InvalidAccountData
    );
    Ok(state)
}
