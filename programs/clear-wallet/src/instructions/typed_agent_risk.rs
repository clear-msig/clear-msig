use quasar_lang::{cpi::Seed, prelude::*, sysvars::Sysvar as _};

use crate::{
    error::WalletError,
    instructions::typed_proposal::{mark_typed_executed, verify_typed_execution_ready},
    state::wallet::ClearWallet,
    state::{
        AgentRiskLedger, AgentSession, AgentSettlementReceipt, Intent, ProposalStatus,
        TypedProposal, AGENT_RISK_LEDGER_LEN, AGENT_RISK_LEDGER_SEED, AGENT_RISK_STATUS_ACTIVE,
        AGENT_RISK_STATUS_PAUSED, AGENT_SESSION_STATUS_REVOKED, AGENT_SETTLEMENT_RECEIPT_LEN,
        AGENT_SETTLEMENT_RECEIPT_SEED,
    },
    utils::clearsign::{
        hash_agent_risk_policy_payload, hash_agent_trade_settlement_payload, ClearSignActionKind,
    },
};

pub const AGENT_SETTLEMENT_OUTCOME_PROFIT: u8 = 1;
pub const AGENT_SETTLEMENT_OUTCOME_LOSS: u8 = 2;
pub const AGENT_SETTLEMENT_OUTCOME_FLAT: u8 = 3;

#[derive(Accounts)]
pub struct ExecuteTypedAgentRiskPolicy<'info> {
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
    pub session: &'info UncheckedAccount,
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub risk_ledger: &'info mut UncheckedAccount,
    pub system_program: &'info Program<System>,
}

pub struct ExecuteTypedAgentRiskPolicyArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub session_id_hash: [u8; 32],
    pub oracle_policy_hash: [u8; 32],
    pub max_loss_raw_le: [u8; 16],
    pub status: u8,
}

