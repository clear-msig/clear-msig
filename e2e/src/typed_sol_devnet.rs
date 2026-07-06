use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

use clear_wallet::utils::clearsign::{
    hash_envelope, hash_policy_commitment, hash_send_payload, hash_vote_message,
    ClearSignActionKind, ClearSignAmount, ClearSignEnvelope, ClearSignVoteKind,
};
use clear_wallet_client::pda::{
    compute_name_hash, find_intent_address, find_typed_proposal_address, find_vault_address,
    find_wallet_address,
};
use quasar_lang::client::{DynBytes, DynVec, TailBytes};
use sha2::{Digest, Sha256};
use solana_address::Address;
use solana_rpc_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair, Signature},
    signer::Signer,
    transaction::Transaction,
};

const DEFAULT_RPC_URL: &str = "https://api.devnet.solana.com";
const SEND_LAMPORTS: u64 = 1_000_000;
const VAULT_FUND_LAMPORTS: u64 = 3_000_000;

fn main() -> anyhow::Result<()> {
    let rpc_url = env::var("RPC_URL").unwrap_or_else(|_| DEFAULT_RPC_URL.to_string());
    let payer_path = env::var("PAYER_KEYPAIR")
        .map_err(|_| anyhow::anyhow!("set PAYER_KEYPAIR=/path/to/funded-devnet-keypair.json"))?;
    let payer = read_keypair_file(&payer_path)
        .map_err(|e| anyhow::anyhow!("failed to read payer keypair at {payer_path}: {e}"))?;
    let client = RpcClient::new_with_commitment(rpc_url.clone(), CommitmentConfig::confirmed());

    let program_id = pubkey_from_address(clear_wallet_client::ID);
    let approver = Keypair::new();
    let payer_addr = Address::new_from_array(payer.pubkey().to_bytes());
    let wallet_name = unique_wallet_name();
    let wallet = find_wallet_address(&wallet_name, &payer_addr, &clear_wallet_client::ID).0;
    let wallet_pubkey = pubkey_from_address(wallet);
    let add_intent = find_intent_address(&wallet, 0, &clear_wallet_client::ID).0;
    let remove_intent = find_intent_address(&wallet, 1, &clear_wallet_client::ID).0;
    let update_intent = find_intent_address(&wallet, 2, &clear_wallet_client::ID).0;
    let intent_pubkey = pubkey_from_address(add_intent);
    let vault_pubkey = pubkey_from_address(find_vault_address(&wallet, &clear_wallet_client::ID).0);
    let recipient = Keypair::new().pubkey();

    println!("RPC: {rpc_url}");
    println!("Payer: {}", payer.pubkey());
    println!("Approver: {}", approver.pubkey());
    println!("Wallet name: {wallet_name}");
    println!("Wallet: {wallet_pubkey}");
    println!("Vault: {vault_pubkey}");
    println!("Recipient: {recipient}");

    let create_wallet = build_create_wallet_ix(
        payer.pubkey(),
        wallet_name.as_bytes(),
        wallet_pubkey,
        pubkey_from_address(add_intent),
        pubkey_from_address(remove_intent),
        pubkey_from_address(update_intent),
        payer.pubkey().to_bytes(),
        approver.pubkey().to_bytes(),
    );
    send_ix(&client, &payer, vec![create_wallet])?;
    println!("created wallet");

    send_ix(
        &client,
        &payer,
        vec![build_system_transfer_ix(
            payer.pubkey(),
            vault_pubkey,
            VAULT_FUND_LAMPORTS,
        )],
    )?;
    println!("funded vault with {VAULT_FUND_LAMPORTS} lamports");

    let proposal_index = 0u64;
    let typed_proposal = pubkey_from_address(
        find_typed_proposal_address(&add_intent, proposal_index, &clear_wallet_client::ID).0,
    );
    let action_id_text = format!("{wallet_name}:typed-sol-send");
    let nonce_text = format!("{}:{}", wallet_name, unix_ts()?);
    let action_id = sha256(action_id_text.as_bytes());
    let nonce = sha256(nonce_text.as_bytes());
    let expires_at = unix_ts()? + 900;
    let policy_commitment = hash_policy_commitment(&[b"devnet-e2e:typed-sol-send"]);
    let payload_hash = hash_send_payload(
        recipient.as_ref(),
        &ClearSignAmount {
            asset: b"SOL",
            raw_amount: SEND_LAMPORTS as u128,
        },
    );
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: ClearSignActionKind::Send,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet_pubkey.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at,
        policy_commitment,
        payload_hash,
    });
    let vote_hash = hash_vote_message(
        ClearSignVoteKind::Propose,
        wallet_pubkey.as_ref(),
        proposal_index,
        envelope_hash,
    );
    let signed = payer.sign_message(&vote_hash);
    let mut signature = [0u8; 64];
    signature.copy_from_slice(signed.as_ref());
    let propose = build_propose_typed_ix(
        program_id,
        payer.pubkey(),
        wallet_pubkey,
        intent_pubkey,
        typed_proposal,
        proposal_index,
        expires_at,
        policy_commitment,
        payload_hash,
        envelope_hash,
        payer.pubkey().to_bytes(),
        signature,
        action_id,
        nonce,
    );
    send_ix(&client, &payer, vec![propose])?;
    println!("created typed proposal: {typed_proposal}");

    let approve_hash = hash_vote_message(
        ClearSignVoteKind::Approve,
        wallet_pubkey.as_ref(),
        proposal_index,
        envelope_hash,
    );
    let signed_approval = approver.sign_message(&approve_hash);
    let mut approval_signature = [0u8; 64];
    approval_signature.copy_from_slice(signed_approval.as_ref());
    let approve = build_approve_typed_ix(
        program_id,
        wallet_pubkey,
        intent_pubkey,
        typed_proposal,
        0,
        approval_signature,
    );
    send_ix(&client, &payer, vec![approve])?;
    println!("approved typed proposal");

    let recipient_before = client.get_balance(&recipient).unwrap_or(0);
    let execute = build_execute_typed_sol_send_ix(
        program_id,
        wallet_pubkey,
        vault_pubkey,
        intent_pubkey,
        typed_proposal,
        recipient,
        policy_commitment,
        envelope_hash,
        SEND_LAMPORTS,
    );
    send_ix(&client, &payer, vec![execute])?;
    println!("executed typed SOL send");

    let recipient_after = client.get_balance(&recipient)?;
    anyhow::ensure!(
        recipient_after == recipient_before + SEND_LAMPORTS,
        "recipient balance mismatch: before={recipient_before}, after={recipient_after}, expected delta={SEND_LAMPORTS}"
    );
    let proposal_data = client.get_account_data(&typed_proposal)?;
    anyhow::ensure!(
        proposal_data.get(105) == Some(&2),
        "typed proposal not marked executed"
    );
    println!("verified recipient balance and proposal status");

    let cleanup = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(typed_proposal, false),
            AccountMeta::new(payer.pubkey(), false),
        ],
        data: vec![16],
    };
    send_ix(&client, &payer, vec![cleanup])?;
    println!("cleaned typed proposal rent");

    println!(
        "{}",
        serde_json::json!({
            "status": "ok",
            "wallet": wallet_pubkey.to_string(),
            "vault": vault_pubkey.to_string(),
            "recipient": recipient.to_string(),
            "proposal": typed_proposal.to_string(),
            "lamports_sent": SEND_LAMPORTS,
        })
    );
    Ok(())
}

