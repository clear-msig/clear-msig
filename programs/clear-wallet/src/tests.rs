extern crate std;

use alloc::vec::Vec;
use {
    crate::clear_wallet::cpi::*,
    crate::state::ika_config::{IKA_CONFIG_DISCRIMINATOR, IKA_CONFIG_LEN},
    crate::utils::clearsign::{
        hash_agent_trade_approval_payload, hash_batch_send_sol_payload_iter, hash_clear_text,
        hash_cross_chain_escrow_release_payload, hash_cross_chain_escrow_return_payload,
        hash_envelope, hash_policy_commitment, hash_private_escrow_release_payload,
        hash_private_escrow_return_payload, hash_release_milestone_payload,
        hash_release_token_milestone_payload, hash_return_escrow_sol_payload_iter,
        hash_return_token_escrow_payload_iter, hash_send_payload, write_vote_message,
        ClearSignActionKind, ClearSignAmount, ClearSignEnvelope, ClearSignVoteKind,
        MAX_CLEARSIGN_TEXT_BYTES,
    },
    crate::utils::policy::hash_typed_policy,
    alloc::vec,
    clear_wallet_client::{
        intent_builder::IntentBuilder,
        intents,
        pda::{
            compute_name_hash, find_intent_address, find_policy_spend_address,
            find_proposal_address, find_typed_proposal_address, find_vault_address,
            find_wallet_address,
        },
    },
    ed25519_dalek::Signer as DalekSigner,
    quasar_lang::client::{DynBytes, DynVec, TailBytes},
    quasar_svm::{Account, Instruction, Pubkey, QuasarSvm},
    sha2::{Digest, Sha256},
    solana_instruction::AccountMeta,
    std::{format, println, string::String},
};

// =========================================================================
// Helpers
// =========================================================================

fn setup() -> QuasarSvm {
    let elf = std::fs::read("../../target/deploy/clear_wallet.so").unwrap();
    QuasarSvm::new().with_program(&crate::ID, &elf)
}

fn setup_with_tokens() -> QuasarSvm {
    let elf = std::fs::read("../../target/deploy/clear_wallet.so").unwrap();
    QuasarSvm::new()
        .with_program(&crate::ID, &elf)
        .with_token_program()
        .with_associated_token_program()
}

fn funded_account(address: Pubkey) -> Account {
    quasar_svm::token::create_keyed_system_account(&address, 10_000_000_000)
}

fn empty_account(address: Pubkey) -> Account {
    Account {
        address,
        lamports: 0,
        data: vec![],
        owner: quasar_svm::system_program::ID,
        executable: false,
    }
}

fn keyed_ika_config_account(
    address: Pubkey,
    wallet: Pubkey,
    dwallet: Pubkey,
    chain_kind: u8,
    signature_scheme: u16,
    bump: u8,
) -> Account {
    let mut data = vec![0u8; IKA_CONFIG_LEN];
    data[0] = IKA_CONFIG_DISCRIMINATOR;
    data[1..33].copy_from_slice(wallet.as_ref());
    data[33..65].copy_from_slice(dwallet.as_ref());
    data[65..97].copy_from_slice(&[7u8; 32]);
    data[97] = chain_kind;
    data[98..100].copy_from_slice(&signature_scheme.to_le_bytes());
    data[100] = bump;
    Account {
        address,
        lamports: 1_000_000,
        data,
        owner: crate::ID,
        executable: false,
    }
}

fn new_keypair() -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::generate(&mut rand::thread_rng())
}

fn pubkey_of(key: &ed25519_dalek::SigningKey) -> Pubkey {
    Pubkey::from(key.verifying_key().to_bytes())
}

fn pubkey_bytes(key: &ed25519_dalek::SigningKey) -> [u8; 32] {
    key.verifying_key().to_bytes()
}

/// Wrap a raw message body in the Solana offchain message header that the
/// on-chain `MessageBuilder` prepends. The on-chain code verifies signatures
/// against the wrapped form, so tests must wrap before signing.
///
/// Format: `\xffsolana offchain` (16) + version(1) + format(1) + len LE(2) + body
fn wrap_offchain(body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(20 + body.len());
    out.extend_from_slice(b"\xffsolana offchain");
    out.push(0); // version 0
    out.push(0); // format 0 = restricted ASCII
    out.extend_from_slice(&(body.len() as u16).to_le_bytes());
    out.extend_from_slice(body);
    out
}

fn sign_message(key: &ed25519_dalek::SigningKey, msg: &[u8]) -> [u8; 64] {
    // `msg` is already an offchain-wrapped message produced by
    // `add_intent_msg` / `remove_intent_msg` / a hand-rolled
    // `wrap_offchain(...)`. The on-chain `MessageBuilder` produces
    // the same single-wrapped form, so signing it as-is matches.
    key.sign(msg).to_bytes()
}

fn sha256_hash(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

fn format_timestamp(ts: i64) -> String {
    let secs_per_day: i64 = 86400;
    let mut days = ts / secs_per_day;
    let day_secs = ((ts % secs_per_day) + secs_per_day) % secs_per_day;
    if ts < 0 && day_secs > 0 {
        days -= 1;
    }
    let (hour, min, sec) = (day_secs / 3600, (day_secs % 3600) / 60, day_secs % 60);
    let adj = days + 719468;
    let era = if adj >= 0 { adj } else { adj - 146096 } / 146097;
    let doe = adj - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02} {hour:02}:{min:02}:{sec:02}")
}

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{b:02x}")).collect()
}

fn message_suffix(wallet_name: &str, proposal_index: u64) -> String {
    format!(" | wallet: {wallet_name} proposal: {proposal_index}")
}

const DEFAULT_EXPIRY: i64 = 1_000_000_000;

fn typed_test_expiry() -> i64 {
    600
}

type MessageFn = dyn Fn(&str, i64, &str, u64, &[u8]) -> Vec<u8>;

// =========================================================================
// Message builders (must match on-chain format exactly)
// =========================================================================

fn add_intent_msg(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    data: &[u8],
) -> Vec<u8> {
    let body = format!(
        "expires {}: {action} add intent definition_hash: {}{}",
        format_timestamp(expiry),
        hex_encode(&sha256_hash(data)),
        message_suffix(wallet_name, proposal_index),
    );
    wrap_offchain(body.as_bytes())
}

fn remove_intent_msg(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    intent_index: u8,
) -> Vec<u8> {
    let body = format!(
        "expires {}: {action} remove intent {intent_index}{}",
        format_timestamp(expiry),
        message_suffix(wallet_name, proposal_index),
    );
    wrap_offchain(body.as_bytes())
}

// =========================================================================
// Instruction builder helpers
// =========================================================================

fn create_wallet_ix(
    payer: Pubkey,
    name: &str,
    proposers: &[Pubkey],
    approvers: &[Pubkey],
    threshold: u8,
) -> (Instruction, Vec<Account>) {
    let name_hash = Pubkey::from(compute_name_hash(name));
    let creator = solana_address::Address::new_from_array(payer.to_bytes());
    let (wallet, _) = find_wallet_address(name, &creator, &crate::ID);
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (update_intent, _) = find_intent_address(&wallet, 2, &crate::ID);

    let instruction: Instruction = CreateWalletInstruction {
        payer,
        name_hash,
        wallet,
        add_intent,
        remove_intent,
        update_intent,
        system_program: quasar_svm::system_program::ID,
        name: DynBytes::new(name.as_bytes().to_vec()),
        approval_threshold: threshold,
        cancellation_threshold: 1,
        timelock_seconds: 0,
        proposers: DynVec::new(proposers.iter().map(|p| p.to_bytes()).collect()),
        approvers: DynVec::new(approvers.iter().map(|a| a.to_bytes()).collect()),
        policy_ciphertexts: TailBytes(Vec::new()),
    }
    .into();

    let accounts = vec![
        funded_account(payer),
        empty_account(name_hash),
        empty_account(wallet),
        empty_account(add_intent),
        empty_account(remove_intent),
        empty_account(update_intent),
    ];
    (instruction, accounts)
}

struct ProposeArgs {
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    expiry: i64,
    proposer_pubkey: [u8; 32],
    signature: [u8; 64],
    params_data: Vec<u8>,
}

fn build_propose_ix(args: ProposeArgs) -> Instruction {
    let (proposal, _) = find_proposal_address(&args.intent, args.proposal_index, &crate::ID);
    ProposeInstruction {
        payer: args.payer,
        wallet: args.wallet,
        intent: args.intent,
        proposal,
        system_program: quasar_svm::system_program::ID,
        proposal_index: args.proposal_index,
        expiry: args.expiry,
        proposer_pubkey: args.proposer_pubkey,
        signature: args.signature,
        params_data: TailBytes(args.params_data),
    }
    .into()
}

fn build_approve_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    expiry: i64,
    approver_index: u8,
    signature: [u8; 64],
) -> Instruction {
    ApproveInstruction {
        wallet,
        intent,
        proposal,
        expiry,
        approver_index,
        signature,
    }
    .into()
}

fn build_cancel_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    expiry: i64,
    canceller_index: u8,
    signature: [u8; 64],
) -> Instruction {
    CancelInstruction {
        wallet,
        intent,
        proposal,
        expiry,
        canceller_index,
        signature,
    }
    .into()
}

fn build_execute_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    remaining: Vec<AccountMeta>,
) -> (Instruction, Pubkey) {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let instruction: Instruction = ExecuteInstruction {
        wallet,
        vault,
        intent,
        proposal,
        system_program: quasar_svm::system_program::ID,
        remaining_accounts: remaining,
    }
    .into();
    (instruction, vault)
}

struct TypedProposalArgs {
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    expiry: i64,
    action_kind: u8,
    policy_commitment: [u8; 32],
    payload_hash: [u8; 32],
    envelope_hash: [u8; 32],
    proposer_pubkey: [u8; 32],
    signature: [u8; 64],
    policy_bytes: Vec<u8>,
    clear_text: Vec<u8>,
    action_id: [u8; 32],
    nonce: [u8; 32],
}

