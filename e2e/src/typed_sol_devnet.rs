use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

use clear_wallet::utils::clearsign::{
    hash_clear_text, hash_envelope, hash_policy_commitment, hash_release_milestone_payload,
    hash_return_escrow_sol_payload_iter, hash_send_payload, write_vote_message_for_clear_text,
    ClearSignActionKind, ClearSignAmount, ClearSignEnvelope, ClearSignVoteKind,
    MAX_CLEARSIGN_VOTE_MESSAGE_BYTES,
};
use clear_wallet_client::pda::{
    compute_name_hash, find_intent_address, find_member_allowance_address,
    find_policy_spend_address, find_typed_proposal_address, find_vault_address,
    find_wallet_address, find_wallet_policy_address,
};
use quasar_lang::client::{DynBytes, DynVec, TailBytes};
use sha2::{Digest, Sha256};
use solana_address::Address;
use solana_rpc_client::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    compute_budget::ComputeBudgetInstruction,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair, Signature},
    signer::Signer,
    transaction::Transaction,
};

const DEFAULT_RPC_URL: &str = "https://api.devnet.solana.com";
const SEND_LAMPORTS: u64 = 1_000_000;
const ESCROW_RELEASE_LAMPORTS: u64 = 1_000_000;
const ESCROW_RETURN_A_LAMPORTS: u64 = 1_000_000;
const ESCROW_RETURN_B_LAMPORTS: u64 = 1_000_000;
const E2E_COMPUTE_UNIT_LIMIT: u32 = 600_000;
const VAULT_FUND_LAMPORTS: u64 = 5_000_000;

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

    let policy_commitment = hash_policy_commitment(&[b"devnet-e2e:typed-sol-send"]);
    let payload_hash = hash_send_payload(
        recipient.as_ref(),
        &ClearSignAmount {
            asset: b"SOL",
            raw_amount: SEND_LAMPORTS as u128,
        },
    );
    let (typed_send_proposal, send_envelope_hash) = propose_and_approve_typed(
        &client,
        program_id,
        &payer,
        &approver,
        &wallet_name,
        wallet_pubkey,
        intent_pubkey,
        0,
        ClearSignActionKind::Send,
        "typed-sol-send",
        policy_commitment,
        payload_hash,
    )?;

    let recipient_before = client.get_balance(&recipient).unwrap_or(0);
    let execute = build_execute_typed_sol_send_ix(
        program_id,
        payer.pubkey(),
        wallet_pubkey,
        vault_pubkey,
        intent_pubkey,
        typed_send_proposal,
        recipient,
        policy_commitment,
        send_envelope_hash,
        SEND_LAMPORTS,
    );
    send_ix(&client, &payer, vec![execute])?;
    println!("executed typed SOL send");

    let recipient_after = client.get_balance(&recipient)?;
    anyhow::ensure!(
        recipient_after == recipient_before + SEND_LAMPORTS,
        "recipient balance mismatch: before={recipient_before}, after={recipient_after}, expected delta={SEND_LAMPORTS}"
    );
    verify_executed(&client, &typed_send_proposal)?;
    println!("verified typed SOL send balance and proposal status");

    let escrow_release_recipient = Keypair::new().pubkey();
    let escrow_id_hash = sha256(format!("{wallet_name}:sol-escrow").as_bytes());
    let milestone_id_hash = sha256(format!("{wallet_name}:milestone-1").as_bytes());
    let release_policy_commitment =
        hash_policy_commitment(&[b"devnet-e2e:typed-sol-escrow-release"]);
    let release_payload_hash = hash_release_milestone_payload(
        &escrow_id_hash,
        &milestone_id_hash,
        escrow_release_recipient.as_ref(),
        &ClearSignAmount {
            asset: b"SOL",
            raw_amount: ESCROW_RELEASE_LAMPORTS as u128,
        },
    );
    let (release_proposal, release_envelope_hash) = propose_and_approve_typed(
        &client,
        program_id,
        &payer,
        &approver,
        &wallet_name,
        wallet_pubkey,
        intent_pubkey,
        1,
        ClearSignActionKind::ReleaseMilestone,
        "typed-sol-escrow-release",
        release_policy_commitment,
        release_payload_hash,
    )?;

    let release_before = client.get_balance(&escrow_release_recipient).unwrap_or(0);
    let release = build_execute_typed_escrow_release_ix(
        program_id,
        wallet_pubkey,
        vault_pubkey,
        intent_pubkey,
        release_proposal,
        escrow_release_recipient,
        release_policy_commitment,
        release_envelope_hash,
        ESCROW_RELEASE_LAMPORTS,
        escrow_id_hash,
        milestone_id_hash,
    );
    send_ix(&client, &payer, vec![release])?;
    println!("executed typed SOL escrow release");

    let release_after = client.get_balance(&escrow_release_recipient)?;
    anyhow::ensure!(
        release_after == release_before + ESCROW_RELEASE_LAMPORTS,
        "release recipient balance mismatch: before={release_before}, after={release_after}, expected delta={ESCROW_RELEASE_LAMPORTS}"
    );
    verify_executed(&client, &release_proposal)?;
    println!("verified typed SOL escrow release balance and proposal status");

    let return_funder_a = Keypair::new().pubkey();
    let return_funder_b = Keypair::new().pubkey();
    let return_policy_commitment = hash_policy_commitment(&[b"devnet-e2e:typed-sol-escrow-return"]);
    let return_payload_hash = hash_return_escrow_sol_payload_iter(
        &escrow_id_hash,
        [
            (return_funder_a.as_ref(), ESCROW_RETURN_A_LAMPORTS),
            (return_funder_b.as_ref(), ESCROW_RETURN_B_LAMPORTS),
        ]
        .into_iter(),
    );
    let (return_proposal, return_envelope_hash) = propose_and_approve_typed(
        &client,
        program_id,
        &payer,
        &approver,
        &wallet_name,
        wallet_pubkey,
        intent_pubkey,
        2,
        ClearSignActionKind::ReturnEscrowFunds,
        "typed-sol-escrow-return",
        return_policy_commitment,
        return_payload_hash,
    )?;

    let funder_a_before = client.get_balance(&return_funder_a).unwrap_or(0);
    let funder_b_before = client.get_balance(&return_funder_b).unwrap_or(0);
    let escrow_return = build_execute_typed_escrow_return_ix(
        program_id,
        wallet_pubkey,
        vault_pubkey,
        intent_pubkey,
        return_proposal,
        return_policy_commitment,
        return_envelope_hash,
        escrow_id_hash,
        vec![ESCROW_RETURN_A_LAMPORTS, ESCROW_RETURN_B_LAMPORTS],
        vec![
            AccountMeta::new(return_funder_a, false),
            AccountMeta::new(return_funder_b, false),
        ],
    );
    send_ix(&client, &payer, vec![escrow_return])?;
    println!("executed typed SOL escrow return");

    let funder_a_after = client.get_balance(&return_funder_a)?;
    let funder_b_after = client.get_balance(&return_funder_b)?;
    anyhow::ensure!(
        funder_a_after == funder_a_before + ESCROW_RETURN_A_LAMPORTS,
        "return funder A balance mismatch: before={funder_a_before}, after={funder_a_after}, expected delta={ESCROW_RETURN_A_LAMPORTS}"
    );
    anyhow::ensure!(
        funder_b_after == funder_b_before + ESCROW_RETURN_B_LAMPORTS,
        "return funder B balance mismatch: before={funder_b_before}, after={funder_b_after}, expected delta={ESCROW_RETURN_B_LAMPORTS}"
    );
    verify_executed(&client, &return_proposal)?;
    println!("verified typed SOL escrow return balances and proposal status");

    for proposal in [typed_send_proposal, release_proposal, return_proposal] {
        let cleanup = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(proposal, false),
                AccountMeta::new(payer.pubkey(), false),
            ],
            data: vec![16],
        };
        send_ix(&client, &payer, vec![cleanup])?;
        println!("cleaned typed proposal rent: {proposal}");
    }

    println!(
        "{}",
        serde_json::json!({
            "status": "ok",
            "wallet": wallet_pubkey.to_string(),
            "vault": vault_pubkey.to_string(),
            "typed_sol_send": {
                "proposal": typed_send_proposal.to_string(),
                "recipient": recipient.to_string(),
                "lamports_sent": SEND_LAMPORTS,
            },
            "typed_sol_escrow_release": {
                "proposal": release_proposal.to_string(),
                "recipient": escrow_release_recipient.to_string(),
                "lamports_released": ESCROW_RELEASE_LAMPORTS,
            },
            "typed_sol_escrow_return": {
                "proposal": return_proposal.to_string(),
                "funders": [
                    return_funder_a.to_string(),
                    return_funder_b.to_string(),
                ],
                "lamports_returned": [
                    ESCROW_RETURN_A_LAMPORTS,
                    ESCROW_RETURN_B_LAMPORTS,
                ],
            },
        })
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn propose_and_approve_typed(
    client: &RpcClient,
    program_id: Pubkey,
    payer: &Keypair,
    approver: &Keypair,
    wallet_name: &str,
    wallet_pubkey: Pubkey,
    intent_pubkey: Pubkey,
    proposal_index: u64,
    action_kind: ClearSignActionKind,
    action_label: &str,
    policy_commitment: [u8; 32],
    payload_hash: [u8; 32],
) -> anyhow::Result<(Pubkey, [u8; 32])> {
    let intent = Address::new_from_array(intent_pubkey.to_bytes());
    let typed_proposal = pubkey_from_address(
        find_typed_proposal_address(&intent, proposal_index, &clear_wallet_client::ID).0,
    );
    let action_id_text = format!("{wallet_name}:{action_label}:{proposal_index}");
    let nonce_text = format!("{}:{}:{}", wallet_name, proposal_index, unix_ts()?);
    let action_id = sha256(action_id_text.as_bytes());
    let nonce = sha256(nonce_text.as_bytes());
    let expires_at = unix_ts()? + 900;
    let clear_text = typed_clear_sign_document(action_kind, action_label);
    let envelope_hash = hash_envelope(&ClearSignEnvelope {
        kind: action_kind,
        wallet_name: wallet_name.as_bytes(),
        wallet_id: wallet_pubkey.as_ref(),
        action_id: action_id.as_ref(),
        nonce: nonce.as_ref(),
        expires_at,
        policy_commitment,
        payload_hash,
        clear_text_hash: hash_clear_text(&clear_text).unwrap(),
    });
    let vote_message = typed_vote_message(
        ClearSignVoteKind::Propose,
        wallet_name,
        payer.pubkey(),
        proposal_index,
        envelope_hash,
        expires_at,
        1,
        0,
        &clear_text,
    );
    let signed = payer.sign_message(&vote_message);
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
        action_kind,
        policy_commitment,
        payload_hash,
        envelope_hash,
        payer.pubkey().to_bytes(),
        signature,
        action_id,
        nonce,
        &clear_text,
    );
    send_ix(client, payer, vec![propose])?;
    println!("created {action_label} proposal: {typed_proposal}");

    let approve_message = typed_vote_message(
        ClearSignVoteKind::Approve,
        wallet_name,
        approver.pubkey(),
        proposal_index,
        envelope_hash,
        expires_at,
        1,
        1,
        &clear_text,
    );
    let signed_approval = approver.sign_message(&approve_message);
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
    send_ix(client, payer, vec![approve])?;
    println!("approved {action_label} proposal");
    Ok((typed_proposal, envelope_hash))
}