impl ExecuteTypedAgentRiskPolicy<'_> {
    pub fn execute_typed_agent_risk_policy(
        &mut self,
        args: ExecuteTypedAgentRiskPolicyArgs,
    ) -> Result<(), ProgramError> {
        require!(
            args.status == AGENT_RISK_STATUS_ACTIVE || args.status == AGENT_RISK_STATUS_PAUSED,
            ProgramError::InvalidInstructionData
        );
        let max_loss_raw = u128::from_le_bytes(args.max_loss_raw_le);
        if args.status == AGENT_RISK_STATUS_ACTIVE {
            require!(max_loss_raw > 0, ProgramError::InvalidInstructionData);
            require!(
                args.oracle_policy_hash != [0u8; 32],
                ProgramError::InvalidInstructionData
            );
        }
        let payload_hash = hash_agent_risk_policy_payload(
            &args.session_id_hash,
            &args.oracle_policy_hash,
            max_loss_raw,
            args.status,
        );
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            ClearSignActionKind::AgentRiskPolicy.code(),
            args.policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;

        let (expected_session, _) = Address::find_program_address(
            &[
                crate::state::AGENT_SESSION_SEED,
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
        let session =
            AgentSession::read(unsafe { self.session.to_account_view().borrow_unchecked() })?;
        require_keys_eq!(
            session.wallet,
            *self.wallet.address(),
            WalletError::AgentSessionInactive
        );
        require!(
            session.session_id_hash == args.session_id_hash,
            WalletError::AgentSessionInactive
        );

        let (expected_risk, bump) = Address::find_program_address(
            &[
                AGENT_RISK_LEDGER_SEED,
                self.wallet.address().as_ref(),
                &args.session_id_hash,
            ],
            &crate::ID,
        );
        require_keys_eq!(
            *self.risk_ledger.address(),
            expected_risk,
            ProgramError::InvalidSeeds
        );
        let risk_view =
            unsafe { &mut *(self.risk_ledger as *mut UncheckedAccount as *mut AccountView) };
        if risk_view.data_len() == 0 {
            let rent = Rent::get()?;
            let lamports = rent.try_minimum_balance(AGENT_RISK_LEDGER_LEN)?;
            let bump_byte = [bump];
            let seeds: &[Seed] = &[
                Seed::from(AGENT_RISK_LEDGER_SEED),
                Seed::from(self.wallet.address().as_ref()),
                Seed::from(args.session_id_hash.as_ref()),
                Seed::from(&bump_byte as &[u8]),
            ];
            self.system_program
                .create_account(
                    self.payer.to_account_view(),
                    self.risk_ledger.to_account_view(),
                    lamports,
                    AGENT_RISK_LEDGER_LEN as u64,
                    &crate::ID,
                )
                .invoke_signed(seeds)?;
        } else {
            require!(
                risk_view.owned_by(&crate::ID),
                ProgramError::IncorrectProgramId
            );
        }

        let data = unsafe { risk_view.borrow_unchecked() };
        let mut next = if data[0] == crate::state::AGENT_RISK_LEDGER_DISCRIMINATOR {
            AgentRiskLedger::read(data)?
        } else {
            AgentRiskLedger {
                wallet: *self.wallet.address(),
                session_id_hash: args.session_id_hash,
                oracle_policy_hash: args.oracle_policy_hash,
                max_loss_raw_le: args.max_loss_raw_le,
                realized_loss_raw_le: [0u8; 16],
                open_notional_raw_le: [0u8; 16],
                next_settlement_sequence: 0,
                last_settlement_artifact_hash: [0u8; 32],
                status: args.status,
                bump,
            }
        };
        require_keys_eq!(
            next.wallet,
            *self.wallet.address(),
            WalletError::AgentRiskPolicyDenied
        );
        require!(
            next.session_id_hash == args.session_id_hash,
            WalletError::AgentRiskPolicyDenied
        );
        if next.open_notional_raw() > 0 {
            require!(
                next.oracle_policy_hash == args.oracle_policy_hash,
                WalletError::AgentRiskPolicyDenied
            );
        }
        next.oracle_policy_hash = args.oracle_policy_hash;
        next.max_loss_raw_le = args.max_loss_raw_le;
        next.status =
            if args.status == AGENT_RISK_STATUS_ACTIVE && next.realized_loss_raw() < max_loss_raw {
                AGENT_RISK_STATUS_ACTIVE
            } else {
                AGENT_RISK_STATUS_PAUSED
            };
        next.bump = bump;
        unsafe { next.write(risk_view.data_mut_ptr()) };
        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ExecuteTypedAgentTradeSettlement<'info> {
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
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub risk_ledger: &'info mut UncheckedAccount,
    #[cfg_attr(target_os = "solana", allow(quasar::unchecked_account))]
    #[account(mut)]
    pub settlement_receipt: &'info mut UncheckedAccount,
    pub system_program: &'info Program<System>,
}

pub struct ExecuteTypedAgentTradeSettlementArgs {
    pub policy_commitment: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub session_id_hash: [u8; 32],
    pub execution_id_hash: [u8; 32],
    pub settlement_artifact_hash: [u8; 32],
    pub oracle_policy_hash: [u8; 32],
    pub closed_notional_raw_le: [u8; 16],
    pub outcome: u8,
    pub pnl_abs_raw_le: [u8; 16],
    pub settlement_sequence: u64,
}

impl ExecuteTypedAgentTradeSettlement<'_> {
    pub fn execute_typed_agent_trade_settlement(
        &mut self,
        args: ExecuteTypedAgentTradeSettlementArgs,
    ) -> Result<(), ProgramError> {
        let closed_notional_raw = u128::from_le_bytes(args.closed_notional_raw_le);
        let pnl_abs_raw = u128::from_le_bytes(args.pnl_abs_raw_le);
        require!(
            closed_notional_raw > 0,
            ProgramError::InvalidInstructionData
        );
        require!(
            args.execution_id_hash != [0u8; 32]
                && args.settlement_artifact_hash != [0u8; 32]
                && args.oracle_policy_hash != [0u8; 32],
            ProgramError::InvalidInstructionData
        );
        require!(
            args.outcome == AGENT_SETTLEMENT_OUTCOME_PROFIT
                || args.outcome == AGENT_SETTLEMENT_OUTCOME_LOSS
                || args.outcome == AGENT_SETTLEMENT_OUTCOME_FLAT,
            ProgramError::InvalidInstructionData
        );
        require!(
            (args.outcome == AGENT_SETTLEMENT_OUTCOME_FLAT && pnl_abs_raw == 0)
                || (args.outcome != AGENT_SETTLEMENT_OUTCOME_FLAT && pnl_abs_raw > 0),
            ProgramError::InvalidInstructionData
        );
        let payload_hash = hash_agent_trade_settlement_payload(
            &args.session_id_hash,
            &args.execution_id_hash,
            &args.settlement_artifact_hash,
            &args.oracle_policy_hash,
            closed_notional_raw,
            args.outcome,
            pnl_abs_raw,
            args.settlement_sequence,
        );
        verify_typed_execution_ready(
            &self.intent,
            &self.proposal,
            ClearSignActionKind::AgentTradeSettlement.code(),
            args.policy_commitment,
            payload_hash,
            args.envelope_hash,
        )?;

        let (expected_session, _) = Address::find_program_address(
            &[
                crate::state::AGENT_SESSION_SEED,
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
        let (expected_risk, _) = Address::find_program_address(
            &[
                AGENT_RISK_LEDGER_SEED,
                self.wallet.address().as_ref(),
                &args.session_id_hash,
            ],
            &crate::ID,
        );
        require_keys_eq!(
            *self.risk_ledger.address(),
            expected_risk,
            ProgramError::InvalidSeeds
        );
        require!(
            self.session.to_account_view().owned_by(&crate::ID)
                && self.risk_ledger.to_account_view().owned_by(&crate::ID),
            ProgramError::IncorrectProgramId
        );

        let session_view =
            unsafe { &mut *(self.session as *mut UncheckedAccount as *mut AccountView) };
        let risk_view =
            unsafe { &mut *(self.risk_ledger as *mut UncheckedAccount as *mut AccountView) };
        let mut session = AgentSession::read(unsafe { session_view.borrow_unchecked() })?;
        let mut risk = AgentRiskLedger::read(unsafe { risk_view.borrow_unchecked() })?;
        require_keys_eq!(
            session.wallet,
            *self.wallet.address(),
            WalletError::AgentSettlementInvalid
        );
        require_keys_eq!(
            risk.wallet,
            *self.wallet.address(),
            WalletError::AgentSettlementInvalid
        );
        require!(
            session.session_id_hash == args.session_id_hash
                && risk.session_id_hash == args.session_id_hash
                && risk.oracle_policy_hash == args.oracle_policy_hash
                && risk.next_settlement_sequence == args.settlement_sequence,
            WalletError::AgentSettlementInvalid
        );
        let next_open = risk
            .open_notional_raw()
            .checked_sub(closed_notional_raw)
            .ok_or(WalletError::AgentSettlementInvalid)?;
        let next_realized_loss = if args.outcome == AGENT_SETTLEMENT_OUTCOME_LOSS {
            risk.realized_loss_raw()
                .checked_add(pnl_abs_raw)
                .ok_or(WalletError::AgentSettlementInvalid)?
        } else {
            risk.realized_loss_raw()
        };

        let (expected_receipt, receipt_bump) = Address::find_program_address(
            &[
                AGENT_SETTLEMENT_RECEIPT_SEED,
                self.wallet.address().as_ref(),
                &args.settlement_artifact_hash,
            ],
            &crate::ID,
        );
        require_keys_eq!(
            *self.settlement_receipt.address(),
            expected_receipt,
            ProgramError::InvalidSeeds
        );
        let receipt_view =
            unsafe { &mut *(self.settlement_receipt as *mut UncheckedAccount as *mut AccountView) };
        require!(
            receipt_view.data_len() == 0,
            WalletError::AgentSettlementInvalid
        );
        let rent = Rent::get()?;
        let lamports = rent.try_minimum_balance(AGENT_SETTLEMENT_RECEIPT_LEN)?;
        let bump_byte = [receipt_bump];
        let seeds: &[Seed] = &[
            Seed::from(AGENT_SETTLEMENT_RECEIPT_SEED),
            Seed::from(self.wallet.address().as_ref()),
            Seed::from(args.settlement_artifact_hash.as_ref()),
            Seed::from(&bump_byte as &[u8]),
        ];
        self.system_program
            .create_account(
                self.payer.to_account_view(),
                self.settlement_receipt.to_account_view(),
                lamports,
                AGENT_SETTLEMENT_RECEIPT_LEN as u64,
                &crate::ID,
            )
            .invoke_signed(seeds)?;

        risk.set_open_notional_raw(next_open);
        risk.set_realized_loss_raw(next_realized_loss);
        risk.next_settlement_sequence = risk
            .next_settlement_sequence
            .checked_add(1)
            .ok_or(WalletError::AgentSettlementInvalid)?;
        risk.last_settlement_artifact_hash = args.settlement_artifact_hash;
        if next_realized_loss >= risk.max_loss_raw() {
            risk.status = AGENT_RISK_STATUS_PAUSED;
            session.status = AGENT_SESSION_STATUS_REVOKED;
        }
        let receipt = AgentSettlementReceipt {
            wallet: *self.wallet.address(),
            session_id_hash: args.session_id_hash,
            execution_id_hash: args.execution_id_hash,
            settlement_artifact_hash: args.settlement_artifact_hash,
            settlement_sequence: args.settlement_sequence,
            bump: receipt_bump,
        };
        unsafe { session.write(session_view.data_mut_ptr()) };
        unsafe { risk.write(risk_view.data_mut_ptr()) };
        unsafe { receipt.write(receipt_view.data_mut_ptr()) };
        mark_typed_executed(&mut self.intent, &mut self.proposal);
        Ok(())
    }
}
