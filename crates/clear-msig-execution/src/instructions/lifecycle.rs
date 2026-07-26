use super::*;

/// Build cleanup_proposal instruction.
pub fn cleanup(proposal: Pubkey, rent_refund: Pubkey) -> Instruction {
    let accounts = vec![
        AccountMeta::new(proposal, false),
        AccountMeta::new(rent_refund, false),
    ];
    Instruction {
        program_id: program_id(),
        accounts,
        data: vec![5u8],
    }
}

/// Build cleanup_typed_proposal instruction.
pub fn cleanup_typed(proposal: Pubkey, rent_refund: Pubkey) -> Instruction {
    let accounts = vec![
        AccountMeta::new(proposal, false),
        AccountMeta::new(rent_refund, false),
    ];
    Instruction {
        program_id: program_id(),
        accounts,
        data: vec![16u8],
    }
}

// =============================================================================
// Cross-chain (dWallet via Ika) instructions
// =============================================================================
//
// All wire formats below match the auto-generated Quasar client at
// `target/client/rust/clear-wallet-client/src/instructions/`. Re-run
// `quasar build` and re-cross-check if signatures change upstream.

/// Build bind_dwallet (disc 6).
///
/// Build bind_dwallet instruction (Quasar discriminator 6) via the vendored
/// quasar client. wincode encoding required.
#[allow(clippy::too_many_arguments)]
pub fn bind_dwallet(
    payer: Pubkey,
    wallet: Pubkey,
    ika_config: Pubkey,
    dwallet_ownership: Pubkey,
    dwallet: Pubkey,
    cpi_authority: Pubkey,
    dwallet_program: Pubkey,
    chain_kind: u8,
    user_pubkey: [u8; 32],
    signature_scheme: u16,
    cpi_authority_bump: u8,
) -> Instruction {
    let ext_ix: solana_instruction::Instruction = BindDwalletInstruction {
        payer: pk_to_addr(payer),
        wallet: pk_to_addr(wallet),
        ika_config: pk_to_addr(ika_config),
        dwallet_ownership: pk_to_addr(dwallet_ownership),
        dwallet: pk_to_addr(dwallet),
        cpi_authority: pk_to_addr(cpi_authority),
        caller_program: pk_to_addr(program_id()),
        dwallet_program: pk_to_addr(dwallet_program),
        system_program: solana_sdk_ids::system_program::ID,
        instructions_sysvar: pk_to_addr(solana_sdk::sysvar::instructions::id()),
        chain_kind,
        user_pubkey,
        signature_scheme,
        cpi_authority_bump,
    }
    .into();
    sdk_ix_from_ext(ext_ix)
}

/// Build ika_sign instruction (Quasar discriminator 7) via the vendored client.
#[allow(clippy::too_many_arguments)]
pub fn ika_sign(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    ika_config: Pubkey,
    dwallet_ownership: Pubkey,
    dwallet: Pubkey,
    message_approval: Pubkey,
    coordinator: Pubkey,
    cpi_authority: Pubkey,
    dwallet_program: Pubkey,
    message_approval_bump: u8,
    cpi_authority_bump: u8,
    blake2b_hashes: [u8; 96],
) -> Instruction {
    let ext_ix: solana_instruction::Instruction = IkaSignInstruction {
        payer: pk_to_addr(payer),
        wallet: pk_to_addr(wallet),
        intent: pk_to_addr(intent),
        proposal: pk_to_addr(proposal),
        ika_config: pk_to_addr(ika_config),
        dwallet_ownership: pk_to_addr(dwallet_ownership),
        dwallet: pk_to_addr(dwallet),
        message_approval: pk_to_addr(message_approval),
        coordinator: pk_to_addr(coordinator),
        cpi_authority: pk_to_addr(cpi_authority),
        caller_program: pk_to_addr(program_id()),
        dwallet_program: pk_to_addr(dwallet_program),
        system_program: solana_sdk_ids::system_program::ID,
        message_approval_bump,
        cpi_authority_bump,
        blake2b_hashes,
    }
    .into();
    sdk_ix_from_ext(ext_ix)
}

/// Build the raw `transfer_ownership` (Ika dWallet program disc 24)
/// instruction. Used to hand off authority of a freshly-DKG'd dWallet to
/// clear-wallet's CPI authority PDA before `bind_dwallet`.
pub fn ika_transfer_ownership(
    dwallet_program: Pubkey,
    payer: Pubkey,
    dwallet: Pubkey,
    new_authority: Pubkey,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(payer, true),
        AccountMeta::new(dwallet, false),
    ];
    let mut data = Vec::with_capacity(33);
    data.push(24u8);
    data.extend_from_slice(new_authority.as_ref());
    Instruction {
        program_id: dwallet_program,
        accounts,
        data,
    }
}