fn verify_executed(client: &RpcClient, proposal: &Pubkey) -> anyhow::Result<()> {
    let proposal_data = client.get_account_data(proposal)?;
    anyhow::ensure!(
        proposal_data.get(105) == Some(&2),
        "typed proposal not marked executed"
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
    action_kind: ClearSignActionKind,
    policy_commitment: [u8; 32],
    payload_hash: [u8; 32],
    envelope_hash: [u8; 32],
    proposer_pubkey: [u8; 32],
    signature: [u8; 64],
    action_id: [u8; 32],
    nonce: [u8; 32],
    clear_text: &[u8],
) -> Instruction {
    let mut data = vec![8];
    wincode::serialize_into(&mut data, &proposal_index).unwrap();
    wincode::serialize_into(&mut data, &expires_at).unwrap();
    wincode::serialize_into(&mut data, &action_kind.code()).unwrap();
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &payload_hash).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &proposer_pubkey).unwrap();
    wincode::serialize_into(&mut data, &signature).unwrap();
    wincode::serialize_into(&mut data, &action_id).unwrap();
    wincode::serialize_into(&mut data, &nonce).unwrap();
    wincode::serialize_into(&mut data, &DynVec::<u8>::new(Vec::new())).unwrap();
    wincode::serialize_into(&mut data, &TailBytes(clear_text.to_vec())).unwrap();
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

