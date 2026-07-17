use clear_msig_signing::{
    envelope_hash as hash_v4_envelope, parse_intent as parse_v4_intent,
    render_document as render_v4_document, Action as V4Action,
    IdentityEncoding as V4IdentityEncoding, MAX_DOCUMENT_BYTES as MAX_V4_DOCUMENT_BYTES,
};
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
        hash_clear_text, hash_envelope_for_clear_text, is_v4_document,
        write_vote_message_for_clear_text, ClearSignActionKind, ClearSignEnvelope,
        ClearSignVoteKind, MAX_CLEARSIGN_VOTE_MESSAGE_BYTES,
    },
    utils::policy::hash_typed_policy,
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

pub struct ProposeTypedV4Args<'a> {
    pub signature: &'a [u8; 64],
    pub policy_bytes: &'a [u8],
    pub canonical_intent: &'a [u8],
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
    pub fn propose_typed(&mut self) -> Result<(), ProgramError> {
        // Discriminator 8 remains in the ABI so existing proposal accounts can
        // still be approved, cancelled, executed, and cleaned up. It must not
        // create new proposals because v3 clear text is caller-authored and is
        // not semantically derived from the executable payload.
        Err(WalletError::ClearSignVersionDowngrade.into())
    }

    pub fn propose_typed_v4(
        &mut self,
        proposal_index: u64,
        args: ProposeTypedV4Args<'_>,
        bumps: &ProposeTypedBumps,
    ) -> Result<(), ProgramError> {
        require!(
            proposal_index == self.wallet.proposal_index.get(),
            WalletError::InvalidProposalIndex
        );

        let canonical = parse_v4_intent(args.canonical_intent)
            .map_err(|_| WalletError::InvalidClearSignEnvelope)?;
        let clock = Clock::get()?;
        let now = clock.unix_timestamp.get();
        require!(
            canonical.common.proposal_index == proposal_index,
            WalletError::InvalidProposalIndex
        );
        require!(
            canonical.common.wallet_id == self.wallet.address().to_bytes(),
            WalletError::InvalidClearSignEnvelope
        );
        require!(
            canonical.common.network.chain_kind() == self.intent.chain_kind,
            WalletError::InvalidClearSignEnvelope
        );
        require!(
            canonical.common.approval_required == self.intent.approval_threshold,
            WalletError::InvalidApprovalThreshold
        );
        require!(
            canonical.common.expires_at > now
                && canonical.common.expires_at - now
                    <= crate::utils::clearsign::MAX_ACTION_TTL_SECONDS,
            WalletError::InvalidClearSignEnvelope
        );
        require!(
            canonical.common.action_id.iter().any(|byte| *byte != 0)
                && canonical.common.nonce.iter().any(|byte| *byte != 0),
            WalletError::InvalidClearSignEnvelope
        );

        let proposer_addr = Address::new_from_array(canonical.common.actor);
        require!(
            self.intent.is_proposer(&proposer_addr),
            WalletError::NotProposer
        );
        validate_v4_execution_shape(&canonical)?;
        let submitted_policy_commitment = hash_typed_policy(args.policy_bytes);
        match canonical.action {
            V4Action::PolicyUpdate(policy) => require!(
                clear_msig_signing::wallet_policy_commitment(args.policy_bytes)
                    == policy.new_policy_commitment,
                WalletError::InvalidPolicy
            ),
            _ => require!(
                submitted_policy_commitment == canonical.common.policy_commitment,
                WalletError::InvalidPolicy
            ),
        }

        let mut clear_text_buffer = [0u8; MAX_V4_DOCUMENT_BYTES];
        let clear_text_len = render_v4_document(
            &canonical,
            self.wallet.name().as_bytes(),
            &mut clear_text_buffer,
        )
        .map_err(|_| WalletError::InvalidClearSignEnvelope)?;
        let clear_text = &clear_text_buffer[..clear_text_len];
        let payload_hash = canonical.payload_hash();
        let clear_text_hash =
            hash_clear_text(clear_text).map_err(|_| WalletError::InvalidClearSignEnvelope)?;
        let envelope_hash =
            hash_v4_envelope(&canonical, self.wallet.name().as_bytes(), clear_text_hash)
                .map_err(|_| WalletError::InvalidClearSignEnvelope)?;

        let proposer_approver_index = self.intent.approver_index(&proposer_addr);
        let approvals_after = u8::from(proposer_approver_index.is_some());
        verify_typed_signature_v4(
            ClearSignVoteKind::Propose,
            self.wallet.name().as_bytes(),
            canonical.common.actor.as_ref(),
            proposal_index,
            envelope_hash,
            canonical.common.expires_at,
            self.intent.approval_threshold,
            approvals_after,
            clear_text,
            args.signature,
        )?;

        let mut approval_bitmap = 0u16;
        let mut approved_at = 0i64;
        let mut status = ProposalStatus::Active;
        if let Some(idx) = proposer_approver_index {
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
                action_kind: canonical.kind().code(),
                proposed_at: now,
                approved_at,
                expires_at: canonical.common.expires_at,
                bump: bumps.proposal,
                approval_bitmap,
                cancellation_bitmap: 0u16,
                rent_refund: *self.payer.address(),
                policy_commitment: canonical.common.policy_commitment,
                payload_hash,
                envelope_hash,
                action_id: canonical.common.action_id.as_ref(),
                nonce: canonical.common.nonce.as_ref(),
                policy_bytes: args.policy_bytes,
                clear_text,
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

fn validate_v4_execution_shape(
    intent: &clear_msig_signing::CanonicalIntent<'_>,
) -> Result<(), ProgramError> {
    match intent.action {
        V4Action::Transfer(transfer) if intent.common.network.chain_kind() == 0 => {
            require!(
                transfer.recipient_encoding == V4IdentityEncoding::SolanaPubkey
                    && transfer.asset_encoding == V4IdentityEncoding::Text
                    && transfer.asset == b"SOL"
                    && transfer.decimals == 9,
                WalletError::InvalidClearSignEnvelope
            );
        }
        V4Action::Transfer(transfer) => {
            require!(
                transfer.recipient_encoding == V4IdentityEncoding::Sha256Text
                    && transfer.asset_encoding == V4IdentityEncoding::Sha256Text,
                WalletError::InvalidClearSignEnvelope
            );
        }
        V4Action::BatchTransfer(batch) => {
            require!(
                intent.common.network.chain_kind() == 0
                    && batch.rows().all(|row| {
                        row.recipient_encoding == V4IdentityEncoding::SolanaPubkey
                            && row.asset_encoding == V4IdentityEncoding::Text
                            && row.asset == b"SOL"
                            && row.decimals == 9
                    }),
                WalletError::InvalidClearSignEnvelope
            );
        }
        V4Action::Governance(_) => {
            require!(
                intent.common.network.chain_kind() == 0,
                WalletError::InvalidClearSignEnvelope
            );
        }
        V4Action::PolicyUpdate(policy) => {
            require!(
                policy.chain_kind == intent.common.network.chain_kind(),
                WalletError::InvalidClearSignEnvelope
            );
        }
        V4Action::EscrowRelease(escrow) => {
            require!(
                escrow.execution_commitment != [0u8; 32]
                    || (intent.common.network.chain_kind() == 0
                        && escrow.payment.recipient_encoding == V4IdentityEncoding::SolanaPubkey
                        && escrow.payment.asset_encoding == V4IdentityEncoding::Text
                        && escrow.payment.asset == b"SOL"
                        && escrow.payment.decimals == 9),
                WalletError::InvalidClearSignEnvelope
            );
        }
        V4Action::EscrowReturn(escrow) => {
            require!(
                escrow.execution_commitment != [0u8; 32]
                    || (intent.common.network.chain_kind() == 0
                        && escrow.rows().all(|row| {
                            row.recipient_encoding == V4IdentityEncoding::SolanaPubkey
                                && row.asset_encoding == V4IdentityEncoding::Text
                                && row.asset == b"SOL"
                                && row.decimals == 9
                        })),
                WalletError::InvalidClearSignEnvelope
            );
        }
        V4Action::AgentTradeApproval(_)
        | V4Action::AgentSession(_)
        | V4Action::AgentRiskPolicy(_)
        | V4Action::AgentSettlement(_) => {}
    }
    Ok(())
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

        let action_id = self.proposal.action_id();
        let nonce = self.proposal.nonce();
        let clear_text = self.proposal.clear_text();
        let envelope = stored_envelope(
            &self.wallet,
            &self.proposal,
            action_id.as_ref(),
            nonce.as_ref(),
            clear_text.as_ref(),
        )?;

        verify_typed_signature(
            ClearSignVoteKind::Approve,
            &envelope,
            clear_text.as_ref(),
            self.intent.approval_threshold,
            self.proposal.approval_count().saturating_add(1),
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

        let action_id = self.proposal.action_id();
        let nonce = self.proposal.nonce();
        let clear_text = self.proposal.clear_text();
        let envelope = stored_envelope(
            &self.wallet,
            &self.proposal,
            action_id.as_ref(),
            nonce.as_ref(),
            clear_text.as_ref(),
        )?;

        verify_typed_signature(
            ClearSignVoteKind::Cancel,
            &envelope,
            clear_text.as_ref(),
            self.intent.cancellation_threshold,
            self.proposal.cancellation_count().saturating_add(1),
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
    envelope: &ClearSignEnvelope<'_>,
    clear_text: &[u8],
    approvals_required: u8,
    approvals_after: u8,
    proposal_index: u64,
    envelope_hash: [u8; 32],
    signer_pubkey: &[u8],
    signature: &[u8; 64],
) -> Result<(), ProgramError> {
    if !is_v4_document(clear_text) {
        require!(
            hash_envelope_for_clear_text(envelope, clear_text) == envelope_hash,
            WalletError::InvalidClearSignEnvelope
        );
    }
    verify_typed_signature_v4(
        vote_kind,
        envelope.wallet_name,
        signer_pubkey,
        proposal_index,
        envelope_hash,
        envelope.expires_at,
        approvals_required,
        approvals_after,
        clear_text,
        signature,
    )
}

#[allow(clippy::too_many_arguments)]
fn verify_typed_signature_v4(
    vote_kind: ClearSignVoteKind,
    wallet_name: &[u8],
    signer_pubkey: &[u8],
    proposal_index: u64,
    envelope_hash: [u8; 32],
    expires_at: i64,
    approvals_required: u8,
    approvals_after: u8,
    clear_text: &[u8],
    signature: &[u8; 64],
) -> Result<(), ProgramError> {
    let mut vote_message = [0u8; MAX_CLEARSIGN_VOTE_MESSAGE_BYTES];
    let vote_message_len = write_vote_message_for_clear_text(
        &mut vote_message,
        vote_kind,
        wallet_name,
        signer_pubkey,
        proposal_index,
        envelope_hash,
        expires_at,
        approvals_required,
        approvals_after,
        clear_text,
    )
    .map_err(|_| WalletError::InvalidClearSignEnvelope)?;
    brine_ed25519::sig_verify(signer_pubkey, signature, &vote_message[..vote_message_len])
        .map_err(|_| WalletError::InvalidSignature.into())
}

fn stored_envelope<'a>(
    wallet: &'a ClearWallet<'_>,
    proposal: &TypedProposal<'_>,
    action_id: &'a [u8],
    nonce: &'a [u8],
    clear_text: &[u8],
) -> Result<ClearSignEnvelope<'a>, ProgramError> {
    let kind = ClearSignActionKind::from_code(proposal.action_kind)
        .ok_or(WalletError::InvalidClearSignAction)?;
    Ok(ClearSignEnvelope {
        kind,
        wallet_name: wallet.name().as_bytes(),
        wallet_id: wallet.address().as_ref(),
        action_id,
        nonce,
        expires_at: proposal.expires_at.get(),
        policy_commitment: proposal.policy_commitment,
        payload_hash: proposal.payload_hash,
        clear_text_hash: hash_clear_text(clear_text)
            .map_err(|_| WalletError::InvalidClearSignEnvelope)?,
    })
}
