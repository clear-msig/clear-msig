use clear_msig_signing::{
    committed_escrow_release_payload_hash, committed_escrow_return_payload_hash,
    execution_commitment,
};
use quasar_lang::prelude::*;
use sha2::{Digest, Sha256};

use crate::{
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::{
        intent::Intent, proposal::ProposalStatus, typed_proposal::TypedProposal,
        wallet::ClearWallet,
    },
    utils::clearsign::ClearSignActionKind,
};

#[derive(Accounts)]
pub struct ExecuteTypedPrivateEscrowRelease<'info> {
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
}

pub struct ExecuteTypedPrivateEscrowReleaseArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub amount_raw_le: [u8; 16],
    pub escrow_id_hash: [u8; 32],
    pub milestone_id_hash: [u8; 32],
    pub recipient_hash: [u8; 32],
    pub asset_id_hash: [u8; 32],
    pub policy_ciphertexts_hash: [u8; 32],
    pub private_evaluation_hash: [u8; 32],
    pub settlement_artifact_hash: [u8; 32],
}

#[derive(Accounts)]
pub struct ExecuteTypedPrivateEscrowReturn<'info> {
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
}

pub struct ExecuteTypedPrivateEscrowReturnArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub amount_raw_le: [u8; 16],
    pub escrow_id_hash: [u8; 32],
    pub refund_recipient_hash: [u8; 32],
    pub asset_id_hash: [u8; 32],
    pub policy_ciphertexts_hash: [u8; 32],
    pub private_evaluation_hash: [u8; 32],
    pub settlement_artifact_hash: [u8; 32],
}

impl<'info> ExecuteTypedPrivateEscrowRelease<'info> {
    pub fn execute_typed_private_escrow_release(
        &mut self,
        args: ExecuteTypedPrivateEscrowReleaseArgs,
    ) -> Result<(), ProgramError> {
        let amount_raw = u128::from_le_bytes(args.amount_raw_le);
        require!(amount_raw > 0, ProgramError::InvalidInstructionData);
        verify_policy_ciphertexts_hash(&self.intent, &args.policy_ciphertexts_hash)?;

        let execution_commitment = execution_commitment(&[
            b"private_escrow_release",
            &args.policy_ciphertexts_hash,
            &args.private_evaluation_hash,
            &args.settlement_artifact_hash,
        ]);
        let payload_hash = committed_escrow_release_payload_hash(
            &args.escrow_id_hash,
            &args.milestone_id_hash,
            &args.recipient_hash,
            &args.asset_id_hash,
            amount_raw,
            execution_commitment,
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

impl<'info> ExecuteTypedPrivateEscrowReturn<'info> {
    pub fn execute_typed_private_escrow_return(
        &mut self,
        args: ExecuteTypedPrivateEscrowReturnArgs,
    ) -> Result<(), ProgramError> {
        let amount_raw = u128::from_le_bytes(args.amount_raw_le);
        require!(amount_raw > 0, ProgramError::InvalidInstructionData);
        verify_policy_ciphertexts_hash(&self.intent, &args.policy_ciphertexts_hash)?;

        let execution_commitment = execution_commitment(&[
            b"private_escrow_return",
            &args.policy_ciphertexts_hash,
            &args.private_evaluation_hash,
            &args.settlement_artifact_hash,
        ]);
        let rows = [(
            args.refund_recipient_hash.as_slice(),
            args.asset_id_hash.as_slice(),
            amount_raw,
        )];
        let payload_hash = committed_escrow_return_payload_hash(
            &args.escrow_id_hash,
            rows.into_iter(),
            execution_commitment,
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

fn verify_policy_ciphertexts_hash(
    intent: &Intent<'_>,
    expected: &[u8; 32],
) -> Result<(), ProgramError> {
    let policy_ciphertexts = intent.policy_ciphertexts();
    require!(
        !policy_ciphertexts.is_empty(),
        ProgramError::InvalidInstructionData
    );
    require!(
        sha256_raw(policy_ciphertexts) == *expected,
        WalletError::InvalidClearSignEnvelope
    );
    Ok(())
}

fn sha256_raw(value: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(value);
    hasher.finalize().into()
}
