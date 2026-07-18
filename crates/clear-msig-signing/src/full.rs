use super::*;

pub(super) fn render_full_document(
    intent: &CanonicalIntent<'_>,
    wallet_name: &[u8],
    out: &mut [u8],
) -> Result<usize, Error> {
    validate_visible_ascii(wallet_name, 64, false)?;
    let mut writer = Writer::new(out);
    match intent.action {
        Action::Transfer(transfer) => {
            writer.push(b"ClearSig Approval\n\nACTION\nSend ")?;
            writer.amount(transfer.raw_amount, transfer.decimals)?;
            writer.push(b" ")?;
            writer.push(display_asset(transfer))?;
            writer.push(b"\n\nDETAILS\nFrom wallet: ")?;
            writer.push(wallet_name)?;
            writer.push(b"\nNetwork: ")?;
            writer.push(intent.common.network.display_name())?;
            writer.push(b"\nAmount: ")?;
            writer.amount(transfer.raw_amount, transfer.decimals)?;
            writer.push(b" ")?;
            writer.push(display_asset(transfer))?;
            writer.push(b"\nTo: ")?;
            writer.identity(transfer.recipient_encoding, transfer.recipient)?;
            if transfer.asset_encoding != IdentityEncoding::Text {
                writer.push(b"\nAsset ID: ")?;
                writer.push(transfer.asset)?;
            }
            if transfer.execution_commitment != [0u8; 32] {
                writer.push(b"\nExecution template: ")?;
                writer.hex(&transfer.execution_commitment)?;
            }
            if let Some(estimate) = transfer.fiat_estimate()? {
                writer.push(b"\nEstimated at review: ")?;
                writer.push(estimate.amount)?;
                writer.push(b" ")?;
                writer.push(estimate.currency)?;
                writer.push(b" (informational)")?;
                writer.push(b"\nPrice source: ")?;
                writer.push(estimate.source)?;
                writer.push(b"\nPrice observed: ")?;
                writer.decimal_u128(estimate.observed_at as u128)?;
                writer.push(b" Unix seconds")?;
            }
        }
        Action::BatchTransfer(batch) => {
            writer.push(b"ClearSig Approval\n\nACTION\nSend batch of ")?;
            writer.decimal_u128(batch.row_count as u128)?;
            writer.push(b" payments\n\nDETAILS\nFrom wallet: ")?;
            writer.push(wallet_name)?;
            writer.push(b"\nNetwork: ")?;
            writer.push(intent.common.network.display_name())?;
            for (index, row) in batch.rows().enumerate() {
                writer.push(b"\nPayment ")?;
                writer.decimal_u128(index as u128 + 1)?;
                writer.push(b": ")?;
                writer.amount(row.raw_amount, row.decimals)?;
                writer.push(b" ")?;
                writer.push(display_asset(row))?;
                writer.push(b" to ")?;
                writer.identity(row.recipient_encoding, row.recipient)?;
                if row.asset_encoding != IdentityEncoding::Text {
                    writer.push(b" (asset ")?;
                    writer.push(row.asset)?;
                    writer.push(b")")?;
                }
            }
        }
        Action::Governance(governance) => {
            writer.push(b"ClearSig Approval\n\nACTION\n")?;
            writer.push(match governance.kind {
                ActionKind::AddMember => b"Update member authority",
                ActionKind::RemoveMember => b"Remove member authority",
                ActionKind::ChangeThreshold => b"Change approval rules",
                _ => return Err(Error::UnsupportedAction),
            })?;
            writer.push(b"\n\nDETAILS\nWallet: ")?;
            writer.push(wallet_name)?;
            writer.push(b"\nNetwork: ")?;
            writer.push(intent.common.network.display_name())?;
            writer.push(b"\nTarget intent: #")?;
            writer.decimal_u128(governance.target_intent_index as u128)?;
            writer.push(b"\nApproval threshold: ")?;
            writer.decimal_u128(governance.approval_threshold as u128)?;
            writer.push(b"\nCancellation threshold: ")?;
            writer.decimal_u128(governance.cancellation_threshold as u128)?;
            writer.push(b"\nTimelock seconds: ")?;
            writer.decimal_u128(governance.timelock_seconds as u128)?;
            writer.push(b"\nFinal proposers: ")?;
            writer.pubkeys(governance.proposers, governance.proposer_count)?;
            writer.push(b"\nFinal approvers: ")?;
            writer.pubkeys(governance.approvers, governance.approver_count)?;
        }
        Action::PolicyUpdate(policy) => {
            writer.push(b"ClearSig Approval\n\nACTION\nReplace wallet protection policy")?;
            writer.push(b"\n\nDETAILS\nWallet: ")?;
            writer.push(wallet_name)?;
            writer.push(b"\nNetwork: ")?;
            writer.push(intent.common.network.display_name())?;
            writer.push(b"\nPolicy chain kind: ")?;
            writer.decimal_u128(policy.chain_kind as u128)?;
            writer.push(b"\nNew policy commitment: ")?;
            writer.hex(&policy.new_policy_commitment)?;
        }
        Action::EscrowRelease(escrow) => {
            writer.push(b"ClearSig Approval\n\nACTION\nRelease escrow milestone")?;
            writer.push(b"\n\nDETAILS\nWallet: ")?;
            writer.push(wallet_name)?;
            writer.push(b"\nNetwork: ")?;
            writer.push(intent.common.network.display_name())?;
            writer.push(b"\nEscrow: ")?;
            writer.push(escrow.escrow_title)?;
            writer.push(b"\nEscrow ID: ")?;
            writer.push(escrow.escrow_id)?;
            writer.push(b"\nMilestone: ")?;
            writer.push(escrow.milestone_title)?;
            writer.push(b"\nMilestone ID: ")?;
            writer.push(escrow.milestone_id)?;
            writer.push(b"\nAmount: ")?;
            writer.amount(escrow.payment.raw_amount, escrow.payment.decimals)?;
            writer.push(b" ")?;
            writer.push(display_asset(escrow.payment))?;
            writer.push(b"\nRecipient: ")?;
            writer.identity(escrow.payment.recipient_encoding, escrow.payment.recipient)?;
            if escrow.execution_commitment != [0u8; 32] {
                writer.push(b"\nExecution evidence: ")?;
                writer.hex(&escrow.execution_commitment)?;
            }
        }
        Action::EscrowReturn(escrow) => {
            writer.push(b"ClearSig Approval\n\nACTION\nReturn escrow funds")?;
            writer.push(b"\n\nDETAILS\nWallet: ")?;
            writer.push(wallet_name)?;
            writer.push(b"\nNetwork: ")?;
            writer.push(intent.common.network.display_name())?;
            writer.push(b"\nEscrow: ")?;
            writer.push(escrow.escrow_title)?;
            writer.push(b"\nEscrow ID: ")?;
            writer.push(escrow.escrow_id)?;
            for (index, row) in escrow.rows().enumerate() {
                writer.push(b"\nReturn ")?;
                writer.decimal_u128(index as u128 + 1)?;
                writer.push(b": ")?;
                writer.amount(row.raw_amount, row.decimals)?;
                writer.push(b" ")?;
                writer.push(display_asset(row))?;
                writer.push(b" to ")?;
                writer.identity(row.recipient_encoding, row.recipient)?;
            }
            if escrow.execution_commitment != [0u8; 32] {
                writer.push(b"\nExecution evidence: ")?;
                writer.hex(&escrow.execution_commitment)?;
            }
        }
        Action::AgentTradeApproval(agent) => {
            writer.push(b"ClearSig Approval\n\nACTION\nApprove agent trade")?;
            writer.push(b"\n\nDETAILS\nWallet: ")?;
            writer.push(wallet_name)?;
            writer.push(b"\nNetwork: ")?;
            writer.push(intent.common.network.display_name())?;
            writer.push(b"\nAgent: ")?;
            writer.push(agent.agent_id)?;
            writer.push(b"\nVenue: ")?;
            writer.push(agent.venue)?;
            writer.push(b"\nMarket: ")?;
            writer.push(agent.market)?;
            writer.push(b"\nSide: ")?;
            writer.push(agent.side)?;
            writer.push(b"\nAsset ID: ")?;
            writer.push(agent.asset_id)?;
            writer.push(b"\nMaximum notional: ")?;
            writer.amount(agent.max_notional_raw, 6)?;
            writer.push(b" USD\nMaximum leverage: ")?;
            writer.amount(agent.max_leverage_x100 as u128, 2)?;
            writer.push(b"x\nSession: ")?;
            writer.push(agent.session_id)?;
            writer.push(b"\nRoute: ")?;
            writer.push(agent.route)?;
            writer.push(b"\nRisk check: ")?;
            writer.hex(&agent.risk_check_hash)?;
        }
        Action::AgentSession(agent) => {
            writer.push(b"ClearSig Approval\n\nACTION\n")?;
            writer.push(if agent.status == 1 {
                b"Grant agent session"
            } else {
                b"Revoke agent session"
            })?;
            writer.push(b"\n\nDETAILS\nWallet: ")?;
            writer.push(wallet_name)?;
            writer.push(b"\nNetwork: ")?;
            writer.push(intent.common.network.display_name())?;
            writer.push(b"\nSession: ")?;
            writer.push(agent.session_id)?;
            writer.push(b"\nAgent: ")?;
            writer.push(agent.agent_id)?;
            writer.push(b"\nVenue: ")?;
            writer.push(agent.venue)?;
            writer.push(b"\nMarket: ")?;
            writer.push(agent.market)?;
            writer.push(b"\nMaximum notional: ")?;
            writer.amount(agent.max_notional_raw, 6)?;
            writer.push(b" USD\nMaximum leverage: ")?;
            writer.amount(agent.max_leverage_x100 as u128, 2)?;
            writer.push(b"x\nSession expiry (Unix): ")?;
            writer.signed_decimal_i64(agent.session_expires_at)?;
        }
        Action::AgentRiskPolicy(agent) => {
            writer.push(b"ClearSig Approval\n\nACTION\n")?;
            writer.push(if agent.status == 1 {
                b"Set agent risk policy"
            } else {
                b"Pause agent risk policy"
            })?;
            writer.push(b"\n\nDETAILS\nWallet: ")?;
            writer.push(wallet_name)?;
            writer.push(b"\nNetwork: ")?;
            writer.push(intent.common.network.display_name())?;
            writer.push(b"\nSession: ")?;
            writer.push(agent.session_id)?;
            writer.push(b"\nMaximum realized loss (raw): ")?;
            writer.decimal_u128(agent.max_loss_raw)?;
            writer.push(b"\nOracle policy: ")?;
            writer.hex(&agent.oracle_policy_hash)?;
        }
        Action::AgentSettlement(agent) => {
            writer.push(b"ClearSig Approval\n\nACTION\nSettle agent execution")?;
            writer.push(b"\n\nDETAILS\nWallet: ")?;
            writer.push(wallet_name)?;
            writer.push(b"\nNetwork: ")?;
            writer.push(intent.common.network.display_name())?;
            writer.push(b"\nSession: ")?;
            writer.push(agent.session_id)?;
            writer.push(b"\nExecution: ")?;
            writer.push(agent.execution_id)?;
            writer.push(b"\nClosed notional (raw): ")?;
            writer.decimal_u128(agent.closed_notional_raw)?;
            writer.push(b"\nOutcome: ")?;
            writer.push(match agent.outcome {
                1 => b"profit",
                2 => b"loss",
                3 => b"flat",
                _ => return Err(Error::InvalidContext),
            })?;
            writer.push(b"\nAbsolute P/L (raw): ")?;
            writer.decimal_u128(agent.pnl_abs_raw)?;
            writer.push(b"\nSettlement sequence: ")?;
            writer.decimal_u128(agent.settlement_sequence as u128)?;
            writer.push(b"\nSettlement artifact: ")?;
            writer.hex(&agent.settlement_artifact_hash)?;
            writer.push(b"\nOracle policy: ")?;
            writer.hex(&agent.oracle_policy_hash)?;
        }
        Action::RecurringSchedule(schedule) => {
            writer.push(b"ClearSig Approval\n\nACTION\n")?;
            writer.push(if schedule.status == 1 {
                b"Create recurring payment"
            } else {
                b"Revoke recurring payment"
            })?;
            writer.push(b"\n\nDETAILS\nWallet: ")?;
            writer.push(wallet_name)?;
            writer.push(b"\nNetwork: ")?;
            writer.push(intent.common.network.display_name())?;
            writer.push(b"\nSchedule: ")?;
            writer.push(schedule.schedule_id)?;
            writer.push(b"\nAmount per payment: ")?;
            writer.amount(schedule.payment.raw_amount, schedule.payment.decimals)?;
            writer.push(b" ")?;
            writer.push(display_asset(schedule.payment))?;
            writer.push(b"\nRecipient: ")?;
            writer.identity(
                schedule.payment.recipient_encoding,
                schedule.payment.recipient,
            )?;
            writer.push(b"\nCadence seconds: ")?;
            writer.decimal_u128(schedule.interval_seconds as u128)?;
            writer.push(b"\nFirst payment (Unix): ")?;
            writer.signed_decimal_i64(schedule.first_execution_at)?;
            writer.push(b"\nMaximum payments: ")?;
            writer.decimal_u128(schedule.payment_count as u128)?;
        }
    }
    write_review_footer(&mut writer, intent)?;
    if writer.len > intent.common.profile.max_document_bytes() {
        return Err(Error::MessageTooLong);
    }
    Ok(writer.len)
}
