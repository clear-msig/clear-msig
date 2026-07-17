use quasar_lang::{cpi::Seed, prelude::*, sysvars::Sysvar as _};

use crate::{
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::{
        intent::Intent,
        proposal::ProposalStatus,
        typed_proposal::TypedProposal,
        wallet::ClearWallet,
        wallet_policy::{WalletPolicy, WALLET_POLICY_LEN, WALLET_POLICY_SEED},
    },
    utils::{
        clearsign::{hash_wallet_policy_update_payload, ClearSignActionKind},
        policy::hash_typed_policy,
    },
};

#[derive(Accounts)]
pub struct ExecuteTypedWalletPolicyUpdate<'info> {
    #[account(mut)]
    pub payer: &'info mut Signer,
    pub wallet: Account<ClearWallet<'info>>,
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub wallet_policy: &'info mut UncheckedAccount,
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

pub struct ExecuteTypedWalletPolicyUpdateArgs<'a> {
    pub current_policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub chain_kind: u8,
    pub new_policy_bytes: &'a [u8],
}

impl<'info> ExecuteTypedWalletPolicyUpdate<'info> {
    pub fn execute_typed_wallet_policy_update(
        &mut self,
        args: ExecuteTypedWalletPolicyUpdateArgs<'_>,
        _bumps: &ExecuteTypedWalletPolicyUpdateBumps,
    ) -> Result<(), ProgramError> {
        let new_policy_commitment = if args.new_policy_bytes.is_empty() {
            [0u8; 32]
        } else {
            hash_typed_policy(args.new_policy_bytes)
        };
        let payload_hash =
            hash_wallet_policy_update_payload(args.chain_kind, &new_policy_commitment);
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            ClearSignActionKind::SetProtection.code(),
            args.current_policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;

        let (expected_policy, policy_bump) = Address::find_program_address(
            &[WALLET_POLICY_SEED, self.wallet.address().as_ref()],
            &crate::ID,
        );
        require_keys_eq!(
            *self.wallet_policy.address(),
            expected_policy,
            ProgramError::InvalidSeeds
        );

        let current = if self.wallet_policy.to_account_view().data_len() == 0 {
            None
        } else {
            require!(
                self.wallet_policy.to_account_view().owned_by(&crate::ID),
                ProgramError::IncorrectProgramId
            );
            let data = unsafe { self.wallet_policy.to_account_view().borrow_unchecked() };
            Some(WalletPolicy::read(data)?)
        };

        if let Some(current) = current.as_ref() {
            require_keys_eq!(
                current.wallet,
                *self.wallet.address(),
                WalletError::WalletPolicyMismatch
            );
            require!(
                current.commitment_for_chain(args.chain_kind)? == args.current_policy_commitment,
                WalletError::WalletPolicyMismatch
            );
        } else {
            require!(
                args.current_policy_commitment == [0u8; 32],
                WalletError::WalletPolicyMismatch
            );
        }

        let clock = Clock::get()?;
        let next_version = current
            .as_ref()
            .map(|policy| policy.version)
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(ProgramError::InvalidInstructionData)?;

        if self.wallet_policy.to_account_view().data_len() == 0 {
            let rent = Rent::get()?;
            let lamports = rent.try_minimum_balance(WALLET_POLICY_LEN)?;
            let bump_byte = [policy_bump];
            let seeds: &[Seed] = &[
                Seed::from(WALLET_POLICY_SEED),
                Seed::from(self.wallet.address().as_ref()),
                Seed::from(&bump_byte as &[u8]),
            ];
            self.system_program
                .create_account(
                    self.payer.to_account_view(),
                    self.wallet_policy.to_account_view(),
                    lamports,
                    WALLET_POLICY_LEN as u64,
                    &crate::ID,
                )
                .invoke_signed(seeds)?;
        }

        let mut next = current.unwrap_or(WalletPolicy {
            wallet: *self.wallet.address(),
            policy_commitments: [[0u8; 32]; crate::state::wallet_policy::WALLET_POLICY_CHAIN_SLOTS],
            version: 0,
            updated_at: 0,
            bump: policy_bump,
        });
        next.version = next_version;
        next.updated_at = clock.unix_timestamp.get();
        next.bump = policy_bump;
        next.set_commitment_for_chain(args.chain_kind, new_policy_commitment)?;
        let view =
            unsafe { &mut *(self.wallet_policy as *mut UncheckedAccount as *mut AccountView) };
        unsafe { next.write(view.data_mut_ptr()) };

        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}