fn build_propose_typed_ix(args: TypedProposalArgs) -> Instruction {
    let (proposal, _) = find_typed_proposal_address(&args.intent, args.proposal_index, &crate::ID);
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
    wincode::serialize_into(&mut data, &DynBytes::<u32>::new(args.policy_bytes)).unwrap();
    wincode::serialize_into(&mut data, &TailBytes(args.clear_text)).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(args.payer, true),
            AccountMeta::new(args.wallet, false),
            AccountMeta::new(args.intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

fn build_execute_typed_escrow_release_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    recipient: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_lamports: u64,
    escrow_id_hash: [u8; 32],
    milestone_id_hash: [u8; 32],
) -> Instruction {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let mut data = vec![12u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_lamports).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &milestone_id_hash).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(vault, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new(recipient, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

fn build_execute_typed_spl_escrow_release_ix(
    wallet: Pubkey,
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
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let mut data = vec![17u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_tokens).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &milestone_id_hash).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new_readonly(vault, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(source_token, false),
            AccountMeta::new(destination_token, false),
            AccountMeta::new_readonly(recipient_owner, false),
            AccountMeta::new_readonly(quasar_svm::SPL_TOKEN_PROGRAM_ID, false),
        ],
        data,
    }
}

fn build_execute_typed_spl_escrow_return_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    mint: Pubkey,
    source_token: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    escrow_id_hash: [u8; 32],
    amount_tokens_le: Vec<u8>,
    remaining_accounts: Vec<AccountMeta>,
) -> Instruction {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let mut data = vec![18u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    data.extend_from_slice(&amount_tokens_le);

    let mut accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new_readonly(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new(source_token, false),
        AccountMeta::new_readonly(quasar_svm::SPL_TOKEN_PROGRAM_ID, false),
    ];
    accounts.extend(remaining_accounts);

    Instruction {
        program_id: crate::ID,
        accounts,
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_cross_chain_escrow_release_ix(
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
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(ika_config, false),
            AccountMeta::new_readonly(dwallet, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_cross_chain_escrow_return_ix(
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
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(ika_config, false),
            AccountMeta::new_readonly(dwallet, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_chain_send_ix(
    wallet: Pubkey,
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
    let mut data = vec![24u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &chain_kind).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &recipient_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &tx_template_hash).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(ika_config, false),
            AccountMeta::new_readonly(dwallet, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_private_escrow_release_ix(
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
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_private_escrow_return_ix(
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
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_agent_trade_approval_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_raw_le: [u8; 16],
    venue_hash: [u8; 32],
    market_hash: [u8; 32],
    side_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    max_leverage_x100: u32,
    session_id_hash: [u8; 32],
    route_hash: [u8; 32],
    risk_check_hash: [u8; 32],
) -> Instruction {
    let mut data = vec![23u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &venue_hash).unwrap();
    wincode::serialize_into(&mut data, &market_hash).unwrap();
    wincode::serialize_into(&mut data, &side_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &max_leverage_x100).unwrap();
    wincode::serialize_into(&mut data, &session_id_hash).unwrap();
    wincode::serialize_into(&mut data, &route_hash).unwrap();
    wincode::serialize_into(&mut data, &risk_check_hash).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
        ],
        data,
    }
}

fn build_execute_typed_escrow_return_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    escrow_id_hash: [u8; 32],
    amount_lamports_le: Vec<u8>,
    remaining_accounts: Vec<AccountMeta>,
) -> Instruction {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let mut data = vec![13u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    data.extend_from_slice(&amount_lamports_le);

    let mut accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
    ];
    accounts.extend(remaining_accounts);

    Instruction {
        program_id: crate::ID,
        accounts,
        data,
    }
}

fn build_execute_typed_sol_send_ix(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    recipient: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_lamports: u64,
) -> Instruction {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let (policy_spend, _) = find_policy_spend_address(&wallet, &crate::ID);
    let mut data = vec![14u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_lamports).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(policy_spend, false),
            AccountMeta::new(vault, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new(recipient, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

fn empty_policy_spend_account(wallet: Pubkey, policy_commitment: [u8; 32]) -> Account {
    let _ = policy_commitment;
    let (policy_spend, _) = find_policy_spend_address(&wallet, &crate::ID);
    empty_account(policy_spend)
}

fn build_execute_typed_sol_batch_send_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_lamports_le: Vec<u8>,
    remaining_accounts: Vec<AccountMeta>,
) -> Instruction {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let mut data = vec![15u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    data.extend_from_slice(&amount_lamports_le);

    let mut accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
    ];
    accounts.extend(remaining_accounts);

    Instruction {
        program_id: crate::ID,
        accounts,
        data,
    }
}

fn get_proposal_address(intent: Pubkey, index: u64) -> Pubkey {
    find_proposal_address(&intent, index, &crate::ID).0
}

fn get_typed_proposal_address(intent: Pubkey, index: u64) -> Pubkey {
    find_typed_proposal_address(&intent, index, &crate::ID).0
}

fn build_cleanup_typed_ix(proposal: Pubkey, rent_refund: Pubkey) -> Instruction {
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(proposal, false),
            AccountMeta::new(rent_refund, false),
        ],
        data: vec![16u8],
    }
}

fn fund_vault(svm: &mut QuasarSvm, payer: Pubkey, wallet: Pubkey, amount: u64) -> Pubkey {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let fund_vault_ix = solana_instruction::Instruction {
        program_id: quasar_svm::system_program::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(vault, false),
        ],
        data: {
            let mut d = vec![2, 0, 0, 0]; // System Transfer discriminator
            d.extend_from_slice(&amount.to_le_bytes());
            d
        },
    };
    let result = svm.process_instruction(
        &fund_vault_ix,
        &[funded_account(payer), empty_account(vault)],
    );
    assert!(result.is_ok(), "fund vault failed: {:?}", result.raw_result);
    vault
}

fn sign_typed_vote(
    key: &ed25519_dalek::SigningKey,
    vote_kind: ClearSignVoteKind,
    wallet_name: &str,
    proposal_index: u64,
    envelope_hash: [u8; 32],
) -> [u8; 64] {
    let mut message = [0u8; MAX_CLEARSIGN_TEXT_BYTES + 160];
    let message_len = write_vote_message(
        &mut message,
        vote_kind,
        wallet_name.as_bytes(),
        proposal_index,
        envelope_hash,
        TEST_CLEAR_TEXT,
    )
    .expect("test ClearSign vote message should be valid");
    let signature = key.sign(&message[..message_len]).to_bytes();
    brine_ed25519::sig_verify(
        &key.verifying_key().to_bytes(),
        &signature,
        &message[..message_len],
    )
    .expect("test ClearSign signature should verify locally");
    signature
}

const TEST_CLEAR_TEXT: &[u8] =
    b"Send 1 SOL from test wallet to test recipient\nRequires wallet approval";

fn typed_sol_policy_bytes(
    mode: u8,
    max_amount_lamports: u64,
    extra_cooldown_seconds: u32,
    recipients: &[Pubkey],
    required_approvers: &[Pubkey],
) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"CSP1");
    out.push(mode);
    out.extend_from_slice(&max_amount_lamports.to_le_bytes());
    out.extend_from_slice(&extra_cooldown_seconds.to_le_bytes());
    out.push(recipients.len() as u8);
    out.push(required_approvers.len() as u8);
    for recipient in recipients {
        out.extend_from_slice(recipient.as_ref());
    }
    for approver in required_approvers {
        out.extend_from_slice(approver.as_ref());
    }
    out
}

fn typed_sol_policy_bytes_with_velocity(
    mode: u8,
    max_amount_lamports: u64,
    extra_cooldown_seconds: u32,
    recipients: &[Pubkey],
    required_approvers: &[Pubkey],
    velocity_cap_lamports: u64,
    velocity_window_seconds: u32,
) -> Vec<u8> {
    let mut out = typed_sol_policy_bytes(
        mode,
        max_amount_lamports,
        extra_cooldown_seconds,
        recipients,
        required_approvers,
    );
    out.push(1);
    out.extend_from_slice(&12u16.to_le_bytes());
    out.extend_from_slice(&velocity_cap_lamports.to_le_bytes());
    out.extend_from_slice(&velocity_window_seconds.to_le_bytes());
    out
}

fn propose_typed_sol_send_with_policy(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    proposer: &ed25519_dalek::SigningKey,
    approvers: &[Pubkey],
    threshold: u8,
    recipient: Pubkey,
    amount_lamports: u64,
    policy_bytes: &[u8],
) -> (Pubkey, Pubkey, Pubkey, [u8; 32], [u8; 32]) {
    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(proposer)],
        approvers,
        threshold,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (proposal, policy_commitment, envelope_hash) = propose_typed_sol_send_on_wallet(
        svm,
        payer,
        wallet_name,
        wallet,
        intent,
        0,
        proposer,
        recipient,
        amount_lamports,
        policy_bytes,
    );

    (wallet, intent, proposal, policy_commitment, envelope_hash)
}

fn propose_typed_sol_send_on_wallet(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &ed25519_dalek::SigningKey,
    recipient: Pubkey,
    amount_lamports: u64,
    policy_bytes: &[u8],
) -> (Pubkey, [u8; 32], [u8; 32]) {
    let proposal = get_typed_proposal_address(intent, proposal_index);
    let action_id = sha256_hash(
        &[
            wallet_name.as_bytes(),
            b":sol-send:",
            &proposal_index.to_le_bytes(),
        ]
        .concat(),
    );
    let nonce = sha256_hash(
        &[
            wallet_name.as_bytes(),
            b":nonce:",
            &proposal_index.to_le_bytes(),
        ]
        .concat(),
    );
    let expiry = typed_test_expiry();
    let policy_commitment = if policy_bytes.is_empty() {
        hash_policy_commitment(&[b"send:sol"])
    } else {
        hash_typed_policy(policy_bytes)
    };
    let payload_hash = hash_send_payload(
        recipient.as_ref(),
        &ClearSignAmount {
            asset: b"SOL",
            raw_amount: amount_lamports as u128,
        },
    );
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::Send,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });

    let propose = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent,
        proposal_index,
        expiry,
        action_kind: ClearSignActionKind::Send.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(proposer),
        signature: sign_typed_vote(
            proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            proposal_index,
            envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: policy_bytes.to_vec(),
        action_id,
        nonce,
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);
    assert!(
        result.is_ok(),
        "typed SOL policy proposal failed: {:?}",
        result.raw_result
    );

    (proposal, policy_commitment, envelope_hash)
}

#[test]
fn test_typed_propose_rejects_signature_for_different_readable_text() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-readable-drift";
    let action_id = sha256_hash(b"readable-drift-action");
    let nonce = sha256_hash(b"readable-drift-nonce");
    let expiry = typed_test_expiry();

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let proposal_index = 0u64;
    let proposal = get_typed_proposal_address(intent, proposal_index);
    let tampered_clear_text = b"Send 99 SOL from test wallet to attacker";
    let payload_hash = hash_send_payload(
        b"test recipient",
        &ClearSignAmount {
            asset: b"SOL",
            raw_amount: 1_000_000_000,
        },
    );
    let policy_commitment = hash_policy_commitment(&[b"send:sol"]);
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::Send,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(tampered_clear_text).unwrap(),
    });

    let propose = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent,
        proposal_index,
        expiry,
        action_kind: ClearSignActionKind::Send.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            proposal_index,
            envelope_hash,
        ),
        clear_text: tampered_clear_text.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);

    assert!(
        result.is_err(),
        "typed proposal accepted a signature over different readable text"
    );
}

/// Full propose → approve → execute flow.
struct ProposeApproveExecuteArgs<'a> {
    svm: &'a mut QuasarSvm,
    payer: Pubkey,
    wallet: Pubkey,
    wallet_name: &'a str,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &'a ed25519_dalek::SigningKey,
    approver: &'a ed25519_dalek::SigningKey,
    params_data: Vec<u8>,
    msg_fn: &'a MessageFn,
    execute_remaining: Vec<AccountMeta>,
    execute_extra_accounts: Vec<Account>,
}

fn propose_approve_execute(args: ProposeApproveExecuteArgs<'_>) -> Pubkey {
    let proposal_address = get_proposal_address(args.intent, args.proposal_index);

    // Propose
    let msg = (args.msg_fn)(
        "propose",
        DEFAULT_EXPIRY,
        args.wallet_name,
        args.proposal_index,
        &args.params_data,
    );
    let instruction = build_propose_ix(ProposeArgs {
        payer: args.payer,
        wallet: args.wallet,
        intent: args.intent,
        proposal_index: args.proposal_index,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(args.proposer),
        signature: sign_message(args.proposer, &msg),
        params_data: args.params_data.clone(),
    });
    let result = args.svm.process_instruction(
        &instruction,
        &[funded_account(args.payer), empty_account(proposal_address)],
    );
    assert!(result.is_ok(), "propose failed: {:?}", result.raw_result);

    // Approve (approver is always at index 0)
    let msg = (args.msg_fn)(
        "approve",
        DEFAULT_EXPIRY,
        args.wallet_name,
        args.proposal_index,
        &args.params_data,
    );
    let instruction = build_approve_ix(
        args.wallet,
        args.intent,
        proposal_address,
        DEFAULT_EXPIRY,
        0,
        sign_message(args.approver, &msg),
    );
    let result = args.svm.process_instruction(&instruction, &[]);
    assert!(result.is_ok(), "approve failed: {:?}", result.raw_result);

    // Execute — vault is already in SVM state, don't overwrite it with empty
    let (instruction, _vault) = build_execute_ix(
        args.wallet,
        args.intent,
        proposal_address,
        args.execute_remaining,
    );
    let all_accounts = args.execute_extra_accounts;
    let result = args.svm.process_instruction(&instruction, &all_accounts);
    assert!(result.is_ok(), "execute failed: {:?}", result.raw_result);
    println!("  EXECUTE CU: {}", result.compute_units_consumed);

    proposal_address
}

// =========================================================================
// Tests
// =========================================================================

#[test]
fn test_create_wallet() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let (instruction, accounts) = create_wallet_ix(
        payer,
        "treasury",
        &[Pubkey::new_unique()],
        &[Pubkey::new_unique()],
        1,
    );
    let result = svm.process_instruction(&instruction, &accounts);
    assert!(result.is_ok(), "create failed: {:?}", result.raw_result);

    let creator = solana_address::Address::new_from_array(payer.to_bytes());
    let (wallet, _) = find_wallet_address("treasury", &creator, &crate::ID);
    assert_eq!(result.account(&wallet).unwrap().data[0], 1);
    for index in 0..3u8 {
        let (intent_address, _) = find_intent_address(&wallet, index, &crate::ID);
        assert_eq!(result.account(&intent_address).unwrap().data[0], 2);
    }
    println!("  CREATE CU: {}", result.compute_units_consumed);
}

#[test]
fn test_execute_typed_escrow_release_moves_sol() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-release";
    let amount_lamports = 2_000_000u64;
    let escrow_id_hash = sha256_hash(b"escrow-release-1");
    let milestone_id_hash = sha256_hash(b"milestone-1");
    let action_id = sha256_hash(b"release-action-1");
    let nonce = sha256_hash(b"release-nonce-1");
    let expiry = typed_test_expiry();

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let proposal_index = 0u64;
    let proposal = get_typed_proposal_address(intent, proposal_index);
    let recipient = Pubkey::new_unique();
    let policy_commitment = hash_policy_commitment(&[b"escrow:release"]);
    let payload_hash = hash_release_milestone_payload(
        &escrow_id_hash,
        &milestone_id_hash,
        recipient.as_ref(),
        &ClearSignAmount {
            asset: b"SOL",
            raw_amount: amount_lamports as u128,
        },
    );
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::ReleaseMilestone,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });

    let propose = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent,
        proposal_index,
        expiry,
        action_kind: ClearSignActionKind::ReleaseMilestone.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            proposal_index,
            envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);
    assert!(
        result.is_ok(),
        "typed escrow release propose failed: {:?}",
        result.raw_result
    );

    let vault = fund_vault(&mut svm, payer, wallet, amount_lamports + 1_000_000);
    let vault_pre = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    let execute = build_execute_typed_escrow_release_ix(
        wallet,
        intent,
        proposal,
        recipient,
        policy_commitment,
        envelope_hash,
        amount_lamports,
        escrow_id_hash,
        milestone_id_hash,
    );
    let result = svm.process_instruction(&execute, &[empty_account(recipient)]);
    assert!(
        result.is_ok(),
        "typed escrow release execute failed: {:?}",
        result.raw_result
    );

    assert_eq!(
        svm.get_account(&recipient).map(|a| a.lamports).unwrap_or(0),
        amount_lamports
    );
    assert_eq!(
        svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0),
        vault_pre - amount_lamports
    );
    assert_eq!(
        svm.get_account(&proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );
}

