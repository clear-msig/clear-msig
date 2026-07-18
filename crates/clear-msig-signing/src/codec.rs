use super::*;

pub fn encode_transfer(input: &TransferInput<'_>, out: &mut [u8]) -> Result<usize, Error> {
    validate_transfer_input(input)?;
    let mut writer = Writer::new(out);
    write_common(&mut writer, &input.common, ActionKind::Send)?;
    write_transfer_row(
        &mut writer,
        &TransferRowInput {
            recipient_encoding: input.recipient_encoding,
            recipient: input.recipient,
            asset_encoding: input.asset_encoding,
            asset: input.asset,
            raw_amount: input.raw_amount,
            decimals: input.decimals,
            display_asset: input.display_asset,
        },
    )?;
    writer.push(&input.execution_commitment)?;
    write_fiat_estimate(&mut writer, input.fiat_estimate)?;
    writer.bytes(input.reason)?;
    Ok(writer.len)
}

pub fn encode_batch_transfer(
    input: &BatchTransferInput<'_>,
    out: &mut [u8],
) -> Result<usize, Error> {
    if input.rows.is_empty() || input.rows.len() > 16 {
        return Err(Error::InvalidLength);
    }
    validate_visible_ascii(input.reason, MAX_REASON_BYTES, true)?;
    let mut writer = Writer::new(out);
    write_common(&mut writer, &input.common, ActionKind::BatchSend)?;
    writer.u8(input.rows.len() as u8)?;
    for row in input.rows {
        validate_transfer_row(row)?;
        write_transfer_row(&mut writer, row)?;
    }
    writer.bytes(input.reason)?;
    Ok(writer.len)
}

pub fn encode_escrow_release(
    input: &EscrowReleaseInput<'_>,
    out: &mut [u8],
) -> Result<usize, Error> {
    validate_visible_ascii(input.escrow_id, 96, false)?;
    validate_visible_ascii(input.escrow_title, 96, false)?;
    validate_visible_ascii(input.milestone_id, 96, false)?;
    validate_visible_ascii(input.milestone_title, 96, false)?;
    validate_transfer_row(&input.payment)?;
    validate_visible_ascii(input.reason, MAX_REASON_BYTES, true)?;
    let mut writer = Writer::new(out);
    write_common(&mut writer, &input.common, ActionKind::ReleaseMilestone)?;
    writer.bytes(input.escrow_id)?;
    writer.bytes(input.escrow_title)?;
    writer.bytes(input.milestone_id)?;
    writer.bytes(input.milestone_title)?;
    write_transfer_row(&mut writer, &input.payment)?;
    writer.push(&input.execution_commitment)?;
    writer.bytes(input.reason)?;
    Ok(writer.len)
}

pub fn encode_escrow_return(input: &EscrowReturnInput<'_>, out: &mut [u8]) -> Result<usize, Error> {
    if input.rows.is_empty() || input.rows.len() > 16 {
        return Err(Error::InvalidLength);
    }
    validate_visible_ascii(input.escrow_id, 96, false)?;
    validate_visible_ascii(input.escrow_title, 96, false)?;
    validate_visible_ascii(input.reason, MAX_REASON_BYTES, true)?;
    let mut writer = Writer::new(out);
    write_common(&mut writer, &input.common, ActionKind::ReturnEscrowFunds)?;
    writer.bytes(input.escrow_id)?;
    writer.bytes(input.escrow_title)?;
    writer.u8(input.rows.len() as u8)?;
    for row in input.rows {
        validate_transfer_row(row)?;
        write_transfer_row(&mut writer, row)?;
    }
    writer.push(&input.execution_commitment)?;
    writer.bytes(input.reason)?;
    Ok(writer.len)
}

pub fn encode_governance(input: &GovernanceInput<'_>, out: &mut [u8]) -> Result<usize, Error> {
    if !matches!(
        input.kind,
        ActionKind::AddMember | ActionKind::RemoveMember | ActionKind::ChangeThreshold
    ) || input.proposers.is_empty()
        || input.proposers.len() > 16
        || input.approvers.is_empty()
        || input.approvers.len() > 16
        || input.approval_threshold == 0
        || input.approval_threshold as usize > input.approvers.len()
        || input.cancellation_threshold == 0
        || input.cancellation_threshold as usize > input.approvers.len()
    {
        return Err(Error::InvalidContext);
    }
    validate_visible_ascii(input.reason, MAX_REASON_BYTES, true)?;
    let mut writer = Writer::new(out);
    write_common(&mut writer, &input.common, input.kind)?;
    writer.u8(input.target_intent_index)?;
    writer.u8(input.approval_threshold)?;
    writer.u8(input.cancellation_threshold)?;
    writer.u32(input.timelock_seconds)?;
    writer.u8(input.proposers.len() as u8)?;
    for proposer in input.proposers {
        writer.push(proposer)?;
    }
    writer.u8(input.approvers.len() as u8)?;
    for approver in input.approvers {
        writer.push(approver)?;
    }
    writer.bytes(input.reason)?;
    Ok(writer.len)
}

