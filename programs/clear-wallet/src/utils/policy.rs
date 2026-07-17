use quasar_lang::{prelude::*, sysvars::Sysvar as _};

use super::advanced_policy::evaluate_advanced_rules;
use crate::{
    error::WalletError,
    state::{
        intent::Intent,
        member_allowance::{
            MemberAllowanceLedger, MemberAllowanceLedgerInner, MAX_MEMBER_ALLOWANCES,
            MEMBER_ALLOWANCE_ROW_LEN,
        },
        policy_spend::{PolicySpendState, PolicySpendStateInner},
        typed_proposal::TypedProposal,
        wallet_policy::{WalletPolicy, WALLET_POLICY_LEN},
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
const EXT_MEMBER_ALLOWANCE: u8 = 4;
const EXT_ADVANCED_RULES: u8 = 5;
const EXT_HEADER_LEN: usize = 1 + 2;
const EXT_VELOCITY_SOL_LEN: usize = 8 + 4;
const EXT_SEND_COUNT_LEN: usize = 4 + 4;
const EXT_ALLOWED_TIME_LEN: usize = 1 + 1 + 1 + 2;
const EXT_MEMBER_ALLOWANCE_ENTRY_LEN: usize = 32 + 8 + 4;

pub fn hash_typed_policy(policy_bytes: &[u8]) -> [u8; 32] {
    hash_policy_commitment(&[POLICY_DOMAIN, policy_bytes])
}

pub fn enforce_wallet_policy_account(
    wallet: &Address,
    wallet_policy: &UncheckedAccount,
    chain_kind: u8,
    proposal_policy_commitment: [u8; 32],
    proposal_policy_bytes: &[u8],
) -> Result<(), ProgramError> {
    let (expected, _) =
        Address::find_program_address(&[b"wallet_policy", wallet.as_ref()], &crate::ID);
    require_keys_eq!(
        *wallet_policy.address(),
        expected,
        ProgramError::InvalidSeeds
    );

    let view = wallet_policy.to_account_view();
    if view.data_len() < WALLET_POLICY_LEN {
        return Ok(());
    }
    require!(view.owned_by(&crate::ID), ProgramError::IncorrectProgramId);
    let data = unsafe { view.borrow_unchecked() };
    let policy = WalletPolicy::read(data)?;
    require_keys_eq!(policy.wallet, *wallet, WalletError::WalletPolicyMismatch);
    let active_commitment = policy.commitment_for_chain(chain_kind)?;
    if active_commitment == [0u8; 32] {
        return Ok(());
    }
    require!(
        active_commitment == proposal_policy_commitment,
        WalletError::WalletPolicyMismatch
    );
    require!(
        !proposal_policy_bytes.is_empty()
            && hash_typed_policy(proposal_policy_bytes) == active_commitment,
        WalletError::WalletPolicyMismatch
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn enforce_typed_sol_send_policy(
    policy_bytes: &[u8],
    committed_policy_hash: [u8; 32],
    recipient: &[u8; 32],
    amount_lamports: u64,
    intent: &Intent<'_>,
    proposal: &TypedProposal<'_>,
    policy_spend: &mut PolicySpendState,
    policy_spend_bump: u8,
    member_allowance: &mut MemberAllowanceLedger,
    member_allowance_bump: u8,
) -> Result<(), ProgramError> {
    enforce_typed_send_policy(
        policy_bytes,
        committed_policy_hash,
        recipient,
        amount_lamports,
        intent,
        proposal,
        policy_spend,
        policy_spend_bump,
        member_allowance,
        member_allowance_bump,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn enforce_typed_remote_send_policy(
    policy_bytes: &[u8],
    committed_policy_hash: [u8; 32],
    recipient_hash: &[u8; 32],
    amount_raw: u128,
    intent: &Intent<'_>,
    proposal: &TypedProposal<'_>,
    policy_spend: &mut PolicySpendState,
    policy_spend_bump: u8,
    member_allowance: &mut MemberAllowanceLedger,
    member_allowance_bump: u8,
) -> Result<(), ProgramError> {
    // The v1 policy wire stores numeric caps as u64, while ERC-20 amounts are
    // u128. Saturation preserves recipient/time/send-count enforcement and
    // guarantees any configured u64 amount or velocity cap rejects a larger
    // value instead of disabling the entire typed ERC-20 path.
    let amount_raw = u64::try_from(amount_raw).unwrap_or(u64::MAX);
    enforce_typed_send_policy(
        policy_bytes,
        committed_policy_hash,
        recipient_hash,
        amount_raw,
        intent,
        proposal,
        policy_spend,
        policy_spend_bump,
        member_allowance,
        member_allowance_bump,
    )
}

#[allow(clippy::too_many_arguments)]
fn enforce_typed_send_policy(
    policy_bytes: &[u8],
    committed_policy_hash: [u8; 32],
    recipient: &[u8; 32],
    amount_raw: u64,
    intent: &Intent<'_>,
    proposal: &TypedProposal<'_>,
    policy_spend: &mut PolicySpendState,
    policy_spend_bump: u8,
    member_allowance: &mut MemberAllowanceLedger,
    member_allowance_bump: u8,
) -> Result<(), ProgramError> {
    initialize_member_allowance(
        intent,
        committed_policy_hash,
        member_allowance,
        member_allowance_bump,
    )?;
    if policy_bytes.is_empty() {
        member_allowance.retain_members(&[]);
        member_allowance.policy_commitment = committed_policy_hash;
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
    let mut active_members = [[0u8; 32]; MAX_MEMBER_ALLOWANCES];
    for (index, member) in active_members
        .iter_mut()
        .enumerate()
        .take(policy.member_cap_count)
    {
        *member = policy.member_caps[index].member;
    }
    member_allowance.retain_members(&active_members[..policy.member_cap_count]);
    member_allowance.policy_commitment = committed_policy_hash;
    policy.enforce_recipient(recipient)?;
    policy.enforce_amount(amount_raw)?;
    policy.enforce_cooldown(intent, proposal)?;
    policy.enforce_required_approvers(intent, proposal)?;
    policy.enforce_allowed_time()?;
    policy.enforce_advanced_rules(recipient, amount_raw, intent, proposal, policy_spend)?;
    policy.enforce_velocity(
        amount_raw,
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
    policy.enforce_member_allowance(amount_raw, proposal, member_allowance)?;
    Ok(())
}

#[derive(Clone, Copy, Default)]
struct MemberAllowanceCap {
    member: [u8; 32],
    cap_raw: u64,
    window_seconds: u32,
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
    member_caps: [MemberAllowanceCap; MAX_MEMBER_ALLOWANCES],
    member_cap_count: usize,
    advanced_rules: Option<&'a [u8]>,
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
            member_caps: extensions.member_caps,
            member_cap_count: extensions.member_cap_count,
            advanced_rules: extensions.advanced_rules,
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

    fn enforce_advanced_rules(
        &self,
        recipient: &[u8; 32],
        amount_raw: u64,
        intent: &Intent<'_>,
        proposal: &TypedProposal<'_>,
        policy_spend: &PolicySpendState,
    ) -> Result<(), ProgramError> {
        let Some(bytes) = self.advanced_rules else {
            return Ok(());
        };
        let now = Clock::get()?.unix_timestamp.get();
        let effect = evaluate_advanced_rules(
            bytes,
            recipient,
            amount_raw,
            policy_spend.window_start.get(),
            policy_spend.spent_lamports.get(),
            now,
        )?;
        let Some(effect) = effect else {
            return Ok(());
        };
        match effect.action {
            0 => return Err(WalletError::PolicyDenied.into()),
            1 => {}
            2 => {
                let approvers = bytes_to_keys(
                    &bytes[effect.approvers_start
                        ..effect.approvers_start + effect.approver_count * 32],
                )?;
                for required in approvers {
                    let address = Address::new_from_array(*required);
                    let idx = intent
                        .approver_index(&address)
                        .ok_or(WalletError::PolicyRequiredApprovalMissing)?;
                    require!(
                        proposal.has_approved_by_index(idx),
                        WalletError::PolicyRequiredApprovalMissing
                    );
                }
            }
            3 => {
                let unlock_at = proposal
                    .approved_at
                    .get()
                    .checked_add(intent.timelock_seconds.get() as i64)
                    .and_then(|value| value.checked_add(effect.cooldown as i64))
                    .ok_or(WalletError::InvalidPolicy)?;
                require!(now >= unlock_at, WalletError::PolicyCooldownNotElapsed);
            }
            _ => return Err(WalletError::InvalidPolicy.into()),
        }
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

    fn enforce_member_allowance(
        &self,
        amount_raw: u64,
        proposal: &TypedProposal<'_>,
        member_allowance: &mut MemberAllowanceLedger,
    ) -> Result<(), ProgramError> {
        if self.member_cap_count == 0 {
            return Ok(());
        }
        let proposer_bytes: [u8; 32] = proposal
            .proposer
            .as_ref()
            .try_into()
            .map_err(|_| WalletError::InvalidPolicy)?;
        let mut cap: Option<MemberAllowanceCap> = None;
        for i in 0..self.member_cap_count {
            if self.member_caps[i].member == proposer_bytes {
                cap = Some(self.member_caps[i]);
                break;
            }
        }
        let Some(cap) = cap else {
            return Ok(());
        };
        if cap.cap_raw == 0 {
            return Err(WalletError::PolicyMemberAllowanceExceeded.into());
        }
        // Per-send hard cap always applies.
        require!(
            amount_raw <= cap.cap_raw,
            WalletError::PolicyMemberAllowanceExceeded
        );
        if cap.window_seconds == 0 {
            return Ok(());
        }
        let clock = Clock::get()?;
        let now = clock.unix_timestamp.get();
        let row = member_allowance.find_or_insert_member(&cap.member)?;
        let window_start = member_allowance.window_start(row);
        let spent = member_allowance.spent_raw(row);
        let window_uninitialized = window_start == 0 && spent == 0;
        let window_elapsed = window_uninitialized
            || now
                .checked_sub(window_start)
                .map(|elapsed| elapsed >= cap.window_seconds as i64)
                .unwrap_or(true);
        if window_elapsed {
            member_allowance.set_window_start(row, now);
            member_allowance.set_spent_raw(row, 0);
        }
        let projected = member_allowance
            .spent_raw(row)
            .checked_add(amount_raw)
            .ok_or(WalletError::PolicyMemberAllowanceExceeded)?;
        require!(
            projected <= cap.cap_raw,
            WalletError::PolicyMemberAllowanceExceeded
        );
        member_allowance.set_spent_raw(row, projected);
        Ok(())
    }
}

fn initialize_member_allowance(
    intent: &Intent<'_>,
    policy_commitment: [u8; 32],
    member_allowance: &mut MemberAllowanceLedger,
    member_allowance_bump: u8,
) -> Result<(), ProgramError> {
    let intent_address = intent_pda(intent);
    if member_allowance.wallet == Address::default() {
        member_allowance.set_inner(MemberAllowanceLedgerInner {
            wallet: intent.wallet,
            intent: intent_address,
            policy_commitment,
            entry_count: 0,
            rows: [0u8; MAX_MEMBER_ALLOWANCES * MEMBER_ALLOWANCE_ROW_LEN],
            bump: member_allowance_bump,
        });
    }
    require!(
        member_allowance.wallet == intent.wallet && member_allowance.intent == intent_address,
        WalletError::InvalidPolicy
    );
    Ok(())
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
    require!(bytes.len().is_multiple_of(32), WalletError::InvalidPolicy);
    Ok(unsafe { core::slice::from_raw_parts(bytes.as_ptr() as *const [u8; 32], bytes.len() / 32) })
}

#[derive(Default)]
struct PolicyExtensions<'a> {
    velocity_cap_lamports: u64,
    velocity_window_seconds: u32,
    max_send_count: u32,
    count_window_seconds: u32,
    allowed_time: Option<AllowedTimeWindow>,
    member_caps: [MemberAllowanceCap; MAX_MEMBER_ALLOWANCES],
    member_cap_count: usize,
    advanced_rules: Option<&'a [u8]>,
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

fn parse_extensions(bytes: &[u8]) -> Result<PolicyExtensions<'_>, ProgramError> {
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
            EXT_MEMBER_ALLOWANCE => {
                require!(
                    len > 0 && len.is_multiple_of(EXT_MEMBER_ALLOWANCE_ENTRY_LEN),
                    WalletError::InvalidPolicy
                );
                let count = len / EXT_MEMBER_ALLOWANCE_ENTRY_LEN;
                require!(count <= MAX_MEMBER_ALLOWANCES, WalletError::InvalidPolicy);
                for i in 0..count {
                    let base = i * EXT_MEMBER_ALLOWANCE_ENTRY_LEN;
                    let mut member = [0u8; 32];
                    member.copy_from_slice(&payload[base..base + 32]);
                    let cap_raw = u64::from_le_bytes(
                        payload[base + 32..base + 40]
                            .try_into()
                            .map_err(|_| WalletError::InvalidPolicy)?,
                    );
                    let window_seconds = u32::from_le_bytes(
                        payload[base + 40..base + 44]
                            .try_into()
                            .map_err(|_| WalletError::InvalidPolicy)?,
                    );
                    extensions.member_caps[i] = MemberAllowanceCap {
                        member,
                        cap_raw,
                        window_seconds,
                    };
                }
                extensions.member_cap_count = count;
            }
            EXT_ADVANCED_RULES => {
                require!(
                    extensions.advanced_rules.is_none(),
                    WalletError::InvalidPolicy
                );
                require!(!payload.is_empty(), WalletError::InvalidPolicy);
                extensions.advanced_rules = Some(payload);
            }
            _ => return Err(WalletError::InvalidPolicy.into()),
        }
        offset += len;
    }
    Ok(extensions)
}

#[cfg(test)]
mod tests {
    use super::{AllowedTimeWindow, TypedSolPolicy};
    use alloc::vec::Vec;

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

    #[test]
    fn parses_advanced_rule_extension_after_velocity() {
        let recipient = [7u8; 32];
        let mut rules = Vec::new();
        rules.extend_from_slice(&[1, 2, 1, 1, 0]);
        rules.extend_from_slice(&0u32.to_le_bytes());
        rules.push(1);
        rules.extend_from_slice(&34u16.to_le_bytes());
        rules.push(1);
        rules.push(1);
        rules.extend_from_slice(&recipient);
        rules.extend_from_slice(&[0, 0, 0]);
        rules.extend_from_slice(&0u32.to_le_bytes());

        let mut policy = b"CSP1".to_vec();
        policy.extend_from_slice(&[0]);
        policy.extend_from_slice(&0u64.to_le_bytes());
        policy.extend_from_slice(&0u32.to_le_bytes());
        policy.extend_from_slice(&[0, 0]);
        policy.push(1);
        policy.extend_from_slice(&12u16.to_le_bytes());
        policy.extend_from_slice(&1_000u64.to_le_bytes());
        policy.extend_from_slice(&86_400u32.to_le_bytes());
        policy.push(5);
        policy.extend_from_slice(&(rules.len() as u16).to_le_bytes());
        policy.extend_from_slice(&rules);

        let parsed = TypedSolPolicy::parse(&policy).unwrap();
        assert_eq!(parsed.advanced_rules, Some(rules.as_slice()));
    }
}