#[test]
fn test_execute_typed_spl_escrow_release_moves_tokens() {
    use quasar_svm::token::{
        create_keyed_mint_account, create_keyed_token_account, Mint, TokenAccount,
    };
    use spl_token::solana_program::program_pack::Pack;
    use spl_token::state::AccountState;

    let mut svm = setup_with_tokens();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-spl-release";
    let amount_tokens = 250_000u64;
    let initial_supply = 1_000_000u64;
    let escrow_id_hash = sha256_hash(b"spl-escrow-release-1");
    let milestone_id_hash = sha256_hash(b"spl-milestone-1");
    let action_id = sha256_hash(b"spl-release-action-1");
    let nonce = sha256_hash(b"spl-release-nonce-1");
    let expiry = typed_test_expiry();

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let proposal_index = 0u64;
    let proposal = get_typed_proposal_address(intent, proposal_index);
    let mint = Pubkey::new_unique();
    let recipient_owner = Pubkey::new_unique();
    let source_token = Pubkey::new_unique();
    let destination_token = Pubkey::new_unique();

    svm.set_account(create_keyed_mint_account(
        &mint,
        &Mint {
            decimals: 6,
            supply: initial_supply,
            is_initialized: true,
            ..Default::default()
        },
    ));
    svm.set_account(create_keyed_token_account(
        &source_token,
        &TokenAccount {
            mint,
            owner: vault,
            amount: initial_supply,
            state: AccountState::Initialized,
            ..Default::default()
        },
    ));
    svm.set_account(create_keyed_token_account(
        &destination_token,
        &TokenAccount {
            mint,
            owner: recipient_owner,
            amount: 0,
            state: AccountState::Initialized,
            ..Default::default()
        },
    ));

    let policy_commitment = hash_policy_commitment(&[b"escrow:release:spl"]);
    let amount = ClearSignAmount {
        asset: mint.as_ref(),
        raw_amount: amount_tokens as u128,
    };
    let payload_hash = hash_release_token_milestone_payload(
        &escrow_id_hash,
        &milestone_id_hash,
        mint.as_ref(),
        source_token.as_ref(),
        destination_token.as_ref(),
        recipient_owner.as_ref(),
        &amount,
    );
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::ReleaseMilestone,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });

    let propose = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent,
        proposal_index,
        expiry,
        action_kind: ClearSignActionKind::ReleaseMilestone.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            proposal_index,
            envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed SPL escrow release propose failed: {:?}",
        result.raw_result
    );

    let execute = build_execute_typed_spl_escrow_release_ix(
        wallet,
        intent,
        proposal,
        mint,
        source_token,
        destination_token,
        recipient_owner,
        policy_commitment,
        envelope_hash,
        amount_tokens,
        escrow_id_hash,
        milestone_id_hash,
    );
    let result = svm.process_instruction(&execute, &[empty_account(recipient_owner)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed SPL escrow release execute failed: {:?}",
        result.raw_result
    );

    let source_account = svm.get_account(&source_token).unwrap();
    let source_state: TokenAccount = TokenAccount::unpack(&source_account.data).unwrap();
    assert_eq!(source_state.amount, initial_supply - amount_tokens);

    let destination_account = svm.get_account(&destination_token).unwrap();
    let destination_state: TokenAccount = TokenAccount::unpack(&destination_account.data).unwrap();
    assert_eq!(destination_state.amount, amount_tokens);
    assert_eq!(destination_state.owner, recipient_owner);
    assert_eq!(destination_state.mint, mint);
    assert_eq!(
        svm.get_account(&proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );
}

#[test]
fn test_execute_typed_spl_escrow_return_moves_tokens_to_funders() {
    use quasar_svm::token::{
        create_keyed_mint_account, create_keyed_token_account, Mint, TokenAccount,
    };
    use spl_token::solana_program::program_pack::Pack;
    use spl_token::state::AccountState;

    let mut svm = setup_with_tokens();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-spl-return";
    let initial_supply = 1_000_000u64;
    let amount_a = 125_000u64;
    let amount_b = 275_000u64;
    let escrow_id_hash = sha256_hash(b"spl-escrow-return-1");
    let action_id = sha256_hash(b"spl-return-action-1");
    let nonce = sha256_hash(b"spl-return-nonce-1");
    let expiry = typed_test_expiry();

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let proposal_index = 0u64;
    let proposal = get_typed_proposal_address(intent, proposal_index);
    let mint = Pubkey::new_unique();
    let funder_a = Pubkey::new_unique();
    let funder_b = Pubkey::new_unique();
    let source_token = Pubkey::new_unique();
    let destination_a = Pubkey::new_unique();
    let destination_b = Pubkey::new_unique();

    svm.set_account(create_keyed_mint_account(
        &mint,
        &Mint {
            decimals: 6,
            supply: initial_supply,
            is_initialized: true,
            ..Default::default()
        },
    ));
    svm.set_account(create_keyed_token_account(
        &source_token,
        &TokenAccount {
            mint,
            owner: vault,
            amount: initial_supply,
            state: AccountState::Initialized,
            ..Default::default()
        },
    ));
    svm.set_account(create_keyed_token_account(
        &destination_a,
        &TokenAccount {
            mint,
            owner: funder_a,
            amount: 0,
            state: AccountState::Initialized,
            ..Default::default()
        },
    ));
    svm.set_account(create_keyed_token_account(
        &destination_b,
        &TokenAccount {
            mint,
            owner: funder_b,
            amount: 0,
            state: AccountState::Initialized,
            ..Default::default()
        },
    ));

    let policy_commitment = hash_policy_commitment(&[b"escrow:return:spl"]);
    let payload_hash = hash_return_token_escrow_payload_iter(
        &escrow_id_hash,
        mint.as_ref(),
        source_token.as_ref(),
        [
            (destination_a.as_ref(), funder_a.as_ref(), amount_a),
            (destination_b.as_ref(), funder_b.as_ref(), amount_b),
        ]
        .into_iter(),
    );
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::ReturnEscrowFunds,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });

    let propose = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent,
        proposal_index,
        expiry,
        action_kind: ClearSignActionKind::ReturnEscrowFunds.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            proposal_index,
            envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);
    assert!(
        result.is_ok(),
        "typed SPL escrow return propose failed: {:?}",
        result.raw_result
    );

    let mut amount_bytes = Vec::new();
    amount_bytes.extend_from_slice(&amount_a.to_le_bytes());
    amount_bytes.extend_from_slice(&amount_b.to_le_bytes());
    let execute = build_execute_typed_spl_escrow_return_ix(
        wallet,
        intent,
        proposal,
        mint,
        source_token,
        policy_commitment,
        envelope_hash,
        escrow_id_hash,
        amount_bytes,
        vec![
            AccountMeta::new(destination_a, false),
            AccountMeta::new_readonly(funder_a, false),
            AccountMeta::new(destination_b, false),
            AccountMeta::new_readonly(funder_b, false),
        ],
    );
    let result = svm.process_instruction(
        &execute,
        &[empty_account(funder_a), empty_account(funder_b)],
    );
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed SPL escrow return execute failed: {:?}",
        result.raw_result
    );

    let source_account = svm.get_account(&source_token).unwrap();
    let source_state: TokenAccount = TokenAccount::unpack(&source_account.data).unwrap();
    assert_eq!(source_state.amount, initial_supply - amount_a - amount_b);

    let destination_a_account = svm.get_account(&destination_a).unwrap();
    let destination_a_state: TokenAccount =
        TokenAccount::unpack(&destination_a_account.data).unwrap();
    assert_eq!(destination_a_state.amount, amount_a);
    assert_eq!(destination_a_state.owner, funder_a);

    let destination_b_account = svm.get_account(&destination_b).unwrap();
    let destination_b_state: TokenAccount =
        TokenAccount::unpack(&destination_b_account.data).unwrap();
    assert_eq!(destination_b_state.amount, amount_b);
    assert_eq!(destination_b_state.owner, funder_b);
    assert_eq!(
        svm.get_account(&proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );
}

#[test]
fn test_execute_typed_chain_send_finalizes_verified_remote_send() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "typed-chain-send";
    let chain_kind = 2u8;
    let amount_raw = 250_000_000u128;
    let recipient_hash = sha256_hash(b"tb1qrecipientaddress");
    let wrong_recipient_hash = sha256_hash(b"tb1qattackeraddress");
    let asset_id_hash = sha256_hash(b"BTC:testnet");
    let tx_template = b"btc-send-template-v1";
    let tx_template_hash = sha256_hash(tx_template);
    let action_id = sha256_hash(b"chain-send-action-1");
    let nonce = sha256_hash(b"chain-send-nonce-1");
    let expiry = typed_test_expiry();

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let mut builder = IntentBuilder::new();
    builder
        .set_chain_kind(chain_kind)
        .set_governance(1, 1, 0)
        .add_proposer(solana_address::Address::new_from_array(
            pubkey_of(&proposer).to_bytes(),
        ))
        .add_approver(solana_address::Address::new_from_array(
            pubkey_of(&proposer).to_bytes(),
        ))
        .set_template("Send BTC")
        .set_tx_template(tx_template);
    let built_intent = builder.build();
    let intent_index = 3u8;
    let intent_body = built_intent.serialize_body(&wallet, 0, intent_index, 3);
    let (remote_intent, _) = find_intent_address(&wallet, intent_index, &crate::ID);

    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: add_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: intent_body,
        msg_fn: &add_intent_msg,
        execute_remaining: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(remote_intent, false),
        ],
        execute_extra_accounts: vec![funded_account(payer), empty_account(remote_intent)],
    });

    let (ika_config, ika_config_bump) =
        Pubkey::find_program_address(&[b"ika_config", wallet.as_ref(), &[chain_kind]], &crate::ID);
    let dwallet = Pubkey::new_unique();
    svm.set_account(keyed_ika_config_account(
        ika_config,
        wallet,
        dwallet,
        chain_kind,
        1,
        ika_config_bump,
    ));

    let proposal_index = 1u64;
    let typed_proposal = get_typed_proposal_address(remote_intent, proposal_index);
    let policy_commitment = hash_policy_commitment(&[b"send:chain:btc"]);
    let amount = ClearSignAmount {
        asset: &asset_id_hash,
        raw_amount: amount_raw,
    };
    let payload_hash = hash_send_payload(&recipient_hash, &amount);
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::Send,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });

    let propose = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent: remote_intent,
        proposal_index,
        expiry,
        action_kind: ClearSignActionKind::Send.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            proposal_index,
            envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result = svm.process_instruction(
        &propose,
        &[funded_account(payer), empty_account(typed_proposal)],
    );
    assert!(
        result.is_ok(),
        "typed chain send propose failed: {:?}",
        result.raw_result
    );

    let wrong_execute = build_execute_typed_chain_send_ix(
        wallet,
        remote_intent,
        typed_proposal,
        ika_config,
        dwallet,
        policy_commitment,
        envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        wrong_recipient_hash,
        asset_id_hash,
        tx_template_hash,
    );
    assert!(svm
        .process_instruction(&wrong_execute, &[empty_account(dwallet)])
        .is_err());

    let execute = build_execute_typed_chain_send_ix(
        wallet,
        remote_intent,
        typed_proposal,
        ika_config,
        dwallet,
        policy_commitment,
        envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        recipient_hash,
        asset_id_hash,
        tx_template_hash,
    );
    let result = svm.process_instruction(&execute, &[empty_account(dwallet)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed chain send execute failed: {:?}",
        result.raw_result
    );
    assert_eq!(
        svm.get_account(&typed_proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );
}

#[test]
fn test_execute_typed_cross_chain_escrow_release_finalizes_verified_artifact() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "typed-cross-chain-release";
    let chain_kind = 2u8;
    let amount_raw = 100_000_000u128;
    let escrow_id_hash = sha256_hash(b"btc-escrow-release-1");
    let milestone_id_hash = sha256_hash(b"btc-milestone-1");
    let recipient_hash = sha256_hash(b"tb1qrecipientaddress");
    let asset_id_hash = sha256_hash(b"BTC:testnet");
    let route_hash = sha256_hash(b"ika:btc:p2wpkh:testnet");
    let settlement_artifact_hash = sha256_hash(b"btc-txid:approved-artifact");
    let wrong_artifact_hash = sha256_hash(b"btc-txid:wrong-artifact");
    let tx_template = b"btc-p2wpkh-template-v1";
    let tx_template_hash = sha256_hash(tx_template);
    let action_id = sha256_hash(b"cross-chain-release-action-1");
    let nonce = sha256_hash(b"cross-chain-release-nonce-1");
    let expiry = typed_test_expiry();

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let mut builder = IntentBuilder::new();
    builder
        .set_chain_kind(chain_kind)
        .set_governance(1, 1, 0)
        .add_proposer(solana_address::Address::new_from_array(
            pubkey_of(&proposer).to_bytes(),
        ))
        .add_approver(solana_address::Address::new_from_array(
            pubkey_of(&proposer).to_bytes(),
        ))
        .set_template("Release BTC escrow milestone")
        .set_tx_template(tx_template);
    let built_intent = builder.build();
    let intent_index = 3u8;
    let intent_body = built_intent.serialize_body(&wallet, 0, intent_index, 3);
    let (remote_intent, _) = find_intent_address(&wallet, intent_index, &crate::ID);

    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: add_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: intent_body,
        msg_fn: &add_intent_msg,
        execute_remaining: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(remote_intent, false),
        ],
        execute_extra_accounts: vec![funded_account(payer), empty_account(remote_intent)],
    });

    let (ika_config, ika_config_bump) =
        Pubkey::find_program_address(&[b"ika_config", wallet.as_ref(), &[chain_kind]], &crate::ID);
    let dwallet = Pubkey::new_unique();
    svm.set_account(keyed_ika_config_account(
        ika_config,
        wallet,
        dwallet,
        chain_kind,
        1,
        ika_config_bump,
    ));

    let proposal_index = 1u64;
    let typed_proposal = get_typed_proposal_address(remote_intent, proposal_index);
    let policy_commitment = hash_policy_commitment(&[b"escrow:release:cross-chain"]);
    let amount = ClearSignAmount {
        asset: &asset_id_hash,
        raw_amount: amount_raw,
    };
    let payload_hash = hash_cross_chain_escrow_release_payload(
        &escrow_id_hash,
        &milestone_id_hash,
        chain_kind,
        ika_config.as_ref(),
        dwallet.as_ref(),
        &recipient_hash,
        &amount,
        &route_hash,
        &tx_template_hash,
        &settlement_artifact_hash,
    );
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::ReleaseMilestone,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });

    let propose = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent: remote_intent,
        proposal_index,
        expiry,
        action_kind: ClearSignActionKind::ReleaseMilestone.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            proposal_index,
            envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result = svm.process_instruction(
        &propose,
        &[funded_account(payer), empty_account(typed_proposal)],
    );
    assert!(
        result.is_ok(),
        "typed cross-chain escrow release propose failed: {:?}",
        result.raw_result
    );

    let wrong_execute = build_execute_typed_cross_chain_escrow_release_ix(
        wallet,
        remote_intent,
        typed_proposal,
        ika_config,
        dwallet,
        policy_commitment,
        envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        milestone_id_hash,
        recipient_hash,
        asset_id_hash,
        route_hash,
        tx_template_hash,
        wrong_artifact_hash,
    );
    assert!(svm
        .process_instruction(&wrong_execute, &[empty_account(dwallet)])
        .is_err());

    let execute = build_execute_typed_cross_chain_escrow_release_ix(
        wallet,
        remote_intent,
        typed_proposal,
        ika_config,
        dwallet,
        policy_commitment,
        envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        milestone_id_hash,
        recipient_hash,
        asset_id_hash,
        route_hash,
        tx_template_hash,
        settlement_artifact_hash,
    );
    let result = svm.process_instruction(&execute, &[empty_account(dwallet)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed cross-chain escrow release execute failed: {:?}",
        result.raw_result
    );
    assert_eq!(
        svm.get_account(&typed_proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );

    let return_proposal_index = 2u64;
    let return_proposal = get_typed_proposal_address(remote_intent, return_proposal_index);
    let refund_recipient_hash = sha256_hash(b"tb1qrefundrecipient");
    let return_artifact_hash = sha256_hash(b"btc-refund-txid:approved-artifact");
    let wrong_return_artifact_hash = sha256_hash(b"btc-refund-txid:wrong-artifact");
    let return_action_id = sha256_hash(b"cross-chain-return-action-1");
    let return_nonce = sha256_hash(b"cross-chain-return-nonce-1");
    let return_policy_commitment = hash_policy_commitment(&[b"escrow:return:cross-chain"]);
    let return_payload_hash = hash_cross_chain_escrow_return_payload(
        &escrow_id_hash,
        chain_kind,
        ika_config.as_ref(),
        dwallet.as_ref(),
        &refund_recipient_hash,
        &amount,
        &route_hash,
        &tx_template_hash,
        &return_artifact_hash,
    );
    let return_envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::ReturnEscrowFunds,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: return_action_id.as_ref(),
        nonce: return_nonce.as_ref(),
        expires_at: expiry,
        policy_commitment: return_policy_commitment,
        payload_hash: return_payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });
    let propose_return = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent: remote_intent,
        proposal_index: return_proposal_index,
        expiry,
        action_kind: ClearSignActionKind::ReturnEscrowFunds.code(),
        policy_commitment: return_policy_commitment,
        payload_hash: return_payload_hash,
        envelope_hash: return_envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            return_proposal_index,
            return_envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id: return_action_id,
        nonce: return_nonce,
    });
    let result = svm.process_instruction(
        &propose_return,
        &[funded_account(payer), empty_account(return_proposal)],
    );
    assert!(
        result.is_ok(),
        "typed cross-chain escrow return propose failed: {:?}",
        result.raw_result
    );

    let wrong_return = build_execute_typed_cross_chain_escrow_return_ix(
        wallet,
        remote_intent,
        return_proposal,
        ika_config,
        dwallet,
        return_policy_commitment,
        return_envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        refund_recipient_hash,
        asset_id_hash,
        route_hash,
        tx_template_hash,
        wrong_return_artifact_hash,
    );
    assert!(svm
        .process_instruction(&wrong_return, &[empty_account(dwallet)])
        .is_err());

    let execute_return = build_execute_typed_cross_chain_escrow_return_ix(
        wallet,
        remote_intent,
        return_proposal,
        ika_config,
        dwallet,
        return_policy_commitment,
        return_envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        refund_recipient_hash,
        asset_id_hash,
        route_hash,
        tx_template_hash,
        return_artifact_hash,
    );
    let result = svm.process_instruction(&execute_return, &[empty_account(dwallet)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed cross-chain escrow return execute failed: {:?}",
        result.raw_result
    );
    assert_eq!(
        svm.get_account(&return_proposal).unwrap().data[105],
        2,
        "typed return proposal should be Executed(2)"
    );
}

