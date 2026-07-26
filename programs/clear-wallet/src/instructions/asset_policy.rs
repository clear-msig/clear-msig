use quasar_lang::{cpi::Seed, prelude::*, sysvars::Sysvar as _};

use crate::{
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::{
        asset_policy::{AssetPolicy, ASSET_POLICY_LEN, ASSET_POLICY_SEED},
        intent::Intent,
        proposal::ProposalStatus,
        typed_proposal::TypedProposal,
        wallet::ClearWallet,
    },
    utils::{
        asset_policy::parse_asset_policy_scope,
        clearsign::{hash_asset_policy_update_payload, ClearSignActionKind},
        policy::hash_typed_policy,
    },
};

#[derive(Accounts)]
pub struct ExecuteTypedAssetPolicyUpdate<'info> {
    #[account(mut)]
    pub payer: &'info mut Signer,
    pub wallet: Account<ClearWallet<'info>>,
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub asset_policy: &'info mut UncheckedAccount,
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

pub struct ExecuteTypedAssetPolicyUpdateArgs<'a> {
    pub current_policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub chain_kind: u8,
    pub scope_kind: u8,
    pub decimals: u8,
    pub asset_id: [u8; 32],
    pub display_asset: &'a [u8],
    pub new_policy_bytes: &'a [u8],
}

impl ExecuteTypedAssetPolicyUpdate<'_> {
    pub fn execute_typed_asset_policy_update(
        &mut self,
        args: ExecuteTypedAssetPolicyUpdateArgs<'_>,
    ) -> Result<(), ProgramError> {
        require!(
            args.chain_kind == 0
                && args.scope_kind == 1
                && args.decimals <= 18
                && args.asset_id != [0u8; 32]
                && !args.display_asset.is_empty()
                && args.display_asset.len() <= 16
                && args
                    .display_asset
                    .iter()
                    .all(|byte| (0x20..=0x7e).contains(byte)),
            WalletError::InvalidPolicy
        );
        let new_policy_commitment = if args.new_policy_bytes.is_empty() {
            [0u8; 32]
        } else {
            let scope = parse_asset_policy_scope(args.new_policy_bytes)?;
            require!(
                scope.scope_kind == args.scope_kind
                    && scope.decimals == args.decimals
                    && scope.asset_id == args.asset_id,
                WalletError::InvalidPolicy
            );
            hash_typed_policy(args.new_policy_bytes)
        };
        let payload_hash = hash_asset_policy_update_payload(
            args.chain_kind,
            args.scope_kind,
            args.decimals,
            &args.asset_id,
            args.display_asset,
            &new_policy_commitment,
        );
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            ClearSignActionKind::SetAssetProtection.code(),
            args.current_policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;

        let (expected, bump) = Address::find_program_address(
            &[
                ASSET_POLICY_SEED,
                self.wallet.address().as_ref(),
                &args.asset_id,
            ],
            &crate::ID,
        );
        require_keys_eq!(
            *self.asset_policy.address(),
            expected,
            ProgramError::InvalidSeeds
        );
        let view = self.asset_policy.to_account_view();
        let current = if view.data_len() == 0 {
            None
        } else {
            require!(view.owned_by(&crate::ID), ProgramError::IncorrectProgramId);
            Some(AssetPolicy::read(unsafe { view.borrow_unchecked() })?)
        };
        if let Some(policy) = current.as_ref() {
            require!(
                policy.wallet == *self.wallet.address()
                    && policy.asset_id.as_ref() == args.asset_id
                    && policy.policy_commitment == args.current_policy_commitment,
                WalletError::WalletPolicyMismatch
            );
        } else {
            require!(
                args.current_policy_commitment == [0u8; 32],
                WalletError::WalletPolicyMismatch
            );
        }

        if view.data_len() == 0 {
            let rent = Rent::get()?;
            let lamports = rent.try_minimum_balance(ASSET_POLICY_LEN)?;
            let bump_bytes = [bump];
            let seeds: &[Seed] = &[
                Seed::from(ASSET_POLICY_SEED),
                Seed::from(self.wallet.address().as_ref()),
                Seed::from(args.asset_id.as_ref()),
                Seed::from(&bump_bytes as &[u8]),
            ];
            self.system_program
                .create_account(
                    self.payer.to_account_view(),
                    self.asset_policy.to_account_view(),
                    lamports,
                    ASSET_POLICY_LEN as u64,
                    &crate::ID,
                )
                .invoke_signed(seeds)?;
        }

        let clock = Clock::get()?;
        let next = AssetPolicy {
            wallet: *self.wallet.address(),
            asset_id: Address::new_from_array(args.asset_id),
            policy_commitment: new_policy_commitment,
            version: current
                .as_ref()
                .map(|policy| policy.version)
                .unwrap_or(0)
                .checked_add(1)
                .ok_or(ProgramError::InvalidInstructionData)?,
            updated_at: clock.unix_timestamp.get(),
            bump,
        };
        let writable =
            unsafe { &mut *(self.asset_policy as *mut UncheckedAccount as *mut AccountView) };
        unsafe { next.write(writable.data_mut_ptr()) };
        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}
