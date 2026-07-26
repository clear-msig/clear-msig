use quasar_lang::{prelude::*, sysvars::Sysvar as _};

use crate::{
    error::WalletError,
    state::{
        asset_policy::{AssetPolicy, ASSET_POLICY_LEN, ASSET_POLICY_SEED},
        asset_policy_spend::{AssetPolicySpend, AssetPolicySpendInner},
    },
    utils::policy::hash_typed_policy,
};

const MAGIC: &[u8; 4] = b"CSP2";
const INNER_MAGIC: &[u8; 4] = b"CSP1";
const SCOPE_SPL_TOKEN: u8 = 1;
const SCOPE_HEADER_LEN: usize = 4 + 1 + 1 + 32;
const INNER_HEADER_LEN: usize = 4 + 1 + 8 + 4 + 1 + 1;
const MAX_POLICY_KEYS: usize = 16;
const MODE_ANY: u8 = 0;
const MODE_ALLOWLIST: u8 = 1;
const MODE_BLOCKLIST: u8 = 2;
const EXT_VELOCITY: u8 = 1;
const EXT_SEND_COUNT: u8 = 2;
const EXT_ALLOWED_TIME: u8 = 3;
const EXT_HEADER_LEN: usize = 3;

pub struct AssetPolicyScope {
    pub scope_kind: u8,
    pub decimals: u8,
    pub asset_id: [u8; 32],
}

pub fn parse_asset_policy_scope(bytes: &[u8]) -> Result<AssetPolicyScope, ProgramError> {
    require!(bytes.len() >= SCOPE_HEADER_LEN, WalletError::InvalidPolicy);
    require!(&bytes[..4] == MAGIC, WalletError::InvalidPolicy);
    let scope_kind = bytes[4];
    let decimals = bytes[5];
    require!(scope_kind == SCOPE_SPL_TOKEN, WalletError::InvalidPolicy);
    require!(decimals <= 18, WalletError::InvalidPolicy);
    let mut asset_id = [0u8; 32];
    asset_id.copy_from_slice(&bytes[6..38]);
    require!(asset_id != [0u8; 32], WalletError::InvalidPolicy);
    Ok(AssetPolicyScope {
        scope_kind,
        decimals,
        asset_id,
    })
}

pub fn enforce_asset_policy_account(
    wallet: &Address,
    account: &UncheckedAccount,
    asset_id: &[u8; 32],
    proposal_policy_commitment: [u8; 32],
    proposal_policy_bytes: &[u8],
) -> Result<(), ProgramError> {
    let (expected, _) =
        Address::find_program_address(&[ASSET_POLICY_SEED, wallet.as_ref(), asset_id], &crate::ID);
    require_keys_eq!(*account.address(), expected, ProgramError::InvalidSeeds);
    let view = account.to_account_view();
    require!(
        view.data_len() >= ASSET_POLICY_LEN,
        WalletError::WalletPolicyMismatch
    );
    require!(view.owned_by(&crate::ID), ProgramError::IncorrectProgramId);
    let policy = AssetPolicy::read(unsafe { view.borrow_unchecked() })?;
    require!(
        policy.wallet == *wallet && policy.asset_id.as_ref() == asset_id,
        WalletError::WalletPolicyMismatch
    );
    require!(
        policy.policy_commitment != [0u8; 32]
            && policy.policy_commitment == proposal_policy_commitment
            && !proposal_policy_bytes.is_empty()
            && hash_typed_policy(proposal_policy_bytes) == policy.policy_commitment,
        WalletError::WalletPolicyMismatch
    );
    Ok(())
}

pub fn validate_recurring_asset_policy(
    policy_bytes: &[u8],
    committed_policy_hash: [u8; 32],
    asset_id: &[u8; 32],
    decimals: u8,
    recipient: &[u8; 32],
    amount_raw: u64,
) -> Result<(), ProgramError> {
    require!(!policy_bytes.is_empty(), WalletError::InvalidPolicy);
    require!(
        hash_typed_policy(policy_bytes) == committed_policy_hash,
        WalletError::InvalidPolicy
    );
    let policy = RecurringAssetPolicy::parse(policy_bytes, asset_id, decimals)?;
    policy.enforce_recipient(recipient)?;
    policy.enforce_amount(amount_raw)
}

