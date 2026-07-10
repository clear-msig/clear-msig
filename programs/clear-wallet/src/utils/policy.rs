use quasar_lang::{prelude::*, sysvars::Sysvar as _};

use crate::{
    error::WalletError,
    state::{
        intent::Intent,
        policy_spend::{PolicySpendState, PolicySpendStateInner},
        typed_proposal::TypedProposal,
    },
    utils::clearsign::hash_policy_commitment,
};

const POLICY_DOMAIN: &[u8] = b"typed-sol-send-policy-v1";
const MAGIC: &[u8; 4] = b"CSP1";
const MODE_ANY: u8 = 0;
const MODE_ALLOWLIST: u8 = 1;
const MODE_BLOCKLIST: u8 = 2;
const HEADER_LEN: usize = 4 + 1 + 8 + 4 + 1 + 1;
const MAX_POLICY_KEYS: usize = 16;
const EXT_VELOCITY_SOL: u8 = 1;
const EXT_SEND_COUNT: u8 = 2;
const EXT_ALLOWED_TIME: u8 = 3;
const EXT_HEADER_LEN: usize = 1 + 2;
const EXT_VELOCITY_SOL_LEN: usize = 8 + 4;
const EXT_SEND_COUNT_LEN: usize = 4 + 4;
const EXT_ALLOWED_TIME_LEN: usize = 1 + 1 + 1 + 2;

pub fn hash_typed_policy(policy_bytes: &[u8]) -> [u8; 32] {
    hash_policy_commitment(&[POLICY_DOMAIN, policy_bytes])
}

pub fn enforce_typed_sol_send_policy(
    policy_bytes: &[u8],
    committed_policy_hash: [u8; 32],
    recipient: &[u8; 32],
    amount_lamports: u64,
    intent: &Intent<'_>,
    proposal: &TypedProposal<'_>,
    policy_spend: &mut PolicySpendState,
    policy_spend_bump: u8,
) -> Result<(), ProgramError> {
    if policy_bytes.is_empty() {
        initialize_policy_spend(
            intent,
            committed_policy_hash,
            policy_spend,
            policy_spend_bump,
        )?;
        return Ok(());
    }
    require!(
        hash_typed_policy(policy_bytes) == committed_policy_hash,
        WalletError::InvalidPolicy
    );

    let policy = TypedSolPolicy::parse(policy_bytes)?;
    policy.enforce_recipient(recipient)?;
    policy.enforce_amount(amount_lamports)?;
    policy.enforce_cooldown(intent, proposal)?;
    policy.enforce_required_approvers(intent, proposal)?;
    policy.enforce_allowed_time()?;
    policy.enforce_velocity(
        amount_lamports,
        intent,
        committed_policy_hash,
        policy_spend,
        policy_spend_bump,
    )?;
    policy.enforce_send_count(
        intent,
        committed_policy_hash,
        policy_spend,
        policy_spend_bump,
    )?;
    Ok(())
}

pub fn enforce_typed_remote_send_policy(
    policy_bytes: &[u8],
    committed_policy_hash: [u8; 32],
    recipient_hash: &[u8; 32],
    amount_raw: u128,
    intent: &Intent<'_>,
    proposal: &TypedProposal<'_>,
    policy_spend: &mut PolicySpendState,
    policy_spend_bump: u8,
) -> Result<(), ProgramError> {
    // The v1 policy wire stores numeric caps as u64, while ERC-20 amounts are
    // u128. Saturation preserves recipient/time/send-count enforcement and
    // guarantees any configured u64 amount or velocity cap rejects a larger
    // value instead of disabling the entire typed ERC-20 path.
    let amount_raw = u64::try_from(amount_raw).unwrap_or(u64::MAX);
    enforce_typed_sol_send_policy(
        policy_bytes,
        committed_policy_hash,
        recipient_hash,
        amount_raw,
        intent,
        proposal,
        policy_spend,
        policy_spend_bump,
    )
}

struct TypedSolPolicy<'a> {
    mode: u8,
    max_amount_lamports: u64,
    extra_cooldown_seconds: u32,
    velocity_cap_lamports: u64,
    velocity_window_seconds: u32,
    max_send_count: u32,
    count_window_seconds: u32,
    allowed_time: Option<AllowedTimeWindow>,
    recipients: &'a [[u8; 32]],
    required_approvers: &'a [[u8; 32]],
}

