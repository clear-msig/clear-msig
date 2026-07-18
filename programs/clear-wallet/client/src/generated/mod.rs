use quasar_lang::client::{DynBytes, DynVec, TailBytes};
pub mod approve;
pub mod approve_typed;
pub mod bind_dwallet;
pub mod cancel;
pub mod cancel_typed;
pub mod cleanup_proposal;
pub mod cleanup_typed_proposal;
pub mod create_wallet;
pub mod execute;
pub mod execute_recurring_payment;
pub mod execute_recurring_token_payment;
pub mod execute_typed;
pub mod execute_typed_agent_risk_policy;
pub mod execute_typed_agent_session_grant;
pub mod execute_typed_agent_trade_approval;
pub mod execute_typed_agent_trade_settlement;
pub mod execute_typed_chain_send;
pub mod execute_typed_cross_chain_escrow_release;
pub mod execute_typed_cross_chain_escrow_return;
pub mod execute_typed_escrow_release;
pub mod execute_typed_escrow_return;
pub mod execute_typed_intent_governance;
pub mod execute_typed_private_escrow_release;
pub mod execute_typed_private_escrow_return;
pub mod execute_typed_recurring_schedule;
pub mod execute_typed_recurring_token_schedule;
pub mod execute_typed_sol_batch_send;
pub mod execute_typed_sol_send;
pub mod execute_typed_spl_escrow_release;
pub mod execute_typed_spl_escrow_return;
pub mod execute_typed_wallet_policy_update;
pub mod ika_sign;
pub mod ika_sign_typed_chain_send;
pub mod propose;
pub mod propose_typed;
pub mod propose_typed_v4;

pub use approve::*;
pub use approve_typed::*;
pub use bind_dwallet::*;
pub use cancel::*;
pub use cancel_typed::*;
pub use cleanup_proposal::*;
pub use cleanup_typed_proposal::*;
pub use create_wallet::*;
pub use execute::*;
pub use execute_recurring_payment::*;
pub use execute_recurring_token_payment::*;
pub use execute_typed::*;
pub use execute_typed_agent_risk_policy::*;
pub use execute_typed_agent_session_grant::*;
pub use execute_typed_agent_trade_approval::*;
pub use execute_typed_agent_trade_settlement::*;
pub use execute_typed_chain_send::*;
pub use execute_typed_cross_chain_escrow_release::*;
pub use execute_typed_cross_chain_escrow_return::*;
pub use execute_typed_escrow_release::*;
pub use execute_typed_escrow_return::*;
pub use execute_typed_intent_governance::*;
pub use execute_typed_private_escrow_release::*;
pub use execute_typed_private_escrow_return::*;
pub use execute_typed_recurring_schedule::*;
pub use execute_typed_recurring_token_schedule::*;
pub use execute_typed_sol_batch_send::*;
pub use execute_typed_sol_send::*;
pub use execute_typed_spl_escrow_release::*;
pub use execute_typed_spl_escrow_return::*;
pub use execute_typed_wallet_policy_update::*;
pub use ika_sign::*;
pub use ika_sign_typed_chain_send::*;
pub use propose::*;
pub use propose_typed::*;
pub use propose_typed_v4::*;