#[test]
fn test_execute_typed_private_escrow_finalizes_ciphertext_bound_artifacts() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "typed-private-escrow";
    let amount_raw = 42_000_000u128;
    let escrow_id_hash = sha256_hash(b"private-escrow-1");
    let milestone_id_hash = sha256_hash(b"private-milestone-1");
    let recipient_hash = sha256_hash(b"private-recipient-commitment");
    let refund_recipient_hash = sha256_hash(b"private-refund-commitment");
    let asset_id_hash = sha256_hash(b"PRIVATE:USDC");
    let private_evaluation_hash = sha256_hash(b"encrypt-evaluation:allowed");
    let wrong_private_evaluation_hash = sha256_hash(b"encrypt-evaluation:wrong");
    let settlement_artifact_hash = sha256_hash(b"private-settlement-artifact");
    let refund_artifact_hash = sha256_hash(b"private-refund-artifact");
    let policy_ciphertexts = {
        let mut out = Vec::new();
        out.extend_from_slice(&2u16.to_le_bytes());
        for id in [
            b"enc_policy_limit".as_slice(),
            b"enc_policy_recipient".as_slice(),
        ] {
            out.extend_from_slice(&(id.len() as u16).to_le_bytes());
            out.extend_from_slice(id);
        }
        out
    };
    let policy_ciphertexts_hash = sha256_hash(&policy_ciphertexts);
    let expiry = typed_test_expiry();

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let mut builder = IntentBuilder::new();
    builder
        .set_governance(1, 1, 0)
        .add_proposer(solana_address::Address::new_from_array(
            pubkey_of(&proposer).to_bytes(),
        ))
        .add_approver(solana_address::Address::new_from_array(
            pubkey_of(&proposer).to_bytes(),
        ))
        .set_template("Release private escrow milestone")
        .set_policy_ciphertexts(&policy_ciphertexts);
    let built_intent = builder.build();
    let intent_index = 3u8;
    let intent_body = built_intent.serialize_body(&wallet, 0, intent_index, 3);
    let (private_intent, _) = find_intent_address(&wallet, intent_index, &crate::ID);

    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: add_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: intent_body,
        msg_fn: &add_intent_msg,
        execute_remaining: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(private_intent, false),
        ],
        execute_extra_accounts: vec![funded_account(payer), empty_account(private_intent)],
    });

    let amount = ClearSignAmount {
        asset: &asset_id_hash,
        raw_amount: amount_raw,
    };
    let release_proposal_index = 1u64;
    let release_proposal = get_typed_proposal_address(private_intent, release_proposal_index);
    let release_policy_commitment = hash_policy_commitment(&[b"escrow:release:private"]);
    let release_payload_hash = hash_private_escrow_release_payload(
        &escrow_id_hash,
        &milestone_id_hash,
        &recipient_hash,
        &amount,
        &policy_ciphertexts_hash,
        &private_evaluation_hash,
        &settlement_artifact_hash,
    );
    let release_action_id = sha256_hash(b"private-release-action-1");
    let release_nonce = sha256_hash(b"private-release-nonce-1");
    let release_envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::ReleaseMilestone,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: release_action_id.as_ref(),
        nonce: release_nonce.as_ref(),
        expires_at: expiry,
        policy_commitment: release_policy_commitment,
        payload_hash: release_payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });
    let propose_release = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent: private_intent,
        proposal_index: release_proposal_index,
        expiry,
        action_kind: ClearSignActionKind::ReleaseMilestone.code(),
        policy_commitment: release_policy_commitment,
        payload_hash: release_payload_hash,
        envelope_hash: release_envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            release_proposal_index,
            release_envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id: release_action_id,
        nonce: release_nonce,
    });
    let result = svm.process_instruction(
        &propose_release,
        &[funded_account(payer), empty_account(release_proposal)],
    );
    assert!(
        result.is_ok(),
        "typed private escrow release propose failed: {:?}",
        result.raw_result
    );

    let wrong_release = build_execute_typed_private_escrow_release_ix(
        wallet,
        private_intent,
        release_proposal,
        release_policy_commitment,
        release_envelope_hash,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        milestone_id_hash,
        recipient_hash,
        asset_id_hash,
        policy_ciphertexts_hash,
        wrong_private_evaluation_hash,
        settlement_artifact_hash,
    );
    assert!(svm.process_instruction(&wrong_release, &[]).is_err());

    let execute_release = build_execute_typed_private_escrow_release_ix(
        wallet,
        private_intent,
        release_proposal,
        release_policy_commitment,
        release_envelope_hash,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        milestone_id_hash,
        recipient_hash,
        asset_id_hash,
        policy_ciphertexts_hash,
        private_evaluation_hash,
        settlement_artifact_hash,
    );
    let result = svm.process_instruction(&execute_release, &[]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed private escrow release execute failed: {:?}",
        result.raw_result
    );
    assert_eq!(
        svm.get_account(&release_proposal).unwrap().data[105],
        2,
        "typed private release proposal should be Executed(2)"
    );

    let return_proposal_index = 2u64;
    let return_proposal = get_typed_proposal_address(private_intent, return_proposal_index);
    let return_policy_commitment = hash_policy_commitment(&[b"escrow:return:private"]);
    let return_payload_hash = hash_private_escrow_return_payload(
        &escrow_id_hash,
        &refund_recipient_hash,
        &amount,
        &policy_ciphertexts_hash,
        &private_evaluation_hash,
        &refund_artifact_hash,
    );
    let return_action_id = sha256_hash(b"private-return-action-1");
    let return_nonce = sha256_hash(b"private-return-nonce-1");
    let return_envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::ReturnEscrowFunds,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: return_action_id.as_ref(),
        nonce: return_nonce.as_ref(),
        expires_at: expiry,
        policy_commitment: return_policy_commitment,
        payload_hash: return_payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });
    let propose_return = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent: private_intent,
        proposal_index: return_proposal_index,
        expiry,
        action_kind: ClearSignActionKind::ReturnEscrowFunds.code(),
        policy_commitment: return_policy_commitment,
        payload_hash: return_payload_hash,
        envelope_hash: return_envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            return_proposal_index,
            return_envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id: return_action_id,
        nonce: return_nonce,
    });
    let result = svm.process_instruction(
        &propose_return,
        &[funded_account(payer), empty_account(return_proposal)],
    );
    assert!(
        result.is_ok(),
        "typed private escrow return propose failed: {:?}",
        result.raw_result
    );

    let execute_return = build_execute_typed_private_escrow_return_ix(
        wallet,
        private_intent,
        return_proposal,
        return_policy_commitment,
        return_envelope_hash,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        refund_recipient_hash,
        asset_id_hash,
        policy_ciphertexts_hash,
        private_evaluation_hash,
        refund_artifact_hash,
    );
    let result = svm.process_instruction(&execute_return, &[]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed private escrow return execute failed: {:?}",
        result.raw_result
    );
    assert_eq!(
        svm.get_account(&return_proposal).unwrap().data[105],
        2,
        "typed private return proposal should be Executed(2)"
    );
}

#[test]
fn test_execute_typed_agent_trade_approval_finalizes_verified_digest() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-agent-trade";
    let amount_raw = 250_000_000u128;
    let venue_hash = sha256_hash(b"hyperliquid:testnet");
    let market_hash = sha256_hash(b"BTC-PERP");
    let side_hash = sha256_hash(b"long");
    let asset_id_hash = sha256_hash(b"USDC:hyperliquid:testnet");
    let max_leverage_x100 = 250u32;
    let session_id_hash = sha256_hash(b"agent-session:morning-risk-pass");
    let route_hash = sha256_hash(b"clearsig-agent:hyperliquid:testnet:limit");
    let risk_check_hash = sha256_hash(b"risk-ok:cap-velocity-thesis-stoploss-v1");
    let wrong_risk_check_hash = sha256_hash(b"risk-skipped:wrong-artifact");
    let action_id = sha256_hash(b"agent-trade-action-1");
    let nonce = sha256_hash(b"agent-trade-nonce-1");
    let expiry = typed_test_expiry();

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let proposal_index = 0u64;
    let proposal = get_typed_proposal_address(intent, proposal_index);
    let policy_commitment = hash_policy_commitment(&[b"agent:hyperliquid:testnet:v1"]);
    let amount = ClearSignAmount {
        asset: &asset_id_hash,
        raw_amount: amount_raw,
    };
    let payload_hash = hash_agent_trade_approval_payload(
        &venue_hash,
        &market_hash,
        &side_hash,
        &amount,
        max_leverage_x100,
        &session_id_hash,
        &route_hash,
        &risk_check_hash,
    );
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::AgentTradeApproval,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });

    let propose = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent,
        proposal_index,
        expiry,
        action_kind: ClearSignActionKind::AgentTradeApproval.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            proposal_index,
            envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);
    assert!(
        result.is_ok(),
        "typed agent trade proposal failed: {:?}",
        result.raw_result
    );

    let wrong_execute = build_execute_typed_agent_trade_approval_ix(
        wallet,
        intent,
        proposal,
        policy_commitment,
        envelope_hash,
        amount_raw.to_le_bytes(),
        venue_hash,
        market_hash,
        side_hash,
        asset_id_hash,
        max_leverage_x100,
        session_id_hash,
        route_hash,
        wrong_risk_check_hash,
    );
    assert!(
        svm.process_instruction(&wrong_execute, &[]).is_err(),
        "agent trade executor accepted a changed risk-check artifact"
    );

    let execute = build_execute_typed_agent_trade_approval_ix(
        wallet,
        intent,
        proposal,
        policy_commitment,
        envelope_hash,
        amount_raw.to_le_bytes(),
        venue_hash,
        market_hash,
        side_hash,
        asset_id_hash,
        max_leverage_x100,
        session_id_hash,
        route_hash,
        risk_check_hash,
    );
    let result = svm.process_instruction(&execute, &[]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed agent trade execute failed: {:?}",
        result.raw_result
    );
    assert_eq!(
        svm.get_account(&proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );
}

