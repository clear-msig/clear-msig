use super::*;

/// Build execute_typed_escrow_release instruction (typed proposal discriminator 12).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_escrow_release(
    wallet: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    recipient: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_lamports: u64,
    escrow_id_hash: [u8; 32],
    milestone_id_hash: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new(recipient, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];
    let mut data = vec![12u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_lamports).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &milestone_id_hash).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_spl_escrow_release instruction (typed proposal discriminator 17).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_spl_escrow_release(
    wallet: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    mint: Pubkey,
    source_token: Pubkey,
    destination_token: Pubkey,
    recipient_owner: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_tokens: u64,
    escrow_id_hash: [u8; 32],
    milestone_id_hash: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new_readonly(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new(source_token, false),
        AccountMeta::new(destination_token, false),
        AccountMeta::new_readonly(recipient_owner, false),
        AccountMeta::new_readonly(spl_token_program_id(), false),
    ];
    let mut data = vec![17u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_tokens).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &milestone_id_hash).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_spl_escrow_return instruction (typed proposal discriminator 18).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_spl_escrow_return(
    wallet: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    mint: Pubkey,
    source_token: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    escrow_id_hash: [u8; 32],
    amount_tokens_le: &[u8],
    returns: Vec<AccountMeta>,
) -> Instruction {
    let mut accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new_readonly(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new(source_token, false),
        AccountMeta::new_readonly(spl_token_program_id(), false),
    ];
    accounts.extend(returns);

    let mut data = vec![18u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    data.extend_from_slice(amount_tokens_le);

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_cross_chain_escrow_release instruction (typed proposal discriminator 19).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_cross_chain_escrow_release(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    ika_config: Pubkey,
    dwallet: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    chain_kind: u8,
    amount_raw_le: [u8; 16],
    escrow_id_hash: [u8; 32],
    milestone_id_hash: [u8; 32],
    recipient_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    route_hash: [u8; 32],
    tx_template_hash: [u8; 32],
    settlement_artifact_hash: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(ika_config, false),
        AccountMeta::new_readonly(dwallet, false),
    ];

    let mut data = vec![19u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &chain_kind).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &milestone_id_hash).unwrap();
    wincode::serialize_into(&mut data, &recipient_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &route_hash).unwrap();
    wincode::serialize_into(&mut data, &tx_template_hash).unwrap();
    wincode::serialize_into(&mut data, &settlement_artifact_hash).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_cross_chain_escrow_return instruction (typed proposal discriminator 20).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_cross_chain_escrow_return(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    ika_config: Pubkey,
    dwallet: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    chain_kind: u8,
    amount_raw_le: [u8; 16],
    escrow_id_hash: [u8; 32],
    refund_recipient_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    route_hash: [u8; 32],
    tx_template_hash: [u8; 32],
    settlement_artifact_hash: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(ika_config, false),
        AccountMeta::new_readonly(dwallet, false),
    ];

    let mut data = vec![20u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &chain_kind).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &refund_recipient_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &route_hash).unwrap();
    wincode::serialize_into(&mut data, &tx_template_hash).unwrap();
    wincode::serialize_into(&mut data, &settlement_artifact_hash).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_private_escrow_release instruction (typed proposal discriminator 21).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_private_escrow_release(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_raw_le: [u8; 16],
    escrow_id_hash: [u8; 32],
    milestone_id_hash: [u8; 32],
    recipient_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    policy_ciphertexts_hash: [u8; 32],
    private_evaluation_hash: [u8; 32],
    settlement_artifact_hash: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
    ];

    let mut data = vec![21u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &milestone_id_hash).unwrap();
    wincode::serialize_into(&mut data, &recipient_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &policy_ciphertexts_hash).unwrap();
    wincode::serialize_into(&mut data, &private_evaluation_hash).unwrap();
    wincode::serialize_into(&mut data, &settlement_artifact_hash).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_private_escrow_return instruction (typed proposal discriminator 22).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_private_escrow_return(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_raw_le: [u8; 16],
    escrow_id_hash: [u8; 32],
    refund_recipient_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    policy_ciphertexts_hash: [u8; 32],
    private_evaluation_hash: [u8; 32],
    settlement_artifact_hash: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
    ];

    let mut data = vec![22u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &refund_recipient_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &policy_ciphertexts_hash).unwrap();
    wincode::serialize_into(&mut data, &private_evaluation_hash).unwrap();
    wincode::serialize_into(&mut data, &settlement_artifact_hash).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_escrow_return instruction (typed proposal discriminator 13).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_escrow_return(
    wallet: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    escrow_id_hash: [u8; 32],
    amount_lamports_le: &[u8],
    funders: Vec<AccountMeta>,
) -> Instruction {
    let mut accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];
    accounts.extend(funders);

    let mut data = vec![13u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    data.extend_from_slice(amount_lamports_le);

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}
