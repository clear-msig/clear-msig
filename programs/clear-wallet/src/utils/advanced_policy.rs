use quasar_lang::prelude::*;

use crate::error::WalletError;

const MODE_ALLOWLIST: u8 = 1;
const MODE_BLOCKLIST: u8 = 2;
const MAX_KEYS: usize = 16;
const MAX_RULES: usize = 16;
const MAX_CONDITIONS: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct AdvancedRuleEffect {
    pub action: u8,
    pub approvers_start: usize,
    pub approver_count: usize,
    pub cooldown: u32,
}

pub(crate) fn evaluate_advanced_rules(
    bytes: &[u8],
    recipient: &[u8; 32],
    amount_raw: u64,
    spend_window_start: i64,
    spent_raw: u64,
    now: i64,
) -> Result<Option<AdvancedRuleEffect>, ProgramError> {
    require!(
        bytes.len() >= 2 && bytes[0] == 1,
        WalletError::InvalidPolicy
    );
    let rule_count = bytes[1] as usize;
    require!(rule_count <= MAX_RULES, WalletError::InvalidPolicy);
    let mut offset = 2usize;
    let mut first_match = None;

    for _ in 0..rule_count {
        require!(offset + 7 <= bytes.len(), WalletError::InvalidPolicy);
        let action = bytes[offset];
        let condition_count = bytes[offset + 1] as usize;
        let approver_count = bytes[offset + 2] as usize;
        let cooldown = read_u32(bytes, offset + 3)?;
        offset += 7;
        require!(action <= 3, WalletError::InvalidPolicy);
        require!(
            condition_count <= MAX_CONDITIONS && approver_count <= MAX_KEYS,
            WalletError::InvalidPolicy
        );
        require!(
            action != 2 || approver_count > 0,
            WalletError::InvalidPolicy
        );
        require!(action != 3 || cooldown > 0, WalletError::InvalidPolicy);

        let approvers_start = offset;
        let approver_bytes = approver_count
            .checked_mul(32)
            .ok_or(WalletError::InvalidPolicy)?;
        require!(
            offset + approver_bytes <= bytes.len(),
            WalletError::InvalidPolicy
        );
        keys(&bytes[offset..offset + approver_bytes])?;
        offset += approver_bytes;

        let mut matches = true;
        for _ in 0..condition_count {
            require!(offset + 3 <= bytes.len(), WalletError::InvalidPolicy);
            let kind = bytes[offset];
            let len = read_u16(bytes, offset + 1)? as usize;
            offset += 3;
            require!(offset + len <= bytes.len(), WalletError::InvalidPolicy);
            matches &= condition_matches(
                kind,
                &bytes[offset..offset + len],
                recipient,
                amount_raw,
                spend_window_start,
                spent_raw,
                now,
            )?;
            offset += len;
        }
        if matches && first_match.is_none() {
            first_match = Some(AdvancedRuleEffect {
                action,
                approvers_start,
                approver_count,
                cooldown,
            });
        }
    }
    require!(offset == bytes.len(), WalletError::InvalidPolicy);
    Ok(first_match)
}

fn condition_matches(
    kind: u8,
    payload: &[u8],
    recipient: &[u8; 32],
    amount_raw: u64,
    spend_window_start: i64,
    spent_raw: u64,
    now: i64,
) -> Result<bool, ProgramError> {
    match kind {
        1 => recipient_matches(payload, recipient),
        2 => amount_matches(payload, amount_raw),
        3 => time_matches(payload, now),
        4 => velocity_matches(payload, amount_raw, spend_window_start, spent_raw, now),
        _ => Err(WalletError::InvalidPolicy.into()),
    }
}

fn recipient_matches(payload: &[u8], recipient: &[u8; 32]) -> Result<bool, ProgramError> {
    require!(payload.len() >= 2, WalletError::InvalidPolicy);
    let mode = payload[0];
    let count = payload[1] as usize;
    require!(
        mode == MODE_ALLOWLIST || mode == MODE_BLOCKLIST,
        WalletError::InvalidPolicy
    );
    require!(count <= MAX_KEYS, WalletError::InvalidPolicy);
    require!(payload.len() == 2 + count * 32, WalletError::InvalidPolicy);
    let listed = keys(&payload[2..])?
        .iter()
        .any(|candidate| candidate == recipient);
    Ok(if mode == MODE_ALLOWLIST {
        listed
    } else {
        !listed
    })
}

fn amount_matches(payload: &[u8], amount_raw: u64) -> Result<bool, ProgramError> {
    require!(payload.len() == 17, WalletError::InvalidPolicy);
    let flags = payload[0];
    require!(flags & !0x03 == 0, WalletError::InvalidPolicy);
    let min = read_u64(payload, 1)?;
    let max = read_u64(payload, 9)?;
    Ok((flags & 1 == 0 || amount_raw >= min) && (flags & 2 == 0 || amount_raw <= max))
}

