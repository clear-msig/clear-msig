use super::*;

pub struct CreateWalletArgs<'a> {
    pub payer: Pubkey,
    pub name_hash: Pubkey,
    pub wallet: Pubkey,
    pub add_intent: Pubkey,
    pub remove_intent: Pubkey,
    pub update_intent: Pubkey,
    pub name: &'a str,
    pub threshold: u8,
    pub cancel_threshold: u8,
    pub timelock: u32,
    pub proposers: &'a [Pubkey],
    pub approvers: &'a [Pubkey],
    pub policy_ciphertexts: &'a [u8],
}

/// Build create_wallet instruction (Quasar discriminator 0).
pub fn create_wallet(args: CreateWalletArgs<'_>) -> Instruction {
    let ext_ix: solana_instruction::Instruction = CreateWalletInstruction {
        payer: pk_to_addr(args.payer),
        name_hash: pk_to_addr(args.name_hash),
        wallet: pk_to_addr(args.wallet),
        add_intent: pk_to_addr(args.add_intent),
        remove_intent: pk_to_addr(args.remove_intent),
        update_intent: pk_to_addr(args.update_intent),
        system_program: solana_sdk_ids::system_program::ID,
        approval_threshold: args.threshold,
        cancellation_threshold: args.cancel_threshold,
        timelock_seconds: args.timelock,
        name: DynBytes::from(args.name.as_bytes().to_vec()),
        proposers: DynVec::new(args.proposers.iter().map(|p| p.to_bytes()).collect()),
        approvers: DynVec::new(args.approvers.iter().map(|a| a.to_bytes()).collect()),
        policy_ciphertexts: TailBytes(args.policy_ciphertexts.to_vec()),
    }
    .into();
    sdk_ix_from_ext(ext_ix)
}

pub struct ProposeArgs<'a> {
    pub payer: Pubkey,
    pub wallet: Pubkey,
    pub intent: Pubkey,
    pub proposal: Pubkey,
    pub proposal_index: u64,
    pub expiry: i64,
    pub proposer_pubkey: [u8; 32],
    pub signature: [u8; 64],
    pub params_data: &'a [u8],
}

/// Build propose instruction (Quasar discriminator 1) via the vendored client.
pub fn propose(args: ProposeArgs<'_>) -> Instruction {
    let ext_ix: solana_instruction::Instruction = ProposeInstruction {
        payer: pk_to_addr(args.payer),
        wallet: pk_to_addr(args.wallet),
        intent: pk_to_addr(args.intent),
        proposal: pk_to_addr(args.proposal),
        system_program: solana_sdk_ids::system_program::ID,
        proposal_index: args.proposal_index,
        expiry: args.expiry,
        proposer_pubkey: args.proposer_pubkey,
        signature: args.signature,
        params_data: TailBytes(args.params_data.to_vec()),
    }
    .into();
    sdk_ix_from_ext(ext_ix)
}

/// Build approve instruction (Quasar discriminator 2) via the vendored client.
pub fn approve(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    expiry: i64,
    approver_index: u8,
    signature: [u8; 64],
) -> Instruction {
    let ext_ix: solana_instruction::Instruction = ApproveInstruction {
        wallet: pk_to_addr(wallet),
        intent: pk_to_addr(intent),
        proposal: pk_to_addr(proposal),
        expiry,
        approver_index,
        signature,
    }
    .into();
    sdk_ix_from_ext(ext_ix)
}

/// Build cancel instruction.
pub fn cancel(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    expiry: i64,
    canceller_index: u8,
    signature: [u8; 64],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
    ];

    let mut data = vec![3u8];
    data.extend_from_slice(&expiry.to_le_bytes());
    data.push(canceller_index);
    data.extend_from_slice(&signature);

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute instruction (Quasar discriminator 4) via the vendored client.
pub fn execute(
    wallet: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    remaining_accounts: Vec<AccountMeta>,
) -> Instruction {
    let ext_remaining: Vec<solana_instruction::AccountMeta> = remaining_accounts
        .into_iter()
        .map(|m| solana_instruction::AccountMeta {
            pubkey: pk_to_addr(m.pubkey),
            is_signer: m.is_signer,
            is_writable: m.is_writable,
        })
        .collect();
    let ext_ix: solana_instruction::Instruction = ExecuteInstruction {
        wallet: pk_to_addr(wallet),
        vault: pk_to_addr(vault),
        intent: pk_to_addr(intent),
        proposal: pk_to_addr(proposal),
        system_program: solana_sdk_ids::system_program::ID,
        remaining_accounts: ext_remaining,
    }
    .into();
    sdk_ix_from_ext(ext_ix)
}

