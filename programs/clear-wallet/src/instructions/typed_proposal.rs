use quasar_lang::{prelude::*, sysvars::Sysvar as _};

use crate::{
    error::WalletError,
    state::{
        intent::Intent,
        proposal::ProposalStatus,
        typed_proposal::{TypedProposal, TypedProposalInner},
        wallet::ClearWallet,
    },
    utils::clearsign::{
        hash_envelope, hash_vote_message, ClearSignActionKind, ClearSignEnvelope, ClearSignVoteKind,
    },
};

#[derive(Accounts)]
#[instruction(proposal_index: u64)]
pub struct ProposeTyped<'info> {
    pub payer: &'info mut Signer,
    #[account(mut)]
    pub wallet: Account<ClearWallet<'info>>,
    #[account(
        mut,
        has_one = wallet,
        constraint = intent.is_approved() @ WalletError::IntentNotApproved,
    )]
    pub intent: Account<Intent<'info>>,
    #[account(
        init,
        payer = payer,
        seeds = TypedProposal::seeds(intent, proposal_index),
        bump,
    )]
    pub proposal: Account<TypedProposal<'info>>,
    pub system_program: &'info Program<System>,
}

pub struct ProposeTypedArgs<'a> {
    pub expiry: i64,
    pub action_kind: u8,
    pub action_id: &'a [u8; 32],
    pub nonce: &'a [u8; 32],
    pub policy_commitment: [u8; 32],
    pub payload_hash: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub proposer_pubkey: &'a [u8; 32],
    pub signature: &'a [u8; 64],
}

#[derive(Accounts)]
pub struct ApproveTyped<'info> {
    pub wallet: Account<ClearWallet<'info>>,
    #[account(
        has_one = wallet,
        constraint = intent.is_approved() @ WalletError::IntentNotApproved,
    )]
    pub intent: Account<Intent<'info>>,
    #[account(
        mut,
        has_one = wallet,
        has_one = intent,
        constraint = proposal.status == ProposalStatus::Active @ WalletError::ProposalNotActive
    )]
    pub proposal: Account<TypedProposal<'info>>,
}

pub struct ApproveTypedArgs<'a> {
    pub approver_index: u8,
    pub signature: &'a [u8; 64],
}

#[derive(Accounts)]
pub struct CancelTyped<'info> {
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
        constraint = proposal.status == ProposalStatus::Active
            || proposal.status == ProposalStatus::Approved
            @ WalletError::ProposalNotActive
    )]
    pub proposal: Account<TypedProposal<'info>>,
}

pub struct CancelTypedArgs<'a> {
    pub canceller_index: u8,
    pub signature: &'a [u8; 64],
}

#[derive(Accounts)]
pub struct ExecuteTyped<'info> {
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

pub struct ExecuteTypedArgs {
    pub action_kind: u8,
    pub policy_commitment: [u8; 32],
    pub payload_hash: [u8; 32],
    pub envelope_hash: [u8; 32],
}

impl<'info> ProposeTyped<'info> {
    pub fn propose_typed(
        &mut self,
        proposal_index: u64,
        args: ProposeTypedArgs<'_>,
        bumps: &ProposeTypedBumps,
    ) -> Result<(), ProgramError> {
        require!(
            proposal_index == self.wallet.proposal_index.get(),
            WalletError::InvalidProposalIndex
        );

        let clock = Clock::get()?;
        let now = clock.unix_timestamp.get();
        let kind = ClearSignActionKind::from_code(args.action_kind)
            .ok_or(WalletError::InvalidClearSignAction)?;
        let envelope = ClearSignEnvelope {
            kind,
            wallet_name: self.wallet.name().as_bytes(),
            wallet_id: self.wallet.address().as_ref(),
            action_id: args.action_id.as_ref(),
            nonce: args.nonce.as_ref(),
            expires_at: args.expiry,
            policy_commitment: args.policy_commitment,
            payload_hash: args.payload_hash,
        };
        envelope
            .validate_replay_fields(now)
            .map_err(|_| WalletError::InvalidClearSignEnvelope)?;
        require!(
            hash_envelope(&envelope) == args.envelope_hash,
            WalletError::InvalidClearSignEnvelope
        );

        let proposer_addr = Address::new_from_array(*args.proposer_pubkey);
        require!(
            self.intent.is_proposer(&proposer_addr),
            WalletError::NotProposer
        );

        verify_typed_signature(
            ClearSignVoteKind::Propose,
            self.wallet.address().as_ref(),
            proposal_index,
            args.envelope_hash,
            args.proposer_pubkey,
            args.signature,
        )?;

        let mut approval_bitmap = 0u16;
        let mut approved_at = 0i64;
        let mut status = ProposalStatus::Active;
        if let Some(idx) = self.intent.approver_index(&proposer_addr) {
            approval_bitmap = 1u16 << idx;
            if approval_bitmap.count_ones() as u8 >= self.intent.approval_threshold {
                status = ProposalStatus::Approved;
                approved_at = now;
            }
        }

        self.proposal.set_inner(
            TypedProposalInner {
                wallet: *self.wallet.address(),
                intent: *self.intent.address(),
                proposal_index,
                proposer: proposer_addr,
                status,
                action_kind: kind.code(),
                proposed_at: now,
                approved_at,
                expires_at: args.expiry,
                bump: bumps.proposal,
                approval_bitmap,
                cancellation_bitmap: 0u16,
                rent_refund: *self.payer.address(),
                policy_commitment: args.policy_commitment,
                payload_hash: args.payload_hash,
                envelope_hash: args.envelope_hash,
                action_id: args.action_id.as_ref(),
                nonce: args.nonce.as_ref(),
            },
            self.payer.to_account_view(),
            None,
        )?;

        self.intent.active_proposal_count = self
            .intent
            .active_proposal_count
            .checked_add(1)
            .ok_or(WalletError::TooManyActiveProposals)?;
        self.wallet.proposal_index += 1;
        Ok(())
    }
}