#[allow(clippy::too_many_arguments)]
pub fn enforce_recurring_asset_payment_policy(
    policy_bytes: &[u8],
    committed_policy_hash: [u8; 32],
    asset_id: &[u8; 32],
    decimals: u8,
    recipient: &[u8; 32],
    amount_raw: u64,
    wallet: &Address,
    spend: &mut AssetPolicySpend,
    spend_bump: u8,
) -> Result<(), ProgramError> {
    validate_recurring_asset_policy(
        policy_bytes,
        committed_policy_hash,
        asset_id,
        decimals,
        recipient,
        amount_raw,
    )?;
    let policy = RecurringAssetPolicy::parse(policy_bytes, asset_id, decimals)?;
    initialize_spend(wallet, asset_id, committed_policy_hash, spend, spend_bump)?;
    policy.enforce_allowed_time()?;
    policy.enforce_velocity(amount_raw, spend)?;
    policy.enforce_send_count(spend)
}

struct RecurringAssetPolicy<'a> {
    mode: u8,
    max_amount_raw: u64,
    recipients: &'a [[u8; 32]],
    velocity_cap_raw: u64,
    velocity_window_seconds: u32,
    max_send_count: u32,
    count_window_seconds: u32,
    allowed_time: Option<AllowedTimeWindow>,
}

impl<'a> RecurringAssetPolicy<'a> {
    fn parse(
        bytes: &'a [u8],
        expected_asset_id: &[u8; 32],
        expected_decimals: u8,
    ) -> Result<Self, ProgramError> {
        let scope = parse_asset_policy_scope(bytes)?;
        require!(
            scope.asset_id == *expected_asset_id && scope.decimals == expected_decimals,
            WalletError::InvalidPolicy
        );
        let body = &bytes[SCOPE_HEADER_LEN..];
        require!(body.len() >= INNER_HEADER_LEN, WalletError::InvalidPolicy);
        require!(&body[..4] == INNER_MAGIC, WalletError::InvalidPolicy);
        let mode = body[4];
        require!(
            matches!(mode, MODE_ANY | MODE_ALLOWLIST | MODE_BLOCKLIST),
            WalletError::InvalidPolicy
        );
        let max_amount_raw = read_u64(&body[5..13])?;
        let extra_cooldown_seconds = read_u32(&body[13..17])?;
        let recipient_count = body[17] as usize;
        let required_approver_count = body[18] as usize;
        require!(
            recipient_count <= MAX_POLICY_KEYS,
            WalletError::InvalidPolicy
        );
        require!(
            required_approver_count == 0 && extra_cooldown_seconds == 0,
            WalletError::RecurringSchedulePolicyUnsupported
        );
        let recipients_end = INNER_HEADER_LEN
            .checked_add(
                recipient_count
                    .checked_mul(32)
                    .ok_or(WalletError::InvalidPolicy)?,
            )
            .ok_or(WalletError::InvalidPolicy)?;
        require!(body.len() >= recipients_end, WalletError::InvalidPolicy);
        let recipients = bytes_to_keys(&body[INNER_HEADER_LEN..recipients_end])?;
        let mut policy = Self {
            mode,
            max_amount_raw,
            recipients,
            velocity_cap_raw: 0,
            velocity_window_seconds: 0,
            max_send_count: 0,
            count_window_seconds: 0,
            allowed_time: None,
        };
        policy.parse_extensions(&body[recipients_end..])?;
        Ok(policy)
    }

    fn parse_extensions(&mut self, bytes: &[u8]) -> Result<(), ProgramError> {
        let mut offset = 0usize;
        while offset < bytes.len() {
            require!(
                offset + EXT_HEADER_LEN <= bytes.len(),
                WalletError::InvalidPolicy
            );
            let tag = bytes[offset];
            let len = u16::from_le_bytes([bytes[offset + 1], bytes[offset + 2]]) as usize;
            offset += EXT_HEADER_LEN;
            require!(offset + len <= bytes.len(), WalletError::InvalidPolicy);
            let payload = &bytes[offset..offset + len];
            match tag {
                EXT_VELOCITY => {
                    require!(len == 12, WalletError::InvalidPolicy);
                    self.velocity_cap_raw = read_u64(&payload[..8])?;
                    self.velocity_window_seconds = read_u32(&payload[8..12])?;
                }
                EXT_SEND_COUNT => {
                    require!(len == 8, WalletError::InvalidPolicy);
                    self.max_send_count = read_u32(&payload[..4])?;
                    self.count_window_seconds = read_u32(&payload[4..8])?;
                }
                EXT_ALLOWED_TIME => {
                    require!(len == 5, WalletError::InvalidPolicy);
                    let window = AllowedTimeWindow {
                        start_hour: payload[0],
                        end_hour: payload[1],
                        days_mask: payload[2],
                        utc_offset_minutes: i16::from_le_bytes([payload[3], payload[4]]),
                    };
                    require!(
                        window.start_hour <= 23 && window.end_hour <= 23,
                        WalletError::InvalidPolicy
                    );
                    require!(window.days_mask & !0x7f == 0, WalletError::InvalidPolicy);
                    require!(
                        (-14 * 60..=14 * 60).contains(&window.utc_offset_minutes),
                        WalletError::InvalidPolicy
                    );
                    self.allowed_time = Some(window);
                }
                _ => return Err(WalletError::RecurringSchedulePolicyUnsupported.into()),
            }
            offset += len;
        }
        require!(
            (self.velocity_cap_raw == 0) == (self.velocity_window_seconds == 0)
                && (self.max_send_count == 0) == (self.count_window_seconds == 0),
            WalletError::InvalidPolicy
        );
        Ok(())
    }

