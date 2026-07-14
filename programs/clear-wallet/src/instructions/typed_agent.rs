use quasar_lang::{cpi::Seed, prelude::*, sysvars::Sysvar as _};

use crate::{
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::{
        agent_risk::AgentRiskLedger,
        agent_session::{AgentSession, AGENT_SESSION_STATUS_ACTIVE, AGENT_SESSION_STATUS_REVOKED},
        intent::Intent,
        proposal::ProposalStatus,
        typed_proposal::TypedProposal,
        wallet::ClearWallet,
    },
    utils::clearsign::{
        hash_agent_session_grant_payload, hash_agent_trade_approval_payload, ClearSignActionKind,
        ClearSignAmount,
    },
};

const AGENT_SESSION_SEED: &[u8] = b"agent_session";
/// disc(1) + wallet(32) + session(32) + agent(32) + venue(32) + market(32) + policy(32)
/// + max_notional(16) + leverage(4) + expires(8) + spent(16) + status(1) + bump(1)
const AGENT_SESSION_LEN: usize = 1 + 32 + 32 + 32 + 32 + 32 + 32 + 16 + 4 + 8 + 16 + 1 + 1;

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
    /// Bound session grant PDA. Verified by seeds + layout in the handler.
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub session: &'info mut UncheckedAccount,
    /// Program-owned loss and open-exposure ledger for this session.
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub risk_ledger: &'info mut UncheckedAccount,
}

pub struct ExecuteTypedAgentTradeApprovalArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub amount_raw_le: [u8; 16],
    pub agent_id_hash: [u8; 32],
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
        require!(
            args.risk_check_hash != [0u8; 32],
            ProgramError::InvalidInstructionData
        );

        let amount = ClearSignAmount {
            asset: &args.asset_id_hash,
            raw_amount: amount_raw,
        };
        let payload_hash = hash_agent_trade_approval_payload(
            &args.agent_id_hash,
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

        let (expected_session, _) = Address::find_program_address(
            &[
                AGENT_SESSION_SEED,
                self.wallet.address().as_ref(),
                &args.session_id_hash,
            ],
            &crate::ID,
        );
        require_keys_eq!(
            *self.session.address(),
            expected_session,
            ProgramError::InvalidSeeds
        );
        require!(
            self.session.to_account_view().owned_by(&crate::ID),
            ProgramError::IncorrectProgramId
        );

        let (expected_risk_ledger, _) = Address::find_program_address(
            &[
                crate::state::AGENT_RISK_LEDGER_SEED,
                self.wallet.address().as_ref(),
                &args.session_id_hash,
            ],
            &crate::ID,
        );
        require_keys_eq!(
            *self.risk_ledger.address(),
            expected_risk_ledger,
            ProgramError::InvalidSeeds
        );
        require!(
            self.risk_ledger.to_account_view().owned_by(&crate::ID),
            ProgramError::IncorrectProgramId
        );

        let view = unsafe { &mut *(self.session as *mut UncheckedAccount as *mut AccountView) };
        let data = unsafe { view.borrow_unchecked() };
        let mut session = AgentSession::read(data)?;
        require_keys_eq!(
            session.wallet,
            *self.wallet.address(),
            WalletError::AgentSessionInactive
        );
        require!(
            session.session_id_hash == args.session_id_hash,
            WalletError::AgentSessionInactive
        );
        require!(session.is_active(), WalletError::AgentSessionInactive);
        require!(
            session.agent_id_hash == args.agent_id_hash,
            WalletError::AgentSessionInactive
        );
        require!(
            session.policy_commitment == args.policy_commitment,
            WalletError::AgentSessionLimitExceeded
        );
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp.get() < session.expires_at,
            WalletError::AgentSessionInactive
        );
        require!(
            session.venue_hash == args.venue_hash,
            WalletError::AgentSessionLimitExceeded
        );
        if session.market_hash != [0u8; 32] {
            require!(
                session.market_hash == args.market_hash,
                WalletError::AgentSessionLimitExceeded
            );
        }
        require!(
            args.max_leverage_x100 <= session.max_leverage_x100,
            WalletError::AgentSessionLimitExceeded
        );
        let remaining = session
            .max_notional_raw()
            .checked_sub(session.spent_notional_raw())
            .ok_or(WalletError::AgentSessionLimitExceeded)?;
        require!(
            amount_raw <= remaining,
            WalletError::AgentSessionLimitExceeded
        );
        let next_spent = session
            .spent_notional_raw()
            .checked_add(amount_raw)
            .ok_or(WalletError::AgentSessionLimitExceeded)?;

        let risk_view =
            unsafe { &mut *(self.risk_ledger as *mut UncheckedAccount as *mut AccountView) };
        let risk_data = unsafe { risk_view.borrow_unchecked() };
        let mut risk = AgentRiskLedger::read(risk_data)?;
        require_keys_eq!(
            risk.wallet,
            *self.wallet.address(),
            WalletError::AgentRiskPolicyDenied
        );
        require!(
            risk.session_id_hash == args.session_id_hash && risk.is_active(),
            WalletError::AgentRiskPolicyDenied
        );
        let next_open = risk
            .open_notional_raw()
            .checked_add(amount_raw)
            .ok_or(WalletError::AgentRiskPolicyDenied)?;
        require!(
            next_open <= session.max_notional_raw(),
            WalletError::AgentRiskPolicyDenied
        );

        session.set_spent_notional_raw(next_spent);
        risk.set_open_notional_raw(next_open);
        unsafe { session.write(view.data_mut_ptr()) };
        unsafe { risk.write(risk_view.data_mut_ptr()) };

        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ExecuteTypedAgentSessionGrant<'info> {
    #[account(mut)]
    pub payer: &'info mut Signer,
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
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub session: &'info mut UncheckedAccount,
    pub system_program: &'info Program<System>,
}