fn time_matches(payload: &[u8], now: i64) -> Result<bool, ProgramError> {
    require!(payload.len() == 6, WalletError::InvalidPolicy);
    let start_hour = payload[0];
    let end_hour = payload[1];
    let days_mask = payload[2];
    let match_mode = payload[3];
    let utc_offset_minutes = i16::from_le_bytes(
        payload[4..6]
            .try_into()
            .map_err(|_| WalletError::InvalidPolicy)?,
    );
    require!(
        start_hour <= 23 && end_hour <= 23,
        WalletError::InvalidPolicy
    );
    require!(days_mask & !0x7f == 0, WalletError::InvalidPolicy);
    require!(
        match_mode == 1 || match_mode == 2,
        WalletError::InvalidPolicy
    );
    require!(
        (-14 * 60..=14 * 60).contains(&utc_offset_minutes),
        WalletError::InvalidPolicy
    );
    let local_timestamp = now - i64::from(utc_offset_minutes) * 60;
    let local_day = local_timestamp.div_euclid(86_400);
    let local_hour = local_timestamp.rem_euclid(86_400) / 3_600;
    let weekday = (local_day + 4).rem_euclid(7) as u8;
    let day_inside = days_mask == 0 || days_mask & (1 << weekday) != 0;
    let hour_inside = if start_hour < end_hour {
        local_hour >= i64::from(start_hour) && local_hour < i64::from(end_hour)
    } else if start_hour > end_hour {
        local_hour >= i64::from(start_hour) || local_hour < i64::from(end_hour)
    } else {
        false
    };
    let inside = day_inside && hour_inside;
    Ok(if match_mode == 1 { inside } else { !inside })
}

fn velocity_matches(
    payload: &[u8],
    amount_raw: u64,
    spend_window_start: i64,
    spent_raw: u64,
    now: i64,
) -> Result<bool, ProgramError> {
    require!(payload.len() == 12, WalletError::InvalidPolicy);
    let cap = read_u64(payload, 0)?;
    let window_seconds = read_u32(payload, 8)?;
    require!(cap > 0 && window_seconds > 0, WalletError::InvalidPolicy);
    let elapsed = spend_window_start == 0
        || now
            .checked_sub(spend_window_start)
            .map(|value| value >= window_seconds as i64)
            .unwrap_or(true);
    let projected = if elapsed {
        Some(amount_raw)
    } else {
        spent_raw.checked_add(amount_raw)
    };
    Ok(projected.map(|value| value > cap).unwrap_or(true))
}

fn keys(bytes: &[u8]) -> Result<&[[u8; 32]], ProgramError> {
    require!(bytes.len() % 32 == 0, WalletError::InvalidPolicy);
    Ok(unsafe { core::slice::from_raw_parts(bytes.as_ptr() as *const [u8; 32], bytes.len() / 32) })
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, ProgramError> {
    let end = offset.checked_add(2).ok_or(WalletError::InvalidPolicy)?;
    require!(end <= bytes.len(), WalletError::InvalidPolicy);
    Ok(u16::from_le_bytes(
        bytes[offset..end]
            .try_into()
            .map_err(|_| WalletError::InvalidPolicy)?,
    ))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ProgramError> {
    let end = offset.checked_add(4).ok_or(WalletError::InvalidPolicy)?;
    require!(end <= bytes.len(), WalletError::InvalidPolicy);
    Ok(u32::from_le_bytes(
        bytes[offset..end]
            .try_into()
            .map_err(|_| WalletError::InvalidPolicy)?,
    ))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, ProgramError> {
    let end = offset.checked_add(8).ok_or(WalletError::InvalidPolicy)?;
    require!(end <= bytes.len(), WalletError::InvalidPolicy);
    Ok(u64::from_le_bytes(
        bytes[offset..end]
            .try_into()
            .map_err(|_| WalletError::InvalidPolicy)?,
    ))
}

#[cfg(test)]
mod tests {
    use alloc::vec::Vec;

    use super::evaluate_advanced_rules;

    #[test]
    fn first_matching_rule_wins() {
        let recipient = [7u8; 32];
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&[1, 2, 1, 1, 0]);
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.push(1);
        bytes.extend_from_slice(&34u16.to_le_bytes());
        bytes.extend_from_slice(&[1, 1]);
        bytes.extend_from_slice(&recipient);
        bytes.extend_from_slice(&[0, 0, 0]);
        bytes.extend_from_slice(&0u32.to_le_bytes());

        let effect = evaluate_advanced_rules(&bytes, &recipient, 1, 0, 0, 0)
            .unwrap()
            .unwrap();
        assert_eq!(effect.action, 1);
    }
}
