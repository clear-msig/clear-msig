use quasar_lang::prelude::*;

#[account(discriminator = 7, set_inner)]
#[seeds(b"policy_spend", wallet: Address, intent: Address)]
pub struct PolicySpendState {
    pub wallet: Address,
    pub intent: Address,
    pub policy_commitment: [u8; 32],
    pub window_start: i64,
    pub spent_lamports: u64,
    pub count_window_start: i64,
    pub send_count: u32,
    pub bump: u8,
}
