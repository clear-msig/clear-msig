use clear_msig_signing::execution_commitment;
use quasar_lang::{cpi::Seed, prelude::*, sysvars::Sysvar as _};

use super::recurring_schedule::{validate_recurring_token_accounts, validate_schedule_limits};
use crate::{
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::{
        AssetPolicySpend, ClearWallet, Intent, ProposalStatus, RecurringTokenSchedule,
        TypedProposal, MAX_RECURRING_POLICY_BYTES, RECURRING_SCHEDULE_SEED,
        RECURRING_SCHEDULE_STATUS_ACTIVE, RECURRING_SCHEDULE_STATUS_COMPLETE,
        RECURRING_SCHEDULE_STATUS_REVOKED, RECURRING_TOKEN_SCHEDULE_LEN,
    },
    utils::{
        asset_policy::{
            enforce_asset_policy_account, enforce_recurring_asset_payment_policy,
            validate_recurring_asset_policy,
        },
        clearsign::{hash_recurring_token_schedule_payload, ClearSignActionKind},
        token::transfer_tokens,
    },
};

const USDC_DECIMALS: u8 = 6;

#[derive(Accounts)]
pub struct ExecuteTypedRecurringAssetSchedule<'info> {
    #[account(mut)]
    pub payer: &'info mut Signer,
    pub wallet: Account<ClearWallet<'info>>,
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    pub asset_policy: &'info UncheckedAccount,
    #[account(seeds = [b"vault", wallet], bump)]
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
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub schedule: &'info mut UncheckedAccount,
    pub mint: &'info UncheckedAccount,
    pub source_token: &'info UncheckedAccount,
    pub destination_token: &'info UncheckedAccount,
    pub recipient_owner: &'info UncheckedAccount,
    pub token_program: &'info UncheckedAccount,
    pub system_program: &'info Program<System>,
}

pub struct ExecuteTypedRecurringAssetScheduleArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub schedule_id_hash: [u8; 32],
    pub amount_tokens: u64,
    pub interval_seconds: u32,
    pub first_execution_at: i64,
    pub payment_count: u32,
    pub status: u8,
}