pub struct ExecuteTypedAgentSessionGrantArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub session_id_hash: [u8; 32],
    pub agent_id_hash: [u8; 32],
    pub venue_hash: [u8; 32],
    pub market_hash: [u8; 32],
    pub max_notional_raw_le: [u8; 16],
    pub max_leverage_x100: u32,
    pub expires_at: i64,
    /// 1 = grant/active, 2 = revoke
    pub status: u8,
}

impl<'info> ExecuteTypedAgentSessionGrant<'info> {
    pub fn execute_typed_agent_session_grant(
        &mut self,
        args: ExecuteTypedAgentSessionGrantArgs,
    ) -> Result<(), ProgramError> {
        require!(
            args.status == AGENT_SESSION_STATUS_ACTIVE
                || args.status == AGENT_SESSION_STATUS_REVOKED,
            ProgramError::InvalidInstructionData
        );
        let max_notional = u128::from_le_bytes(args.max_notional_raw_le);
        if args.status == AGENT_SESSION_STATUS_ACTIVE {
            require!(max_notional > 0, ProgramError::InvalidInstructionData);
            require!(
                args.max_leverage_x100 > 0,
                ProgramError::InvalidInstructionData
            );
            let clock = Clock::get()?;
            require!(
                args.expires_at > clock.unix_timestamp.get(),
                ProgramError::InvalidInstructionData
            );
        }

        let payload_hash = hash_agent_session_grant_payload(
            &args.session_id_hash,
            &args.agent_id_hash,
            &args.venue_hash,
            &args.market_hash,
            max_notional,
            args.max_leverage_x100,
            args.expires_at,
            args.status,
        );
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            ClearSignActionKind::AgentSessionGrant.code(),
            args.policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;

        let (expected, bump) = Address::find_program_address(
            &[
                AGENT_SESSION_SEED,
                self.wallet.address().as_ref(),
                &args.session_id_hash,
            ],
            &crate::ID,
        );
        require_keys_eq!(
            *self.session.address(),
            expected,
            ProgramError::InvalidSeeds
        );

        let view = unsafe { &mut *(self.session as *mut UncheckedAccount as *mut AccountView) };
        if view.data_len() == 0 {
            let rent = Rent::get()?;
            let lamports = rent.try_minimum_balance(AGENT_SESSION_LEN)?;
            let bump_byte = [bump];
            let seeds: &[Seed] = &[
                Seed::from(AGENT_SESSION_SEED),
                Seed::from(self.wallet.address().as_ref()),
                Seed::from(args.session_id_hash.as_ref()),
                Seed::from(&bump_byte as &[u8]),
            ];
            self.system_program
                .create_account(
                    self.payer.to_account_view(),
                    self.session.to_account_view(),
                    lamports,
                    AGENT_SESSION_LEN as u64,
                    &crate::ID,
                )
                .invoke_signed(seeds)?;
        } else {
            require!(view.owned_by(&crate::ID), ProgramError::IncorrectProgramId);
        }

        let data = unsafe { view.borrow_unchecked() };
        let existing = if data.len() >= AGENT_SESSION_LEN && data[0] == 9 {
            Some(AgentSession::read(data)?)
        } else {
            None
        };

        let mut next = existing.unwrap_or(AgentSession {
            wallet: *self.wallet.address(),
            session_id_hash: args.session_id_hash,
            agent_id_hash: args.agent_id_hash,
            venue_hash: args.venue_hash,
            market_hash: args.market_hash,
            policy_commitment: args.policy_commitment,
            max_notional_raw_le: args.max_notional_raw_le,
            max_leverage_x100: args.max_leverage_x100,
            expires_at: args.expires_at,
            spent_notional_raw_le: [0u8; 16],
            status: args.status,
            bump,
        });
        next.wallet = *self.wallet.address();
        next.session_id_hash = args.session_id_hash;
        next.bump = bump;
        if args.status == AGENT_SESSION_STATUS_REVOKED {
            next.status = AGENT_SESSION_STATUS_REVOKED;
        } else {
            next.agent_id_hash = args.agent_id_hash;
            next.venue_hash = args.venue_hash;
            next.market_hash = args.market_hash;
            next.policy_commitment = args.policy_commitment;
            next.max_notional_raw_le = args.max_notional_raw_le;
            next.max_leverage_x100 = args.max_leverage_x100;
            next.expires_at = args.expires_at;
            next.status = AGENT_SESSION_STATUS_ACTIVE;
            next.spent_notional_raw_le = [0u8; 16];
        }
        unsafe { next.write(view.data_mut_ptr()) };

        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}
