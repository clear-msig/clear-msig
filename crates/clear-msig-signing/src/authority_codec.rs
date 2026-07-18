use super::*;

pub fn encode_agent_trade_approval(
    input: &AgentTradeApprovalInput<'_>,
    out: &mut [u8],
) -> Result<usize, Error> {
    for value in [
        input.agent_id,
        input.venue,
        input.market,
        input.side,
        input.asset_id,
        input.session_id,
        input.route,
    ] {
        validate_visible_ascii(value, 96, false)?;
    }
    if !matches!(input.side, b"long" | b"short")
        || input.max_notional_raw == 0
        || input.max_leverage_x100 == 0
    {
        return Err(Error::InvalidAmount);
    }
    validate_visible_ascii(input.reason, MAX_REASON_BYTES, true)?;
    let mut writer = Writer::new(out);
    write_common(&mut writer, &input.common, ActionKind::AgentTradeApproval)?;
    writer.bytes(input.agent_id)?;
    writer.bytes(input.venue)?;
    writer.bytes(input.market)?;
    writer.bytes(input.side)?;
    writer.bytes(input.asset_id)?;
    writer.u128(input.max_notional_raw)?;
    writer.u32(input.max_leverage_x100)?;
    writer.bytes(input.session_id)?;
    writer.bytes(input.route)?;
    writer.push(&input.risk_check_hash)?;
    writer.bytes(input.reason)?;
    Ok(writer.len)
}

pub fn encode_agent_session(input: &AgentSessionInput<'_>, out: &mut [u8]) -> Result<usize, Error> {
    for value in [input.session_id, input.agent_id, input.venue, input.market] {
        validate_visible_ascii(value, 96, false)?;
    }
    if input.max_notional_raw == 0 || input.max_leverage_x100 == 0 || !matches!(input.status, 1 | 2)
    {
        return Err(Error::InvalidContext);
    }
    validate_visible_ascii(input.reason, MAX_REASON_BYTES, true)?;
    let mut writer = Writer::new(out);
    write_common(&mut writer, &input.common, ActionKind::AgentSessionGrant)?;
    writer.bytes(input.session_id)?;
    writer.bytes(input.agent_id)?;
    writer.bytes(input.venue)?;
    writer.bytes(input.market)?;
    writer.u128(input.max_notional_raw)?;
    writer.u32(input.max_leverage_x100)?;
    writer.i64(input.session_expires_at)?;
    writer.u8(input.status)?;
    writer.bytes(input.reason)?;
    Ok(writer.len)
}

pub fn encode_agent_risk_policy(
    input: &AgentRiskPolicyInput<'_>,
    out: &mut [u8],
) -> Result<usize, Error> {
    validate_visible_ascii(input.session_id, 96, false)?;
    if !matches!(input.status, 1 | 2) || (input.status == 1 && input.max_loss_raw == 0) {
        return Err(Error::InvalidContext);
    }
    validate_visible_ascii(input.reason, MAX_REASON_BYTES, true)?;
    let mut writer = Writer::new(out);
    write_common(&mut writer, &input.common, ActionKind::AgentRiskPolicy)?;
    writer.bytes(input.session_id)?;
    writer.push(&input.oracle_policy_hash)?;
    writer.u128(input.max_loss_raw)?;
    writer.u8(input.status)?;
    writer.bytes(input.reason)?;
    Ok(writer.len)
}

pub fn encode_agent_settlement(
    input: &AgentSettlementInput<'_>,
    out: &mut [u8],
) -> Result<usize, Error> {
    validate_visible_ascii(input.session_id, 96, false)?;
    validate_visible_ascii(input.execution_id, 96, false)?;
    if input.closed_notional_raw == 0
        || !matches!(input.outcome, 1..=3)
        || (input.outcome == 3 && input.pnl_abs_raw != 0)
        || (input.outcome != 3 && input.pnl_abs_raw == 0)
    {
        return Err(Error::InvalidAmount);
    }
    validate_visible_ascii(input.reason, MAX_REASON_BYTES, true)?;
    let mut writer = Writer::new(out);
    write_common(&mut writer, &input.common, ActionKind::AgentTradeSettlement)?;
    writer.bytes(input.session_id)?;
    writer.bytes(input.execution_id)?;
    writer.push(&input.settlement_artifact_hash)?;
    writer.push(&input.oracle_policy_hash)?;
    writer.u128(input.closed_notional_raw)?;
    writer.u8(input.outcome)?;
    writer.u128(input.pnl_abs_raw)?;
    writer.u64(input.settlement_sequence)?;
    writer.bytes(input.reason)?;
    Ok(writer.len)
}

pub fn encode_recurring_schedule(
    input: &RecurringScheduleInput<'_>,
    out: &mut [u8],
) -> Result<usize, Error> {
    validate_visible_ascii(input.schedule_id, 96, false)?;
    validate_transfer_row(&input.payment)?;
    if input.payment.asset != b"SOL"
        || input.payment.asset_encoding != IdentityEncoding::Text
        || input.interval_seconds < 3_600
        || input.payment_count == 0
        || input.payment_count > 1_000
        || !matches!(input.status, 1 | 2)
    {
        return Err(Error::InvalidContext);
    }
    validate_visible_ascii(input.reason, MAX_REASON_BYTES, true)?;
    let mut writer = Writer::new(out);
    write_common(&mut writer, &input.common, ActionKind::RecurringSchedule)?;
    writer.bytes(input.schedule_id)?;
    write_transfer_row(&mut writer, &input.payment)?;
    writer.u32(input.interval_seconds)?;
    writer.i64(input.first_execution_at)?;
    writer.u32(input.payment_count)?;
    writer.u8(input.status)?;
    writer.bytes(input.reason)?;
    Ok(writer.len)
}