fn build_create_wallet_ix(
    payer: Pubkey,
    wallet_name: &[u8],
    wallet: Pubkey,
    add_intent: Pubkey,
    remove_intent: Pubkey,
    update_intent: Pubkey,
    member: [u8; 32],
    approver: [u8; 32],
) -> Instruction {
    let name_hash = Pubkey::new_from_array(compute_name_hash(
        std::str::from_utf8(wallet_name).expect("wallet name utf8"),
    ));
    let mut data = vec![0];
    wincode::serialize_into(&mut data, &1u8).unwrap();
    wincode::serialize_into(&mut data, &1u8).unwrap();
    wincode::serialize_into(&mut data, &0u32).unwrap();
    let name: DynBytes<u32> = DynBytes::from(wallet_name.to_vec());
    let proposers: DynVec<[u8; 32]> = DynVec::new(vec![member]);
    let approvers: DynVec<[u8; 32]> = DynVec::new(vec![approver]);
    wincode::serialize_into(&mut data, &name).unwrap();
    wincode::serialize_into(&mut data, &proposers).unwrap();
    wincode::serialize_into(&mut data, &approvers).unwrap();
    wincode::serialize_into(&mut data, &TailBytes(Vec::new())).unwrap();
    Instruction {
        program_id: pubkey_from_address(clear_wallet_client::ID),
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(name_hash, false),
            AccountMeta::new(wallet, false),
            AccountMeta::new(add_intent, false),
            AccountMeta::new(remove_intent, false),
            AccountMeta::new(update_intent, false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data,
    }
}

fn build_system_transfer_ix(from: Pubkey, to: Pubkey, lamports: u64) -> Instruction {
    let mut data = vec![2, 0, 0, 0];
    data.extend_from_slice(&lamports.to_le_bytes());
    Instruction {
        program_id: solana_sdk::system_program::id(),
        accounts: vec![AccountMeta::new(from, true), AccountMeta::new(to, false)],
        data,
    }
}

fn build_approve_typed_ix(
    program_id: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    approver_index: u8,
    signature: [u8; 64],
) -> Instruction {
    let mut data = vec![9];
    wincode::serialize_into(&mut data, &approver_index).unwrap();
    wincode::serialize_into(&mut data, &signature).unwrap();
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new_readonly(intent, false),
            AccountMeta::new(proposal, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_propose_typed_ix(
    program_id: Pubkey,
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    proposal_index: u64,
    expires_at: i64,
    policy_commitment: [u8; 32],
    payload_hash: [u8; 32],
    envelope_hash: [u8; 32],
    proposer_pubkey: [u8; 32],
    signature: [u8; 64],
    action_id: [u8; 32],
    nonce: [u8; 32],
) -> Instruction {
    let mut data = vec![8];
    wincode::serialize_into(&mut data, &proposal_index).unwrap();
    wincode::serialize_into(&mut data, &expires_at).unwrap();
    wincode::serialize_into(&mut data, &ClearSignActionKind::Send.code()).unwrap();
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &payload_hash).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &proposer_pubkey).unwrap();
    wincode::serialize_into(&mut data, &signature).unwrap();
    wincode::serialize_into(&mut data, &action_id).unwrap();
    wincode::serialize_into(&mut data, &nonce).unwrap();
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_sol_send_ix(
    program_id: Pubkey,
    wallet: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    recipient: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_lamports: u64,
) -> Instruction {
    let mut data = vec![14];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_lamports).unwrap();
    Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(vault, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new(recipient, false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data,
    }
}

fn send_ix(
    client: &RpcClient,
    payer: &Keypair,
    ixs: Vec<Instruction>,
) -> anyhow::Result<Signature> {
    let blockhash = client.get_latest_blockhash()?;
    let tx = Transaction::new_signed_with_payer(&ixs, Some(&payer.pubkey()), &[payer], blockhash);
    let sig = client.send_and_confirm_transaction(&tx)?;
    Ok(sig)
}

fn pubkey_from_address(address: Address) -> Pubkey {
    Pubkey::new_from_array(address.to_bytes())
}

fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

fn unix_ts() -> anyhow::Result<i64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() as i64)
}

fn unique_wallet_name() -> String {
    format!("typed-sol-e2e-{}", unix_ts().unwrap_or(0))
}
