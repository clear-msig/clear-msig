use quasar_lang::prelude::*;

use crate::{
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::{
        intent::Intent, proposal::ProposalStatus, typed_proposal::TypedProposal,
        wallet::ClearWallet,
    },
    utils::clearsign::{hash_agent_trade_approval_payload, ClearSignActionKind, ClearSignAmount},
};

#[derive(Accounts)]
pub struct ExecuteTypedAgentTradeApproval<'info> {
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

pub struct ExecuteTypedAgentTradeApprovalArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub amount_raw_le: [u8; 16],
    pub venue_hash: [u8; 32],
    pub market_hash: [u8; 32],
    pub side_hash: [u8; 32],
    pub asset_id_hash: [u8; 32],
    pub max_leverage_x100: u32,
    pub session_id_hash: [u8; 32],
    pub route_hash: [u8; 32],
    pub risk_check_hash: [u8; 32],
}

impl<'info> ExecuteTypedAgentTradeApproval<'info> {
    pub fn execute_typed_agent_trade_approval(
        &mut self,
        args: ExecuteTypedAgentTradeApprovalArgs,
    ) -> Result<(), ProgramError> {
        let amount_raw = u128::from_le_bytes(args.amount_raw_le);
        require!(amount_raw > 0, ProgramError::InvalidInstructionData);
        require!(
            args.max_leverage_x100 > 0,
            ProgramError::InvalidInstructionData
        );

        let amount = ClearSignAmount {
            asset: &args.asset_id_hash,
            raw_amount: amount_raw,
        };
        let payload_hash = hash_agent_trade_approval_payload(
            &args.venue_hash,
            &args.market_hash,
            &args.side_hash,
            &amount,
            args.max_leverage_x100,
            &args.session_id_hash,
            &args.route_hash,
            &args.risk_check_hash,
        );
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            ClearSignActionKind::AgentTradeApproval.code(),
            args.policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;

        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}
