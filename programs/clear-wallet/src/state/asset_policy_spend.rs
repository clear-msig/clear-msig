use quasar_lang::prelude::*;

#[account(discriminator = 15, set_inner)]
#[seeds(b"asset_policy_spend", wallet: Address, asset_id: Address)]
pub struct AssetPolicySpend {
    pub wallet: Address,
    pub asset_id: Address,
    pub policy_commitment: [u8; 32],
    pub window_start: i64,
    pub spent_raw: u64,
    pub count_window_start: i64,
    pub send_count: u32,
    pub bump: u8,
}