    fn enforce_recipient(&self, recipient: &[u8; 32]) -> Result<(), ProgramError> {
        let listed = self.recipients.iter().any(|value| value == recipient);
        match self.mode {
            MODE_ANY => Ok(()),
            MODE_ALLOWLIST => {
                require!(listed, WalletError::PolicyDenied);
                Ok(())
            }
            MODE_BLOCKLIST => {
                require!(!listed, WalletError::PolicyDenied);
                Ok(())
            }
            _ => Err(WalletError::InvalidPolicy.into()),
        }
    }

    fn enforce_amount(&self, amount_raw: u64) -> Result<(), ProgramError> {
        if self.max_amount_raw != 0 {
            require!(
                amount_raw <= self.max_amount_raw,
                WalletError::PolicyAmountExceeded
            );
        }
        Ok(())
    }

    fn enforce_allowed_time(&self) -> Result<(), ProgramError> {
        if let Some(window) = self.allowed_time {
            require!(
                window.allows(Clock::get()?.unix_timestamp.get()),
                WalletError::PolicyOutsideAllowedHours
            );
        }
        Ok(())
    }

    fn enforce_velocity(
        &self,
        amount_raw: u64,
        spend: &mut AssetPolicySpend,
    ) -> Result<(), ProgramError> {
        if self.velocity_cap_raw == 0 {
            return Ok(());
        }
        let now = Clock::get()?.unix_timestamp.get();
        let elapsed = now
            .checked_sub(spend.window_start.get())
            .map(|value| value >= i64::from(self.velocity_window_seconds))
            .unwrap_or(true);
        if elapsed {
            spend.window_start = now.into();
            spend.spent_raw = 0u64.into();
        }
        let projected = spend
            .spent_raw
            .get()
            .checked_add(amount_raw)
            .ok_or(WalletError::PolicyVelocityExceeded)?;
        require!(
            projected <= self.velocity_cap_raw,
            WalletError::PolicyVelocityExceeded
        );
        spend.spent_raw = projected.into();
        Ok(())
    }

    fn enforce_send_count(&self, spend: &mut AssetPolicySpend) -> Result<(), ProgramError> {
        if self.max_send_count == 0 {
            return Ok(());
        }
        let now = Clock::get()?.unix_timestamp.get();
        let elapsed = now
            .checked_sub(spend.count_window_start.get())
            .map(|value| value >= i64::from(self.count_window_seconds))
            .unwrap_or(true);
        if elapsed {
            spend.count_window_start = now.into();
            spend.send_count = 0u32.into();
        }
        let projected = spend
            .send_count
            .get()
            .checked_add(1)
            .ok_or(WalletError::PolicyVelocityExceeded)?;
        require!(
            projected <= self.max_send_count,
            WalletError::PolicyVelocityExceeded
        );
        spend.send_count = projected.into();
        Ok(())
    }
}

fn initialize_spend(
    wallet: &Address,
    asset_id: &[u8; 32],
    commitment: [u8; 32],
    spend: &mut AssetPolicySpend,
    bump: u8,
) -> Result<(), ProgramError> {
    let asset = Address::new_from_array(*asset_id);
    if spend.wallet == Address::default() {
        spend.set_inner(AssetPolicySpendInner {
            wallet: *wallet,
            asset_id: asset,
            policy_commitment: commitment,
            window_start: 0,
            spent_raw: 0,
            count_window_start: 0,
            send_count: 0,
            bump,
        });
    }
    require!(
        spend.wallet == *wallet && spend.asset_id == asset,
        WalletError::InvalidPolicy
    );
    spend.policy_commitment = commitment;
    Ok(())
}