pub enum ProgramInstruction {
    CreateWallet {
        approval_threshold: u8,
        cancellation_threshold: u8,
        timelock_seconds: u32,
        name: DynBytes,
        proposers: DynVec<[u8; 32]>,
        approvers: DynVec<[u8; 32]>,
        policy_ciphertexts: TailBytes,
    },
    Propose {
        proposal_index: u64,
        expiry: i64,
        proposer_pubkey: [u8; 32],
        signature: [u8; 64],
        params_data: TailBytes,
    },
    Approve {
        expiry: i64,
        approver_index: u8,
        signature: [u8; 64],
    },
    Cancel {
        expiry: i64,
        canceller_index: u8,
        signature: [u8; 64],
    },
    Execute,
    CleanupProposal,
    CleanupTypedProposal,
    ExecuteTypedSplEscrowRelease {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_tokens: u64,
        escrow_id_hash: [u8; 32],
        milestone_id_hash: [u8; 32],
    },
    ExecuteTypedSplEscrowReturn {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        escrow_id_hash: [u8; 32],
        amount_tokens_le: TailBytes,
    },
    ExecuteTypedCrossChainEscrowRelease {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        chain_kind: u8,
        amount_raw_le: [u8; 16],
        escrow_id_hash: [u8; 32],
        milestone_id_hash: [u8; 32],
        recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        route_hash: [u8; 32],
        tx_template_hash: [u8; 32],
        settlement_artifact_hash: [u8; 32],
    },
    ExecuteTypedCrossChainEscrowReturn {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        chain_kind: u8,
        amount_raw_le: [u8; 16],
        escrow_id_hash: [u8; 32],
        refund_recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        route_hash: [u8; 32],
        tx_template_hash: [u8; 32],
        settlement_artifact_hash: [u8; 32],
    },
    ExecuteTypedPrivateEscrowRelease {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_raw_le: [u8; 16],
        escrow_id_hash: [u8; 32],
        milestone_id_hash: [u8; 32],
        recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        policy_ciphertexts_hash: [u8; 32],
        private_evaluation_hash: [u8; 32],
        settlement_artifact_hash: [u8; 32],
    },
    ExecuteTypedPrivateEscrowReturn {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_raw_le: [u8; 16],
        escrow_id_hash: [u8; 32],
        refund_recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        policy_ciphertexts_hash: [u8; 32],
        private_evaluation_hash: [u8; 32],
        settlement_artifact_hash: [u8; 32],
    },
    ExecuteTypedAgentTradeApproval {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_raw_le: [u8; 16],
        agent_id_hash: [u8; 32],
        venue_hash: [u8; 32],
        market_hash: [u8; 32],
        side_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        max_leverage_x100: u32,
        session_id_hash: [u8; 32],
        route_hash: [u8; 32],
        risk_check_hash: [u8; 32],
    },
    ExecuteTypedAgentSessionGrant {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        session_id_hash: [u8; 32],
        agent_id_hash: [u8; 32],
        venue_hash: [u8; 32],
        market_hash: [u8; 32],
        max_notional_raw_le: [u8; 16],
        max_leverage_x100: u32,
        expires_at: i64,
        status: u8,
    },
    ExecuteTypedAgentRiskPolicy {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        session_id_hash: [u8; 32],
        oracle_policy_hash: [u8; 32],
        max_loss_raw_le: [u8; 16],
        status: u8,
    },
    ExecuteTypedAgentTradeSettlement {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        session_id_hash: [u8; 32],
        execution_id_hash: [u8; 32],
        settlement_artifact_hash: [u8; 32],
        oracle_policy_hash: [u8; 32],
        closed_notional_raw_le: [u8; 16],
        outcome: u8,
        pnl_abs_raw_le: [u8; 16],
        settlement_sequence: u64,
    },
    ExecuteTypedChainSend {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        chain_kind: u8,
        amount_raw_le: [u8; 16],
        recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        tx_template_hash: [u8; 32],
    },
    IkaSignTypedChainSend {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        chain_kind: u8,
        amount_raw_le: [u8; 16],
        recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        tx_template_hash: [u8; 32],
        message_approval_bump: u8,
        cpi_authority_bump: u8,
        blake2b_hashes: [u8; 96],
        params_data: TailBytes,
    },
    ExecuteTypedWalletPolicyUpdate {
        current_policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        chain_kind: u8,
        new_policy_bytes: DynVec<u8>,
    },
    ExecuteTypedIntentGovernance {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        action_kind: u8,
        target_intent_index: u8,
        new_intent_body: TailBytes,
    },
    BindDwallet {
        chain_kind: u8,
        user_pubkey: [u8; 32],
        signature_scheme: u16,
        cpi_authority_bump: u8,
    },
    IkaSign {
        message_approval_bump: u8,
        cpi_authority_bump: u8,
        blake2b_hashes: [u8; 96],
    },
    ProposeTyped {
        proposal_index: u64,
        expiry: i64,
        action_kind: u8,
        policy_commitment: [u8; 32],
        payload_hash: [u8; 32],
        envelope_hash: [u8; 32],
        proposer_pubkey: [u8; 32],
        signature: [u8; 64],
        action_id: [u8; 32],
        nonce: [u8; 32],
        policy_bytes: DynVec<u8>,
        clear_text: TailBytes,
    },
    ProposeTypedV4 {
        proposal_index: u64,
        signature: [u8; 64],
        policy_bytes: DynVec<u8>,
        canonical_intent: TailBytes,
    },
    ExecuteTypedRecurringSchedule {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        schedule_id_hash: [u8; 32],
        recipient: [u8; 32],
        amount_lamports: u64,
        interval_seconds: u32,
        first_execution_at: i64,
        payment_count: u32,
        status: u8,
    },
    ExecuteRecurringPayment {
        schedule_id_hash: [u8; 32],
    },
    ExecuteTypedRecurringTokenSchedule {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        schedule_id_hash: [u8; 32],
        amount_tokens: u64,
        interval_seconds: u32,
        first_execution_at: i64,
        payment_count: u32,
        status: u8,
    },
    ExecuteRecurringTokenPayment {
        schedule_id_hash: [u8; 32],
    },
    ApproveTyped {
        approver_index: u8,
        signature: [u8; 64],
    },
    CancelTyped {
        canceller_index: u8,
        signature: [u8; 64],
    },
    ExecuteTyped {
        action_kind: u8,
        policy_commitment: [u8; 32],
        payload_hash: [u8; 32],
        envelope_hash: [u8; 32],
    },
    ExecuteTypedEscrowRelease {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_lamports: u64,
        escrow_id_hash: [u8; 32],
        milestone_id_hash: [u8; 32],
    },
    ExecuteTypedEscrowReturn {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        escrow_id_hash: [u8; 32],
        amount_lamports_le: TailBytes,
    },
    ExecuteTypedSolSend {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_lamports: u64,
    },
    ExecuteTypedSolBatchSend {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_lamports_le: TailBytes,
    },
}

