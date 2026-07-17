use super::*;

/// Build execute_typed_wallet_policy_update instruction (typed proposal discriminator 26).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_wallet_policy_update(
    payer: Pubkey,
    wallet: Pubkey,
    wallet_policy: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    current_policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    chain_kind: u8,
    new_policy_bytes: &[u8],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(wallet_policy, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let mut data = vec![26u8];
    wincode::serialize_into(&mut data, &current_policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &chain_kind).unwrap();
    wincode::serialize_into(
        &mut data,
        &quasar_lang::client::DynBytes::<u32>::new(new_policy_bytes.to_vec()),
    )
    .unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_intent_governance instruction (typed proposal discriminator 27).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_intent_governance(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    target_intent: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    action_kind: u8,
    target_intent_index: u8,
    new_intent_body: &[u8],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new(target_intent, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let mut data = vec![27u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &action_kind).unwrap();
    wincode::serialize_into(&mut data, &target_intent_index).unwrap();
    wincode::serialize_into(
        &mut data,
        &quasar_lang::client::DynBytes::<u32>::new(new_intent_body.to_vec()),
    )
    .unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}
