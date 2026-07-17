extern crate std;

use alloc::vec::Vec;
use {
    crate::clear_wallet::cpi::*,
    crate::state::ika_config::{IKA_CONFIG_DISCRIMINATOR, IKA_CONFIG_LEN},
    crate::utils::clearsign::{
        hash_clear_text, hash_envelope, hash_policy_commitment, hash_send_payload,
        write_vote_message_for_clear_text, ClearSignActionKind, ClearSignAmount, ClearSignEnvelope,
        ClearSignVoteKind, MAX_CLEARSIGN_VOTE_MESSAGE_BYTES,
    },
    crate::utils::policy::hash_typed_policy,
    alloc::vec,
    clear_msig_signing::{
        encode_agent_risk_policy as encode_v4_agent_risk_policy,
        encode_agent_session as encode_v4_agent_session,
        encode_agent_settlement as encode_v4_agent_settlement,
        encode_agent_trade_approval as encode_v4_agent_trade_approval,
        encode_batch_transfer as encode_v4_batch_transfer,
        encode_escrow_release as encode_v4_escrow_release,
        encode_escrow_return as encode_v4_escrow_return,
        encode_policy_update as encode_v4_policy_update, encode_transfer as encode_v4_transfer,
        envelope_hash as hash_v4_envelope, execution_commitment as v4_execution_commitment,
        parse_intent as parse_v4_intent, policy_commitment as v4_policy_commitment,
        render_document as render_v4_document,
        spl_escrow_return_execution_commitment as v4_spl_return_execution_commitment,
        wallet_policy_commitment as v4_wallet_policy_commitment,
        AgentRiskPolicyInput as V4AgentRiskPolicyInput, AgentSessionInput as V4AgentSessionInput,
        AgentSettlementInput as V4AgentSettlementInput,
        AgentTradeApprovalInput as V4AgentTradeApprovalInput,
        BatchTransferInput as V4BatchTransferInput, CommonFields as V4CommonFields,
        DeviceProfile as V4DeviceProfile, EscrowReleaseInput as V4EscrowReleaseInput,
        EscrowReturnInput as V4EscrowReturnInput, IdentityEncoding as V4IdentityEncoding,
        Network as V4Network, PolicyUpdateInput as V4PolicyUpdateInput,
        TransferInput as V4TransferInput, TransferRowInput as V4TransferRowInput,
        MAX_CANONICAL_INTENT_BYTES, MAX_DOCUMENT_BYTES,
    },
    clear_wallet_client::{
        intent_builder::IntentBuilder,
        intents,
        pda::{
            compute_name_hash, find_agent_risk_address, find_agent_session_address,
            find_agent_settlement_receipt_address, find_intent_address, find_policy_spend_address,
            find_proposal_address, find_typed_proposal_address, find_vault_address,
            find_wallet_address, find_wallet_policy_address,
        },
    },
    ed25519_dalek::Signer as DalekSigner,
    quasar_lang::client::{DynBytes, DynVec, TailBytes},
    quasar_svm::{Account, Instruction, Pubkey, QuasarSvm},
    sha2::{Digest, Sha256},
    solana_instruction::AccountMeta,
    std::{
        format, println,
        string::{String, ToString},
    },
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

include!("tests/support/instruction_builders.rs");
include!("tests/support/agent_instruction_builders.rs");
include!("tests/support/policy_support.rs");
include!("tests/support/agent_support.rs");
include!("tests/support/escrow_legacy_support.rs");

mod agents;
mod clear_sign_binding;
mod escrow_native;
mod escrow_remote;
mod legacy_intent_lifecycle;
mod legacy_proposal_creation;
mod legacy_proposal_enforcement;
mod legacy_transfers;
mod remote_assets;
mod solana_batch;
mod solana_policy_enforcement;
mod solana_policy_ledger;
mod wallet_basics;
