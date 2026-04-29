use quasar_lang::prelude::*;

use crate::{error::WalletError, state::proposal::{Proposal, ProposalStatus}};

#[derive(Accounts)]
pub struct CleanupProposal<'info> {
    /// `wallet`, `intent`, and `proposer` recorded at propose-time are not
    /// re-passed here (cleanup needs only the proposal and the rent refund
    /// recipient). Suppress the cross-instruction drift warnings.
    #[cfg_attr(target_os = "solana", allow(quasar::cross_instruction))]
    #[account(
        has_one = rent_refund,
        close = rent_refund,
        constraint = proposal.status == ProposalStatus::Executed
            || proposal.status == ProposalStatus::Cancelled
            @ WalletError::ProposalNotFinalized
    )]
    pub proposal: Account<Proposal<'info>>,
    /// Recipient of the proposal account's rent. Linked through the
    /// `has_one = rent_refund` above; no user signer is on the path.
    #[cfg_attr(target_os = "solana", allow(quasar::writable_no_authority))]
    #[account(mut)]
    pub rent_refund: &'info mut UncheckedAccount,
}

impl<'info> CleanupProposal<'info> {
    pub fn cleanup(&mut self) -> Result<(), ProgramError> {
        Ok(())
    }
}
