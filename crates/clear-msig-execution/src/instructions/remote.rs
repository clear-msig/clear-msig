use super::*;

/// Build execute_typed_chain_send instruction (typed proposal discriminator 24).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_chain_send(
    payer: Pubkey,
    wallet: Pubkey,
    wallet_policy: Pubkey,
    policy_spend: Pubkey,
    member_allowance: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    ika_config: Pubkey,
    dwallet: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    chain_kind: u8,
    amount_raw_le: [u8; 16],
    recipient_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    tx_template_hash: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(wallet_policy, false),
        AccountMeta::new(policy_spend, false),
        AccountMeta::new(member_allowance, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(ika_config, false),
        AccountMeta::new_readonly(dwallet, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let mut data = vec![24u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &chain_kind).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &recipient_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &tx_template_hash).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build ika_sign_typed_chain_send instruction (typed proposal discriminator 25).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn ika_sign_typed_chain_send(
    payer: Pubkey,
    wallet: Pubkey,
    wallet_policy: Pubkey,
    policy_spend: Pubkey,
    member_allowance: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    ika_config: Pubkey,
    dwallet_ownership: Pubkey,
    dwallet: Pubkey,
    message_approval: Pubkey,
    coordinator: Pubkey,
    cpi_authority: Pubkey,
    dwallet_program: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    chain_kind: u8,
    amount_raw_le: [u8; 16],
    recipient_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    tx_template_hash: [u8; 32],
    message_approval_bump: u8,
    cpi_authority_bump: u8,
    blake2b_hashes: [u8; 96],
    params_data: &[u8],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(wallet_policy, false),
        AccountMeta::new(policy_spend, false),
        AccountMeta::new(member_allowance, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(ika_config, false),
        AccountMeta::new_readonly(dwallet_ownership, false),
        AccountMeta::new(dwallet, false),
        AccountMeta::new(message_approval, false),
        AccountMeta::new_readonly(coordinator, false),
        AccountMeta::new_readonly(cpi_authority, false),
        AccountMeta::new_readonly(program_id(), false),
        AccountMeta::new_readonly(dwallet_program, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let mut data = vec![25u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &chain_kind).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &recipient_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &tx_template_hash).unwrap();
    wincode::serialize_into(&mut data, &message_approval_bump).unwrap();
    wincode::serialize_into(&mut data, &cpi_authority_bump).unwrap();
    wincode::serialize_into(&mut data, &blake2b_hashes).unwrap();
    data.extend_from_slice(params_data);

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}