impl ExecuteTypedRecurringAssetSchedule<'_> {
    pub fn execute_typed_recurring_asset_schedule(
        &mut self,
        args: ExecuteTypedRecurringAssetScheduleArgs,
    ) -> Result<(), ProgramError> {
        validate_schedule_limits(
            args.amount_tokens,
            args.interval_seconds,
            args.first_execution_at,
            args.payment_count,
            args.status,
        )?;
        validate_recurring_token_accounts(
            self.vault.address(),
            self.mint,
            self.source_token.to_account_view(),
            self.destination_token.to_account_view(),
            self.recipient_owner.address(),
            self.token_program,
        )?;
        let recipient: [u8; 32] = self
            .recipient_owner
            .address()
            .as_ref()
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        let mint: [u8; 32] = self
            .mint
            .address()
            .as_ref()
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;
        let binding = execution_commitment(&[
            b"spl_recurring_payment",
            self.mint.address().as_ref(),
            self.source_token.address().as_ref(),
            self.destination_token.address().as_ref(),
        ]);
        let payload_hash = hash_recurring_token_schedule_payload(
            &args.schedule_id_hash,
            &recipient,
            &mint,
            args.amount_tokens,
            binding,
            args.interval_seconds,
            args.first_execution_at,
            args.payment_count,
            args.status,
        );
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            ClearSignActionKind::RecurringSchedule.code(),
            args.policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;

        let (expected, bump) = Address::find_program_address(
            &[
                RECURRING_SCHEDULE_SEED,
                self.wallet.address().as_ref(),
                &args.schedule_id_hash,
            ],
            &crate::ID,
        );
        require_keys_eq!(
            *self.schedule.address(),
            expected,
            ProgramError::InvalidSeeds
        );
        let view = unsafe { &mut *(self.schedule as *mut UncheckedAccount as *mut AccountView) };
        let existing = if view.data_len() == 0 {
            None
        } else {
            require!(view.owned_by(&crate::ID), ProgramError::IncorrectProgramId);
            Some(RecurringTokenSchedule::read(unsafe {
                view.borrow_unchecked()
            })?)
        };
        if args.status == RECURRING_SCHEDULE_STATUS_REVOKED {
            let mut schedule = existing.ok_or(WalletError::RecurringScheduleInactive)?;
            require!(
                schedule.wallet == *self.wallet.address()
                    && schedule.intent == *self.intent.address()
                    && schedule.schedule_id_hash == args.schedule_id_hash
                    && schedule.recipient_owner == *self.recipient_owner.address()
                    && schedule.mint == *self.mint.address()
                    && schedule.source_token == *self.source_token.address()
                    && schedule.destination_token == *self.destination_token.address()
                    && schedule.execution_commitment == binding
                    && schedule.amount_tokens == args.amount_tokens
                    && schedule.interval_seconds == args.interval_seconds
                    && schedule.next_execution_at == args.first_execution_at
                    && schedule.remaining_payments == args.payment_count
                    && schedule.policy().starts_with(b"CSP2"),
                WalletError::InvalidClearSignEnvelope
            );
            schedule.status = RECURRING_SCHEDULE_STATUS_REVOKED;
            unsafe { schedule.write(view.data_mut_ptr()) };
            mark_typed_executed(&mut self.intent, &mut self.proposal);
            return Ok(());
        }

        enforce_asset_policy_account(
            self.wallet.address(),
            self.asset_policy,
            &mint,
            args.policy_commitment,
            self.proposal.policy_bytes(),
        )?;
        validate_recurring_asset_policy(
            self.proposal.policy_bytes(),
            args.policy_commitment,
            &mint,
            USDC_DECIMALS,
            &recipient,
            args.amount_tokens,
        )?;
        require!(
            self.proposal.policy_bytes().len() <= MAX_RECURRING_POLICY_BYTES,
            WalletError::InvalidPolicy
        );
        require!(existing.is_none(), WalletError::InvalidClearSignEnvelope);
        let rent = Rent::get()?;
        let lamports = rent.try_minimum_balance(RECURRING_TOKEN_SCHEDULE_LEN)?;
        let bump_bytes = [bump];
        let seeds: &[Seed] = &[
            Seed::from(RECURRING_SCHEDULE_SEED),
            Seed::from(self.wallet.address().as_ref()),
            Seed::from(args.schedule_id_hash.as_ref()),
            Seed::from(&bump_bytes as &[u8]),
        ];
        self.system_program
            .create_account(
                self.payer.to_account_view(),
                self.schedule.to_account_view(),
                lamports,
                RECURRING_TOKEN_SCHEDULE_LEN as u64,
                &crate::ID,
            )
            .invoke_signed(seeds)?;

        let source_policy = self.proposal.policy_bytes();
        let mut schedule = RecurringTokenSchedule {
            wallet: *self.wallet.address(),
            intent: *self.intent.address(),
            schedule_id_hash: args.schedule_id_hash,
            recipient_owner: *self.recipient_owner.address(),
            policy_commitment: args.policy_commitment,
            mint: *self.mint.address(),
            source_token: *self.source_token.address(),
            destination_token: *self.destination_token.address(),
            execution_commitment: binding,
            amount_tokens: args.amount_tokens,
            interval_seconds: args.interval_seconds,
            next_execution_at: args.first_execution_at,
            remaining_payments: args.payment_count,
            executed_payments: 0,
            policy_len: source_policy.len() as u16,
            policy_bytes: [0u8; MAX_RECURRING_POLICY_BYTES],
            status: RECURRING_SCHEDULE_STATUS_ACTIVE,
            bump,
        };
        schedule.policy_bytes[..source_policy.len()].copy_from_slice(source_policy);
        unsafe { schedule.write(view.data_mut_ptr()) };
        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ExecuteRecurringAssetPayment<'info> {
    #[account(mut)]
    pub payer: &'info mut Signer,
    pub wallet: Account<ClearWallet<'info>>,
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    pub asset_policy: &'info UncheckedAccount,
    #[account(
        init_if_needed,
        payer = payer,
        seeds = AssetPolicySpend::seeds(wallet, mint),
        bump,
        bump,
    )]
    pub asset_policy_spend: &'info mut Account<AssetPolicySpend>,
    #[account(seeds = [b"vault", wallet], bump)]
    pub vault: &'info UncheckedAccount,
    #[account(has_one = wallet, constraint = intent.is_approved() @ WalletError::IntentNotApproved)]
    pub intent: Account<Intent<'info>>,
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub schedule: &'info mut UncheckedAccount,
    pub mint: &'info UncheckedAccount,
    #[account(mut)]
    pub source_token: &'info mut UncheckedAccount,
    #[account(mut)]
    pub destination_token: &'info mut UncheckedAccount,
    pub recipient_owner: &'info UncheckedAccount,
    pub token_program: &'info UncheckedAccount,
    pub system_program: &'info Program<System>,
}

