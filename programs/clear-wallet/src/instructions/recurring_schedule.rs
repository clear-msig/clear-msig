use quasar_lang::{cpi::Seed, prelude::*, sysvars::Sysvar as _};

use crate::{
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::{
        ClearWallet, Intent, PolicySpendState, ProposalStatus, RecurringSchedule, TypedProposal,
        MAX_RECURRING_POLICY_BYTES, RECURRING_SCHEDULE_LEN, RECURRING_SCHEDULE_SEED,
        RECURRING_SCHEDULE_STATUS_ACTIVE, RECURRING_SCHEDULE_STATUS_COMPLETE,
        RECURRING_SCHEDULE_STATUS_REVOKED,
    },
    utils::{
        clearsign::{hash_recurring_schedule_payload, ClearSignActionKind},
        policy::{
            enforce_recurring_sol_payment_policy, enforce_wallet_policy_account,
            validate_recurring_sol_policy,
        },
    },
};

const MIN_RECURRING_INTERVAL_SECONDS: u32 = 3_600;
const MAX_RECURRING_PAYMENTS: u32 = 1_000;

#[derive(Accounts)]
pub struct ExecuteTypedRecurringSchedule<'info> {
    #[account(mut)]
    pub payer: &'info mut Signer,
    pub wallet: Account<ClearWallet<'info>>,
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    pub wallet_policy: &'info UncheckedAccount,
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
    pub system_program: &'info Program<System>,
}

pub struct ExecuteTypedRecurringScheduleArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub schedule_id_hash: [u8; 32],
    pub recipient: [u8; 32],
    pub amount_lamports: u64,
    pub interval_seconds: u32,
    pub first_execution_at: i64,
    pub payment_count: u32,
    pub status: u8,
}

impl ExecuteTypedRecurringSchedule<'_> {
    pub fn execute_typed_recurring_schedule(
        &mut self,
        args: ExecuteTypedRecurringScheduleArgs,
    ) -> Result<(), ProgramError> {
        require!(
            matches!(
                args.status,
                RECURRING_SCHEDULE_STATUS_ACTIVE | RECURRING_SCHEDULE_STATUS_REVOKED
            ),
            ProgramError::InvalidInstructionData
        );
        require!(
            args.amount_lamports > 0,
            ProgramError::InvalidInstructionData
        );
        require!(
            args.interval_seconds >= MIN_RECURRING_INTERVAL_SECONDS,
            ProgramError::InvalidInstructionData
        );
        require!(
            (1..=MAX_RECURRING_PAYMENTS).contains(&args.payment_count),
            ProgramError::InvalidInstructionData
        );
        if args.status == RECURRING_SCHEDULE_STATUS_ACTIVE {
            require!(
                args.first_execution_at >= Clock::get()?.unix_timestamp.get(),
                ProgramError::InvalidInstructionData
            );
        }

        let payload_hash = hash_recurring_schedule_payload(
            &args.schedule_id_hash,
            &args.recipient,
            args.amount_lamports,
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
            Some(RecurringSchedule::read(unsafe { view.borrow_unchecked() })?)
        };

        if args.status == RECURRING_SCHEDULE_STATUS_REVOKED {
            let mut schedule = existing.ok_or(WalletError::RecurringScheduleInactive)?;
            require_keys_eq!(
                schedule.wallet,
                *self.wallet.address(),
                WalletError::RecurringScheduleInactive
            );
            require!(
                schedule.intent == *self.intent.address()
                    && schedule.schedule_id_hash == args.schedule_id_hash
                    && schedule.recipient.as_ref() == args.recipient.as_ref()
                    && schedule.amount_lamports == args.amount_lamports
                    && schedule.interval_seconds == args.interval_seconds
                    && schedule.next_execution_at == args.first_execution_at
                    && schedule.remaining_payments == args.payment_count,
                WalletError::InvalidClearSignEnvelope
            );
            schedule.status = RECURRING_SCHEDULE_STATUS_REVOKED;
            unsafe { schedule.write(view.data_mut_ptr()) };
            mark_typed_executed(&mut self.intent, &mut self.proposal);
            return Ok(());
        }

        enforce_wallet_policy_account(
            self.wallet.address(),
            self.wallet_policy,
            0,
            args.policy_commitment,
            self.proposal.policy_bytes(),
        )?;
        validate_recurring_sol_policy(
            self.proposal.policy_bytes(),
            args.policy_commitment,
            &args.recipient,
            args.amount_lamports,
        )?;
        require!(
            self.proposal.policy_bytes().len() <= MAX_RECURRING_POLICY_BYTES,
            WalletError::InvalidPolicy
        );

        if view.data_len() == 0 {
            let rent = Rent::get()?;
            let lamports = rent.try_minimum_balance(RECURRING_SCHEDULE_LEN)?;
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
                    RECURRING_SCHEDULE_LEN as u64,
                    &crate::ID,
                )
                .invoke_signed(seeds)?;
        }

        let source_policy = self.proposal.policy_bytes();
        let mut schedule = RecurringSchedule {
            wallet: *self.wallet.address(),
            intent: *self.intent.address(),
            schedule_id_hash: args.schedule_id_hash,
            recipient: Address::new_from_array(args.recipient),
            policy_commitment: args.policy_commitment,
            amount_lamports: args.amount_lamports,
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
pub struct ExecuteRecurringPayment<'info> {
    #[account(mut)]
    pub payer: &'info mut Signer,
    pub wallet: Account<ClearWallet<'info>>,
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    pub wallet_policy: &'info UncheckedAccount,
    #[account(
        init_if_needed,
        payer = payer,
        seeds = PolicySpendState::seeds(wallet, intent),
        bump,
    )]
    pub policy_spend: &'info mut Account<PolicySpendState>,
    #[cfg_attr(target_os = "solana", allow(quasar::writable_no_authority))]
    #[account(mut, seeds = [b"vault", wallet], bump)]
    pub vault: &'info mut UncheckedAccount,
    #[account(has_one = wallet, constraint = intent.is_approved() @ WalletError::IntentNotApproved)]
    pub intent: Account<Intent<'info>>,
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub schedule: &'info mut UncheckedAccount,
    #[account(mut)]
    pub recipient: &'info mut UncheckedAccount,
    pub system_program: &'info Program<System>,
}

