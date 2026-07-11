use quasar_lang::{prelude::*, sysvars::Sysvar as _};

use crate::{
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::{
        intent::Intent, proposal::ProposalStatus, typed_proposal::TypedProposal,
        wallet::ClearWallet,
    },
    utils::clearsign::{hash_intent_governance_payload, ClearSignActionKind},
};

/// Fixed header length of an Intent body (without the 1-byte discriminator).
/// Layout mirrors `BuiltIntent::serialize_body`.
const INTENT_BODY_FIXED_LEN: usize = 53;
const INTENT_BODY_WALLET_OFFSET: usize = 0;
const INTENT_BODY_INDEX_OFFSET: usize = 33;
const INTENT_BODY_APPROVAL_THRESHOLD_OFFSET: usize = 37;
const INTENT_BODY_CANCELLATION_THRESHOLD_OFFSET: usize = 38;
const INTENT_BODY_TIMELOCK_OFFSET: usize = 39;
const INTENT_BODY_ACTIVE_PROPOSAL_COUNT_OFFSET: usize = 51;
const MAX_GOVERNANCE_MEMBERS: usize = 16;

#[derive(Accounts)]
pub struct ExecuteTypedIntentGovernance<'info> {
    #[account(mut)]
    pub payer: &'info mut Signer,
    pub wallet: Account<ClearWallet<'info>>,
    /// Intent that holds the typed proposal (typically UpdateIntent meta).
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
    /// Target intent whose proposers/approvers/thresholds/timelock are rewritten.
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub target_intent: &'info mut UncheckedAccount,
    pub system_program: &'info Program<System>,
}

pub struct ExecuteTypedIntentGovernanceArgs<'a> {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub action_kind: u8,
    pub target_intent_index: u8,
    /// Full intent body (no discriminator), same shape as UpdateIntent params[1..].
    pub new_intent_body: &'a [u8],
}

struct GovernanceSnapshot {
    approval_threshold: u8,
    cancellation_threshold: u8,
    timelock_seconds: u32,
    proposers: [[u8; 32]; MAX_GOVERNANCE_MEMBERS],
    proposer_count: usize,
    approvers: [[u8; 32]; MAX_GOVERNANCE_MEMBERS],
    approver_count: usize,
}