#[test]
fn test_execute_typed_escrow_return_moves_sol_to_funders() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-return";
    let escrow_id_hash = sha256_hash(b"escrow-return-1");
    let action_id = sha256_hash(b"return-action-1");
    let nonce = sha256_hash(b"return-nonce-1");
    let funder_a = Pubkey::new_unique();
    let funder_b = Pubkey::new_unique();
    let amount_a = 3_000_000u64;
    let amount_b = 5_000_000u64;
    let expiry = typed_test_expiry();

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let proposal_index = 0u64;
    let proposal = get_typed_proposal_address(intent, proposal_index);
    let policy_commitment = hash_policy_commitment(&[b"escrow:return"]);
    let payload_hash = hash_return_escrow_sol_payload_iter(
        &escrow_id_hash,
        [(funder_a.as_ref(), amount_a), (funder_b.as_ref(), amount_b)].into_iter(),
    );
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::ReturnEscrowFunds,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });

    let propose = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent,
        proposal_index,
        expiry,
        action_kind: ClearSignActionKind::ReturnEscrowFunds.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            proposal_index,
            envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed escrow return propose failed: {:?}",
        result.raw_result
    );

    let total = amount_a + amount_b;
    let vault = fund_vault(&mut svm, payer, wallet, total + 1_000_000);
    let vault_pre = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    let mut amount_bytes = Vec::new();
    amount_bytes.extend_from_slice(&amount_a.to_le_bytes());
    amount_bytes.extend_from_slice(&amount_b.to_le_bytes());
    let execute = build_execute_typed_escrow_return_ix(
        wallet,
        intent,
        proposal,
        policy_commitment,
        envelope_hash,
        escrow_id_hash,
        amount_bytes,
        vec![
            AccountMeta::new(funder_a, false),
            AccountMeta::new(funder_b, false),
        ],
    );
    let result = svm.process_instruction(
        &execute,
        &[empty_account(funder_a), empty_account(funder_b)],
    );
    assert!(
        result.is_ok(),
        "typed escrow return execute failed: {:?}",
        result.raw_result
    );

    assert_eq!(
        svm.get_account(&funder_a).map(|a| a.lamports).unwrap_or(0),
        amount_a
    );
    assert_eq!(
        svm.get_account(&funder_b).map(|a| a.lamports).unwrap_or(0),
        amount_b
    );
    assert_eq!(
        svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0),
        vault_pre - total
    );
    assert_eq!(
        svm.get_account(&proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );
}

#[test]
fn test_execute_typed_sol_send_moves_sol() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-sol-send";
    let recipient = Pubkey::new_unique();
    let amount_lamports = 1_750_000u64;
    let action_id = sha256_hash(b"sol-send-action-1");
    let nonce = sha256_hash(b"sol-send-nonce-1");
    let expiry = typed_test_expiry();

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let proposal_index = 0u64;
    let proposal = get_typed_proposal_address(intent, proposal_index);
    let policy_commitment = hash_policy_commitment(&[b"send:sol"]);
    let payload_hash = hash_send_payload(
        recipient.as_ref(),
        &ClearSignAmount {
            asset: b"SOL",
            raw_amount: amount_lamports as u128,
        },
    );
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::Send,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });

    let propose = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent,
        proposal_index,
        expiry,
        action_kind: ClearSignActionKind::Send.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            proposal_index,
            envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);
    result.expect("typed SOL send propose failed");

    let vault = fund_vault(&mut svm, payer, wallet, amount_lamports + 1_000_000);
    let vault_pre = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    let execute = build_execute_typed_sol_send_ix(
        payer,
        wallet,
        intent,
        proposal,
        recipient,
        policy_commitment,
        envelope_hash,
        amount_lamports,
    );
    let result = svm.process_instruction(
        &execute,
        &[
            funded_account(payer),
            empty_policy_spend_account(wallet, policy_commitment),
            empty_account(recipient),
        ],
    );
    assert!(
        result.is_ok(),
        "typed SOL send execute failed: {:?}",
        result.raw_result
    );

    assert_eq!(
        svm.get_account(&recipient).map(|a| a.lamports).unwrap_or(0),
        amount_lamports
    );
    assert_eq!(
        svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0),
        vault_pre - amount_lamports
    );
    assert_eq!(
        svm.get_account(&proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );
}

#[test]
fn test_execute_typed_sol_send_rejects_policy_amount_cap() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let recipient = Pubkey::new_unique();
    let amount_lamports = 2_000_000u64;
    let policy_bytes = typed_sol_policy_bytes(0, 1_000_000, 0, &[], &[]);

    let (wallet, intent, proposal, policy_commitment, envelope_hash) =
        propose_typed_sol_send_with_policy(
            &mut svm,
            payer,
            "typed-sol-policy-cap",
            &proposer,
            &[pubkey_of(&proposer)],
            1,
            recipient,
            amount_lamports,
            &policy_bytes,
        );
    fund_vault(&mut svm, payer, wallet, amount_lamports + 1_000_000);

    let execute = build_execute_typed_sol_send_ix(
        payer,
        wallet,
        intent,
        proposal,
        recipient,
        policy_commitment,
        envelope_hash,
        amount_lamports,
    );
    let result = svm.process_instruction(
        &execute,
        &[
            funded_account(payer),
            empty_policy_spend_account(wallet, policy_commitment),
            empty_account(recipient),
        ],
    );
    assert!(result.is_err(), "policy amount cap did not stop execute");
}

#[test]
fn test_execute_typed_sol_send_rejects_policy_blocklist() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let recipient = Pubkey::new_unique();
    let amount_lamports = 1_000_000u64;
    let policy_bytes = typed_sol_policy_bytes(2, 0, 0, &[recipient], &[]);

    let (wallet, intent, proposal, policy_commitment, envelope_hash) =
        propose_typed_sol_send_with_policy(
            &mut svm,
            payer,
            "typed-sol-policy-blocklist",
            &proposer,
            &[pubkey_of(&proposer)],
            1,
            recipient,
            amount_lamports,
            &policy_bytes,
        );
    fund_vault(&mut svm, payer, wallet, amount_lamports + 1_000_000);

    let execute = build_execute_typed_sol_send_ix(
        payer,
        wallet,
        intent,
        proposal,
        recipient,
        policy_commitment,
        envelope_hash,
        amount_lamports,
    );
    let result = svm.process_instruction(
        &execute,
        &[
            funded_account(payer),
            empty_policy_spend_account(wallet, policy_commitment),
            empty_account(recipient),
        ],
    );
    assert!(result.is_err(), "policy blocklist did not stop execute");
}

#[test]
fn test_execute_typed_sol_send_requires_policy_extra_approver() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let extra_approver = new_keypair();
    let recipient = Pubkey::new_unique();
    let amount_lamports = 1_000_000u64;
    let policy_bytes = typed_sol_policy_bytes(0, 0, 0, &[], &[pubkey_of(&extra_approver)]);

    let (wallet, intent, proposal, policy_commitment, envelope_hash) =
        propose_typed_sol_send_with_policy(
            &mut svm,
            payer,
            "typed-sol-policy-extra-approver",
            &proposer,
            &[pubkey_of(&proposer), pubkey_of(&extra_approver)],
            1,
            recipient,
            amount_lamports,
            &policy_bytes,
        );
    fund_vault(&mut svm, payer, wallet, amount_lamports + 1_000_000);

    let execute = build_execute_typed_sol_send_ix(
        payer,
        wallet,
        intent,
        proposal,
        recipient,
        policy_commitment,
        envelope_hash,
        amount_lamports,
    );
    let result = svm.process_instruction(
        &execute,
        &[
            funded_account(payer),
            empty_policy_spend_account(wallet, policy_commitment),
            empty_account(recipient),
        ],
    );
    assert!(
        result.is_err(),
        "policy-required extra approver did not stop execute"
    );
}

#[test]
fn test_execute_typed_sol_send_accepts_committed_policy() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let recipient = Pubkey::new_unique();
    let amount_lamports = 1_000_000u64;
    let policy_bytes = typed_sol_policy_bytes(1, 2_000_000, 0, &[recipient], &[]);

    let (wallet, intent, proposal, policy_commitment, envelope_hash) =
        propose_typed_sol_send_with_policy(
            &mut svm,
            payer,
            "typed-sol-policy-ok",
            &proposer,
            &[pubkey_of(&proposer)],
            1,
            recipient,
            amount_lamports,
            &policy_bytes,
        );
    fund_vault(&mut svm, payer, wallet, amount_lamports + 1_000_000);

    let execute = build_execute_typed_sol_send_ix(
        payer,
        wallet,
        intent,
        proposal,
        recipient,
        policy_commitment,
        envelope_hash,
        amount_lamports,
    );
    let result = svm.process_instruction(
        &execute,
        &[
            funded_account(payer),
            empty_policy_spend_account(wallet, policy_commitment),
            empty_account(recipient),
        ],
    );
    assert!(
        result.is_ok(),
        "committed policy should allow execute: {:?}",
        result.raw_result
    );
}

#[test]
fn test_execute_typed_sol_send_enforces_velocity_window() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-sol-policy-velocity";
    let recipient_a = Pubkey::new_unique();
    let recipient_b = Pubkey::new_unique();
    let amount_lamports = 600_000u64;
    let policy_bytes =
        typed_sol_policy_bytes_with_velocity(0, 0, 0, &[], &[], 1_000_000, 24 * 60 * 60);

    let (wallet, intent, proposal_a, policy_commitment, envelope_hash_a) =
        propose_typed_sol_send_with_policy(
            &mut svm,
            payer,
            wallet_name,
            &proposer,
            &[pubkey_of(&proposer)],
            1,
            recipient_a,
            amount_lamports,
            &policy_bytes,
        );
    fund_vault(&mut svm, payer, wallet, amount_lamports * 3);

    let execute_a = build_execute_typed_sol_send_ix(
        payer,
        wallet,
        intent,
        proposal_a,
        recipient_a,
        policy_commitment,
        envelope_hash_a,
        amount_lamports,
    );
    let result = svm.process_instruction(
        &execute_a,
        &[
            funded_account(payer),
            empty_policy_spend_account(wallet, policy_commitment),
            empty_account(recipient_a),
        ],
    );
    assert!(
        result.is_ok(),
        "first velocity-tracked send should execute: {:?}",
        result.raw_result
    );

    let (proposal_b, policy_commitment_b, envelope_hash_b) = propose_typed_sol_send_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        1,
        &proposer,
        recipient_b,
        amount_lamports,
        &policy_bytes,
    );
    assert_eq!(policy_commitment_b, policy_commitment);

    let execute_b = build_execute_typed_sol_send_ix(
        payer,
        wallet,
        intent,
        proposal_b,
        recipient_b,
        policy_commitment_b,
        envelope_hash_b,
        amount_lamports,
    );
    let result = svm.process_instruction(
        &execute_b,
        &[funded_account(payer), empty_account(recipient_b)],
    );
    assert!(
        result.is_err(),
        "second send should exceed the on-chain velocity cap"
    );
}

#[test]
fn test_execute_typed_sol_batch_send_moves_sol_to_recipients() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-sol-batch";
    let recipient_a = Pubkey::new_unique();
    let recipient_b = Pubkey::new_unique();
    let amount_a = 2_000_000u64;
    let amount_b = 3_250_000u64;
    let action_id = sha256_hash(b"sol-batch-action-1");
    let nonce = sha256_hash(b"sol-batch-nonce-1");
    let expiry = typed_test_expiry();

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let proposal_index = 0u64;
    let proposal = get_typed_proposal_address(intent, proposal_index);
    let policy_commitment = hash_policy_commitment(&[b"batch:sol"]);
    let payload_hash = hash_batch_send_sol_payload_iter(
        [
            (recipient_a.as_ref(), amount_a),
            (recipient_b.as_ref(), amount_b),
        ]
        .into_iter(),
    );
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::BatchSend,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });

    let propose = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent,
        proposal_index,
        expiry,
        action_kind: ClearSignActionKind::BatchSend.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            proposal_index,
            envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);
    assert!(
        result.is_ok(),
        "typed SOL batch propose failed: {:?}",
        result.raw_result
    );

    let total = amount_a + amount_b;
    let vault = fund_vault(&mut svm, payer, wallet, total + 1_000_000);
    let vault_pre = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    let mut amount_bytes = Vec::new();
    amount_bytes.extend_from_slice(&amount_a.to_le_bytes());
    amount_bytes.extend_from_slice(&amount_b.to_le_bytes());
    let execute = build_execute_typed_sol_batch_send_ix(
        wallet,
        intent,
        proposal,
        policy_commitment,
        envelope_hash,
        amount_bytes,
        vec![
            AccountMeta::new(recipient_a, false),
            AccountMeta::new(recipient_b, false),
        ],
    );
    let result = svm.process_instruction(
        &execute,
        &[empty_account(recipient_a), empty_account(recipient_b)],
    );
    assert!(
        result.is_ok(),
        "typed SOL batch execute failed: {:?}",
        result.raw_result
    );

    assert_eq!(
        svm.get_account(&recipient_a)
            .map(|a| a.lamports)
            .unwrap_or(0),
        amount_a
    );
    assert_eq!(
        svm.get_account(&recipient_b)
            .map(|a| a.lamports)
            .unwrap_or(0),
        amount_b
    );
    assert_eq!(
        svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0),
        vault_pre - total
    );
    assert_eq!(
        svm.get_account(&proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );
}

#[test]
fn test_cleanup_nonfinalized_typed_proposal_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-cleanup-fail";
    let recipient = Pubkey::new_unique();
    let amount_lamports = 500_000u64;
    let action_id = sha256_hash(b"typed-cleanup-action");
    let nonce = sha256_hash(b"typed-cleanup-nonce");
    let expiry = typed_test_expiry();

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[Pubkey::new_unique()],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let proposal_index = 0u64;
    let proposal = get_typed_proposal_address(intent, proposal_index);
    let policy_commitment = hash_policy_commitment(&[b"send:sol"]);
    let payload_hash = hash_send_payload(
        recipient.as_ref(),
        &ClearSignAmount {
            asset: b"SOL",
            raw_amount: amount_lamports as u128,
        },
    );
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::Send,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });

    let propose = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent,
        proposal_index,
        expiry,
        action_kind: ClearSignActionKind::Send.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            proposal_index,
            envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);
    assert!(
        result.is_ok(),
        "typed proposal create failed: {:?}",
        result.raw_result
    );

    let cleanup = build_cleanup_typed_ix(proposal, payer);
    let result = svm.process_instruction(&cleanup, &[]);
    assert!(
        result.is_err(),
        "non-finalized typed proposal cleanup should fail"
    );
}

