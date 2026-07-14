use crate::quasar_client::approve::ApproveInstruction;
use crate::quasar_client::bind_dwallet::BindDwalletInstruction;
use crate::quasar_client::create_wallet::CreateWalletInstruction;
use crate::quasar_client::execute::ExecuteInstruction;
use crate::quasar_client::ika_sign::IkaSignInstruction;
use crate::quasar_client::propose::ProposeInstruction;
use quasar_lang::client::{DynBytes, DynVec, TailBytes};
use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
};

/// The clear-wallet program ID.
pub fn program_id() -> Pubkey {
    // C1earWa11etMSig1111111111111111111111111111
    let addr = clear_wallet_client::ID;
    Pubkey::new_from_array(addr.to_bytes())
}

fn spl_token_program_id() -> Pubkey {
    Pubkey::new_from_array([
        6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133,
        237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
    ])
}

/// Convert a `solana_sdk::Pubkey` to a `solana_address::Address` (used by the
/// vendored quasar client which lives on a different solana crate version).
fn pk_to_addr(p: Pubkey) -> solana_address::Address {
    solana_address::Address::new_from_array(p.to_bytes())
}

/// Convert a `solana_instruction_v3::Instruction` produced by the vendored
/// quasar client (which uses `solana_address::Address`) into the
/// `solana_sdk::Instruction` shape the RPC client expects.
fn sdk_ix_from_ext(ix: solana_instruction_v3::Instruction) -> Instruction {
    Instruction {
        program_id: Pubkey::new_from_array(ix.program_id.to_bytes()),
        accounts: ix
            .accounts
            .into_iter()
            .map(|m| AccountMeta {
                pubkey: Pubkey::new_from_array(m.pubkey.to_bytes()),
                is_signer: m.is_signer,
                is_writable: m.is_writable,
            })
            .collect(),
        data: ix.data,
    }
}

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
    let ext_ix: solana_instruction_v3::Instruction = CreateWalletInstruction {
        payer: pk_to_addr(args.payer),
        name_hash: pk_to_addr(args.name_hash),
        wallet: pk_to_addr(args.wallet),
        add_intent: pk_to_addr(args.add_intent),
        remove_intent: pk_to_addr(args.remove_intent),
        update_intent: pk_to_addr(args.update_intent),
        system_program: pk_to_addr(solana_sdk::system_program::id()),
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
    let ext_ix: solana_instruction_v3::Instruction = ProposeInstruction {
        payer: pk_to_addr(args.payer),
        wallet: pk_to_addr(args.wallet),
        intent: pk_to_addr(args.intent),
        proposal: pk_to_addr(args.proposal),
        system_program: pk_to_addr(solana_sdk::system_program::id()),
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
    let ext_ix: solana_instruction_v3::Instruction = ApproveInstruction {
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
    let ext_remaining: Vec<solana_instruction_v3::AccountMeta> = remaining_accounts
        .into_iter()
        .map(|m| solana_instruction_v3::AccountMeta {
            pubkey: pk_to_addr(m.pubkey),
            is_signer: m.is_signer,
            is_writable: m.is_writable,
        })
        .collect();
    let ext_ix: solana_instruction_v3::Instruction = ExecuteInstruction {
        wallet: pk_to_addr(wallet),
        vault: pk_to_addr(vault),
        intent: pk_to_addr(intent),
        proposal: pk_to_addr(proposal),
        system_program: pk_to_addr(solana_sdk::system_program::id()),
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
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
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

/// Build execute_typed_escrow_release instruction (typed proposal discriminator 12).
#[allow(dead_code)]
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
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
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
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
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
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
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

/// Build execute_typed_agent_trade_approval instruction (typed proposal discriminator 23).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_agent_trade_approval(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    session: Pubkey,
    risk_ledger: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_raw_le: [u8; 16],
    agent_id_hash: [u8; 32],
    venue_hash: [u8; 32],
    market_hash: [u8; 32],
    side_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    max_leverage_x100: u32,
    session_id_hash: [u8; 32],
    route_hash: [u8; 32],
    risk_check_hash: [u8; 32],
) -> Instruction {
    let accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new(session, false),
        AccountMeta::new(risk_ledger, false),
    ];

    let mut data = vec![23u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &agent_id_hash).unwrap();
    wincode::serialize_into(&mut data, &venue_hash).unwrap();
    wincode::serialize_into(&mut data, &market_hash).unwrap();
    wincode::serialize_into(&mut data, &side_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &max_leverage_x100).unwrap();
    wincode::serialize_into(&mut data, &session_id_hash).unwrap();
    wincode::serialize_into(&mut data, &route_hash).unwrap();
    wincode::serialize_into(&mut data, &risk_check_hash).unwrap();

    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_agent_risk_policy instruction (discriminator 29).
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_agent_risk_policy(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    session: Pubkey,
    risk_ledger: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    session_id_hash: [u8; 32],
    oracle_policy_hash: [u8; 32],
    max_loss_raw_le: [u8; 16],
    status: u8,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(session, false),
        AccountMeta::new(risk_ledger, false),
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
    ];
    let mut data = vec![29u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &session_id_hash).unwrap();
    wincode::serialize_into(&mut data, &oracle_policy_hash).unwrap();
    wincode::serialize_into(&mut data, &max_loss_raw_le).unwrap();
    wincode::serialize_into(&mut data, &status).unwrap();
    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_agent_trade_settlement instruction (discriminator 30).
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_agent_trade_settlement(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    session: Pubkey,
    risk_ledger: Pubkey,
    settlement_receipt: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    session_id_hash: [u8; 32],
    execution_id_hash: [u8; 32],
    settlement_artifact_hash: [u8; 32],
    oracle_policy_hash: [u8; 32],
    closed_notional_raw_le: [u8; 16],
    outcome: u8,
    pnl_abs_raw_le: [u8; 16],
    settlement_sequence: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new(session, false),
        AccountMeta::new(risk_ledger, false),
        AccountMeta::new(settlement_receipt, false),
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
    ];
    let mut data = vec![30u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &session_id_hash).unwrap();
    wincode::serialize_into(&mut data, &execution_id_hash).unwrap();
    wincode::serialize_into(&mut data, &settlement_artifact_hash).unwrap();
    wincode::serialize_into(&mut data, &oracle_policy_hash).unwrap();
    wincode::serialize_into(&mut data, &closed_notional_raw_le).unwrap();
    wincode::serialize_into(&mut data, &outcome).unwrap();
    wincode::serialize_into(&mut data, &pnl_abs_raw_le).unwrap();
    wincode::serialize_into(&mut data, &settlement_sequence).unwrap();
    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_agent_session_grant instruction (typed proposal discriminator 28).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_agent_session_grant(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    session: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    session_id_hash: [u8; 32],
    agent_id_hash: [u8; 32],
    venue_hash: [u8; 32],
    market_hash: [u8; 32],
    max_notional_raw_le: [u8; 16],
    max_leverage_x100: u32,
    expires_at: i64,
    status: u8,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new(session, false),
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
    ];
    let mut data = vec![28u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &session_id_hash).unwrap();
    wincode::serialize_into(&mut data, &agent_id_hash).unwrap();
    wincode::serialize_into(&mut data, &venue_hash).unwrap();
    wincode::serialize_into(&mut data, &market_hash).unwrap();
    wincode::serialize_into(&mut data, &max_notional_raw_le).unwrap();
    wincode::serialize_into(&mut data, &max_leverage_x100).unwrap();
    wincode::serialize_into(&mut data, &expires_at).unwrap();
    wincode::serialize_into(&mut data, &status).unwrap();
    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_escrow_return instruction (typed proposal discriminator 13).
#[allow(dead_code)]
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
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
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

/// Build execute_typed_wallet_policy_update instruction (typed proposal discriminator 26).
#[allow(dead_code)]
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
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
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
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
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
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
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
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
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
    let ext_ix: solana_instruction_v3::Instruction = BindDwalletInstruction {
        payer: pk_to_addr(payer),
        wallet: pk_to_addr(wallet),
        ika_config: pk_to_addr(ika_config),
        dwallet_ownership: pk_to_addr(dwallet_ownership),
        dwallet: pk_to_addr(dwallet),
        cpi_authority: pk_to_addr(cpi_authority),
        caller_program: pk_to_addr(program_id()),
        dwallet_program: pk_to_addr(dwallet_program),
        system_program: pk_to_addr(solana_sdk::system_program::id()),
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
    let ext_ix: solana_instruction_v3::Instruction = IkaSignInstruction {
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
        system_program: pk_to_addr(solana_sdk::system_program::id()),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    #[test]
    fn typed_propose_uses_expected_accounts_and_discriminator() {
        let ix = propose_typed(ProposeTypedArgs {
            payer: key(1),
            wallet: key(2),
            intent: key(3),
            proposal: key(4),
            proposal_index: 7,
            expiry: 1_900_000_000,
            action_kind: 8,
            policy_commitment: [5; 32],
            payload_hash: [6; 32],
            envelope_hash: [7; 32],
            proposer_pubkey: [8; 32],
            signature: [9; 64],
            action_id: [10; 32],
            nonce: [11; 32],
            policy_bytes: &[],
            clear_text: b"Readable action",
        });

        assert_eq!(ix.program_id, program_id());
        assert_eq!(ix.data[0], 8);
        assert_eq!(ix.accounts.len(), 5);
        assert!(ix.accounts[0].is_signer);
        assert!(ix.accounts[0].is_writable);
        assert!(ix.accounts[1].is_writable);
        assert!(ix.accounts[2].is_writable);
        assert!(ix.accounts[3].is_writable);
        assert!(!ix.accounts[4].is_writable);
    }

    #[test]
    fn typed_approve_cancel_execute_use_expected_discriminators() {
        let approve = approve_typed(key(1), key(2), key(3), 1, [4; 64]);
        let cancel = cancel_typed(key(1), key(2), key(3), 1, [4; 64]);
        let execute = execute_typed(key(1), key(2), key(3), 8, [4; 32], [5; 32], [6; 32]);

        assert_eq!(approve.data[0], 9);
        assert_eq!(cancel.data[0], 10);
        assert_eq!(execute.data[0], 11);
        assert_eq!(approve.data.len(), 66);
        assert_eq!(cancel.data.len(), 66);
        assert_eq!(execute.data.len(), 98);
        assert!(!approve.accounts[0].is_writable);
        assert!(!approve.accounts[1].is_writable);
        assert!(approve.accounts[2].is_writable);
        assert!(cancel.accounts[1].is_writable);
        assert!(execute.accounts[1].is_writable);
        assert!(execute.accounts[2].is_writable);
    }

    #[test]
    fn typed_escrow_executors_use_expected_accounts_and_discriminators() {
        let release = execute_typed_escrow_release(
            key(1),
            key(2),
            key(3),
            key(4),
            key(5),
            [6; 32],
            [7; 32],
            1_000_000,
            [8; 32],
            [9; 32],
        );
        let mut amount_bytes = Vec::new();
        amount_bytes.extend_from_slice(&1_000_000u64.to_le_bytes());
        amount_bytes.extend_from_slice(&2_000_000u64.to_le_bytes());
        let unwind = execute_typed_escrow_return(
            key(1),
            key(2),
            key(3),
            key(4),
            [6; 32],
            [7; 32],
            [10; 32],
            &amount_bytes,
            vec![
                AccountMeta::new(key(8), false),
                AccountMeta::new(key(9), false),
            ],
        );

        assert_eq!(release.data[0], 12);
        assert_eq!(unwind.data[0], 13);
        assert_eq!(release.accounts.len(), 6);
        assert_eq!(unwind.accounts.len(), 7);
        assert!(!release.accounts[0].is_writable);
        assert!(release.accounts[1].is_writable);
        assert!(release.accounts[2].is_writable);
        assert!(release.accounts[3].is_writable);
        assert!(release.accounts[4].is_writable);
        assert!(!release.accounts[5].is_writable);
        assert!(unwind.accounts[1].is_writable);
        assert!(!unwind.accounts[4].is_writable);
        assert!(unwind.accounts[5].is_writable);
        assert!(unwind.accounts[6].is_writable);
    }

    #[test]
    fn typed_spl_escrow_executor_uses_expected_accounts_and_discriminator() {
        let release = execute_typed_spl_escrow_release(
            key(1),
            key(2),
            key(3),
            key(4),
            key(5),
            key(6),
            key(7),
            key(8),
            [9; 32],
            [10; 32],
            1_000_000,
            [11; 32],
            [12; 32],
        );
        let unwind = execute_typed_spl_escrow_return(
            key(1),
            key(2),
            key(3),
            key(4),
            key(5),
            key(6),
            [9; 32],
            [10; 32],
            [11; 32],
            &1_000_000u64.to_le_bytes(),
            vec![
                AccountMeta::new(key(7), false),
                AccountMeta::new_readonly(key(8), false),
                AccountMeta::new(key(9), false),
                AccountMeta::new_readonly(key(10), false),
            ],
        );

        assert_eq!(release.data[0], 17);
        assert_eq!(release.accounts.len(), 9);
        assert!(!release.accounts[0].is_writable);
        assert!(!release.accounts[1].is_writable);
        assert!(release.accounts[2].is_writable);
        assert!(release.accounts[3].is_writable);
        assert!(!release.accounts[4].is_writable);
        assert!(release.accounts[5].is_writable);
        assert!(release.accounts[6].is_writable);
        assert!(!release.accounts[7].is_writable);
        assert!(!release.accounts[8].is_writable);
        assert_eq!(release.accounts[8].pubkey, spl_token_program_id());
        assert_eq!(unwind.data[0], 18);
        assert_eq!(unwind.accounts.len(), 11);
        assert!(!unwind.accounts[0].is_writable);
        assert!(!unwind.accounts[1].is_writable);
        assert!(unwind.accounts[2].is_writable);
        assert!(unwind.accounts[3].is_writable);
        assert!(!unwind.accounts[4].is_writable);
        assert!(unwind.accounts[5].is_writable);
        assert!(!unwind.accounts[6].is_writable);
        assert_eq!(unwind.accounts[6].pubkey, spl_token_program_id());
        assert!(unwind.accounts[7].is_writable);
        assert!(!unwind.accounts[8].is_writable);
        assert!(unwind.accounts[9].is_writable);
        assert!(!unwind.accounts[10].is_writable);
    }

    #[test]
    fn typed_cross_chain_escrow_executor_uses_expected_accounts_and_discriminator() {
        let release = execute_typed_cross_chain_escrow_release(
            key(1),
            key(2),
            key(3),
            key(4),
            key(5),
            [6; 32],
            [7; 32],
            2,
            100_000_000u128.to_le_bytes(),
            [8; 32],
            [9; 32],
            [10; 32],
            [11; 32],
            [12; 32],
            [13; 32],
            [14; 32],
        );
        let refund = execute_typed_cross_chain_escrow_return(
            key(1),
            key(2),
            key(3),
            key(4),
            key(5),
            [6; 32],
            [7; 32],
            2,
            100_000_000u128.to_le_bytes(),
            [8; 32],
            [10; 32],
            [11; 32],
            [12; 32],
            [13; 32],
            [14; 32],
        );

        assert_eq!(release.data[0], 19);
        assert_eq!(release.data.len(), 306);
        assert_eq!(release.accounts.len(), 5);
        assert!(!release.accounts[0].is_writable);
        assert!(release.accounts[1].is_writable);
        assert!(release.accounts[2].is_writable);
        assert!(!release.accounts[3].is_writable);
        assert!(!release.accounts[4].is_writable);
        assert_eq!(refund.data[0], 20);
        assert_eq!(refund.data.len(), 274);
        assert_eq!(refund.accounts.len(), 5);
        assert!(!refund.accounts[0].is_writable);
        assert!(refund.accounts[1].is_writable);
        assert!(refund.accounts[2].is_writable);
        assert!(!refund.accounts[3].is_writable);
        assert!(!refund.accounts[4].is_writable);
    }

    #[test]
    fn typed_private_escrow_executor_uses_expected_accounts_and_discriminator() {
        let release = execute_typed_private_escrow_release(
            key(1),
            key(2),
            key(3),
            [4; 32],
            [5; 32],
            100_000_000u128.to_le_bytes(),
            [6; 32],
            [7; 32],
            [8; 32],
            [9; 32],
            [10; 32],
            [11; 32],
            [12; 32],
        );
        let refund = execute_typed_private_escrow_return(
            key(1),
            key(2),
            key(3),
            [4; 32],
            [5; 32],
            100_000_000u128.to_le_bytes(),
            [6; 32],
            [8; 32],
            [9; 32],
            [10; 32],
            [11; 32],
            [12; 32],
        );

        assert_eq!(release.data[0], 21);
        assert_eq!(release.data.len(), 305);
        assert_eq!(release.accounts.len(), 3);
        assert!(!release.accounts[0].is_writable);
        assert!(release.accounts[1].is_writable);
        assert!(release.accounts[2].is_writable);
        assert_eq!(refund.data[0], 22);
        assert_eq!(refund.data.len(), 273);
        assert_eq!(refund.accounts.len(), 3);
        assert!(!refund.accounts[0].is_writable);
        assert!(refund.accounts[1].is_writable);
        assert!(refund.accounts[2].is_writable);
    }

    #[test]
    fn typed_agent_trade_executor_uses_expected_accounts_and_discriminator() {
        let trade = execute_typed_agent_trade_approval(
            key(1),
            key(2),
            key(3),
            key(4),
            key(5),
            [5; 32],
            [6; 32],
            100_000_000u128.to_le_bytes(),
            [7; 32],
            [8; 32],
            [9; 32],
            [10; 32],
            [11; 32],
            250,
            [12; 32],
            [13; 32],
            [14; 32],
        );

        assert_eq!(trade.data[0], 23);
        assert_eq!(trade.data.len(), 341);
        assert_eq!(trade.accounts.len(), 5);
        assert!(!trade.accounts[0].is_writable);
        assert!(trade.accounts[1].is_writable);
        assert!(trade.accounts[2].is_writable);
        assert!(trade.accounts[3].is_writable);
        assert!(trade.accounts[4].is_writable);
    }

    #[test]
    fn typed_agent_risk_and_settlement_use_program_owned_ledgers() {
        let risk = execute_typed_agent_risk_policy(
            key(1),
            key(2),
            key(3),
            key(4),
            key(5),
            key(6),
            [7; 32],
            [8; 32],
            [9; 32],
            [10; 32],
            100u128.to_le_bytes(),
            1,
        );
        assert_eq!(risk.data[0], 29);
        assert_eq!(risk.accounts.len(), 7);
        assert!(risk.accounts[5].is_writable);

        let settlement = execute_typed_agent_trade_settlement(
            key(1),
            key(2),
            key(3),
            key(4),
            key(5),
            key(6),
            key(7),
            [8; 32],
            [9; 32],
            [10; 32],
            [11; 32],
            [12; 32],
            [13; 32],
            250u128.to_le_bytes(),
            2,
            50u128.to_le_bytes(),
            0,
        );
        assert_eq!(settlement.data[0], 30);
        assert_eq!(settlement.accounts.len(), 8);
        assert!(settlement.accounts[4].is_writable);
        assert!(settlement.accounts[5].is_writable);
        assert!(settlement.accounts[6].is_writable);
    }

    #[test]
    fn typed_chain_send_ika_sign_uses_expected_accounts_and_discriminator() {
        let ix = ika_sign_typed_chain_send(
            key(1),
            key(2),
            key(3),
            key(4),
            key(5),
            key(6),
            key(7),
            key(8),
            key(9),
            key(10),
            key(11),
            key(12),
            key(13),
            key(14),
            [15; 32],
            [16; 32],
            1,
            1_000_000u128.to_le_bytes(),
            [17; 32],
            [18; 32],
            [19; 32],
            19,
            20,
            [21; 96],
            &[0xaa, 0xbb, 0xcc],
        );

        assert_eq!(ix.data[0], 25);
        assert_eq!(
            ix.data.len(),
            1 + 32 + 32 + 1 + 16 + 32 + 32 + 32 + 1 + 1 + 96 + 3
        );
        assert_eq!(ix.accounts.len(), 16);
        assert!(ix.accounts[0].is_signer);
        assert!(ix.accounts[0].is_writable);
        assert!(!ix.accounts[1].is_writable);
        assert!(ix.accounts[2].is_writable);
        assert!(ix.accounts[3].is_writable);
        assert!(ix.accounts[4].is_writable);
        assert!(ix.accounts[5].is_writable);
        assert!(ix.accounts[6].is_writable);
        assert!(!ix.accounts[7].is_writable);
        assert!(!ix.accounts[8].is_writable);
        assert!(ix.accounts[9].is_writable);
        assert!(ix.accounts[10].is_writable);
        assert!(!ix.accounts[11].is_writable);
        assert!(!ix.accounts[12].is_writable);
        assert!(!ix.accounts[13].is_writable);
        assert_eq!(ix.accounts[13].pubkey, program_id());
        assert!(!ix.accounts[14].is_writable);
        assert!(!ix.accounts[15].is_writable);
        assert_eq!(ix.data[ix.data.len() - 3..], [0xaa, 0xbb, 0xcc]);
    }

    #[test]
    fn typed_sol_send_executors_use_expected_accounts_and_discriminators() {
        let send = execute_typed_sol_send(
            key(1),
            key(2),
            key(3),
            key(4),
            key(5),
            key(6),
            key(7),
            key(8),
            key(9),
            [8; 32],
            [9; 32],
            1_000_000,
        );
        let batch = execute_typed_sol_batch_send(
            key(1),
            key(2),
            key(3),
            key(4),
            key(5),
            key(6),
            key(7),
            key(8),
            [7; 32],
            [8; 32],
            &1_000_000u64.to_le_bytes(),
            vec![AccountMeta::new(key(9), false)],
        );

        assert_eq!(send.data[0], 14);
        assert_eq!(batch.data[0], 15);
        assert_eq!(send.accounts.len(), 10);
        assert_eq!(batch.accounts.len(), 10);
        assert!(batch.accounts[0].is_signer);
        assert!(batch.accounts[0].is_writable);
        assert!(!batch.accounts[1].is_writable);
        assert!(batch.accounts[2].is_writable);
        assert!(send.accounts[0].is_signer);
        assert!(send.accounts[0].is_writable);
        assert!(!send.accounts[1].is_writable);
        assert!(send.accounts[2].is_writable);
        assert!(send.accounts[3].is_writable);
        assert!(send.accounts[4].is_writable);
        assert!(send.accounts[5].is_writable);
        assert!(send.accounts[6].is_writable);
        assert!(send.accounts[7].is_writable);
        assert!(send.accounts[8].is_writable);
        assert!(batch.accounts[3].is_writable);
        assert!(batch.accounts[7].is_writable);
        assert!(!batch.accounts[8].is_writable);
        assert!(batch.accounts[5].is_writable);
    }

    #[test]
    fn typed_wallet_policy_update_uses_expected_accounts_and_discriminator() {
        let ix = execute_typed_wallet_policy_update(
            key(1),
            key(2),
            key(3),
            key(4),
            key(5),
            [6; 32],
            [7; 32],
            2,
            &[0xca, 0xfe],
        );

        assert_eq!(ix.data[0], 26);
        assert_eq!(ix.accounts.len(), 6);
        assert!(ix.accounts[0].is_signer);
        assert!(ix.accounts[0].is_writable);
        assert!(!ix.accounts[1].is_writable);
        assert!(ix.accounts[2].is_writable);
        assert!(ix.accounts[3].is_writable);
        assert!(ix.accounts[4].is_writable);
        assert!(!ix.accounts[5].is_writable);
    }

    #[test]
    fn cleanup_instructions_use_expected_discriminators() {
        let legacy = cleanup(key(1), key(2));
        let typed = cleanup_typed(key(1), key(2));

        assert_eq!(legacy.data, vec![5]);
        assert_eq!(typed.data, vec![16]);
        assert_eq!(legacy.accounts.len(), 2);
        assert_eq!(typed.accounts.len(), 2);
        assert!(legacy.accounts[0].is_writable);
        assert!(legacy.accounts[1].is_writable);
        assert!(typed.accounts[0].is_writable);
        assert!(typed.accounts[1].is_writable);
    }
}