impl<'a> TypedSolPolicy<'a> {
    fn parse(bytes: &'a [u8]) -> Result<Self, ProgramError> {
        require!(bytes.len() >= HEADER_LEN, WalletError::InvalidPolicy);
        require!(&bytes[0..4] == MAGIC, WalletError::InvalidPolicy);

        let mode = bytes[4];
        require!(
            mode == MODE_ANY || mode == MODE_ALLOWLIST || mode == MODE_BLOCKLIST,
            WalletError::InvalidPolicy
        );
        let max_amount_lamports = u64::from_le_bytes(
            bytes[5..13]
                .try_into()
                .map_err(|_| WalletError::InvalidPolicy)?,
        );
        let extra_cooldown_seconds = u32::from_le_bytes(
            bytes[13..17]
                .try_into()
                .map_err(|_| WalletError::InvalidPolicy)?,
        );
        let recipient_count = bytes[17] as usize;
        let required_approver_count = bytes[18] as usize;
        require!(
            recipient_count <= MAX_POLICY_KEYS && required_approver_count <= MAX_POLICY_KEYS,
            WalletError::InvalidPolicy
        );
        let base_len = HEADER_LEN
            .checked_add(
                recipient_count
                    .checked_add(required_approver_count)
                    .ok_or(WalletError::InvalidPolicy)?
                    .checked_mul(32)
                    .ok_or(WalletError::InvalidPolicy)?,
            )
            .ok_or(WalletError::InvalidPolicy)?;
        require!(bytes.len() >= base_len, WalletError::InvalidPolicy);

        let recipients_start = HEADER_LEN;
        let approvers_start = recipients_start + recipient_count * 32;
        let approvers_end = approvers_start + required_approver_count * 32;
        let recipients = bytes_to_keys(&bytes[recipients_start..approvers_start])?;
        let required_approvers = bytes_to_keys(&bytes[approvers_start..approvers_end])?;
        let extensions = parse_extensions(&bytes[approvers_end..])?;

        Ok(Self {
            mode,
            max_amount_lamports,
            extra_cooldown_seconds,
            velocity_cap_lamports: extensions.velocity_cap_lamports,
            velocity_window_seconds: extensions.velocity_window_seconds,
            max_send_count: extensions.max_send_count,
            count_window_seconds: extensions.count_window_seconds,
            allowed_time: extensions.allowed_time,
            recipients,
            required_approvers,
        })
    }

