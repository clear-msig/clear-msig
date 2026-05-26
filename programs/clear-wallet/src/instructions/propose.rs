use quasar_lang::{prelude::*, sysvars::Sysvar as _};

use crate::{
    error::WalletError,
    state::{
        intent::Intent,
        proposal::{Proposal, ProposalInner, ProposalStatus},
        wallet::ClearWallet,
    },
    utils::message::{MessageBuilder, MessageContext},
};

#[derive(Accounts)]
#[instruction(proposal_index: u64)]
pub struct Propose<'info> {
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
        seeds = Proposal::seeds(intent, proposal_index),
        bump,
    )]
    pub proposal: Account<Proposal<'info>>,
    pub system_program: &'info Program<System>,
}

pub struct ProposeArgs<'a> {
    pub expiry: i64,
    pub proposer_pubkey: &'a [u8; 32],
    pub signature: &'a [u8; 64],
    pub params_data: &'a [u8],
}

impl<'info> Propose<'info> {
    pub fn propose(
        &mut self,
        proposal_index: u64,
        args: ProposeArgs<'_>,
        bumps: &ProposeBumps,
    ) -> Result<(), ProgramError> {
        // Verify the client-provided proposal_index matches the wallet's current index
        require!(
            proposal_index == self.wallet.proposal_index.get(),
            WalletError::InvalidProposalIndex
        );

        let clock = Clock::get()?;
        require!(
            args.expiry > clock.unix_timestamp.get(),
            WalletError::Expired
        );

        let proposer_addr = Address::new_from_array(*args.proposer_pubkey);
        require!(
            self.intent.is_proposer(&proposer_addr),
            WalletError::NotProposer
        );

        if self.intent.intent_type == crate::state::intent::IntentType::Custom {
            self.intent.validate_param_constraints(args.params_data)?;
        }

        let ctx = MessageContext {
            expiry: args.expiry,
            action: "propose",
            wallet_name: self.wallet.name(),
            proposal_index,
        };

        let mut msg_buf = MessageBuilder::new();
        msg_buf.build_message_for_intent(&ctx, &self.intent, args.params_data)?;

        let v1 =
            brine_ed25519::sig_verify(args.proposer_pubkey, args.signature, msg_buf.as_bytes());
        if v1.is_err() {
            msg_buf.build_plain_message_for_intent(&ctx, &self.intent, args.params_data)?;
            brine_ed25519::sig_verify(args.proposer_pubkey, args.signature, msg_buf.as_bytes())
                .map_err(|_| WalletError::InvalidSignature)?;
        }

        // Auto-approve the proposer's bit when the proposer is also
        // in the approvers list. Cuts the popup count for any solo
        // wallet (and the common case where the proposer also
        // counts toward quorum) from 2 — propose then approve — to
        // 1, matching what users expect from Squads' multisig flow.
        // If the proposer isn't an approver, the bitmap stays zero
        // and the proposal still needs the usual approve step.
        let mut approval_bitmap = 0u16;
        let mut approved_at = 0i64;
        let mut status = ProposalStatus::Active;
        if let Some(idx) = self.intent.approver_index(&proposer_addr) {
            approval_bitmap = 1u16 << idx;
            // If the proposer's single bit already meets threshold
            // (e.g. 1-of-1, or any wallet where the proposer's vote
            // alone is enough), flip status to Approved so the
            // execute can run without a second user signature.
            let approvals_now = approval_bitmap.count_ones() as u8;
            if approvals_now >= self.intent.approval_threshold {
                status = ProposalStatus::Approved;
                approved_at = clock.unix_timestamp.get();
            }
        }

        self.proposal.set_inner(
            ProposalInner {
                wallet: *self.wallet.address(),
                intent: *self.intent.address(),
                proposal_index,
                proposer: proposer_addr,
                status,
                proposed_at: clock.unix_timestamp.get(),
                approved_at,
                bump: bumps.proposal,
                approval_bitmap,
                cancellation_bitmap: 0u16,
                rent_refund: *self.payer.address(),
                params_data: args.params_data,
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