impl ExecuteRecurringPayment<'_> {
    pub fn execute_recurring_payment(
        &mut self,
        schedule_id_hash: [u8; 32],
        bumps: &ExecuteRecurringPaymentBumps,
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
        let mut schedule = RecurringSchedule::read(unsafe { view.borrow_unchecked() })?;
        require_keys_eq!(
            schedule.wallet,
            *self.wallet.address(),
            WalletError::RecurringScheduleInactive
        );
        require!(
            schedule.intent == *self.intent.address()
                && schedule.schedule_id_hash == schedule_id_hash
                && schedule.status == RECURRING_SCHEDULE_STATUS_ACTIVE
                && schedule.remaining_payments > 0,
            WalletError::RecurringScheduleInactive
        );
        require_keys_eq!(
            schedule.recipient,
            *self.recipient.address(),
            WalletError::AccountAddressMismatch
        );
        let now = Clock::get()?.unix_timestamp.get();
        require!(
            now >= schedule.next_execution_at,
            WalletError::RecurringScheduleNotDue
        );
        enforce_wallet_policy_account(
            self.wallet.address(),
            self.wallet_policy,
            0,
            schedule.policy_commitment,
            schedule.policy(),
        )?;
        let recipient: &[u8; 32] = schedule
            .recipient
            .as_ref()
            .try_into()
            .map_err(|_| WalletError::InvalidPolicy)?;
        enforce_recurring_sol_payment_policy(
            schedule.policy(),
            schedule.policy_commitment,
            recipient,
            schedule.amount_lamports,
            &self.intent,
            self.policy_spend,
            bumps.policy_spend,
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
                .checked_add(schedule.interval_seconds as i64)
                .ok_or(WalletError::RecurringScheduleInactive)?;
        }
        unsafe { schedule.write(view.data_mut_ptr()) };

        let vault_seeds = self.vault_seeds(bumps);
        self.system_program
            .transfer(
                self.vault.to_account_view(),
                self.recipient.to_account_view(),
                schedule.amount_lamports,
            )
            .invoke_signed(&vault_seeds)
    }
}