#[test]
fn test_legacy_and_typed_proposals_share_wallet_index_without_pda_collision() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "mixed-proposal-index";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 1, &crate::ID);

    let legacy_index = 0u64;
    let legacy_proposal = get_proposal_address(intent, legacy_index);
    let legacy_params = vec![0u8];
    let legacy_msg = remove_intent_msg(
        "propose",
        DEFAULT_EXPIRY,
        wallet_name,
        legacy_index,
        legacy_params[0],
    );
    let legacy = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent,
        proposal_index: legacy_index,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &legacy_msg),
        params_data: legacy_params,
    });
    let result = svm.process_instruction(
        &legacy,
        &[funded_account(payer), empty_account(legacy_proposal)],
    );
    assert!(
        result.is_ok(),
        "legacy proposal create failed: {:?}",
        result.raw_result
    );

    let typed_index = 1u64;
    let typed_proposal = get_typed_proposal_address(intent, typed_index);
    let action_id = sha256_hash(b"mixed-action");
    let nonce = sha256_hash(b"mixed-nonce");
    let policy_commitment = hash_policy_commitment(&[b"mixed"]);
    let payload_hash = sha256_hash(b"mixed-payload");
    let expiry = typed_test_expiry();
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::SetProtection,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at: expiry,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(TEST_CLEAR_TEXT).unwrap(),
    });
    let typed = build_propose_typed_ix(TypedProposalArgs {
        payer,
        wallet,
        intent,
        proposal_index: typed_index,
        expiry,
        action_kind: ClearSignActionKind::SetProtection.code(),
        policy_commitment,
        payload_hash,
        envelope_hash,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_typed_vote(
            &proposer,
            ClearSignVoteKind::Propose,
            wallet_name,
            typed_index,
            envelope_hash,
        ),
        clear_text: TEST_CLEAR_TEXT.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result = svm.process_instruction(
        &typed,
        &[funded_account(payer), empty_account(typed_proposal)],
    );
    assert!(
        result.is_ok(),
        "typed proposal create failed: {:?}",
        result.raw_result
    );

    assert_ne!(
        legacy_proposal, typed_proposal,
        "legacy and typed proposal PDAs must use separate namespaces"
    );
    assert_eq!(svm.get_account(&legacy_proposal).unwrap().data[0], 3);
    assert_eq!(svm.get_account(&typed_proposal).unwrap().data[0], 6);
    let wallet_data = svm.get_account(&wallet).unwrap().data;
    let proposal_index = u64::from_le_bytes(wallet_data[2..10].try_into().unwrap());
    assert_eq!(
        proposal_index, 2,
        "legacy and typed creates must share one monotonic wallet proposal index"
    );
}

#[test]
fn test_create_wallet_wrong_wallet_address_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = Pubkey::new_unique();
    let approver = Pubkey::new_unique();
    let (wallet, _) = find_wallet_address(
        "wrong-name",
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (update_intent, _) = find_intent_address(&wallet, 2, &crate::ID);

    let wrong_name_hash = Pubkey::from([0u8; 32]);
    let instruction: Instruction = CreateWalletInstruction {
        payer,
        name_hash: wrong_name_hash,
        wallet,
        add_intent,
        remove_intent,
        update_intent,
        system_program: quasar_svm::system_program::ID,
        name: DynBytes::new(b"actual-name".to_vec()),
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 0,
        proposers: DynVec::new(vec![proposer.to_bytes()]),
        approvers: DynVec::new(vec![approver.to_bytes()]),
        policy_ciphertexts: TailBytes(Vec::new()),
    }
    .into();

    let result = svm.process_instruction(
        &instruction,
        &[
            funded_account(payer),
            empty_account(wrong_name_hash),
            empty_account(wallet),
            empty_account(add_intent),
            empty_account(remove_intent),
            empty_account(update_intent),
        ],
    );
    assert!(
        result.is_err(),
        "wrong wallet address should fail PDA check"
    );
}

#[test]
fn test_create_wallet_bad_threshold_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let (instruction, accounts) = create_wallet_ix(
        payer,
        "bad",
        &[Pubkey::new_unique()],
        &[Pubkey::new_unique()],
        2,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_err());
}

#[test]
fn test_propose_add_intent() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "prop-test";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);

    let built = intents::transfer_sol::build(&intents::transfer_sol::IntentConfig {
        proposers: &[pubkey_of(&proposer)],
        approvers: &[pubkey_of(&approver)],
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 0,
    });
    let params_data = built.serialize_body(&wallet, 0, 3, 3);

    let msg = add_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 0, &params_data);
    let instruction = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent: add_intent,
        proposal_index: 0,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &msg),
        params_data,
    });
    let proposal_address = get_proposal_address(add_intent, 0);

    let result = svm.process_instruction(
        &instruction,
        &[funded_account(payer), empty_account(proposal_address)],
    );
    assert!(result.is_ok(), "propose failed: {:?}", result.raw_result);
    println!("  PROPOSE CU: {}", result.compute_units_consumed);
}

#[test]
fn test_propose_and_approve_add_intent() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "approve-test";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);

    let built = intents::transfer_sol::build(&intents::transfer_sol::IntentConfig {
        proposers: &[pubkey_of(&proposer)],
        approvers: &[pubkey_of(&approver)],
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 0,
    });
    let params_data = built.serialize_body(&wallet, 0, 3, 3);
    let proposal_address = get_proposal_address(add_intent, 0);

    // Propose
    let msg = add_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 0, &params_data);
    let instruction = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent: add_intent,
        proposal_index: 0,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &msg),
        params_data: params_data.clone(),
    });
    assert!(svm
        .process_instruction(
            &instruction,
            &[funded_account(payer), empty_account(proposal_address)]
        )
        .is_ok());

    // Approve
    let msg = add_intent_msg("approve", DEFAULT_EXPIRY, wallet_name, 0, &params_data);
    let instruction = build_approve_ix(
        wallet,
        add_intent,
        proposal_address,
        DEFAULT_EXPIRY,
        0,
        sign_message(&approver, &msg),
    );
    let result = svm.process_instruction(&instruction, &[]);
    assert!(result.is_ok(), "approve failed: {:?}", result.raw_result);

    // Verify Approved status (byte offset 105)
    assert_eq!(
        svm.get_account(&proposal_address).unwrap().data[105],
        1,
        "status should be Approved(1)"
    );
    println!("  APPROVE CU: {}", result.compute_units_consumed);
}

#[test]
fn test_cancel_overrides_approval() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver1 = new_keypair();
    let approver2 = new_keypair();
    let wallet_name = "cancel-test";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver1), pubkey_of(&approver2)],
        2,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);

    let built = intents::transfer_sol::build(&intents::transfer_sol::IntentConfig {
        proposers: &[pubkey_of(&proposer)],
        approvers: &[pubkey_of(&approver1), pubkey_of(&approver2)],
        approval_threshold: 2,
        cancellation_threshold: 1,
        timelock_seconds: 0,
    });
    let params_data = built.serialize_body(&wallet, 0, 3, 3);
    let proposal_address = get_proposal_address(add_intent, 0);

    // Propose
    let msg = add_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 0, &params_data);
    svm.process_instruction(
        &build_propose_ix(ProposeArgs {
            payer,
            wallet,
            intent: add_intent,
            proposal_index: 0,
            expiry: DEFAULT_EXPIRY,
            proposer_pubkey: pubkey_bytes(&proposer),
            signature: sign_message(&proposer, &msg),
            params_data: params_data.clone(),
        }),
        &[funded_account(payer), empty_account(proposal_address)],
    )
    .unwrap();

    // Approver 1 approves
    let msg = add_intent_msg("approve", DEFAULT_EXPIRY, wallet_name, 0, &params_data);
    svm.process_instruction(
        &build_approve_ix(
            wallet,
            add_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            0,
            sign_message(&approver1, &msg),
        ),
        &[],
    )
    .unwrap();

    // Approver 1 switches to cancel
    let cancel_msg = wrap_offchain(
        format!(
            "expires {}: cancel add intent definition_hash: {}{}",
            format_timestamp(DEFAULT_EXPIRY),
            hex_encode(&sha256_hash(&params_data)),
            message_suffix(wallet_name, 0)
        )
        .as_bytes(),
    );
    svm.process_instruction(
        &build_cancel_ix(
            wallet,
            add_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            0,
            sign_message(&approver1, &cancel_msg),
        ),
        &[],
    )
    .unwrap();

    assert_eq!(
        svm.get_account(&proposal_address).unwrap().data[105],
        3,
        "status should be Cancelled(3)"
    );
}

#[test]
fn test_wrong_signer_propose_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wrong_key = new_keypair();
    let wallet_name = "wrong-signer";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);

    let params_data = vec![0u8; 10];
    let msg = add_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 0, &params_data);
    let instruction = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent: add_intent,
        proposal_index: 0,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&wrong_key),
        signature: sign_message(&wrong_key, &msg),
        params_data,
    });
    let proposal_address = get_proposal_address(add_intent, 0);
    assert!(svm
        .process_instruction(
            &instruction,
            &[funded_account(payer), empty_account(proposal_address)]
        )
        .is_err());
}

#[test]
fn test_expired_signature_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "expired-sig";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);

    let params_data = vec![0u8; 10];
    let expired = -1i64;
    let msg = add_intent_msg("propose", expired, wallet_name, 0, &params_data);
    let instruction = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent: add_intent,
        proposal_index: 0,
        expiry: expired,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &msg),
        params_data,
    });
    let proposal_address = get_proposal_address(add_intent, 0);
    assert!(svm
        .process_instruction(
            &instruction,
            &[funded_account(payer), empty_account(proposal_address)]
        )
        .is_err());
}

#[test]
fn test_propose_remove_intent() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "remove-test";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);

    let params_data = vec![0u8]; // target_index = 0
    let msg = remove_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 0, 0);
    let instruction = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent: remove_intent,
        proposal_index: 0,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &msg),
        params_data,
    });
    let proposal_address = get_proposal_address(remove_intent, 0);

    let result = svm.process_instruction(
        &instruction,
        &[funded_account(payer), empty_account(proposal_address)],
    );
    assert!(
        result.is_ok(),
        "propose remove failed: {:?}",
        result.raw_result
    );
    println!("  PROPOSE_REMOVE CU: {}", result.compute_units_consumed);
}

#[test]
fn test_duplicate_approval_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "dup-approve";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let proposal_address = get_proposal_address(add_intent, 0);

    let params_data = vec![0u8; 10];
    let msg = add_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 0, &params_data);
    svm.process_instruction(
        &build_propose_ix(ProposeArgs {
            payer,
            wallet,
            intent: add_intent,
            proposal_index: 0,
            expiry: DEFAULT_EXPIRY,
            proposer_pubkey: pubkey_bytes(&proposer),
            signature: sign_message(&proposer, &msg),
            params_data: params_data.clone(),
        }),
        &[funded_account(payer), empty_account(proposal_address)],
    )
    .unwrap();

    let msg = add_intent_msg("approve", DEFAULT_EXPIRY, wallet_name, 0, &params_data);
    let signature = sign_message(&approver, &msg);
    assert!(svm
        .process_instruction(
            &build_approve_ix(
                wallet,
                add_intent,
                proposal_address,
                DEFAULT_EXPIRY,
                0,
                signature
            ),
            &[]
        )
        .is_ok());
    assert!(
        svm.process_instruction(
            &build_approve_ix(
                wallet,
                add_intent,
                proposal_address,
                DEFAULT_EXPIRY,
                0,
                signature
            ),
            &[]
        )
        .is_err(),
        "duplicate approval should fail"
    );
}

// =========================================================================
// Execute lifecycle tests
// =========================================================================

#[test]
fn test_execute_add_intent() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "exec-add";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (new_intent_address, _) = find_intent_address(&wallet, 3, &crate::ID);

    let built = intents::transfer_sol::build(&intents::transfer_sol::IntentConfig {
        proposers: &[pubkey_of(&proposer)],
        approvers: &[pubkey_of(&approver)],
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 0,
    });
    let params_data = built.serialize_body(&wallet, 0, 3, 3);

    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: add_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data,
        msg_fn: &add_intent_msg,
        execute_remaining: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(new_intent_address, false),
        ],
        execute_extra_accounts: vec![funded_account(payer), empty_account(new_intent_address)],
    });

    let intent_data = svm.get_account(&new_intent_address).unwrap();
    assert_eq!(intent_data.data[0], 2, "new intent discriminator");
    assert_eq!(intent_data.owner, crate::ID, "new intent owned by program");
}

#[test]
fn test_execute_remove_intent() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "exec-remove";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);

    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: remove_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: vec![0u8],
        msg_fn: &|action, expiry, wallet_name, proposal_index, data| {
            remove_intent_msg(action, expiry, wallet_name, proposal_index, data[0])
        },
        execute_remaining: vec![AccountMeta::new(add_intent, false)],
        execute_extra_accounts: vec![],
    });

    assert_eq!(
        svm.get_account(&add_intent).unwrap().data[36],
        0,
        "intent should be deactivated"
    );
}

#[test]
fn test_removed_intent_cannot_be_used() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "removed-fail";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);

    // Remove AddIntent
    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: remove_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: vec![0u8],
        msg_fn: &|action, expiry, wallet_name, proposal_index, data| {
            remove_intent_msg(action, expiry, wallet_name, proposal_index, data[0])
        },
        execute_remaining: vec![AccountMeta::new(add_intent, false)],
        execute_extra_accounts: vec![],
    });

    // Try to propose via the removed AddIntent — should fail
    let dummy_params = vec![0u8; 10];
    let msg = add_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 1, &dummy_params);
    let instruction = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent: add_intent,
        proposal_index: 1,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &msg),
        params_data: dummy_params,
    });
    let proposal_address = get_proposal_address(add_intent, 1);
    assert!(svm
        .process_instruction(
            &instruction,
            &[funded_account(payer), empty_account(proposal_address)]
        )
        .is_err());
}

// =========================================================================
// Comprehensive tests
// =========================================================================

