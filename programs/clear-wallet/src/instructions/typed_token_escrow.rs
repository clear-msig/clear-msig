use quasar_lang::prelude::*;

use crate::{
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::{
        intent::Intent, proposal::ProposalStatus, typed_proposal::TypedProposal,
        wallet::ClearWallet,
    },
    utils::clearsign::{
        hash_release_token_milestone_payload, ClearSignActionKind, ClearSignAmount,
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

fn transfer_tokens(
    token_program: &UncheckedAccount,
    source: &UncheckedAccount,
    destination: &UncheckedAccount,
    authority: &UncheckedAccount,
    vault_seeds: &[Seed],
    amount: u64,
) -> Result<(), ProgramError> {
    let mut cpi = DynCpiCall::<3, 9>::new(token_program.address());
    cpi.push_account(source.to_account_view(), false, true)?;
    cpi.push_account(destination.to_account_view(), false, true)?;
    cpi.push_account(authority.to_account_view(), true, false)?;
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