    fn enforce_recipient(&self, recipient: &[u8; 32]) -> Result<(), ProgramError> {
        let listed = self.recipients.iter().any(|item| item == recipient);
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

    fn enforce_amount(&self, amount_lamports: u64) -> Result<(), ProgramError> {
        if self.max_amount_lamports == 0 {
            return Ok(());
        }
        require!(
            amount_lamports <= self.max_amount_lamports,
            WalletError::PolicyAmountExceeded
        );
        Ok(())
    }

    fn enforce_cooldown(
        &self,
        intent: &Intent<'_>,
        proposal: &TypedProposal<'_>,
    ) -> Result<(), ProgramError> {
        if self.extra_cooldown_seconds == 0 {
            return Ok(());
        }
        let clock = Clock::get()?;
        let unlock_at = proposal
            .approved_at
            .get()
            .checked_add(intent.timelock_seconds.get() as i64)
            .and_then(|value| value.checked_add(self.extra_cooldown_seconds as i64))
            .ok_or(WalletError::InvalidPolicy)?;
        require!(
            clock.unix_timestamp.get() >= unlock_at,
            WalletError::PolicyCooldownNotElapsed
        );
        Ok(())
    }

    fn enforce_required_approvers(
        &self,
        intent: &Intent<'_>,
        proposal: &TypedProposal<'_>,
    ) -> Result<(), ProgramError> {
        for required in self.required_approvers {
            let address = Address::new_from_array(*required);
            let idx = intent
                .approver_index(&address)
                .ok_or(WalletError::PolicyRequiredApprovalMissing)?;
            require!(
                proposal.has_approved_by_index(idx),
                WalletError::PolicyRequiredApprovalMissing
            );
        }
        Ok(())
    }

    fn enforce_allowed_time(&self) -> Result<(), ProgramError> {
        let Some(window) = self.allowed_time else {
            return Ok(());
        };
        let now = Clock::get()?.unix_timestamp.get();
        require!(
            window.allows_timestamp(now),
            WalletError::PolicyOutsideAllowedHours
        );
        Ok(())
    }

    fn enforce_velocity(
        &self,
        amount_lamports: u64,
        intent: &Intent<'_>,
        policy_commitment: [u8; 32],
        policy_spend: &mut PolicySpendState,
        policy_spend_bump: u8,
    ) -> Result<(), ProgramError> {
        if self.velocity_cap_lamports == 0 || self.velocity_window_seconds == 0 {
            return Ok(());
        }

        initialize_policy_spend(intent, policy_commitment, policy_spend, policy_spend_bump)?;

        let clock = Clock::get()?;
        let now = clock.unix_timestamp.get();
        let window_start = policy_spend.window_start.get();
        let spent_lamports = policy_spend.spent_lamports.get();
        let window_uninitialized = window_start == 0 && spent_lamports == 0;
        let window_elapsed = window_uninitialized
            || now
                .checked_sub(window_start)
                .map(|elapsed| elapsed >= self.velocity_window_seconds as i64)
                .unwrap_or(true);
        if window_elapsed {
            policy_spend.window_start = now.into();
            policy_spend.spent_lamports = 0u64.into();
        }

        let projected = policy_spend
            .spent_lamports
            .get()
            .checked_add(amount_lamports)
            .ok_or(WalletError::PolicyVelocityExceeded)?;
        require!(
            projected <= self.velocity_cap_lamports,
            WalletError::PolicyVelocityExceeded
        );
        policy_spend.spent_lamports = projected.into();
        Ok(())
    }

    fn enforce_send_count(
        &self,
        intent: &Intent<'_>,
        policy_commitment: [u8; 32],
        policy_spend: &mut PolicySpendState,
        policy_spend_bump: u8,
    ) -> Result<(), ProgramError> {
        if self.max_send_count == 0 || self.count_window_seconds == 0 {
            return Ok(());
        }
        initialize_policy_spend(intent, policy_commitment, policy_spend, policy_spend_bump)?;

        let clock = Clock::get()?;
        let now = clock.unix_timestamp.get();
        let window_start = policy_spend.count_window_start.get();
        let send_count = policy_spend.send_count.get();
        let window_uninitialized = window_start == 0 && send_count == 0;
        let window_elapsed = window_uninitialized
            || now
                .checked_sub(window_start)
                .map(|elapsed| elapsed >= self.count_window_seconds as i64)
                .unwrap_or(true);
        if window_elapsed {
            policy_spend.count_window_start = now.into();
            policy_spend.send_count = 0u32.into();
        }

        let projected = policy_spend
            .send_count
            .get()
            .checked_add(1)
            .ok_or(WalletError::PolicyVelocityExceeded)?;
        require!(
            projected <= self.max_send_count,
            WalletError::PolicyVelocityExceeded
        );
        policy_spend.send_count = projected.into();
        Ok(())
    }
}

fn initialize_policy_spend(
    intent: &Intent<'_>,
    policy_commitment: [u8; 32],
    policy_spend: &mut PolicySpendState,
    policy_spend_bump: u8,
) -> Result<(), ProgramError> {
    let intent_address = intent_pda(intent);
    if policy_spend.wallet == Address::default() {
        policy_spend.set_inner(PolicySpendStateInner {
            wallet: intent.wallet,
            intent: intent_address,
            policy_commitment,
            window_start: 0i64,
            spent_lamports: 0u64,
            count_window_start: 0i64,
            send_count: 0u32,
            bump: policy_spend_bump,
        });
    }
    require!(
        policy_spend.wallet == intent.wallet && policy_spend.intent == intent_address,
        WalletError::InvalidPolicy
    );
    // Policy edits must not erase already-accounted spend. Keep one aggregate
    // ledger per intent and retain the latest commitment for auditability.
    policy_spend.policy_commitment = policy_commitment;
    Ok(())
}

fn intent_pda(intent: &Intent<'_>) -> Address {
    let intent_index = [intent.intent_index];
    Address::find_program_address(
        &[b"intent", intent.wallet.as_ref(), &intent_index],
        &crate::ID,
    )
    .0
}

fn bytes_to_keys(bytes: &[u8]) -> Result<&[[u8; 32]], ProgramError> {
    require!(bytes.len() % 32 == 0, WalletError::InvalidPolicy);
    Ok(unsafe { core::slice::from_raw_parts(bytes.as_ptr() as *const [u8; 32], bytes.len() / 32) })
}

#[derive(Default)]
struct PolicyExtensions {
    velocity_cap_lamports: u64,
    velocity_window_seconds: u32,
    max_send_count: u32,
    count_window_seconds: u32,
    allowed_time: Option<AllowedTimeWindow>,
}

#[derive(Clone, Copy)]
struct AllowedTimeWindow {
    start_hour: u8,
    end_hour: u8,
    days_mask: u8,
    utc_offset_minutes: i16,
}

impl AllowedTimeWindow {
    fn allows_timestamp(&self, unix_timestamp: i64) -> bool {
        let local_timestamp = unix_timestamp - i64::from(self.utc_offset_minutes) * 60;
        let local_day = local_timestamp.div_euclid(86_400);
        let local_hour = local_timestamp.rem_euclid(86_400) / 3_600;
        let weekday = (local_day + 4).rem_euclid(7) as u8;
        let day_allowed = self.days_mask == 0 || self.days_mask & (1 << weekday) != 0;
        if !day_allowed {
            return false;
        }
        let start = i64::from(self.start_hour);
        let end = i64::from(self.end_hour);
        if start < end {
            local_hour >= start && local_hour < end
        } else if start > end {
            local_hour >= start || local_hour < end
        } else {
            false
        }
    }
}

fn parse_extensions(bytes: &[u8]) -> Result<PolicyExtensions, ProgramError> {
    let mut offset = 0usize;
    let mut extensions = PolicyExtensions::default();
    while offset < bytes.len() {
        require!(
            offset + EXT_HEADER_LEN <= bytes.len(),
            WalletError::InvalidPolicy
        );
        let tag = bytes[offset];
        let len = u16::from_le_bytes(
            bytes[offset + 1..offset + 3]
                .try_into()
                .map_err(|_| WalletError::InvalidPolicy)?,
        ) as usize;
        offset += EXT_HEADER_LEN;
        require!(offset + len <= bytes.len(), WalletError::InvalidPolicy);
        let payload = &bytes[offset..offset + len];
        match tag {
            EXT_VELOCITY_SOL => {
                require!(len == EXT_VELOCITY_SOL_LEN, WalletError::InvalidPolicy);
                extensions.velocity_cap_lamports = u64::from_le_bytes(
                    payload[0..8]
                        .try_into()
                        .map_err(|_| WalletError::InvalidPolicy)?,
                );
                extensions.velocity_window_seconds = u32::from_le_bytes(
                    payload[8..12]
                        .try_into()
                        .map_err(|_| WalletError::InvalidPolicy)?,
                );
            }
            EXT_SEND_COUNT => {
                require!(len == EXT_SEND_COUNT_LEN, WalletError::InvalidPolicy);
                extensions.max_send_count = u32::from_le_bytes(
                    payload[0..4]
                        .try_into()
                        .map_err(|_| WalletError::InvalidPolicy)?,
                );
                extensions.count_window_seconds = u32::from_le_bytes(
                    payload[4..8]
                        .try_into()
                        .map_err(|_| WalletError::InvalidPolicy)?,
                );
            }
            EXT_ALLOWED_TIME => {
                require!(len == EXT_ALLOWED_TIME_LEN, WalletError::InvalidPolicy);
                let start_hour = payload[0];
                let end_hour = payload[1];
                let days_mask = payload[2];
                let utc_offset_minutes = i16::from_le_bytes(
                    payload[3..5]
                        .try_into()
                        .map_err(|_| WalletError::InvalidPolicy)?,
                );
                require!(
                    start_hour <= 23 && end_hour <= 23,
                    WalletError::InvalidPolicy
                );
                require!(days_mask & !0x7f == 0, WalletError::InvalidPolicy);
                require!(
                    (-14 * 60..=14 * 60).contains(&utc_offset_minutes),
                    WalletError::InvalidPolicy
                );
                extensions.allowed_time = Some(AllowedTimeWindow {
                    start_hour,
                    end_hour,
                    days_mask,
                    utc_offset_minutes,
                });
            }
            _ => return Err(WalletError::InvalidPolicy.into()),
        }
        offset += len;
    }
    Ok(extensions)
}

#[cfg(test)]
mod tests {
    use super::AllowedTimeWindow;

    #[test]
    fn allowed_hours_apply_the_signed_local_offset_and_day() {
        let monday_nine_utc = 4 * 86_400 + 9 * 3_600;
        let window = AllowedTimeWindow {
            start_hour: 9,
            end_hour: 17,
            days_mask: 1 << 1,
            utc_offset_minutes: 0,
        };
        assert!(window.allows_timestamp(monday_nine_utc));
        assert!(!window.allows_timestamp(monday_nine_utc + 8 * 3_600));
    }

    #[test]
    fn allowed_hours_support_windows_that_wrap_midnight() {
        let window = AllowedTimeWindow {
            start_hour: 22,
            end_hour: 6,
            days_mask: 0,
            utc_offset_minutes: -60,
        };
        let utc_21_local_22 = 21 * 3_600;
        assert!(window.allows_timestamp(utc_21_local_22));
        assert!(!window.allows_timestamp(12 * 3_600));
    }
}
