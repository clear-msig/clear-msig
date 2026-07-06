use quasar_lang::prelude::*;
use sha2::{Digest, Sha256};

use crate::{
    chains::ChainKind,
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::{
        ika_config::IkaConfig, intent::Intent, proposal::ProposalStatus,
        typed_proposal::TypedProposal, wallet::ClearWallet,
    },
    utils::clearsign::{
        hash_cross_chain_escrow_release_payload, hash_cross_chain_escrow_return_payload,
        ClearSignActionKind, ClearSignAmount,
    },
};

#[derive(Accounts)]
pub struct ExecuteTypedCrossChainEscrowRelease<'info> {
    pub wallet: Account<ClearWallet<'info>>,
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
    #[cfg_attr(target_os = "solana", allow(quasar::unconstrained))]
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    pub ika_config: &'info UncheckedAccount,
    #[cfg_attr(target_os = "solana", allow(quasar::unconstrained))]
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    pub dwallet: &'info UncheckedAccount,
}

pub struct ExecuteTypedCrossChainEscrowReleaseArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub chain_kind: u8,
    pub amount_raw_le: [u8; 16],
    pub escrow_id_hash: [u8; 32],
    pub milestone_id_hash: [u8; 32],
    pub recipient_hash: [u8; 32],
    pub asset_id_hash: [u8; 32],
    pub route_hash: [u8; 32],
    pub tx_template_hash: [u8; 32],
    pub settlement_artifact_hash: [u8; 32],
}

#[derive(Accounts)]
pub struct ExecuteTypedCrossChainEscrowReturn<'info> {
    pub wallet: Account<ClearWallet<'info>>,
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
    #[cfg_attr(target_os = "solana", allow(quasar::unconstrained))]
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    pub ika_config: &'info UncheckedAccount,
    #[cfg_attr(target_os = "solana", allow(quasar::unconstrained))]
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    pub dwallet: &'info UncheckedAccount,
}

pub struct ExecuteTypedCrossChainEscrowReturnArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub chain_kind: u8,
    pub amount_raw_le: [u8; 16],
    pub escrow_id_hash: [u8; 32],
    pub refund_recipient_hash: [u8; 32],
    pub asset_id_hash: [u8; 32],
    pub route_hash: [u8; 32],
    pub tx_template_hash: [u8; 32],
    pub settlement_artifact_hash: [u8; 32],
}

impl<'info> ExecuteTypedCrossChainEscrowRelease<'info> {
    pub fn execute_typed_cross_chain_escrow_release(
        &mut self,
        args: ExecuteTypedCrossChainEscrowReleaseArgs,
    ) -> Result<(), ProgramError> {
        let amount_raw = u128::from_le_bytes(args.amount_raw_le);
        require!(amount_raw > 0, ProgramError::InvalidInstructionData);
        let kind = ChainKind::from_u8(args.chain_kind)?;
        require!(kind.is_remote(), ProgramError::InvalidArgument);
        require!(
            self.intent.chain_kind == args.chain_kind,
            ProgramError::InvalidArgument
        );

        let chain_byte = [args.chain_kind];
        let (expected_cfg, _) = Address::find_program_address(
            &[b"ika_config", self.wallet.address().as_ref(), &chain_byte],
            &crate::ID,
        );
        require_keys_eq!(
            *self.ika_config.address(),
            expected_cfg,
            ProgramError::InvalidSeeds
        );
        require!(
            self.ika_config.to_account_view().owned_by(&crate::ID),
            ProgramError::IncorrectProgramId
        );

        let cfg_data = unsafe { self.ika_config.to_account_view().borrow_unchecked() };
        let ika_config = IkaConfig::read(cfg_data)?;
        require_keys_eq!(
            ika_config.wallet,
            *self.wallet.address(),
            ProgramError::InvalidArgument
        );
        require!(
            ika_config.chain_kind == args.chain_kind,
            ProgramError::InvalidArgument
        );
        require_keys_eq!(
            ika_config.dwallet,
            *self.dwallet.address(),
            ProgramError::InvalidArgument
        );

        let template_hash = sha256_raw(self.intent.tx_template_bytes()?);
        require!(
            template_hash == args.tx_template_hash,
            WalletError::InvalidClearSignEnvelope
        );

        let amount = ClearSignAmount {
            asset: &args.asset_id_hash,
            raw_amount: amount_raw,
        };
        let payload_hash = hash_cross_chain_escrow_release_payload(
            &args.escrow_id_hash,
            &args.milestone_id_hash,
            args.chain_kind,
            self.ika_config.address().as_ref(),
            self.dwallet.address().as_ref(),
            &args.recipient_hash,
            &amount,
            &args.route_hash,
            &args.tx_template_hash,
            &args.settlement_artifact_hash,
        );
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            ClearSignActionKind::ReleaseMilestone.code(),
            args.policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;

        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}

impl<'info> ExecuteTypedCrossChainEscrowReturn<'info> {
    pub fn execute_typed_cross_chain_escrow_return(
        &mut self,
        args: ExecuteTypedCrossChainEscrowReturnArgs,
    ) -> Result<(), ProgramError> {
        let amount_raw = u128::from_le_bytes(args.amount_raw_le);
        require!(amount_raw > 0, ProgramError::InvalidInstructionData);
        let kind = ChainKind::from_u8(args.chain_kind)?;
        require!(kind.is_remote(), ProgramError::InvalidArgument);
        require!(
            self.intent.chain_kind == args.chain_kind,
            ProgramError::InvalidArgument
        );

        let chain_byte = [args.chain_kind];
        let (expected_cfg, _) = Address::find_program_address(
            &[b"ika_config", self.wallet.address().as_ref(), &chain_byte],
            &crate::ID,
        );
        require_keys_eq!(
            *self.ika_config.address(),
            expected_cfg,
            ProgramError::InvalidSeeds
        );
        require!(
            self.ika_config.to_account_view().owned_by(&crate::ID),
            ProgramError::IncorrectProgramId
        );

        let cfg_data = unsafe { self.ika_config.to_account_view().borrow_unchecked() };
        let ika_config = IkaConfig::read(cfg_data)?;
        require_keys_eq!(
            ika_config.wallet,
            *self.wallet.address(),
            ProgramError::InvalidArgument
        );
        require!(
            ika_config.chain_kind == args.chain_kind,
            ProgramError::InvalidArgument
        );
        require_keys_eq!(
            ika_config.dwallet,
            *self.dwallet.address(),
            ProgramError::InvalidArgument
        );

        let template_hash = sha256_raw(self.intent.tx_template_bytes()?);
        require!(
            template_hash == args.tx_template_hash,
            WalletError::InvalidClearSignEnvelope
        );

        let amount = ClearSignAmount {
            asset: &args.asset_id_hash,
            raw_amount: amount_raw,
        };
        let payload_hash = hash_cross_chain_escrow_return_payload(
            &args.escrow_id_hash,
            args.chain_kind,
            self.ika_config.address().as_ref(),
            self.dwallet.address().as_ref(),
            &args.refund_recipient_hash,
            &amount,
            &args.route_hash,
            &args.tx_template_hash,
            &args.settlement_artifact_hash,
        );
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            ClearSignActionKind::ReturnEscrowFunds.code(),
            args.policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;

        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}

fn sha256_raw(value: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(value);
    hasher.finalize().into()
}