#[allow(dead_code)]
pub struct ProposeTypedArgs<'a> {
    pub payer: Pubkey,
    pub wallet: Pubkey,
    pub intent: Pubkey,
    pub proposal: Pubkey,
    pub proposal_index: u64,
    pub expiry: i64,
    pub action_kind: u8,
    pub policy_commitment: [u8; 32],
    pub payload_hash: [u8; 32],
    pub envelope_hash: [u8; 32],
    pub proposer_pubkey: [u8; 32],
    pub signature: [u8; 64],
    pub action_id: [u8; 32],
    pub nonce: [u8; 32],
    pub policy_bytes: &'a [u8],
    pub clear_text: &'a [u8],
}

/// Build propose_typed instruction (typed proposal discriminator 8).
#[allow(dead_code)]
pub fn propose_typed(args: ProposeTypedArgs) -> Instruction {
    let accounts = vec![
        AccountMeta::new(args.payer, true),
        AccountMeta::new(args.wallet, false),
        AccountMeta::new(args.intent, false),
        AccountMeta::new(args.proposal, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];

    let mut data = vec![8u8];
    wincode::serialize_into(&mut data, &args.proposal_index).unwrap();
    wincode::serialize_into(&mut data, &args.expiry).unwrap();
    wincode::serialize_into(&mut data, &args.action_kind).unwrap();
    wincode::serialize_into(&mut data, &args.policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &args.payload_hash).unwrap();
    wincode::serialize_into(&mut data, &args.envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &args.proposer_pubkey).unwrap();
    wincode::serialize_into(&mut data, &args.signature).unwrap();
    wincode::serialize_into(&mut data, &args.action_id).unwrap();
    wincode::serialize_into(&mut data, &args.nonce).unwrap();
    wincode::serialize_into(&mut data, &DynBytes::<u32>::new(args.policy_bytes.to_vec())).unwrap();
    wincode::serialize_into(&mut data, &TailBytes(args.clear_text.to_vec())).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

pub struct ProposeTypedV4Args<'a> {
    pub payer: Pubkey,
    pub wallet: Pubkey,
    pub intent: Pubkey,
    pub proposal: Pubkey,
    pub proposal_index: u64,
    pub signature: [u8; 64],
    pub policy_bytes: &'a [u8],
    pub canonical_intent: &'a [u8],
}

/// Build propose_typed_v4 instruction (canonical typed proposal discriminator 31).
pub fn propose_typed_v4(args: ProposeTypedV4Args<'_>) -> Instruction {
    let accounts = vec![
        AccountMeta::new(args.payer, true),
        AccountMeta::new(args.wallet, false),
        AccountMeta::new(args.intent, false),
        AccountMeta::new(args.proposal, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];
    let mut data = vec![31u8];
    wincode::serialize_into(&mut data, &args.proposal_index).unwrap();
    wincode::serialize_into(&mut data, &args.signature).unwrap();
    wincode::serialize_into(&mut data, &DynBytes::<u32>::new(args.policy_bytes.to_vec())).unwrap();
    wincode::serialize_into(&mut data, &TailBytes(args.canonical_intent.to_vec())).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build approve_typed instruction (typed proposal discriminator 9).
#[allow(dead_code)]
pub fn approve_typed(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    approver_index: u8,
    signature: [u8; 64],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new_readonly(intent, false),
        AccountMeta::new(proposal, false),
    ];
    let mut data = vec![9u8];
    wincode::serialize_into(&mut data, &approver_index).unwrap();
    wincode::serialize_into(&mut data, &signature).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build cancel_typed instruction (typed proposal discriminator 10).
#[allow(dead_code)]
pub fn cancel_typed(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    canceller_index: u8,
    signature: [u8; 64],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
    ];
    let mut data = vec![10u8];
    wincode::serialize_into(&mut data, &canceller_index).unwrap();
    wincode::serialize_into(&mut data, &signature).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed instruction (typed proposal discriminator 11).
#[allow(dead_code)]
pub fn execute_typed(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    action_kind: u8,
    policy_commitment: [u8; 32],
    payload_hash: [u8; 32],
    envelope_hash: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
    ];
    let mut data = vec![11u8];
    wincode::serialize_into(&mut data, &action_kind).unwrap();
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &payload_hash).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}