pub fn decode_instruction(data: &[u8]) -> Option<ProgramInstruction> {
    let disc = *data.first()?;
    match disc {
        0 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let approval_threshold: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&approval_threshold).ok()? as usize;
            let cancellation_threshold: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&cancellation_threshold).ok()? as usize;
            let timelock_seconds: u32 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&timelock_seconds).ok()? as usize;
            let name: DynBytes = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&name).ok()? as usize;
            let proposers: DynVec<[u8; 32]> = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&proposers).ok()? as usize;
            let approvers: DynVec<[u8; 32]> = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&approvers).ok()? as usize;
            let policy_ciphertexts: TailBytes = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::CreateWallet {
                approval_threshold,
                cancellation_threshold,
                timelock_seconds,
                name,
                proposers,
                approvers,
                policy_ciphertexts,
            })
        }
        1 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let proposal_index: u64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&proposal_index).ok()? as usize;
            let expiry: i64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&expiry).ok()? as usize;
            let proposer_pubkey: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&proposer_pubkey).ok()? as usize;
            let signature: [u8; 64] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&signature).ok()? as usize;
            let params_data: TailBytes = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::Propose {
                proposal_index,
                expiry,
                proposer_pubkey,
                signature,
                params_data,
            })
        }
        2 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let expiry: i64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&expiry).ok()? as usize;
            let approver_index: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&approver_index).ok()? as usize;
            let signature: [u8; 64] = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::Approve {
                expiry,
                approver_index,
                signature,
            })
        }
        3 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let expiry: i64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&expiry).ok()? as usize;
            let canceller_index: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&canceller_index).ok()? as usize;
            let signature: [u8; 64] = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::Cancel {
                expiry,
                canceller_index,
                signature,
            })
        }
        4 => Some(ProgramInstruction::Execute),
        5 => Some(ProgramInstruction::CleanupProposal),
        16 => Some(ProgramInstruction::CleanupTypedProposal),
        17 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let amount_tokens: u64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&amount_tokens).ok()? as usize;
            let escrow_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&escrow_id_hash).ok()? as usize;
            let milestone_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedSplEscrowRelease {
                policy_commitment,
                envelope_hash,
                amount_tokens,
                escrow_id_hash,
                milestone_id_hash,
            })
        }
        18 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let escrow_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&escrow_id_hash).ok()? as usize;
            let amount_tokens_le: TailBytes = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedSplEscrowReturn {
                policy_commitment,
                envelope_hash,
                escrow_id_hash,
                amount_tokens_le,
            })
        }
        19 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let chain_kind: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&chain_kind).ok()? as usize;
            let amount_raw_le: [u8; 16] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&amount_raw_le).ok()? as usize;
            let escrow_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&escrow_id_hash).ok()? as usize;
            let milestone_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&milestone_id_hash).ok()? as usize;
            let recipient_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&recipient_hash).ok()? as usize;
            let asset_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&asset_id_hash).ok()? as usize;
            let route_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&route_hash).ok()? as usize;
            let tx_template_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&tx_template_hash).ok()? as usize;
            let settlement_artifact_hash: [u8; 32] =
                wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedCrossChainEscrowRelease {
                policy_commitment,
                envelope_hash,
                chain_kind,
                amount_raw_le,
                escrow_id_hash,
                milestone_id_hash,
                recipient_hash,
                asset_id_hash,
                route_hash,
                tx_template_hash,
                settlement_artifact_hash,
            })
        }
        20 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let chain_kind: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&chain_kind).ok()? as usize;
            let amount_raw_le: [u8; 16] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&amount_raw_le).ok()? as usize;
            let escrow_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&escrow_id_hash).ok()? as usize;
            let refund_recipient_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&refund_recipient_hash).ok()? as usize;
            let asset_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&asset_id_hash).ok()? as usize;
            let route_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&route_hash).ok()? as usize;
            let tx_template_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&tx_template_hash).ok()? as usize;
            let settlement_artifact_hash: [u8; 32] =
                wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedCrossChainEscrowReturn {
                policy_commitment,
                envelope_hash,
                chain_kind,
                amount_raw_le,
                escrow_id_hash,
                refund_recipient_hash,
                asset_id_hash,
                route_hash,
                tx_template_hash,
                settlement_artifact_hash,
            })
        }
        21 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let amount_raw_le: [u8; 16] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&amount_raw_le).ok()? as usize;
            let escrow_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&escrow_id_hash).ok()? as usize;
            let milestone_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&milestone_id_hash).ok()? as usize;
            let recipient_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&recipient_hash).ok()? as usize;
            let asset_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&asset_id_hash).ok()? as usize;
            let policy_ciphertexts_hash: [u8; 32] =
                wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_ciphertexts_hash).ok()? as usize;
            let private_evaluation_hash: [u8; 32] =
                wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&private_evaluation_hash).ok()? as usize;
            let settlement_artifact_hash: [u8; 32] =
                wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedPrivateEscrowRelease {
                policy_commitment,
                envelope_hash,
                amount_raw_le,
                escrow_id_hash,
                milestone_id_hash,
                recipient_hash,
                asset_id_hash,
                policy_ciphertexts_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
            })
        }
        22 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let amount_raw_le: [u8; 16] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&amount_raw_le).ok()? as usize;
            let escrow_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&escrow_id_hash).ok()? as usize;
            let refund_recipient_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&refund_recipient_hash).ok()? as usize;
            let asset_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&asset_id_hash).ok()? as usize;
            let policy_ciphertexts_hash: [u8; 32] =
                wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_ciphertexts_hash).ok()? as usize;
            let private_evaluation_hash: [u8; 32] =
                wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&private_evaluation_hash).ok()? as usize;
            let settlement_artifact_hash: [u8; 32] =
                wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedPrivateEscrowReturn {
                policy_commitment,
                envelope_hash,
                amount_raw_le,
                escrow_id_hash,
                refund_recipient_hash,
                asset_id_hash,
                policy_ciphertexts_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
            })
        }
        23 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let amount_raw_le: [u8; 16] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&amount_raw_le).ok()? as usize;
            let agent_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&agent_id_hash).ok()? as usize;
            let venue_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&venue_hash).ok()? as usize;
            let market_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&market_hash).ok()? as usize;
            let side_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&side_hash).ok()? as usize;
            let asset_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&asset_id_hash).ok()? as usize;
            let max_leverage_x100: u32 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&max_leverage_x100).ok()? as usize;
            let session_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&session_id_hash).ok()? as usize;
            let route_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&route_hash).ok()? as usize;
            let risk_check_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedAgentTradeApproval {
                policy_commitment,
                envelope_hash,
                amount_raw_le,
                agent_id_hash,
                venue_hash,
                market_hash,
                side_hash,
                asset_id_hash,
                max_leverage_x100,
                session_id_hash,
                route_hash,
                risk_check_hash,
            })
        }
        28 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let session_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&session_id_hash).ok()? as usize;
            let agent_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&agent_id_hash).ok()? as usize;
            let venue_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&venue_hash).ok()? as usize;
            let market_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&market_hash).ok()? as usize;
            let max_notional_raw_le: [u8; 16] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&max_notional_raw_le).ok()? as usize;
            let max_leverage_x100: u32 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&max_leverage_x100).ok()? as usize;
            let expires_at: i64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&expires_at).ok()? as usize;
            let status: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedAgentSessionGrant {
                policy_commitment,
                envelope_hash,
                session_id_hash,
                agent_id_hash,
                venue_hash,
                market_hash,
                max_notional_raw_le,
                max_leverage_x100,
                expires_at,
                status,
            })
        }
        29 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let session_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&session_id_hash).ok()? as usize;
            let oracle_policy_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&oracle_policy_hash).ok()? as usize;
            let max_loss_raw_le: [u8; 16] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&max_loss_raw_le).ok()? as usize;
            let status: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedAgentRiskPolicy {
                policy_commitment,
                envelope_hash,
                session_id_hash,
                oracle_policy_hash,
                max_loss_raw_le,
                status,
            })
        }
        30 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let session_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&session_id_hash).ok()? as usize;
            let execution_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&execution_id_hash).ok()? as usize;
            let settlement_artifact_hash: [u8; 32] =
                wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&settlement_artifact_hash).ok()? as usize;
            let oracle_policy_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&oracle_policy_hash).ok()? as usize;
            let closed_notional_raw_le: [u8; 16] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&closed_notional_raw_le).ok()? as usize;
            let outcome: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&outcome).ok()? as usize;
            let pnl_abs_raw_le: [u8; 16] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&pnl_abs_raw_le).ok()? as usize;
            let settlement_sequence: u64 = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedAgentTradeSettlement {
                policy_commitment,
                envelope_hash,
                session_id_hash,
                execution_id_hash,
                settlement_artifact_hash,
                oracle_policy_hash,
                closed_notional_raw_le,
                outcome,
                pnl_abs_raw_le,
                settlement_sequence,
            })
        }
        24 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let chain_kind: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&chain_kind).ok()? as usize;
            let amount_raw_le: [u8; 16] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&amount_raw_le).ok()? as usize;
            let recipient_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&recipient_hash).ok()? as usize;
            let asset_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&asset_id_hash).ok()? as usize;
            let tx_template_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedChainSend {
                policy_commitment,
                envelope_hash,
                chain_kind,
                amount_raw_le,
                recipient_hash,
                asset_id_hash,
                tx_template_hash,
            })
        }
        25 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let chain_kind: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&chain_kind).ok()? as usize;
            let amount_raw_le: [u8; 16] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&amount_raw_le).ok()? as usize;
            let recipient_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&recipient_hash).ok()? as usize;
            let asset_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&asset_id_hash).ok()? as usize;
            let tx_template_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&tx_template_hash).ok()? as usize;
            let message_approval_bump: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&message_approval_bump).ok()? as usize;
            let cpi_authority_bump: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&cpi_authority_bump).ok()? as usize;
            let blake2b_hashes: [u8; 96] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&blake2b_hashes).ok()? as usize;
            let params_data: TailBytes = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::IkaSignTypedChainSend {
                policy_commitment,
                envelope_hash,
                chain_kind,
                amount_raw_le,
                recipient_hash,
                asset_id_hash,
                tx_template_hash,
                message_approval_bump,
                cpi_authority_bump,
                blake2b_hashes,
                params_data,
            })
        }
        26 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let current_policy_commitment: [u8; 32] =
                wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&current_policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let chain_kind: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&chain_kind).ok()? as usize;
            let new_policy_bytes: DynVec<u8> = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedWalletPolicyUpdate {
                current_policy_commitment,
                envelope_hash,
                chain_kind,
                new_policy_bytes,
            })
        }
        27 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let action_kind: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&action_kind).ok()? as usize;
            let target_intent_index: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&target_intent_index).ok()? as usize;
            let new_intent_body: TailBytes = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedIntentGovernance {
                policy_commitment,
                envelope_hash,
                action_kind,
                target_intent_index,
                new_intent_body,
            })
        }
        6 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let chain_kind: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&chain_kind).ok()? as usize;
            let user_pubkey: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&user_pubkey).ok()? as usize;
            let signature_scheme: u16 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&signature_scheme).ok()? as usize;
            let cpi_authority_bump: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::BindDwallet {
                chain_kind,
                user_pubkey,
                signature_scheme,
                cpi_authority_bump,
            })
        }
        7 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let message_approval_bump: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&message_approval_bump).ok()? as usize;
            let cpi_authority_bump: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&cpi_authority_bump).ok()? as usize;
            let blake2b_hashes: [u8; 96] = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::IkaSign {
                message_approval_bump,
                cpi_authority_bump,
                blake2b_hashes,
            })
        }
        8 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let proposal_index: u64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&proposal_index).ok()? as usize;
            let expiry: i64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&expiry).ok()? as usize;
            let action_kind: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&action_kind).ok()? as usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let payload_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&payload_hash).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let proposer_pubkey: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&proposer_pubkey).ok()? as usize;
            let signature: [u8; 64] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&signature).ok()? as usize;
            let action_id: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&action_id).ok()? as usize;
            let nonce: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&nonce).ok()? as usize;
            let policy_bytes: DynVec<u8> = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_bytes).ok()? as usize;
            let clear_text: TailBytes = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ProposeTyped {
                proposal_index,
                expiry,
                action_kind,
                policy_commitment,
                payload_hash,
                envelope_hash,
                proposer_pubkey,
                signature,
                action_id,
                nonce,
                policy_bytes,
                clear_text,
            })
        }
        31 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let proposal_index: u64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&proposal_index).ok()? as usize;
            let signature: [u8; 64] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&signature).ok()? as usize;
            let policy_bytes: DynVec<u8> = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_bytes).ok()? as usize;
            let canonical_intent: TailBytes = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ProposeTypedV4 {
                proposal_index,
                signature,
                policy_bytes,
                canonical_intent,
            })
        }
        32 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let schedule_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&schedule_id_hash).ok()? as usize;
            let recipient: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&recipient).ok()? as usize;
            let amount_lamports: u64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&amount_lamports).ok()? as usize;
            let interval_seconds: u32 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&interval_seconds).ok()? as usize;
            let first_execution_at: i64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&first_execution_at).ok()? as usize;
            let payment_count: u32 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&payment_count).ok()? as usize;
            let status: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedRecurringSchedule {
                policy_commitment,
                envelope_hash,
                schedule_id_hash,
                recipient,
                amount_lamports,
                interval_seconds,
                first_execution_at,
                payment_count,
                status,
            })
        }
        33 => {
            let payload = &data[1..];
            let schedule_id_hash: [u8; 32] = wincode::deserialize(payload).ok()?;
            Some(ProgramInstruction::ExecuteRecurringPayment { schedule_id_hash })
        }
        34 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let schedule_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&schedule_id_hash).ok()? as usize;
            let amount_tokens: u64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&amount_tokens).ok()? as usize;
            let interval_seconds: u32 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&interval_seconds).ok()? as usize;
            let first_execution_at: i64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&first_execution_at).ok()? as usize;
            let payment_count: u32 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&payment_count).ok()? as usize;
            let status: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedRecurringTokenSchedule {
                policy_commitment,
                envelope_hash,
                schedule_id_hash,
                amount_tokens,
                interval_seconds,
                first_execution_at,
                payment_count,
                status,
            })
        }
        35 => {
            let payload = &data[1..];
            let schedule_id_hash: [u8; 32] = wincode::deserialize(payload).ok()?;
            Some(ProgramInstruction::ExecuteRecurringTokenPayment { schedule_id_hash })
        }
        9 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let approver_index: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&approver_index).ok()? as usize;
            let signature: [u8; 64] = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ApproveTyped {
                approver_index,
                signature,
            })
        }
        10 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let canceller_index: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&canceller_index).ok()? as usize;
            let signature: [u8; 64] = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::CancelTyped {
                canceller_index,
                signature,
            })
        }
        11 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let action_kind: u8 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&action_kind).ok()? as usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let payload_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&payload_hash).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTyped {
                action_kind,
                policy_commitment,
                payload_hash,
                envelope_hash,
            })
        }
        12 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let amount_lamports: u64 = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&amount_lamports).ok()? as usize;
            let escrow_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&escrow_id_hash).ok()? as usize;
            let milestone_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedEscrowRelease {
                policy_commitment,
                envelope_hash,
                amount_lamports,
                escrow_id_hash,
                milestone_id_hash,
            })
        }
        13 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let escrow_id_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&escrow_id_hash).ok()? as usize;
            let amount_lamports_le: TailBytes = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedEscrowReturn {
                policy_commitment,
                envelope_hash,
                escrow_id_hash,
                amount_lamports_le,
            })
        }
        14 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let amount_lamports: u64 = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedSolSend {
                policy_commitment,
                envelope_hash,
                amount_lamports,
            })
        }
        15 => {
            let payload = &data[1..];
            let mut offset = 0usize;
            let policy_commitment: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&policy_commitment).ok()? as usize;
            let envelope_hash: [u8; 32] = wincode::deserialize(&payload[offset..]).ok()?;
            offset += wincode::serialized_size(&envelope_hash).ok()? as usize;
            let amount_lamports_le: TailBytes = wincode::deserialize(&payload[offset..]).ok()?;
            Some(ProgramInstruction::ExecuteTypedSolBatchSend {
                policy_commitment,
                envelope_hash,
                amount_lamports_le,
            })
        }
        _ => None,
    }
}
