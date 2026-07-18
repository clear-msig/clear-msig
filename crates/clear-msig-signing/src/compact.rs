use super::*;

pub(super) fn render_compact_document(
    intent: &CanonicalIntent<'_>,
    wallet_name: &[u8],
    out: &mut [u8],
) -> Result<usize, Error> {
    validate_visible_ascii(wallet_name, 64, false)?;
    let mut writer = Writer::new(out);
    writer.push(b"ClearSig v4\n")?;
    match intent.action {
        Action::Transfer(transfer) => {
            writer.push(b"SEND ")?;
            writer.amount(transfer.raw_amount, transfer.decimals)?;
            writer.push(b" ")?;
            writer.push(display_asset(transfer))?;
            writer.push(b"\nTO ")?;
            writer.identity(transfer.recipient_encoding, transfer.recipient)?;
            if transfer.asset_encoding != IdentityEncoding::Text {
                writer.push(b"\nASSET ")?;
                writer.push(transfer.asset)?;
            }
            if transfer.execution_commitment != [0u8; 32] {
                writer.push(b"\nEXEC ")?;
                writer.hex(&transfer.execution_commitment)?;
            }
        }
        Action::BatchTransfer(batch) => {
            writer.push(b"BATCH ")?;
            writer.decimal_u128(batch.row_count as u128)?;
            for (index, row) in batch.rows().enumerate() {
                writer.push(b"\n")?;
                writer.decimal_u128(index as u128 + 1)?;
                writer.push(b" ")?;
                writer.amount(row.raw_amount, row.decimals)?;
                writer.push(b" ")?;
                writer.push(display_asset(row))?;
                writer.push(b" TO ")?;
                writer.identity(row.recipient_encoding, row.recipient)?;
                if row.asset_encoding != IdentityEncoding::Text {
                    writer.push(b" ASSET ")?;
                    writer.push(row.asset)?;
                }
            }
        }
        Action::Governance(governance) => {
            writer.push(match governance.kind {
                ActionKind::AddMember => b"ADD MEMBER",
                ActionKind::RemoveMember => b"REMOVE MEMBER",
                ActionKind::ChangeThreshold => b"CHANGE THRESHOLD",
                _ => return Err(Error::UnsupportedAction),
            })?;
            writer.push(b"\nTARGET INTENT ")?;
            writer.decimal_u128(governance.target_intent_index as u128)?;
            writer.push(b"\nAPPROVE ")?;
            writer.decimal_u128(governance.approval_threshold as u128)?;
            writer.push(b" CANCEL ")?;
            writer.decimal_u128(governance.cancellation_threshold as u128)?;
            writer.push(b" DELAY ")?;
            writer.decimal_u128(governance.timelock_seconds as u128)?;
            writer.push(b"\nPROPOSERS ")?;
            writer.pubkeys(governance.proposers, governance.proposer_count)?;
            writer.push(b"\nAPPROVERS ")?;
            writer.pubkeys(governance.approvers, governance.approver_count)?;
        }
        Action::PolicyUpdate(policy) => {
            writer.push(b"POLICY UPDATE\nCHAIN ")?;
            writer.decimal_u128(policy.chain_kind as u128)?;
            writer.push(b"\nNEW ")?;
            writer.hex(&policy.new_policy_commitment)?;
        }
        Action::EscrowRelease(escrow) => {
            writer.push(b"ESCROW RELEASE\nESCROW ")?;
            writer.push(escrow.escrow_id)?;
            writer.push(b"\nMILESTONE ")?;
            writer.push(escrow.milestone_id)?;
            writer.push(b"\nSEND ")?;
            writer.amount(escrow.payment.raw_amount, escrow.payment.decimals)?;
            writer.push(b" ")?;
            writer.push(display_asset(escrow.payment))?;
            writer.push(b" TO ")?;
            writer.identity(escrow.payment.recipient_encoding, escrow.payment.recipient)?;
            if escrow.execution_commitment != [0u8; 32] {
                writer.push(b"\nEVIDENCE ")?;
                writer.hex(&escrow.execution_commitment)?;
            }
        }
        Action::EscrowReturn(escrow) => {
            writer.push(b"ESCROW RETURN\nESCROW ")?;
            writer.push(escrow.escrow_id)?;
            for (index, row) in escrow.rows().enumerate() {
                writer.push(b"\n")?;
                writer.decimal_u128(index as u128 + 1)?;
                writer.push(b" ")?;
                writer.amount(row.raw_amount, row.decimals)?;
                writer.push(b" ")?;
                writer.push(display_asset(row))?;
                writer.push(b" TO ")?;
                writer.identity(row.recipient_encoding, row.recipient)?;
            }
            if escrow.execution_commitment != [0u8; 32] {
                writer.push(b"\nEVIDENCE ")?;
                writer.hex(&escrow.execution_commitment)?;
            }
        }
        Action::AgentTradeApproval(agent) => {
            writer.push(b"AGENT TRADE\nAGENT ")?;
            writer.push(agent.agent_id)?;
            writer.push(b"\nVENUE ")?;
            writer.push(agent.venue)?;
            writer.push(b"\nMARKET ")?;
            writer.push(agent.market)?;
            writer.push(b"\nSIDE ")?;
            writer.push(agent.side)?;
            writer.push(b"\nASSET ")?;
            writer.push(agent.asset_id)?;
            writer.push(b"\nMAX NOTIONAL ")?;
            writer.decimal_u128(agent.max_notional_raw)?;
            writer.push(b"\nMAX LEVERAGE X100 ")?;
            writer.decimal_u128(agent.max_leverage_x100 as u128)?;
            writer.push(b"\nSESSION ")?;
            writer.push(agent.session_id)?;
            writer.push(b"\nROUTE ")?;
            writer.push(agent.route)?;
            writer.push(b"\nRISK ")?;
            writer.hex(&agent.risk_check_hash)?;
        }
        Action::AgentSession(agent) => {
            writer.push(if agent.status == 1 {
                b"AGENT GRANT"
            } else {
                b"AGENT REVOKE"
            })?;
            writer.push(b"\nSESSION ")?;
            writer.push(agent.session_id)?;
            writer.push(b"\nAGENT ")?;
            writer.push(agent.agent_id)?;
            writer.push(b"\nVENUE ")?;
            writer.push(agent.venue)?;
            writer.push(b"\nMARKET ")?;
            writer.push(agent.market)?;
            writer.push(b"\nMAX NOTIONAL ")?;
            writer.decimal_u128(agent.max_notional_raw)?;
            writer.push(b"\nMAX LEVERAGE X100 ")?;
            writer.decimal_u128(agent.max_leverage_x100 as u128)?;
            writer.push(b"\nSESSION EXPIRES ")?;
            writer.signed_decimal_i64(agent.session_expires_at)?;
        }
        Action::AgentRiskPolicy(agent) => {
            writer.push(if agent.status == 1 {
                b"AGENT RISK SET"
            } else {
                b"AGENT RISK PAUSE"
            })?;
            writer.push(b"\nSESSION ")?;
            writer.push(agent.session_id)?;
            writer.push(b"\nMAX LOSS ")?;
            writer.decimal_u128(agent.max_loss_raw)?;
            writer.push(b"\nORACLE ")?;
            writer.hex(&agent.oracle_policy_hash)?;
        }
        Action::AgentSettlement(agent) => {
            writer.push(b"AGENT SETTLEMENT\nSESSION ")?;
            writer.push(agent.session_id)?;
            writer.push(b"\nEXECUTION ")?;
            writer.push(agent.execution_id)?;
            writer.push(b"\nCLOSED NOTIONAL ")?;
            writer.decimal_u128(agent.closed_notional_raw)?;
            writer.push(b"\nOUTCOME ")?;
            writer.push(match agent.outcome {
                1 => b"PROFIT",
                2 => b"LOSS",
                3 => b"FLAT",
                _ => return Err(Error::InvalidContext),
            })?;
            writer.push(b"\nABS PNL ")?;
            writer.decimal_u128(agent.pnl_abs_raw)?;
            writer.push(b"\nSEQUENCE ")?;
            writer.decimal_u128(agent.settlement_sequence as u128)?;
            writer.push(b"\nARTIFACT ")?;
            writer.hex(&agent.settlement_artifact_hash)?;
            writer.push(b"\nORACLE ")?;
            writer.hex(&agent.oracle_policy_hash)?;
        }
        Action::RecurringSchedule(schedule) => {
            writer.push(if schedule.status == 1 {
                b"RECURRING CREATE"
            } else {
                b"RECURRING REVOKE"
            })?;
            writer.push(b"\nSCHEDULE ")?;
            writer.push(schedule.schedule_id)?;
            writer.push(b"\nPAY ")?;
            writer.amount(schedule.payment.raw_amount, schedule.payment.decimals)?;
            writer.push(b" ")?;
            writer.push(display_asset(schedule.payment))?;
            writer.push(b" TO ")?;
            writer.identity(
                schedule.payment.recipient_encoding,
                schedule.payment.recipient,
            )?;
            writer.push(b"\nEVERY ")?;
            writer.decimal_u128(schedule.interval_seconds as u128)?;
            writer.push(b" SECONDS\nFIRST ")?;
            writer.signed_decimal_i64(schedule.first_execution_at)?;
            writer.push(b"\nCOUNT ")?;
            writer.decimal_u128(schedule.payment_count as u128)?;
        }
    }
    writer.push(b"\nNET ")?;
    writer.push(intent.common.network.display_name())?;
    writer.push(b"\nFROM ")?;
    writer.push(wallet_name)?;
    writer.push(b"\nAPPROVAL ")?;
    writer.decimal_u128(intent.common.approval_required as u128)?;
    writer.push(b"\nPROPOSAL ")?;
    writer.decimal_u128(intent.common.proposal_index as u128)?;
    writer.push(b"\nEXPIRES ")?;
    writer.signed_decimal_i64(intent.common.expires_at)?;
    writer.push(b"\nPOLICY ")?;
    writer.hex(&intent.common.policy_commitment)?;
    writer.push(b"\nPROFILE ")?;
    writer.push(intent.common.profile.display_label())?;
    writer.push(b"\n")?;
    writer.push(DOCUMENT_PROTOCOL_MARKER)?;
    if writer.len > intent.common.profile.max_document_bytes() {
        return Err(Error::MessageTooLong);
    }
    Ok(writer.len)
}