#[derive(Clone, Copy)]
struct AllowedTimeWindow {
    start_hour: u8,
    end_hour: u8,
    days_mask: u8,
    utc_offset_minutes: i16,
}

impl AllowedTimeWindow {
    fn allows(self, unix_timestamp: i64) -> bool {
        let local_timestamp = unix_timestamp - i64::from(self.utc_offset_minutes) * 60;
        let day = local_timestamp.div_euclid(86_400);
        let hour = local_timestamp.rem_euclid(86_400) / 3_600;
        let weekday = (day + 4).rem_euclid(7) as u8;
        if self.days_mask != 0 && self.days_mask & (1 << weekday) == 0 {
            return false;
        }
        let start = i64::from(self.start_hour);
        let end = i64::from(self.end_hour);
        if start < end {
            hour >= start && hour < end
        } else if start > end {
            hour >= start || hour < end
        } else {
            false
        }
    }
}

fn read_u64(bytes: &[u8]) -> Result<u64, ProgramError> {
    Ok(u64::from_le_bytes(
        bytes.try_into().map_err(|_| WalletError::InvalidPolicy)?,
    ))
}

fn read_u32(bytes: &[u8]) -> Result<u32, ProgramError> {
    Ok(u32::from_le_bytes(
        bytes.try_into().map_err(|_| WalletError::InvalidPolicy)?,
    ))
}

fn bytes_to_keys(bytes: &[u8]) -> Result<&[[u8; 32]], ProgramError> {
    require!(bytes.len().is_multiple_of(32), WalletError::InvalidPolicy);
    Ok(unsafe { core::slice::from_raw_parts(bytes.as_ptr().cast::<[u8; 32]>(), bytes.len() / 32) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(asset: [u8; 32], decimals: u8, max: u64) -> alloc::vec::Vec<u8> {
        let mut bytes = b"CSP2".to_vec();
        bytes.extend_from_slice(&[SCOPE_SPL_TOKEN, decimals]);
        bytes.extend_from_slice(&asset);
        bytes.extend_from_slice(b"CSP1");
        bytes.push(MODE_ANY);
        bytes.extend_from_slice(&max.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&[0, 0]);
        bytes
    }

    #[test]
    fn scope_rejects_mint_and_decimal_substitution() {
        let asset = [7u8; 32];
        let bytes = policy(asset, 6, 1_000_000);
        assert!(RecurringAssetPolicy::parse(&bytes, &asset, 6).is_ok());
        assert!(RecurringAssetPolicy::parse(&bytes, &[8u8; 32], 6).is_err());
        assert!(RecurringAssetPolicy::parse(&bytes, &asset, 9).is_err());
    }

    #[test]
    fn validation_rejects_amount_and_recipient_substitution() {
        let asset = [7u8; 32];
        let recipient = [9u8; 32];
        let mut bytes = b"CSP2".to_vec();
        bytes.extend_from_slice(&[SCOPE_SPL_TOKEN, 6]);
        bytes.extend_from_slice(&asset);
        bytes.extend_from_slice(b"CSP1");
        bytes.push(MODE_ALLOWLIST);
        bytes.extend_from_slice(&1_000_000u64.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&[1, 0]);
        bytes.extend_from_slice(&recipient);
        let commitment = hash_typed_policy(&bytes);

        assert!(validate_recurring_asset_policy(
            &bytes, commitment, &asset, 6, &recipient, 1_000_000,
        )
        .is_ok());
        assert!(validate_recurring_asset_policy(
            &bytes,
            commitment,
            &asset,
            6,
            &[10u8; 32],
            1_000_000,
        )
        .is_err());
        assert!(validate_recurring_asset_policy(
            &bytes, commitment, &asset, 6, &recipient, 1_000_001,
        )
        .is_err());
        assert!(validate_recurring_asset_policy(
            &bytes, [0u8; 32], &asset, 6, &recipient, 1_000_000,
        )
        .is_err());
    }

    #[test]
    fn recurring_rejects_policy_extensions_it_cannot_enforce() {
        let asset = [7u8; 32];
        let mut bytes = policy(asset, 6, 1_000_000);
        bytes.extend_from_slice(&[99, 0, 0]);
        assert!(RecurringAssetPolicy::parse(&bytes, &asset, 6).is_err());
    }
}
