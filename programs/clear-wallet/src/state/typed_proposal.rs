use quasar_lang::prelude::*;

use crate::utils::clearsign::ClearSignActionKind;

use super::proposal::ProposalStatus;

#[account(discriminator = 6, set_inner)]
#[seeds(b"typed_proposal", intent: Address, proposal_index: u64)]
pub struct TypedProposal<'a> {
    pub wallet: Address,
    pub intent: Address,
    pub proposal_index: u64,
    pub proposer: Address,
    pub status: ProposalStatus,
    pub action_kind: u8,
    pub proposed_at: i64,
    pub approved_at: i64,
    pub expires_at: i64,
    pub bump: u8,
    pub approval_bitmap: u16,
    pub cancellation_bitmap: u16,
    pub rent_refund: Address,
    pub policy_commitment: [u8; 32],
    pub payload_hash: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub action_id: Vec<'a, u8, 128>,
    pub nonce: Vec<'a, u8, 128>,
    pub policy_bytes: Vec<'a, u8, 2048>,
    pub clear_text: Vec<'a, u8, 2048>,
}

impl TypedProposal<'_> {
    pub fn action_kind(&self) -> Result<ClearSignActionKind, ProgramError> {
        ClearSignActionKind::from_code(self.action_kind).ok_or(ProgramError::InvalidInstructionData)
    }

    pub fn approval_count(&self) -> u8 {
        self.approval_bitmap.get().count_ones() as u8
    }

    pub fn cancellation_count(&self) -> u8 {
        self.cancellation_bitmap.get().count_ones() as u8
    }

    pub fn has_approved_by_index(&self, idx: u8) -> bool {
        self.approval_bitmap.get() & (1 << idx) != 0
    }

    pub fn has_cancelled_by_index(&self, idx: u8) -> bool {
        self.cancellation_bitmap.get() & (1 << idx) != 0
    }

    pub fn set_approval(&mut self, idx: u8) {
        let mask: PodU16 = (1u16 << idx).into();
        self.cancellation_bitmap &= !mask;
        self.approval_bitmap |= mask;
    }

    pub fn set_cancellation(&mut self, idx: u8) {
        let mask: PodU16 = (1u16 << idx).into();
        self.approval_bitmap &= !mask;
        self.cancellation_bitmap |= mask;
    }
}
