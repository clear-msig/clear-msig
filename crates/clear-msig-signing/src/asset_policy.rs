use crate::model::CommonFields;

#[derive(Clone, Copy)]
pub struct AssetPolicyUpdateInput<'a> {
    pub common: CommonFields,
    pub chain_kind: u8,
    pub scope_kind: u8,
    pub decimals: u8,
    pub asset_id: [u8; 32],
    pub display_asset: &'a [u8],
    pub new_policy_commitment: [u8; 32],
    pub reason: &'a [u8],
}

#[derive(Clone, Copy)]
pub struct AssetPolicyUpdate<'a> {
    pub chain_kind: u8,
    pub scope_kind: u8,
    pub decimals: u8,
    pub asset_id: [u8; 32],
    pub display_asset: &'a [u8],
    pub new_policy_commitment: [u8; 32],
}
