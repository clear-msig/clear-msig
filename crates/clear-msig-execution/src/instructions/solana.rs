use super::*;

/// Build execute_typed_sol_send instruction (typed proposal discriminator 14).
#[allow(dead_code)]
pub fn execute_typed_sol_send(
    payer: Pubkey,
    wallet: Pubkey,
    wallet_policy: Pubkey,
    policy_spend: Pubkey,
    member_allowance: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    recipient: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_lamports: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(wallet_policy, false),
        AccountMeta::new(policy_spend, false),
        AccountMeta::new(member_allowance, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new(recipient, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];
    let mut data = vec![14u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_lamports).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_sol_batch_send instruction (typed proposal discriminator 15).
#[allow(dead_code)]
pub fn execute_typed_sol_batch_send(
    payer: Pubkey,
    wallet: Pubkey,
    wallet_policy: Pubkey,
    policy_spend: Pubkey,
    member_allowance: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_lamports_le: &[u8],
    recipients: Vec<AccountMeta>,
) -> Instruction {
    let mut accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(wallet_policy, false),
        AccountMeta::new(policy_spend, false),
        AccountMeta::new(member_allowance, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];
    accounts.extend(recipients);

    let mut data = vec![15u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    data.extend_from_slice(amount_lamports_le);

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}