impl ExecuteRecurringAssetPayment<'_> {
    pub fn execute_recurring_asset_payment(
        &mut self,
        schedule_id_hash: [u8; 32],
        bumps: &ExecuteRecurringAssetPaymentBumps,
    ) -> Result<(), ProgramError> {
        let (expected, _) = Address::find_program_address(
            &[
                RECURRING_SCHEDULE_SEED,
                self.wallet.address().as_ref(),
                &schedule_id_hash,
            ],
            &crate::ID,
        );
        require_keys_eq!(
            *self.schedule.address(),
            expected,
            ProgramError::InvalidSeeds
        );
        require!(
            self.schedule.to_account_view().owned_by(&crate::ID),
            ProgramError::IncorrectProgramId
        );
        let view = unsafe { &mut *(self.schedule as *mut UncheckedAccount as *mut AccountView) };
        let mut schedule = RecurringTokenSchedule::read(unsafe { view.borrow_unchecked() })?;
        require!(
            schedule.wallet == *self.wallet.address()
                && schedule.intent == *self.intent.address()
                && schedule.schedule_id_hash == schedule_id_hash
                && schedule.status == RECURRING_SCHEDULE_STATUS_ACTIVE
                && schedule.remaining_payments > 0
                && schedule.mint == *self.mint.address()
                && schedule.source_token == *self.source_token.address()
                && schedule.destination_token == *self.destination_token.address()
                && schedule.recipient_owner == *self.recipient_owner.address()
                && schedule.policy().starts_with(b"CSP2"),
            WalletError::RecurringScheduleInactive
        );
        validate_recurring_token_accounts(
            self.vault.address(),
            self.mint,
            self.source_token.to_account_view(),
            self.destination_token.to_account_view(),
            self.recipient_owner.address(),
            self.token_program,
        )?;
        let binding = execution_commitment(&[
            b"spl_recurring_payment",
            self.mint.address().as_ref(),
            self.source_token.address().as_ref(),
            self.destination_token.address().as_ref(),
        ]);
        require!(
            binding == schedule.execution_commitment,
            WalletError::InvalidClearSignEnvelope
        );
        let now = Clock::get()?.unix_timestamp.get();
        require!(
            now >= schedule.next_execution_at,
            WalletError::RecurringScheduleNotDue
        );
        let mint: [u8; 32] = schedule
            .mint
            .as_ref()
            .try_into()
            .map_err(|_| WalletError::InvalidPolicy)?;
        enforce_asset_policy_account(
            self.wallet.address(),
            self.asset_policy,
            &mint,
            schedule.policy_commitment,
            schedule.policy(),
        )?;
        let recipient: [u8; 32] = schedule
            .recipient_owner
            .as_ref()
            .try_into()
            .map_err(|_| WalletError::InvalidPolicy)?;
        enforce_recurring_asset_payment_policy(
            schedule.policy(),
            schedule.policy_commitment,
            &mint,
            USDC_DECIMALS,
            &recipient,
            schedule.amount_tokens,
            self.wallet.address(),
            self.asset_policy_spend,
            bumps.asset_policy_spend,
        )?;

        schedule.remaining_payments = schedule.remaining_payments.saturating_sub(1);
        schedule.executed_payments = schedule
            .executed_payments
            .checked_add(1)
            .ok_or(WalletError::RecurringScheduleInactive)?;
        if schedule.remaining_payments == 0 {
            schedule.status = RECURRING_SCHEDULE_STATUS_COMPLETE;
        } else {
            schedule.next_execution_at = now
                .checked_add(i64::from(schedule.interval_seconds))
                .ok_or(WalletError::RecurringScheduleInactive)?;
        }
        unsafe { schedule.write(view.data_mut_ptr()) };
        let vault_seeds = self.vault_seeds(bumps);
        transfer_tokens(
            self.token_program,
            self.source_token,
            self.destination_token,
            self.vault,
            &vault_seeds,
            schedule.amount_tokens,
        )
    }
}