impl<'info> ApproveTyped<'info> {
    pub fn approve_typed(&mut self, args: ApproveTypedArgs<'_>) -> Result<(), ProgramError> {
        let clock = Clock::get()?;
        require!(
            self.proposal.expires_at.get() > clock.unix_timestamp.get(),
            WalletError::Expired
        );

        let approvers = self.intent.approvers();
        let approver_addr = approvers
            .get(args.approver_index as usize)
            .ok_or(WalletError::InvalidMemberIndex)?;

        require!(
            !self.proposal.has_approved_by_index(args.approver_index),
            WalletError::AlreadyApproved
        );

        verify_typed_signature(
            ClearSignVoteKind::Approve,
            self.wallet.address().as_ref(),
            self.proposal.proposal_index.get(),
            self.proposal.envelope_hash,
            approver_addr.as_ref(),
            args.signature,
        )?;

        self.proposal.set_approval(args.approver_index);
        if self.proposal.approval_count() >= self.intent.approval_threshold {
            self.proposal.status = ProposalStatus::Approved;
            self.proposal.approved_at = clock.unix_timestamp;
        }
        Ok(())
    }
}

impl<'info> CancelTyped<'info> {
    pub fn cancel_typed(&mut self, args: CancelTypedArgs<'_>) -> Result<(), ProgramError> {
        let clock = Clock::get()?;
        require!(
            self.proposal.expires_at.get() > clock.unix_timestamp.get(),
            WalletError::Expired
        );

        let approvers = self.intent.approvers();
        let canceller_addr = approvers
            .get(args.canceller_index as usize)
            .ok_or(WalletError::InvalidMemberIndex)?;

        require!(
            !self.proposal.has_cancelled_by_index(args.canceller_index),
            WalletError::AlreadyCancelled
        );

        verify_typed_signature(
            ClearSignVoteKind::Cancel,
            self.wallet.address().as_ref(),
            self.proposal.proposal_index.get(),
            self.proposal.envelope_hash,
            canceller_addr.as_ref(),
            args.signature,
        )?;

        self.proposal.set_cancellation(args.canceller_index);
        if self.proposal.cancellation_count() >= self.intent.cancellation_threshold {
            self.proposal.status = ProposalStatus::Cancelled;
            self.intent.active_proposal_count = self.intent.active_proposal_count.saturating_sub(1);
        } else if self.proposal.status == ProposalStatus::Approved
            && self.proposal.approval_count() < self.intent.approval_threshold
        {
            self.proposal.status = ProposalStatus::Active;
        }
        Ok(())
    }
}

impl<'info> ExecuteTyped<'info> {
    pub fn execute_typed(&mut self, args: ExecuteTypedArgs) -> Result<(), ProgramError> {
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            args.action_kind,
            args.policy_commitment,
            args.payload_hash,
            args.envelope_hash,
        )?;
        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}

pub(crate) fn verify_typed_execution_ready(
    intent: &Intent<'_>,
    proposal: &TypedProposal<'_>,
    action_kind: u8,
    policy_commitment: [u8; 32],
    payload_hash: [u8; 32],
    envelope_hash: [u8; 32],
) -> Result<(), ProgramError> {
    let clock = Clock::get()?;
    require!(
        proposal.expires_at.get() > clock.unix_timestamp.get(),
        WalletError::Expired
    );

    let approved_at = proposal.approved_at.get();
    let unlock_at = approved_at + intent.timelock_seconds.get() as i64;
    require!(
        clock.unix_timestamp.get() >= unlock_at,
        WalletError::TimelockNotElapsed
    );
    require!(
        proposal.action_kind == action_kind,
        WalletError::InvalidClearSignEnvelope
    );
    require!(
        proposal.policy_commitment == policy_commitment,
        WalletError::InvalidClearSignEnvelope
    );
    require!(
        proposal.payload_hash == payload_hash,
        WalletError::InvalidClearSignEnvelope
    );
    require!(
        proposal.envelope_hash == envelope_hash,
        WalletError::InvalidClearSignEnvelope
    );
    ClearSignActionKind::from_code(action_kind).ok_or(WalletError::InvalidClearSignAction)?;
    Ok(())
}

pub(crate) fn mark_typed_executed(intent: &mut Intent<'_>, proposal: &mut TypedProposal<'_>) {
    proposal.status = ProposalStatus::Executed;
    intent.active_proposal_count = intent.active_proposal_count.saturating_sub(1);
}

fn verify_typed_signature(
    vote_kind: ClearSignVoteKind,
    wallet_id: &[u8],
    proposal_index: u64,
    envelope_hash: [u8; 32],
    signer_pubkey: &[u8],
    signature: &[u8; 64],
) -> Result<(), ProgramError> {
    let vote_hash = hash_vote_message(vote_kind, wallet_id, proposal_index, envelope_hash);
    brine_ed25519::sig_verify(signer_pubkey, signature, &vote_hash)
        .map_err(|_| WalletError::InvalidSignature.into())
}