fn typed_vote_message(
    vote_kind: ClearSignVoteKind,
    wallet_name: &str,
    signer_pubkey: Pubkey,
    proposal_index: u64,
    envelope_hash: [u8; 32],
    expires_at: i64,
    approvals_required: u8,
    approvals_after: u8,
    clear_text: &[u8],
) -> Vec<u8> {
    let mut out = [0u8; MAX_CLEARSIGN_VOTE_MESSAGE_BYTES];
    let len = write_vote_message_for_clear_text(
        &mut out,
        vote_kind,
        wallet_name.as_bytes(),
        signer_pubkey.as_ref(),
        proposal_index,
        envelope_hash,
        expires_at,
        approvals_required,
        approvals_after,
        clear_text,
    )
    .expect("valid ClearSign v3 vote message");
    out[..len].to_vec()
}

fn typed_clear_sign_document(kind: ClearSignActionKind, action_label: &str) -> Vec<u8> {
    format!(
        "ClearSig Proposal\n\nACTION\n{}\n\nDETAILS\nDevnet E2E operation: {action_label}\nNetwork: Solana devnet\n\nPOLICY\nApproval: Wallet's onchain threshold must be met\nExecution: Onchain policy and timelock must pass\nEnforcement: Exact payload and policy must match onchain\n\nRISK\nCategory: Testnet asset movement\nCheck: Verify the action and destination before signing\n\nPURPOSE\nValidate the typed ClearSign v3 execution path",
        kind.clear_headline(),
    )
    .into_bytes()
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_sol_send_ix(
    program_id: Pubkey,
    payer: Pubkey,
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
    let wallet_address = Address::new_from_array(wallet.to_bytes());
    let intent_address = Address::new_from_array(intent.to_bytes());
    let wallet_policy = pubkey_from_address(
        find_wallet_policy_address(&wallet_address, &clear_wallet_client::ID).0,
    );
    let policy_spend = pubkey_from_address(
        find_policy_spend_address(&wallet_address, &intent_address, &clear_wallet_client::ID).0,
    );
    let member_allowance = pubkey_from_address(
        find_member_allowance_address(&wallet_address, &intent_address, &clear_wallet_client::ID).0,
    );
    Instruction {
        program_id,
        accounts: vec![
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
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_escrow_release_ix(
    program_id: Pubkey,
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
    let mut data = vec![12];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_lamports).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &milestone_id_hash).unwrap();
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

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_escrow_return_ix(
    program_id: Pubkey,
    wallet: Pubkey,
    vault: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    escrow_id_hash: [u8; 32],
    amount_lamports: Vec<u64>,
    remaining_accounts: Vec<AccountMeta>,
) -> Instruction {
    let mut data = vec![13];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    for amount in amount_lamports {
        data.extend_from_slice(&amount.to_le_bytes());
    }

    let mut accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
    ];
    accounts.extend(remaining_accounts);
    Instruction {
        program_id,
        accounts,
        data,
    }
}

fn send_ix(
    client: &RpcClient,
    payer: &Keypair,
    mut ixs: Vec<Instruction>,
) -> anyhow::Result<Signature> {
    ixs.insert(
        0,
        ComputeBudgetInstruction::set_compute_unit_limit(E2E_COMPUTE_UNIT_LIMIT),
    );
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
