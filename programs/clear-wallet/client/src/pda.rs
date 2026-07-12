use sha2::{Digest, Sha256};
use solana_address::Address;

/// Derive the wallet PDA. As of the creator-scoped seed change, the
/// wallet's namespace is owned by the creator (the payer at create
/// time). Two creators can both pick the same name without collision.
///
/// Callers MUST pass the creator who originally signed the create_wallet
/// instruction. Wallets created against the older name-only seed live
/// at different PDAs and won't be found by this function.
pub fn find_wallet_address(name: &str, creator: &Address, program_id: &Address) -> (Address, u8) {
    let name_hash = compute_name_hash(name);
    Address::find_program_address(&[b"clear_wallet", creator.as_ref(), &name_hash], program_id)
}

pub fn find_vault_address(wallet: &Address, program_id: &Address) -> (Address, u8) {
    Address::find_program_address(&[b"vault", wallet.as_ref()], program_id)
}

pub fn find_policy_spend_address(
    wallet: &Address,
    intent: &Address,
    program_id: &Address,
) -> (Address, u8) {
    Address::find_program_address(
        &[b"policy_spend", wallet.as_ref(), intent.as_ref()],
        program_id,
    )
}

pub fn find_member_allowance_address(
    wallet: &Address,
    intent: &Address,
    program_id: &Address,
) -> (Address, u8) {
    Address::find_program_address(
        &[b"member_allowance", wallet.as_ref(), intent.as_ref()],
        program_id,
    )
}

pub fn find_agent_session_address(
    wallet: &Address,
    session_id_hash: &[u8; 32],
    program_id: &Address,
) -> (Address, u8) {
    Address::find_program_address(
        &[b"agent_session", wallet.as_ref(), session_id_hash.as_ref()],
        program_id,
    )
}

pub fn find_agent_risk_address(
    wallet: &Address,
    session_id_hash: &[u8; 32],
    program_id: &Address,
) -> (Address, u8) {
    Address::find_program_address(
        &[b"agent_risk", wallet.as_ref(), session_id_hash.as_ref()],
        program_id,
    )
}

pub fn find_agent_settlement_receipt_address(
    wallet: &Address,
    settlement_artifact_hash: &[u8; 32],
    program_id: &Address,
) -> (Address, u8) {
    Address::find_program_address(
        &[
            b"agent_settlement",
            wallet.as_ref(),
            settlement_artifact_hash.as_ref(),
        ],
        program_id,
    )
}

pub fn find_wallet_policy_address(wallet: &Address, program_id: &Address) -> (Address, u8) {
    Address::find_program_address(&[b"wallet_policy", wallet.as_ref()], program_id)
}

pub fn find_intent_address(wallet: &Address, index: u8, program_id: &Address) -> (Address, u8) {
    Address::find_program_address(&[b"intent", wallet.as_ref(), &[index]], program_id)
}

pub fn find_proposal_address(intent: &Address, index: u64, program_id: &Address) -> (Address, u8) {
    Address::find_program_address(
        &[b"proposal", intent.as_ref(), &index.to_le_bytes()],
        program_id,
    )
}

pub fn find_typed_proposal_address(
    intent: &Address,
    index: u64,
    program_id: &Address,
) -> (Address, u8) {
    Address::find_program_address(
        &[b"typed_proposal", intent.as_ref(), &index.to_le_bytes()],
        program_id,
    )
}

pub fn find_ika_config_address(
    wallet: &Address,
    chain_kind: u8,
    program_id: &Address,
) -> (Address, u8) {
    Address::find_program_address(&[b"ika_config", wallet.as_ref(), &[chain_kind]], program_id)
}

pub fn find_cpi_authority(program_id: &Address) -> (Address, u8) {
    Address::find_program_address(&[b"__ika_cpi_authority"], program_id)
}

pub fn compute_name_hash(name: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(name.as_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}