#[test]
fn test_timelock_enforcement() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "timelock-test";

    let name_hash = Pubkey::from(compute_name_hash(wallet_name));
    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (update_intent, _) = find_intent_address(&wallet, 2, &crate::ID);

    let instruction: Instruction = CreateWalletInstruction {
        payer,
        name_hash,
        wallet,
        add_intent,
        remove_intent,
        update_intent,
        system_program: quasar_svm::system_program::ID,
        name: DynBytes::new(wallet_name.as_bytes().to_vec()),
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 3600,
        proposers: DynVec::new(vec![pubkey_of(&proposer).to_bytes()]),
        approvers: DynVec::new(vec![pubkey_of(&approver).to_bytes()]),
        policy_ciphertexts: TailBytes(Vec::new()),
    }
    .into();

    svm.process_instruction(
        &instruction,
        &[
            funded_account(payer),
            empty_account(name_hash),
            empty_account(wallet),
            empty_account(add_intent),
            empty_account(remove_intent),
            empty_account(update_intent),
        ],
    )
    .unwrap();

    let params_data = vec![0u8];
    let proposal_address = get_proposal_address(remove_intent, 0);

    // Propose + approve
    let msg = remove_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 0, 0);
    svm.process_instruction(
        &build_propose_ix(ProposeArgs {
            payer,
            wallet,
            intent: remove_intent,
            proposal_index: 0,
            expiry: DEFAULT_EXPIRY,
            proposer_pubkey: pubkey_bytes(&proposer),
            signature: sign_message(&proposer, &msg),
            params_data: params_data.clone(),
        }),
        &[funded_account(payer), empty_account(proposal_address)],
    )
    .unwrap();

    let msg = remove_intent_msg("approve", DEFAULT_EXPIRY, wallet_name, 0, 0);
    svm.process_instruction(
        &build_approve_ix(
            wallet,
            remove_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            0,
            sign_message(&approver, &msg),
        ),
        &[],
    )
    .unwrap();

    // Execute immediately should fail (clock=0, timelock=3600)
    let (instruction, vault) = build_execute_ix(
        wallet,
        remove_intent,
        proposal_address,
        vec![AccountMeta::new(add_intent, false)],
    );
    assert!(svm
        .process_instruction(&instruction, &[empty_account(vault)])
        .is_err());
    println!("  TIMELOCK: correctly blocked execution");
}

#[test]
fn test_execute_not_approved_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "not-approved";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);

    // Propose but don't approve
    let params_data = vec![0u8];
    let proposal_address = get_proposal_address(remove_intent, 0);
    let msg = remove_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 0, 0);
    svm.process_instruction(
        &build_propose_ix(ProposeArgs {
            payer,
            wallet,
            intent: remove_intent,
            proposal_index: 0,
            expiry: DEFAULT_EXPIRY,
            proposer_pubkey: pubkey_bytes(&proposer),
            signature: sign_message(&proposer, &msg),
            params_data,
        }),
        &[funded_account(payer), empty_account(proposal_address)],
    )
    .unwrap();

    let (instruction, vault) = build_execute_ix(
        wallet,
        remove_intent,
        proposal_address,
        vec![AccountMeta::new(add_intent, false)],
    );
    assert!(svm
        .process_instruction(&instruction, &[empty_account(vault)])
        .is_err());
}

#[test]
fn test_multi_approver_threshold() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver1 = new_keypair();
    let approver2 = new_keypair();
    let approver3 = new_keypair();
    let wallet_name = "multi-approve";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[
            pubkey_of(&approver1),
            pubkey_of(&approver2),
            pubkey_of(&approver3),
        ],
        2,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let proposal_address = get_proposal_address(remove_intent, 0);

    let params_data = vec![0u8];
    let msg = remove_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 0, 0);
    svm.process_instruction(
        &build_propose_ix(ProposeArgs {
            payer,
            wallet,
            intent: remove_intent,
            proposal_index: 0,
            expiry: DEFAULT_EXPIRY,
            proposer_pubkey: pubkey_bytes(&proposer),
            signature: sign_message(&proposer, &msg),
            params_data: params_data.clone(),
        }),
        &[funded_account(payer), empty_account(proposal_address)],
    )
    .unwrap();

    // First approval — not enough
    let msg = remove_intent_msg("approve", DEFAULT_EXPIRY, wallet_name, 0, 0);
    svm.process_instruction(
        &build_approve_ix(
            wallet,
            remove_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            0,
            sign_message(&approver1, &msg),
        ),
        &[],
    )
    .unwrap();
    assert_eq!(
        svm.get_account(&proposal_address).unwrap().data[105],
        0,
        "should still be Active"
    );

    // Second approval — threshold met
    svm.process_instruction(
        &build_approve_ix(
            wallet,
            remove_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            1,
            sign_message(&approver2, &msg),
        ),
        &[],
    )
    .unwrap();
    assert_eq!(
        svm.get_account(&proposal_address).unwrap().data[105],
        1,
        "should be Approved"
    );
    println!("  MULTI_APPROVE: 2-of-3 threshold works");
}

#[test]
fn test_cancel_reverts_approved_to_active() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver1 = new_keypair();
    let approver2 = new_keypair();
    let wallet_name = "revert-test";

    let name_hash = Pubkey::from(compute_name_hash(wallet_name));
    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (update_intent, _) = find_intent_address(&wallet, 2, &crate::ID);

    let instruction: Instruction = CreateWalletInstruction {
        payer,
        name_hash,
        wallet,
        add_intent,
        remove_intent,
        update_intent,
        system_program: quasar_svm::system_program::ID,
        name: DynBytes::new(wallet_name.as_bytes().to_vec()),
        approval_threshold: 2,
        cancellation_threshold: 2,
        timelock_seconds: 0,
        proposers: DynVec::new(vec![pubkey_of(&proposer).to_bytes()]),
        approvers: DynVec::new(vec![
            pubkey_of(&approver1).to_bytes(),
            pubkey_of(&approver2).to_bytes(),
        ]),
        policy_ciphertexts: TailBytes(Vec::new()),
    }
    .into();
    svm.process_instruction(
        &instruction,
        &[
            funded_account(payer),
            empty_account(name_hash),
            empty_account(wallet),
            empty_account(add_intent),
            empty_account(remove_intent),
            empty_account(update_intent),
        ],
    )
    .unwrap();

    let params_data = vec![0u8];
    let proposal_address = get_proposal_address(remove_intent, 0);

    let msg = remove_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 0, 0);
    svm.process_instruction(
        &build_propose_ix(ProposeArgs {
            payer,
            wallet,
            intent: remove_intent,
            proposal_index: 0,
            expiry: DEFAULT_EXPIRY,
            proposer_pubkey: pubkey_bytes(&proposer),
            signature: sign_message(&proposer, &msg),
            params_data: params_data.clone(),
        }),
        &[funded_account(payer), empty_account(proposal_address)],
    )
    .unwrap();

    // Both approve
    let approve_msg = remove_intent_msg("approve", DEFAULT_EXPIRY, wallet_name, 0, 0);
    svm.process_instruction(
        &build_approve_ix(
            wallet,
            remove_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            0,
            sign_message(&approver1, &approve_msg),
        ),
        &[],
    )
    .unwrap();
    svm.process_instruction(
        &build_approve_ix(
            wallet,
            remove_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            1,
            sign_message(&approver2, &approve_msg),
        ),
        &[],
    )
    .unwrap();
    assert_eq!(
        svm.get_account(&proposal_address).unwrap().data[105],
        1,
        "should be Approved"
    );

    // approver1 switches to cancel
    let cancel_msg = wrap_offchain(
        format!(
            "expires {}: cancel remove intent 0{}",
            format_timestamp(DEFAULT_EXPIRY),
            message_suffix(wallet_name, 0)
        )
        .as_bytes(),
    );
    svm.process_instruction(
        &build_cancel_ix(
            wallet,
            remove_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            0,
            sign_message(&approver1, &cancel_msg),
        ),
        &[],
    )
    .unwrap();

    assert_eq!(
        svm.get_account(&proposal_address).unwrap().data[105],
        0,
        "should revert to Active"
    );
    println!("  REVERT: Approved → Active after vote switch");
}

#[test]
fn test_non_approver_approve_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let random_key = new_keypair();
    let wallet_name = "non-approver";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let proposal_address = get_proposal_address(remove_intent, 0);

    let params_data = vec![0u8];
    let msg = remove_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 0, 0);
    svm.process_instruction(
        &build_propose_ix(ProposeArgs {
            payer,
            wallet,
            intent: remove_intent,
            proposal_index: 0,
            expiry: DEFAULT_EXPIRY,
            proposer_pubkey: pubkey_bytes(&proposer),
            signature: sign_message(&proposer, &msg),
            params_data,
        }),
        &[funded_account(payer), empty_account(proposal_address)],
    )
    .unwrap();

    let msg = remove_intent_msg("approve", DEFAULT_EXPIRY, wallet_name, 0, 0);
    assert!(svm
        .process_instruction(
            &build_approve_ix(
                wallet,
                remove_intent,
                proposal_address,
                DEFAULT_EXPIRY,
                99,
                sign_message(&random_key, &msg)
            ),
            &[]
        )
        .is_err());
}

#[test]
fn test_full_add_then_remove_lifecycle() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "full-lifecycle";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (new_intent_address, _) = find_intent_address(&wallet, 3, &crate::ID);

    // 1. Add a transfer intent
    let built = intents::transfer_sol::build(&intents::transfer_sol::IntentConfig {
        proposers: &[pubkey_of(&proposer)],
        approvers: &[pubkey_of(&approver)],
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 0,
    });
    let params_data = built.serialize_body(&wallet, 0, 3, 3);

    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: add_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data,
        msg_fn: &add_intent_msg,
        execute_remaining: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(new_intent_address, false),
        ],
        execute_extra_accounts: vec![funded_account(payer), empty_account(new_intent_address)],
    });
    assert_eq!(
        svm.get_account(&new_intent_address).unwrap().data[0],
        2,
        "new intent created"
    );

    // 2. Remove the new intent
    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: remove_intent,
        proposal_index: 1,
        proposer: &proposer,
        approver: &approver,
        params_data: vec![3u8],
        msg_fn: &|action, expiry, wallet_name, proposal_index, data| {
            remove_intent_msg(action, expiry, wallet_name, proposal_index, data[0])
        },
        execute_remaining: vec![AccountMeta::new(new_intent_address, false)],
        execute_extra_accounts: vec![],
    });

    assert_eq!(
        svm.get_account(&new_intent_address).unwrap().data[36],
        0,
        "intent deactivated"
    );

    // 3. Try to propose using deactivated intent — should fail
    let dummy_params = vec![0u8; 10];
    let msg = add_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 2, &dummy_params);
    let instruction = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent: new_intent_address,
        proposal_index: 2,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &msg),
        params_data: dummy_params,
    });
    let proposal_address = get_proposal_address(new_intent_address, 2);
    assert!(svm
        .process_instruction(
            &instruction,
            &[funded_account(payer), empty_account(proposal_address)]
        )
        .is_err());
    println!("  FULL_LIFECYCLE: add → remove → reject all passed");
}

#[test]
fn test_remove_add_intent_blocks_future_adds() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "block-adds";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);

    // Remove AddIntent itself
    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: remove_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: vec![0u8],
        msg_fn: &|action, expiry, wallet_name, proposal_index, data| {
            remove_intent_msg(action, expiry, wallet_name, proposal_index, data[0])
        },
        execute_remaining: vec![AccountMeta::new(add_intent, false)],
        execute_extra_accounts: vec![],
    });

    // Now try to add an intent — AddIntent is deactivated
    let built = intents::transfer_sol::build(&intents::transfer_sol::IntentConfig {
        proposers: &[pubkey_of(&proposer)],
        approvers: &[pubkey_of(&approver)],
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 0,
    });
    let params_data = built.serialize_body(&wallet, 0, 3, 3);
    let msg = add_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 1, &params_data);
    let proposal_address = get_proposal_address(add_intent, 1);
    let instruction = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent: add_intent,
        proposal_index: 1,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &msg),
        params_data,
    });
    assert!(svm
        .process_instruction(
            &instruction,
            &[funded_account(payer), empty_account(proposal_address)]
        )
        .is_err());
    println!("  BLOCK_ADDS: removing AddIntent blocks future additions");
}

#[test]
#[ignore] // quasar-svm returns UnbalancedInstruction on close; works on real validator
fn test_cleanup_executed_proposal() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "cleanup-test";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);

    let proposal_address = propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: remove_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: vec![0u8],
        msg_fn: &|action, expiry, wallet_name, proposal_index, data| {
            remove_intent_msg(action, expiry, wallet_name, proposal_index, data[0])
        },
        execute_remaining: vec![AccountMeta::new(add_intent, false)],
        execute_extra_accounts: vec![],
    });

    assert_eq!(
        svm.get_account(&proposal_address).unwrap().data[105],
        2,
        "should be Executed"
    );

    let instruction: Instruction = CleanupProposalInstruction {
        proposal: proposal_address,
        rent_refund: payer,
    }
    .into();
    let result = svm.process_instruction(&instruction, &[]);
    assert!(result.is_ok(), "cleanup failed: {:?}", result.raw_result);

    let account = svm.get_account(&proposal_address);
    assert!(
        account.is_none_or(|a| a.data.is_empty() || a.lamports == 0),
        "proposal should be closed"
    );
    println!("  CLEANUP: proposal closed successfully");
}

#[test]
fn test_cleanup_active_proposal_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "cleanup-fail";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);

    let params_data = vec![0u8];
    let proposal_address = get_proposal_address(remove_intent, 0);
    let msg = remove_intent_msg("propose", DEFAULT_EXPIRY, wallet_name, 0, 0);
    svm.process_instruction(
        &build_propose_ix(ProposeArgs {
            payer,
            wallet,
            intent: remove_intent,
            proposal_index: 0,
            expiry: DEFAULT_EXPIRY,
            proposer_pubkey: pubkey_bytes(&proposer),
            signature: sign_message(&proposer, &msg),
            params_data,
        }),
        &[funded_account(payer), empty_account(proposal_address)],
    )
    .unwrap();

    let instruction: Instruction = CleanupProposalInstruction {
        proposal: proposal_address,
        rent_refund: payer,
    }
    .into();
    assert!(svm
        .process_instruction(&instruction, &[funded_account(payer)])
        .is_err());
}

// =========================================================================
// SPL Token transfer test — exercises the full CPI execution engine
// =========================================================================

