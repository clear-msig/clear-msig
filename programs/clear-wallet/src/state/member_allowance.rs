use quasar_lang::prelude::*;

use crate::error::WalletError;

pub const MAX_MEMBER_ALLOWANCES: usize = 8;
pub const MEMBER_ALLOWANCE_ROW_LEN: usize = 48;

#[account(discriminator = 10, set_inner)]
#[seeds(b"member_allowance", wallet: Address, intent: Address)]
pub struct MemberAllowanceLedger {
    pub wallet: Address,
    pub intent: Address,
    pub policy_commitment: [u8; 32],
    pub entry_count: u8,
    pub rows: [u8; MAX_MEMBER_ALLOWANCES * MEMBER_ALLOWANCE_ROW_LEN],
    pub bump: u8,
}

impl MemberAllowanceLedger {
    pub fn retain_members(&mut self, members: &[[u8; 32]]) {
        let mut retained = [0u8; MAX_MEMBER_ALLOWANCES * MEMBER_ALLOWANCE_ROW_LEN];
        let mut retained_count = 0usize;
        for index in 0..self.entry_count as usize {
            let start = index * MEMBER_ALLOWANCE_ROW_LEN;
            let member: [u8; 32] = self.rows[start..start + 32].try_into().unwrap_or([0u8; 32]);
            if members.contains(&member) {
                let target = retained_count * MEMBER_ALLOWANCE_ROW_LEN;
                retained[target..target + MEMBER_ALLOWANCE_ROW_LEN]
                    .copy_from_slice(&self.rows[start..start + MEMBER_ALLOWANCE_ROW_LEN]);
                retained_count += 1;
            }
        }
        self.rows = retained;
        self.entry_count = retained_count as u8;
    }

    pub fn find_or_insert_member(&mut self, member: &[u8; 32]) -> Result<usize, ProgramError> {
        for index in 0..self.entry_count as usize {
            let start = index * MEMBER_ALLOWANCE_ROW_LEN;
            if &self.rows[start..start + 32] == member.as_slice() {
                return Ok(index);
            }
        }

        require!(
            (self.entry_count as usize) < MAX_MEMBER_ALLOWANCES,
            WalletError::TooManyAccounts
        );
        let index = self.entry_count as usize;
        let start = index * MEMBER_ALLOWANCE_ROW_LEN;
        self.rows[start..start + 32].copy_from_slice(member);
        self.rows[start + 32..start + 40].copy_from_slice(&0i64.to_le_bytes());
        self.rows[start + 40..start + 48].copy_from_slice(&0u64.to_le_bytes());
        self.entry_count = self.entry_count.saturating_add(1);
        Ok(index)
    }

    pub fn window_start(&self, index: usize) -> i64 {
        let start = index * MEMBER_ALLOWANCE_ROW_LEN + 32;
        i64::from_le_bytes(self.rows[start..start + 8].try_into().unwrap_or([0; 8]))
    }

    pub fn spent_raw(&self, index: usize) -> u64 {
        let start = index * MEMBER_ALLOWANCE_ROW_LEN + 40;
        u64::from_le_bytes(self.rows[start..start + 8].try_into().unwrap_or([0; 8]))
    }

    pub fn set_window_start(&mut self, index: usize, value: i64) {
        let start = index * MEMBER_ALLOWANCE_ROW_LEN + 32;
        self.rows[start..start + 8].copy_from_slice(&value.to_le_bytes());
    }

    pub fn set_spent_raw(&mut self, index: usize, value: u64) {
        let start = index * MEMBER_ALLOWANCE_ROW_LEN + 40;
        self.rows[start..start + 8].copy_from_slice(&value.to_le_bytes());
    }
}