impl<'info> ExecuteTypedIntentGovernance<'info> {
    pub fn execute_typed_intent_governance(
        &mut self,
        args: ExecuteTypedIntentGovernanceArgs<'_>,
    ) -> Result<(), ProgramError> {
        let kind = ClearSignActionKind::from_code(args.action_kind)
            .ok_or(ProgramError::InvalidInstructionData)?;
        require!(
            matches!(
                kind,
                ClearSignActionKind::AddMember
                    | ClearSignActionKind::RemoveMember
                    | ClearSignActionKind::ChangeThreshold
            ),
            ProgramError::InvalidInstructionData
        );
        require!(
            governance_payload_matches(
                self.proposal.policy_bytes().as_ref(),
                args.target_intent_index,
                args.new_intent_body,
            ),
            WalletError::InvalidPolicy
        );

        let snap = parse_governance_snapshot(args.new_intent_body, args.target_intent_index)?;
        require_keys_eq!(
            Address::new_from_array(
                args.new_intent_body[INTENT_BODY_WALLET_OFFSET..INTENT_BODY_WALLET_OFFSET + 32]
                    .try_into()
                    .map_err(|_| ProgramError::InvalidInstructionData)?,
            ),
            *self.wallet.address(),
            ProgramError::InvalidArgument
        );

        // Threshold invariants — same rules the client enforces before signing.
        require!(
            snap.approval_threshold >= 1,
            WalletError::InvalidApprovalThreshold
        );
        require!(
            snap.cancellation_threshold >= 1,
            WalletError::InvalidCancellationThreshold
        );
        require!(
            (snap.approval_threshold as usize) <= snap.approver_count,
            WalletError::InvalidApprovalThreshold
        );
        require!(
            (snap.cancellation_threshold as usize) <= snap.approver_count,
            WalletError::InvalidCancellationThreshold
        );
        require!(snap.proposer_count >= 1, ProgramError::InvalidArgument);
        require!(snap.approver_count >= 1, ProgramError::InvalidArgument);

        let mut proposer_refs = [[0u8; 32]; MAX_GOVERNANCE_MEMBERS];
        let mut approver_refs = [[0u8; 32]; MAX_GOVERNANCE_MEMBERS];
        proposer_refs[..snap.proposer_count]
            .copy_from_slice(&snap.proposers[..snap.proposer_count]);
        approver_refs[..snap.approver_count]
            .copy_from_slice(&snap.approvers[..snap.approver_count]);

        let payload_hash = hash_intent_governance_payload(
            kind,
            args.target_intent_index,
            snap.approval_threshold,
            snap.cancellation_threshold,
            snap.timelock_seconds,
            &proposer_refs[..snap.proposer_count],
            &approver_refs[..snap.approver_count],
        );
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            kind.code(),
            args.policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;

        let (expected_target, _) = Address::find_program_address(
            &[
                b"intent",
                self.wallet.address().as_ref(),
                &[args.target_intent_index],
            ],
            &crate::ID,
        );
        require_keys_eq!(
            *self.target_intent.address(),
            expected_target,
            ProgramError::InvalidSeeds
        );

        // UncheckedAccount → AccountView (same pattern as wallet_policy).
        let target_view =
            unsafe { &mut *(self.target_intent as *mut UncheckedAccount as *mut AccountView) };
        require!(target_view.is_writable(), ProgramError::Immutable);

        // Block rewrite while the target still has open proposals (mirrors UpdateIntent).
        // Account layout: disc(1) + body. Active count sits at body offset 51 → account offset 52.
        // If the typed proposal itself lives on the target intent (solo wallets
        // without a separate UpdateIntent vote surface), discount this one
        // open proposal so governance can complete.
        let apc_off = 1 + INTENT_BODY_ACTIVE_PROPOSAL_COUNT_OFFSET;
        let apc_bytes =
            unsafe { core::slice::from_raw_parts(target_view.data_mut_ptr().add(apc_off), 2) };
        let active_count = u16::from_le_bytes([apc_bytes[0], apc_bytes[1]]);
        let same_intent = *self.target_intent.address() == *self.intent.address();
        let effective_active = if same_intent {
            active_count.saturating_sub(1)
        } else {
            active_count
        };
        require!(effective_active == 0, WalletError::IntentHasActiveProposals);

        let new_space = 1 + args.new_intent_body.len();
        let rent = Rent::get()?;
        quasar_lang::accounts::account::realloc_account(
            target_view,
            new_space,
            self.payer.to_account_view(),
            Some(&rent),
        )?;
        let data_ptr = target_view.data_mut_ptr();
        unsafe {
            *data_ptr = 2; // Intent discriminator
            core::ptr::copy_nonoverlapping(
                args.new_intent_body.as_ptr(),
                data_ptr.add(1),
                args.new_intent_body.len(),
            );
        }

        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}

fn governance_payload_matches(committed: &[u8], target_index: u8, body: &[u8]) -> bool {
    committed.len() == body.len() + 1
        && committed.first() == Some(&target_index)
        && committed.get(1..) == Some(body)
}

fn parse_governance_snapshot(
    body: &[u8],
    expected_index: u8,
) -> Result<GovernanceSnapshot, ProgramError> {
    require!(
        body.len() >= INTENT_BODY_FIXED_LEN + 8,
        ProgramError::InvalidInstructionData
    );
    require!(
        body[INTENT_BODY_INDEX_OFFSET] == expected_index,
        ProgramError::InvalidInstructionData
    );
    // New body must clear active proposals.
    let apc = u16::from_le_bytes([
        body[INTENT_BODY_ACTIVE_PROPOSAL_COUNT_OFFSET],
        body[INTENT_BODY_ACTIVE_PROPOSAL_COUNT_OFFSET + 1],
    ]);
    require!(apc == 0, WalletError::IntentHasActiveProposals);

    let approval_threshold = body[INTENT_BODY_APPROVAL_THRESHOLD_OFFSET];
    let cancellation_threshold = body[INTENT_BODY_CANCELLATION_THRESHOLD_OFFSET];
    let timelock_seconds = u32::from_le_bytes(
        body[INTENT_BODY_TIMELOCK_OFFSET..INTENT_BODY_TIMELOCK_OFFSET + 4]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    let offset = INTENT_BODY_FIXED_LEN;
    let (proposers, proposer_count, offset) = read_address_vec(body, offset)?;
    let (approvers, approver_count, _offset) = read_address_vec(body, offset)?;

    Ok(GovernanceSnapshot {
        approval_threshold,
        cancellation_threshold,
        timelock_seconds,
        proposers,
        proposer_count,
        approvers,
        approver_count,
    })
}

fn read_address_vec(
    body: &[u8],
    offset: usize,
) -> Result<([[u8; 32]; MAX_GOVERNANCE_MEMBERS], usize, usize), ProgramError> {
    require!(
        offset + 4 <= body.len(),
        ProgramError::InvalidInstructionData
    );
    let count = u32::from_le_bytes(
        body[offset..offset + 4]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    ) as usize;
    require!(
        count >= 1 && count <= MAX_GOVERNANCE_MEMBERS,
        ProgramError::InvalidInstructionData
    );
    let mut next = offset + 4;
    let mut out = [[0u8; 32]; MAX_GOVERNANCE_MEMBERS];
    for i in 0..count {
        require!(
            next + 32 <= body.len(),
            ProgramError::InvalidInstructionData
        );
        out[i].copy_from_slice(&body[next..next + 32]);
        next += 32;
    }
    Ok((out, count, next))
}

#[cfg(test)]
mod tests {
    use super::governance_payload_matches;

    #[test]
    fn committed_governance_payload_binds_target_and_full_body() {
        let body = [2u8, 0, 9, 8, 7];
        let mut committed = vec![3u8];
        committed.extend_from_slice(&body);

        assert!(governance_payload_matches(&committed, 3, &body));
        assert!(!governance_payload_matches(&committed, 4, &body));

        let mut changed_body = body;
        changed_body[4] = 6;
        assert!(!governance_payload_matches(&committed, 3, &changed_body));
        assert!(!governance_payload_matches(&[], 3, &body));
    }
}