#[test]
fn test_execute_spl_token_transfer() {
    use quasar_svm::token::{
        create_keyed_mint_account, create_keyed_token_account, Mint, TokenAccount,
    };
    use quasar_svm::{SPL_ASSOCIATED_TOKEN_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID};
    use spl_token::solana_program::program_pack::Pack;
    use spl_token::state::AccountState;

    let mut svm = setup_with_tokens();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "token-transfer";
    let transfer_amount = 500_000u64;

    // 1. Create the wallet
    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    svm.process_instruction(&instruction, &accounts).unwrap();

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (vault, _) = find_vault_address(&wallet, &crate::ID);

    // 2. Add a transfer_tokens intent
    let built_intent = intents::transfer_tokens::build(&intents::transfer_sol::IntentConfig {
        proposers: &[pubkey_of(&proposer)],
        approvers: &[pubkey_of(&approver)],
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 0,
    });
    let intent_body = built_intent.serialize_body(&wallet, 0, 3, 3);
    let (new_intent_address, _) = find_intent_address(&wallet, 3, &crate::ID);

    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: add_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: intent_body,
        msg_fn: &add_intent_msg,
        execute_remaining: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(new_intent_address, false),
        ],
        execute_extra_accounts: vec![funded_account(payer), empty_account(new_intent_address)],
    });
    assert_eq!(
        svm.get_account(&new_intent_address).unwrap().data[0],
        2,
        "intent created"
    );

    // 3. Set up token accounts
    let mint_address = Pubkey::new_unique();
    let destination_wallet = Pubkey::new_unique();
    let decimals = 6u8;
    let initial_supply = 1_000_000u64;

    // Create mint
    let mint_account = create_keyed_mint_account(
        &mint_address,
        &Mint {
            decimals,
            supply: initial_supply,
            is_initialized: true,
            ..Default::default()
        },
    );

    // Derive ATAs
    let (source_ata, _) = Pubkey::find_program_address(
        &[
            vault.as_ref(),
            SPL_TOKEN_PROGRAM_ID.as_ref(),
            mint_address.as_ref(),
        ],
        &SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    let (dest_ata, _) = Pubkey::find_program_address(
        &[
            destination_wallet.as_ref(),
            SPL_TOKEN_PROGRAM_ID.as_ref(),
            mint_address.as_ref(),
        ],
        &SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Create source ATA with tokens
    let source_token_account = create_keyed_token_account(
        &source_ata,
        &TokenAccount {
            mint: mint_address,
            owner: vault,
            amount: initial_supply,
            state: AccountState::Initialized,
            ..Default::default()
        },
    );

    // Load token accounts into SVM
    svm.set_account(mint_account);
    svm.set_account(source_token_account);

    // Fund the vault with SOL for ATA creation rent via system transfer
    let fund_vault_ix = solana_instruction::Instruction {
        program_id: quasar_svm::system_program::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(vault, false),
        ],
        data: {
            let mut d = vec![2, 0, 0, 0]; // Transfer instruction
            d.extend_from_slice(&10_000_000_000u64.to_le_bytes());
            d
        },
    };
    svm.process_instruction(
        &fund_vault_ix,
        &[funded_account(payer), empty_account(vault)],
    )
    .unwrap();

    // 4. Build params_data for the token transfer proposal
    // The transfer_tokens intent params are: destination(address), mint(address), amount(u64)
    let mut params_data = Vec::new();
    params_data.extend_from_slice(destination_wallet.as_ref()); // param 0: destination (32 bytes)
    params_data.extend_from_slice(mint_address.as_ref()); // param 1: mint (32 bytes)
    params_data.extend_from_slice(&transfer_amount.to_le_bytes()); // param 2: amount (8 bytes)

    // 5. Build the human-readable message for this custom intent
    // Template: "transfer {2} of mint {1} to {0}"
    // This needs to match what the on-chain message builder produces.
    let rendered_template = format!(
        "transfer {transfer_amount} of mint {} to {}",
        bs58::encode(mint_address.as_ref()).into_string(),
        bs58::encode(destination_wallet.as_ref()).into_string(),
    );
    let propose_msg = wrap_offchain(
        format!(
            "expires {}: propose {rendered_template}{}",
            format_timestamp(DEFAULT_EXPIRY),
            message_suffix(wallet_name, 1), // proposal_index = 1 (we already used 0 for add intent)
        )
        .as_bytes(),
    );
    let approve_msg = wrap_offchain(
        format!(
            "expires {}: approve {rendered_template}{}",
            format_timestamp(DEFAULT_EXPIRY),
            message_suffix(wallet_name, 1),
        )
        .as_bytes(),
    );

    let proposal_address = get_proposal_address(new_intent_address, 1);

    // 6. Propose the token transfer
    let instruction = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent: new_intent_address,
        proposal_index: 1,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &propose_msg),
        params_data: params_data.clone(),
    });
    let result = svm.process_instruction(
        &instruction,
        &[funded_account(payer), empty_account(proposal_address)],
    );
    assert!(
        result.is_ok(),
        "propose token transfer failed: {:?}",
        result.raw_result
    );
    println!("  TOKEN PROPOSE CU: {}", result.compute_units_consumed);

    // 7. Approve the token transfer
    let instruction = build_approve_ix(
        wallet,
        new_intent_address,
        proposal_address,
        DEFAULT_EXPIRY,
        0,
        sign_message(&approver, &approve_msg),
    );
    let result = svm.process_instruction(&instruction, &[]);
    assert!(
        result.is_ok(),
        "approve token transfer failed: {:?}",
        result.raw_result
    );
    println!("  TOKEN APPROVE CU: {}", result.compute_units_consumed);

    // 8. Execute the token transfer
    // The transfer_tokens intent defines these accounts:
    //   0: Token Program, 1: ATA Program, 2: System Program,
    //   3: Vault, 4: Destination wallet, 5: Mint,
    //   6: Source ATA (PDA), 7: Dest ATA (PDA)
    let (execute_instruction, _execute_vault) = build_execute_ix(
        wallet,
        new_intent_address,
        proposal_address,
        vec![
            AccountMeta::new_readonly(SPL_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(SPL_ASSOCIATED_TOKEN_PROGRAM_ID, false),
            // system_program and vault are NOT passed — they're injected from
            // declared Execute accounts (quasar rejects duplicate remaining accounts)
            AccountMeta::new_readonly(destination_wallet, false),
            AccountMeta::new_readonly(mint_address, false),
            AccountMeta::new(source_ata, false),
            AccountMeta::new(dest_ata, false),
        ],
    );
    let result = svm.process_instruction(
        &execute_instruction,
        &[empty_account(destination_wallet), empty_account(dest_ata)],
    );
    assert!(
        result.is_ok(),
        "execute token transfer failed: {:?}",
        result.raw_result
    );
    println!("  TOKEN EXECUTE CU: {}", result.compute_units_consumed);

    // 9. Verify the transfer happened
    let dest_account_data = svm.get_account(&dest_ata).unwrap();
    assert_eq!(
        dest_account_data.owner, SPL_TOKEN_PROGRAM_ID,
        "dest ATA should be owned by token program"
    );

    // Parse the token account to check amount
    let dest_token: TokenAccount = TokenAccount::unpack(&dest_account_data.data).unwrap();
    assert_eq!(
        dest_token.amount, transfer_amount,
        "dest should have received tokens"
    );
    assert_eq!(
        dest_token.owner, destination_wallet,
        "dest ATA should be owned by destination wallet"
    );
    assert_eq!(
        dest_token.mint, mint_address,
        "dest ATA should have correct mint"
    );

    // Check source was debited
    let source_account_data = svm.get_account(&source_ata).unwrap();
    let source_token: TokenAccount = TokenAccount::unpack(&source_account_data.data).unwrap();
    assert_eq!(
        source_token.amount,
        initial_supply - transfer_amount,
        "source should be debited"
    );

    println!("  TOKEN_TRANSFER: {transfer_amount} tokens transferred successfully!");
}

/// End-to-end SOL transfer through execute_custom — the path two
/// recent regressions silently broke in production:
///
///   1. solana_transfer.json shipped without an `accounts` /
///      `instructions` block (442a4af). The on-chain handler
///      iterated an empty instructions array, returned success,
///      and no SOL moved. Confirmed live on devnet
///      (2c71B…rA8 — only the payer's gas fee budged).
///
///   2. Once the JSON was fixed, the CLI's resolve_remaining_accounts
///      passed ALL three accounts (system / vault / destination)
///      while execute_custom auto-injects vault + system_program.
///      Position [2] received system_program, validate_remaining_accounts
///      hit AccountAddressMismatch (0x1785). Fixed in 296696d by
///      filtering auto-injected entries out of remaining_accounts.
///
/// This test exercises the same shape end-to-end inside quasar-svm
/// — a future regression in either layer fails here before it can
/// hit production.
#[test]
fn test_execute_sol_transfer() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "sol-transfer";
    let transfer_amount = 100_000_000u64; // 0.1 SOL — same shape as the live test we just ran

    // 1. Create the wallet.
    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    svm.process_instruction(&instruction, &accounts).unwrap();

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (vault, _) = find_vault_address(&wallet, &crate::ID);

    // 2. Add the SOL transfer intent at slot 3 via the AddIntent
    //    meta path. Same intent shape as
    //    examples/intents/solana_transfer.json: 2 params + 3
    //    accounts (system / vault / param-0) + 1 System Transfer
    //    instruction.
    let built_intent = intents::transfer_sol::build(&intents::transfer_sol::IntentConfig {
        proposers: &[pubkey_of(&proposer)],
        approvers: &[pubkey_of(&approver)],
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 0,
    });
    let intent_body = built_intent.serialize_body(&wallet, 0, 3, 3);
    let (new_intent_address, _) = find_intent_address(&wallet, 3, &crate::ID);

    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: add_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: intent_body,
        msg_fn: &add_intent_msg,
        execute_remaining: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(new_intent_address, false),
        ],
        execute_extra_accounts: vec![funded_account(payer), empty_account(new_intent_address)],
    });
    assert_eq!(
        svm.get_account(&new_intent_address).unwrap().data[0],
        2,
        "intent created"
    );

    // 3. Fund the vault with enough SOL to cover the transfer +
    //    rent-exempt minimum. System Transfer between System-owned
    //    accounts works as long as the source has the balance.
    let fund_amount = transfer_amount + 5_000_000; // 0.1 + 0.005 SOL
    let fund_vault_ix = solana_instruction::Instruction {
        program_id: quasar_svm::system_program::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(vault, false),
        ],
        data: {
            let mut d = vec![2, 0, 0, 0]; // System Transfer discriminator
            d.extend_from_slice(&fund_amount.to_le_bytes());
            d
        },
    };
    svm.process_instruction(
        &fund_vault_ix,
        &[funded_account(payer), empty_account(vault)],
    )
    .unwrap();
    let vault_pre = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    assert!(
        vault_pre >= fund_amount,
        "vault should be funded; got {vault_pre}",
    );

    // 4. Build params_data for the SOL transfer proposal.
    //    Params per transfer_sol.rs: [destination(address), amount(u64)].
    let destination = Pubkey::new_unique();
    let mut params_data = Vec::new();
    params_data.extend_from_slice(destination.as_ref()); // 32 bytes
    params_data.extend_from_slice(&transfer_amount.to_le_bytes()); // 8 bytes

    // 5. Render the human-readable message the on-chain builder
    //    will reproduce exactly. Template is
    //    "transfer {1:10^9} SOL to {0}". Param[0] is base58'd
    //    address, param[1] is lamports rendered as display SOL.
    let rendered_template = format!(
        "transfer 0.1 SOL to {}",
        bs58::encode(destination.as_ref()).into_string(),
    );
    let propose_msg = wrap_offchain(
        format!(
            "expires {}: propose {rendered_template}{}",
            format_timestamp(DEFAULT_EXPIRY),
            message_suffix(wallet_name, 1),
        )
        .as_bytes(),
    );
    let approve_msg = wrap_offchain(
        format!(
            "expires {}: approve {rendered_template}{}",
            format_timestamp(DEFAULT_EXPIRY),
            message_suffix(wallet_name, 1),
        )
        .as_bytes(),
    );

    let proposal_address = get_proposal_address(new_intent_address, 1);

    // 6. Propose the SOL transfer.
    let instruction = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent: new_intent_address,
        proposal_index: 1,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &propose_msg),
        params_data: params_data.clone(),
    });
    let result = svm.process_instruction(
        &instruction,
        &[funded_account(payer), empty_account(proposal_address)],
    );
    assert!(
        result.is_ok(),
        "propose SOL transfer failed: {:?}",
        result.raw_result
    );

    // 7. Approve.
    let instruction = build_approve_ix(
        wallet,
        new_intent_address,
        proposal_address,
        DEFAULT_EXPIRY,
        0,
        sign_message(&approver, &approve_msg),
    );
    let result = svm.process_instruction(&instruction, &[]);
    assert!(
        result.is_ok(),
        "approve SOL transfer failed: {:?}",
        result.raw_result
    );

    // 8. Execute. CRITICAL: only the destination is passed in
    //    remaining_accounts. The on-chain handler auto-injects
    //    system_program (Static matching declared) + vault (Vault
    //    source). Passing them in remaining_accounts here would
    //    misalign positions and trigger AccountAddressMismatch
    //    (0x1785) — that's exactly the regression this test
    //    guards.
    let (execute_instruction, _) = build_execute_ix(
        wallet,
        new_intent_address,
        proposal_address,
        vec![
            // ONLY the destination — vault and system_program are
            // auto-injected by execute_custom from `declared`.
            AccountMeta::new(destination, false),
        ],
    );
    let result = svm.process_instruction(&execute_instruction, &[empty_account(destination)]);
    assert!(
        result.is_ok(),
        "execute SOL transfer failed: {:?}",
        result.raw_result,
    );

    // 9. Verify lamports actually moved. This is the assertion
    //    that would have caught the silent no-op outright.
    let dest_lamports = svm
        .get_account(&destination)
        .map(|a| a.lamports)
        .unwrap_or(0);
    assert_eq!(
        dest_lamports, transfer_amount,
        "destination should have received exactly {transfer_amount} lamports",
    );
    let vault_post = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    assert_eq!(
        vault_post,
        vault_pre - transfer_amount,
        "vault should have been debited by exactly {transfer_amount} lamports",
    );
}