pub fn encode_policy_update(input: &PolicyUpdateInput<'_>, out: &mut [u8]) -> Result<usize, Error> {
    if input.chain_kind != input.common.network.chain_kind() {
        return Err(Error::InvalidContext);
    }
    validate_visible_ascii(input.reason, MAX_REASON_BYTES, true)?;
    let mut writer = Writer::new(out);
    write_common(&mut writer, &input.common, ActionKind::SetProtection)?;
    writer.u8(input.chain_kind)?;
    writer.push(&input.new_policy_commitment)?;
    writer.bytes(input.reason)?;
    Ok(writer.len)
}

pub fn parse_intent(bytes: &[u8]) -> Result<CanonicalIntent<'_>, Error> {
    if bytes.len() > MAX_CANONICAL_INTENT_BYTES {
        return Err(Error::InvalidLength);
    }
    let mut reader = Reader::new(bytes);
    if reader.take(8)? != INTENT_MAGIC {
        return Err(Error::InvalidMagic);
    }
    if reader.u8()? != INTENT_VERSION {
        return Err(Error::UnsupportedVersion);
    }
    let profile = DeviceProfile::from_code(reader.u8()?)?;
    let kind = ActionKind::from_code(reader.u8()?)?;
    let network = Network::from_code(reader.u8()?)?;
    let proposal_index = reader.u64()?;
    let wallet_id = reader.array32()?;
    let actor = reader.array32()?;
    let action_id = reader.array32()?;
    let nonce = reader.array32()?;
    let expires_at = reader.i64()?;
    let policy_commitment = reader.array32()?;
    let approval_required = reader.u8()?;
    if approval_required == 0 || approval_required > 16 {
        return Err(Error::InvalidContext);
    }
    let common = CommonFields {
        profile,
        network,
        proposal_index,
        wallet_id,
        actor,
        action_id,
        nonce,
        expires_at,
        policy_commitment,
        approval_required,
    };
    let action = match kind {
        ActionKind::Send => {
            let mut transfer = read_transfer_row(&mut reader)?;
            transfer.execution_commitment = reader.array32()?;
            transfer.encoded_fiat_estimate = read_fiat_estimate_bytes(&mut reader)?;
            Action::Transfer(transfer)
        }
        ActionKind::BatchSend => {
            let row_count = reader.u8()?;
            if row_count == 0 || row_count > 16 {
                return Err(Error::InvalidLength);
            }
            let rows_start = reader.remaining();
            for _ in 0..row_count {
                read_transfer_row(&mut reader)?;
            }
            let consumed = rows_start.len() - reader.remaining().len();
            Action::BatchTransfer(BatchTransfer {
                encoded_rows: &rows_start[..consumed],
                row_count,
            })
        }
        ActionKind::AddMember | ActionKind::RemoveMember | ActionKind::ChangeThreshold => {
            let target_intent_index = reader.u8()?;
            let approval_threshold = reader.u8()?;
            let cancellation_threshold = reader.u8()?;
            let timelock_seconds = reader.u32()?;
            let proposer_count = reader.u8()?;
            if proposer_count == 0 || proposer_count > 16 {
                return Err(Error::InvalidContext);
            }
            let proposers = reader.take(proposer_count as usize * 32)?;
            let approver_count = reader.u8()?;
            if approver_count == 0
                || approver_count > 16
                || approval_threshold == 0
                || approval_threshold > approver_count
                || cancellation_threshold == 0
                || cancellation_threshold > approver_count
            {
                return Err(Error::InvalidContext);
            }
            let approvers = reader.take(approver_count as usize * 32)?;
            Action::Governance(Governance {
                kind,
                target_intent_index,
                approval_threshold,
                cancellation_threshold,
                timelock_seconds,
                proposers,
                proposer_count,
                approvers,
                approver_count,
            })
        }
        ActionKind::SetProtection => {
            let chain_kind = reader.u8()?;
            let new_policy_commitment = reader.array32()?;
            if chain_kind != network.chain_kind() {
                return Err(Error::InvalidContext);
            }
            Action::PolicyUpdate(PolicyUpdate {
                chain_kind,
                new_policy_commitment,
            })
        }
        ActionKind::ReleaseMilestone => {
            let escrow_id = read_ascii(&mut reader, 96)?;
            let escrow_title = read_ascii(&mut reader, 96)?;
            let milestone_id = read_ascii(&mut reader, 96)?;
            let milestone_title = read_ascii(&mut reader, 96)?;
            let payment = read_transfer_row(&mut reader)?;
            let execution_commitment = reader.array32()?;
            Action::EscrowRelease(EscrowRelease {
                escrow_id,
                escrow_title,
                milestone_id,
                milestone_title,
                payment,
                execution_commitment,
            })
        }
        ActionKind::ReturnEscrowFunds => {
            let escrow_id = read_ascii(&mut reader, 96)?;
            let escrow_title = read_ascii(&mut reader, 96)?;
            let row_count = reader.u8()?;
            if row_count == 0 || row_count > 16 {
                return Err(Error::InvalidLength);
            }
            let rows_start = reader.remaining();
            for _ in 0..row_count {
                read_transfer_row(&mut reader)?;
            }
            let consumed = rows_start.len() - reader.remaining().len();
            let execution_commitment = reader.array32()?;
            Action::EscrowReturn(EscrowReturn {
                escrow_id,
                escrow_title,
                encoded_rows: &rows_start[..consumed],
                row_count,
                execution_commitment,
            })
        }
        ActionKind::AgentTradeApproval => {
            let agent_id = read_ascii(&mut reader, 96)?;
            let venue = read_ascii(&mut reader, 96)?;
            let market = read_ascii(&mut reader, 96)?;
            let side = read_ascii(&mut reader, 96)?;
            let asset_id = read_ascii(&mut reader, 96)?;
            let max_notional_raw = reader.u128()?;
            let max_leverage_x100 = reader.u32()?;
            let session_id = read_ascii(&mut reader, 96)?;
            let route = read_ascii(&mut reader, 96)?;
            let risk_check_hash = reader.array32()?;
            if !matches!(side, b"long" | b"short")
                || max_notional_raw == 0
                || max_leverage_x100 == 0
            {
                return Err(Error::InvalidAmount);
            }
            Action::AgentTradeApproval(AgentTradeApproval {
                agent_id,
                venue,
                market,
                side,
                asset_id,
                max_notional_raw,
                max_leverage_x100,
                session_id,
                route,
                risk_check_hash,
            })
        }
        ActionKind::AgentSessionGrant => {
            let session_id = read_ascii(&mut reader, 96)?;
            let agent_id = read_ascii(&mut reader, 96)?;
            let venue = read_ascii(&mut reader, 96)?;
            let market = read_ascii(&mut reader, 96)?;
            let max_notional_raw = reader.u128()?;
            let max_leverage_x100 = reader.u32()?;
            let session_expires_at = reader.i64()?;
            let status = reader.u8()?;
            if max_notional_raw == 0 || max_leverage_x100 == 0 || !matches!(status, 1 | 2) {
                return Err(Error::InvalidContext);
            }
            Action::AgentSession(AgentSession {
                session_id,
                agent_id,
                venue,
                market,
                max_notional_raw,
                max_leverage_x100,
                session_expires_at,
                status,
            })
        }
        ActionKind::AgentRiskPolicy => {
            let session_id = read_ascii(&mut reader, 96)?;
            let oracle_policy_hash = reader.array32()?;
            let max_loss_raw = reader.u128()?;
            let status = reader.u8()?;
            if !matches!(status, 1 | 2) || (status == 1 && max_loss_raw == 0) {
                return Err(Error::InvalidContext);
            }
            Action::AgentRiskPolicy(AgentRiskPolicy {
                session_id,
                oracle_policy_hash,
                max_loss_raw,
                status,
            })
        }
        ActionKind::AgentTradeSettlement => {
            let session_id = read_ascii(&mut reader, 96)?;
            let execution_id = read_ascii(&mut reader, 96)?;
            let settlement_artifact_hash = reader.array32()?;
            let oracle_policy_hash = reader.array32()?;
            let closed_notional_raw = reader.u128()?;
            let outcome = reader.u8()?;
            let pnl_abs_raw = reader.u128()?;
            let settlement_sequence = reader.u64()?;
            if closed_notional_raw == 0
                || !matches!(outcome, 1..=3)
                || (outcome == 3 && pnl_abs_raw != 0)
                || (outcome != 3 && pnl_abs_raw == 0)
            {
                return Err(Error::InvalidAmount);
            }
            Action::AgentSettlement(AgentSettlement {
                session_id,
                execution_id,
                settlement_artifact_hash,
                oracle_policy_hash,
                closed_notional_raw,
                outcome,
                pnl_abs_raw,
                settlement_sequence,
            })
        }
        ActionKind::RecurringSchedule => {
            let schedule_id = read_ascii(&mut reader, 96)?;
            let payment = read_transfer_row(&mut reader)?;
            let interval_seconds = reader.u32()?;
            let first_execution_at = reader.i64()?;
            let payment_count = reader.u32()?;
            let status = reader.u8()?;
            if payment.asset != b"SOL"
                || payment.asset_encoding != IdentityEncoding::Text
                || interval_seconds < 3_600
                || payment_count == 0
                || payment_count > 1_000
                || !matches!(status, 1 | 2)
            {
                return Err(Error::InvalidContext);
            }
            Action::RecurringSchedule(RecurringSchedule {
                schedule_id,
                payment,
                interval_seconds,
                first_execution_at,
                payment_count,
                status,
            })
        }
        _ => return Err(Error::UnsupportedAction),
    };
    let reason = reader.bytes(MAX_REASON_BYTES)?;
    validate_visible_ascii(reason, MAX_REASON_BYTES, true)?;
    if !reader.remaining().is_empty() {
        return Err(Error::TrailingBytes);
    }
    Ok(CanonicalIntent {
        common,
        action,
        reason,
        encoded: bytes,
    })
}
