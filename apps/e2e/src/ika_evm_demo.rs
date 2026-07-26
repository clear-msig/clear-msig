// Copyright (c) dWallet Labs, Ltd.
// SPDX-License-Identifier: BSD-3-Clause-Clear

//! Clear-msig + Ika E2E Demo (EVM signing).
//!
//! End-to-end flow against Solana devnet and the Ika pre-alpha gRPC service.
//! Drives a 2-of-2 clear-msig wallet through approving an EIP-1559 ETH
//! transfer and getting it signed by an Ika dWallet.
//!
//! ## Steps
//!
//! 1. Wait for the dWallet program's coordinator + NEK to initialize.
//! 2. Request a DKG via gRPC. The mock signer commits the dWallet on-chain
//!    and transfers ownership to the payer.
//! 3. Prepare `transfer_ownership` from payer → clear-wallet's CPI authority PDA.
//! 4. `create_wallet` (clear-msig wallet with proposer + 2 approvers).
//! 5. `add_intent` flow:
//!     - Build an EVM EIP-1559 intent body using `clear-wallet-client::IntentBuilder`
//!       (loads `examples/intents/evm_transfer.json`).
//!     - Propose AddIntent (proposer signs the wrapped offchain message).
//!     - Approve.
//!     - Execute (writes the new intent on-chain at index 3).
//! 6. Atomically transfer authority + `bind_dwallet` to create IkaConfig.
//! 7. Propose a Custom EVM intent with concrete params (nonce, to, value, empty data).
//! 8. Approver1 + Approver2 approve.
//! 9. `ika_sign` — clear-wallet builds the EVM RLP sighash and CPIs `approve_message`.
//! 10. Verify `MessageApproval` PDA exists with status=Pending.
//! 11. gRPC `Presign` then `Sign` with the same RLP-encoded message.
//! 12. Verify the Ika network commits the signature back into MessageApproval (status=Signed).
//!
//! ## Usage
//!
//! ```bash
//! cargo run -p e2e-clear-msig-ika -- <DWALLET_PROGRAM_ID> [CLEAR_WALLET_PROGRAM_ID]
//! ```
//!
//! `CLEAR_WALLET_PROGRAM_ID` defaults to `clear-wallet-client::ID`. Override
//! the RPC and gRPC endpoints with `RPC_URL` and `GRPC_URL`.
//!
//! ## Pre-conditions
//!
//! - `~/.config/solana/devnet-admin.json` is a funded devnet keypair (override
//!   with `PAYER_KEYPAIR`).
//! - `clear_wallet.so` is deployed to devnet at the program ID you pass.
//! - The dWallet program is deployed to the same devnet at the program ID you pass.

use std::env;
use std::str::FromStr;
use std::thread;
use std::time::{Duration, Instant};

use solana_commitment_config::CommitmentConfig;
use solana_rpc_client::rpc_client::RpcClient;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signer::Signer as SolanaSigner;
#[allow(deprecated)]
use solana_sdk_ids::system_program;

use ika_dwallet_types::*;
use ika_grpc::d_wallet_service_client::DWalletServiceClient;

use clear_msig_intent::{IntentDefinitionJson, IntentTransactionJson};
use clear_wallet_client::chains::evm::Tx1559;
use clear_wallet_client::intent_json::IntentDefinitionBuildExt;
use clear_wallet_client::pda::{
    compute_name_hash, find_ika_config_address, find_intent_address, find_proposal_address,
    find_vault_address, find_wallet_address,
};

use crate::constants::*;
use crate::ika_helpers::build_grpc_request;
use crate::messages::{add_intent_msg, custom_evm_msg, hex_lower, sign_dalek};
use crate::output::{log, ok, val, BOLD, GREEN, RESET};
use crate::solana_helpers::{
    addr_to_pk, load_payer, pk_to_addr, poll_until, read_u16_le, sdk_ix_from_ext, send_tx,
};
use clear_wallet_client::generated as quasar_client;

pub async fn run() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: e2e-clear-msig-ika <DWALLET_PROGRAM_ID> [CLEAR_WALLET_PROGRAM_ID]");
        eprintln!();
        eprintln!("Defaults to Solana devnet and pre-alpha gRPC. Override with:");
        eprintln!("  RPC_URL=<solana_rpc> GRPC_URL=<grpc_url> PAYER_KEYPAIR=<path>");
        std::process::exit(1);
    }

    let dwallet_program_id = Pubkey::from_str(&args[1]).expect("invalid dWallet program ID");
    let clear_wallet_program_id = if args.len() >= 3 {
        Pubkey::from_str(&args[2]).expect("invalid clear-wallet program ID")
    } else {
        addr_to_pk(clear_wallet_client::ID)
    };
    let grpc_url = env::var("GRPC_URL")
        .unwrap_or_else(|_| "https://pre-alpha-dev-1.ika.ika-network.net:443".to_string());

    let client = RpcClient::new_with_commitment(
        env::var("RPC_URL").unwrap_or_else(|_| "https://api.devnet.solana.com".to_string()),
        CommitmentConfig::confirmed(),
    );

    println!();
    println!("{BOLD}\u{2550}\u{2550}\u{2550} clear-msig × Ika E2E Demo (EVM) \u{2550}\u{2550}\u{2550}{RESET}");
    println!();
    val("dWallet program", dwallet_program_id);
    val("clear-wallet program", clear_wallet_program_id);
    val("gRPC endpoint", &grpc_url);
    println!();

    // ---------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------
    log(
        "Setup",
        "Loading payer + waiting for dWallet program init...",
    );
    let payer = load_payer();
    let balance = client.get_balance(&payer.pubkey()).unwrap_or(0);
    ok(&format!(
        "Payer: {} ({:.3} SOL)",
        payer.pubkey(),
        balance as f64 / 1e9
    ));
    if balance < 100_000_000 {
        panic!("payer needs at least 0.1 SOL on devnet");
    }

    let (coordinator_pda, _) =
        Pubkey::find_program_address(&[SEED_DWALLET_COORDINATOR], &dwallet_program_id);
    poll_until(
        &client,
        &coordinator_pda,
        |d| d.len() >= COORDINATOR_LEN && d[0] == DISC_COORDINATOR,
        Duration::from_secs(30),
    );
    ok(&format!("DWalletCoordinator: {coordinator_pda}"));

    use solana_sdk::account::Account;
    let nek_accounts: Vec<(Pubkey, Account)> = {
        let start = Instant::now();
        loop {
            let accs = client
                .get_program_accounts(&dwallet_program_id)
                .unwrap_or_default();
            let neks: Vec<_> = accs
                .into_iter()
                .filter(|(_, a)| a.data.len() >= NEK_LEN && a.data[0] == DISC_NEK)
                .collect();
            if !neks.is_empty() {
                break neks;
            }
            if start.elapsed() > Duration::from_secs(30) {
                panic!("timeout waiting for NEK account");
            }
            thread::sleep(Duration::from_millis(500));
        }
    };
    let (nek_pda, _) = &nek_accounts[0];
    ok(&format!("NetworkEncryptionKey: {nek_pda}"));
    println!();

    // ---------------------------------------------------------------
    // 1. gRPC DKG → dWallet on-chain
    // ---------------------------------------------------------------
    log(
        "1/12",
        "Requesting DKG via gRPC (Curve25519 — pre-alpha mock limitation)...",
    );

    let mut grpc_client = if grpc_url.starts_with("https") {
        let tls = tonic::transport::ClientTlsConfig::new().with_native_roots();
        let channel = tonic::transport::Channel::from_shared(grpc_url.clone())
            .expect("valid URL")
            .tls_config(tls)
            .expect("tls")
            .connect()
            .await
            .expect("connect to gRPC");
        DWalletServiceClient::new(channel)
    } else {
        DWalletServiceClient::connect(grpc_url.clone())
            .await
            .expect("connect to gRPC")
    };

    let dkg_request = build_grpc_request(
        &payer,
        SignedRequestData {
            session_identifier_preimage: [0u8; 32],
            epoch: 1,
            chain_id: ChainId::Solana,
            intended_chain_sender: payer.pubkey().to_bytes().to_vec(),
            request: DWalletRequest::DKG {
                dwallet_network_encryption_public_key: vec![0u8; 32],
                curve: DWalletCurve::Curve25519,
                centralized_public_key_share_and_proof: vec![0u8; 32],
                user_secret_key_share: UserSecretKeyShare::Encrypted {
                    encrypted_centralized_secret_share_and_proof: vec![0u8; 32],
                    encryption_key: vec![0u8; 32],
                    signer_public_key: payer.pubkey().to_bytes().to_vec(),
                },
                user_public_output: vec![0u8; 32],
                sign_during_dkg_request: None,
            },
        },
    );

    let response = grpc_client
        .submit_transaction(dkg_request)
        .await
        .expect("gRPC DKG");
    let response_data: TransactionResponseData =
        bcs::from_bytes(&response.into_inner().response_data).expect("BCS deserialize");

    // Post-redesign (ika-pre-alpha @ 3bd7945e), DKG returns an Attestation
    // carrying a BCS-encoded VersionedDWalletDataAttestation. The
    // session_identifier + public_key live inside the V1 body.
    let dkg_attestation = match response_data {
        TransactionResponseData::Attestation(att) => att,
        TransactionResponseData::Error { message } => panic!("gRPC DKG failed: {message}"),
        other => panic!("unexpected DKG response: {other:?}"),
    };
    let VersionedDWalletDataAttestation::V1(dkg_body) =
        bcs::from_bytes::<VersionedDWalletDataAttestation>(&dkg_attestation.attestation_data)
            .expect("decode DKG attestation body");
    ok("DKG attestation received");

    let dwallet_addr: [u8; 32] = dkg_body.session_identifier;
    let dwallet_public_key = dkg_body.public_key.clone();

    val("dWallet address", hex::encode(dwallet_addr));
    val("dWallet pubkey", hex::encode(&dwallet_public_key));

    // PDA seeds = ["dwallet", chunks_of(curve || pubkey)] where the
    // `curve || pubkey` payload is split into 32-byte chunks (Solana's
    // `MAX_SEED_LEN`). Mirrors the on-chain `DWalletPdaSeeds::new`.
    let mut payload = Vec::with_capacity(1 + dwallet_public_key.len());
    payload.push(CURVE_CURVE25519);
    payload.extend_from_slice(&dwallet_public_key);
    let mut seeds: Vec<&[u8]> = Vec::with_capacity(4);
    seeds.push(SEED_DWALLET);
    for chunk in payload.chunks(32) {
        seeds.push(chunk);
    }
    let (dwallet_pda, _) = Pubkey::find_program_address(&seeds, &dwallet_program_id);
    poll_until(
        &client,
        &dwallet_pda,
        |d| d.len() > 2 && d[0] == 2,
        Duration::from_secs(15),
    );
    ok(&format!("dWallet on-chain: {dwallet_pda}"));
    println!();

    // ---------------------------------------------------------------
    // 2. Transfer dWallet authority → clear-wallet's CPI authority PDA
    // ---------------------------------------------------------------
    log(
        "2/12",
        "Transferring dWallet authority to clear-wallet CPI PDA...",
    );

    let (cpi_authority_pk, cpi_authority_bump) =
        Pubkey::find_program_address(&[SEED_CPI_AUTHORITY], &clear_wallet_program_id);

    let mut transfer_data = Vec::with_capacity(33);
    transfer_data.push(IX_TRANSFER_OWNERSHIP);
    transfer_data.extend_from_slice(cpi_authority_pk.as_ref());

    let transfer_ix = Instruction::new_with_bytes(
        dwallet_program_id,
        &transfer_data,
        vec![
            AccountMeta::new_readonly(payer.pubkey(), true),
            AccountMeta::new(dwallet_pda, false),
        ],
    );
    ok(&format!(
        "Atomic authority transfer prepared → {cpi_authority_pk}"
    ));
    println!();

    // ---------------------------------------------------------------
    // 3. Create clear-msig wallet (1 proposer, 2 approvers, 2-of-2)
    // ---------------------------------------------------------------
    log("3/12", "Creating clear-msig wallet (2-of-2)...");

    let proposer = ed25519_dalek::SigningKey::generate(&mut rand::thread_rng());
    let approver1 = ed25519_dalek::SigningKey::generate(&mut rand::thread_rng());
    let approver2 = ed25519_dalek::SigningKey::generate(&mut rand::thread_rng());

    let proposer_pk = Pubkey::new_from_array(proposer.verifying_key().to_bytes());
    let approver1_pk = Pubkey::new_from_array(approver1.verifying_key().to_bytes());
    let approver2_pk = Pubkey::new_from_array(approver2.verifying_key().to_bytes());

    let wallet_name = format!("e2e-{}", &hex_lower(&rand::random::<[u8; 4]>()));
    let name_hash = compute_name_hash(&wallet_name);
    let name_hash_pk = Pubkey::new_from_array(name_hash);
    let (wallet_pk_addr, _) = find_wallet_address(
        &wallet_name,
        &pk_to_addr(payer.pubkey()),
        &pk_to_addr(clear_wallet_program_id),
    );
    let wallet_pk = addr_to_pk(wallet_pk_addr);
    let (vault_addr, _) = find_vault_address(&wallet_pk_addr, &pk_to_addr(clear_wallet_program_id));
    let vault_pk = addr_to_pk(vault_addr);

    let (add_intent_addr, _) =
        find_intent_address(&wallet_pk_addr, 0, &pk_to_addr(clear_wallet_program_id));
    let (remove_intent_addr, _) =
        find_intent_address(&wallet_pk_addr, 1, &pk_to_addr(clear_wallet_program_id));
    let (update_intent_addr, _) =
        find_intent_address(&wallet_pk_addr, 2, &pk_to_addr(clear_wallet_program_id));

    let cw_ix: solana_instruction::Instruction =
        quasar_client::create_wallet::CreateWalletInstruction {
            payer: pk_to_addr(payer.pubkey()),
            name_hash: pk_to_addr(name_hash_pk),
            wallet: wallet_pk_addr,
            add_intent: add_intent_addr,
            remove_intent: remove_intent_addr,
            update_intent: update_intent_addr,
            system_program: pk_to_addr(system_program::id()),
            approval_threshold: 2,
            cancellation_threshold: 1,
            timelock_seconds: 0,
            name: quasar_lang::client::DynBytes::from(wallet_name.as_bytes().to_vec()),
            proposers: quasar_lang::client::DynVec::new(vec![proposer_pk.to_bytes()]),
            approvers: quasar_lang::client::DynVec::new(vec![
                approver1_pk.to_bytes(),
                approver2_pk.to_bytes(),
            ]),
            policy_ciphertexts: quasar_lang::client::TailBytes(Vec::new()),
        }
        .into();
    let cw_ix = sdk_ix_from_ext(cw_ix);
    send_tx(&client, &payer, vec![cw_ix], &[]);
    ok(&format!("Wallet: {wallet_pk}"));
    val("Vault", vault_pk);
    val("Proposer", proposer_pk);
    val("Approver 1", approver1_pk);
    val("Approver 2", approver2_pk);
    println!();

    // ---------------------------------------------------------------
    // 4. Build the EVM intent body via the JSON example
    // ---------------------------------------------------------------
    log(
        "4/12",
        "Loading and building EVM intent definition from JSON...",
    );

    let json = std::fs::read_to_string("examples/intents/evm_transfer.json")
        .expect("read evm_transfer.json (run from repo root)");
    let tx_def: IntentTransactionJson =
        serde_json::from_str(&json).expect("parse evm_transfer.json");
    let def: IntentDefinitionJson = tx_def.with_governance(
        vec![bs58::encode(proposer_pk.as_ref()).into_string()],
        vec![
            bs58::encode(approver1_pk.as_ref()).into_string(),
            bs58::encode(approver2_pk.as_ref()).into_string(),
        ],
        2, // approval_threshold
        1, // cancellation_threshold
        0, // timelock
    );
    let built = def.to_built().expect("build intent");
    val("chain_kind", built.chain_kind);
    val("tx_template_len", built.tx_template_len);
    val("params", built.params.len());

    // Serialize the intent body that will become params_data of the AddIntent proposal.
    let intent_body = built.serialize_body(
        &wallet_pk_addr,
        /*bump=*/ 0,
        /*intent_index=*/ 3,
        INTENT_TYPE_CUSTOM,
    );
    println!();

    // ---------------------------------------------------------------
    // 5. Propose AddIntent
    // ---------------------------------------------------------------
    log("5/12", "Proposing AddIntent (EVM transfer template)...");

    let proposal_index_add: u64 = 0;
    let (proposal_add_addr, _) = find_proposal_address(
        &add_intent_addr,
        proposal_index_add,
        &pk_to_addr(clear_wallet_program_id),
    );
    let proposal_add_pk = addr_to_pk(proposal_add_addr);

    let propose_msg = add_intent_msg(
        "propose",
        DEFAULT_EXPIRY,
        &wallet_name,
        proposal_index_add,
        &intent_body,
    );
    let proposer_sig = sign_dalek(&proposer, &propose_msg);
    let proposer_pk_bytes = proposer.verifying_key().to_bytes();

    let propose_ix: solana_instruction::Instruction = quasar_client::propose::ProposeInstruction {
        payer: pk_to_addr(payer.pubkey()),
        wallet: wallet_pk_addr,
        intent: add_intent_addr,
        proposal: proposal_add_addr,
        system_program: pk_to_addr(system_program::id()),
        proposal_index: proposal_index_add,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: proposer_pk_bytes,
        signature: proposer_sig,
        params_data: quasar_lang::client::TailBytes(intent_body.clone()),
    }
    .into();
    send_tx(&client, &payer, vec![sdk_ix_from_ext(propose_ix)], &[]);
    ok(&format!("AddIntent proposal: {proposal_add_pk}"));

    // ---------------------------------------------------------------
    // 6. Approve AddIntent (2 approvers)
    // ---------------------------------------------------------------
    log("6/12", "Approving AddIntent (2/2)...");

    let approve_msg = add_intent_msg(
        "approve",
        DEFAULT_EXPIRY,
        &wallet_name,
        proposal_index_add,
        &intent_body,
    );
    for (idx, approver) in [(0u8, &approver1), (1u8, &approver2)] {
        let sig = sign_dalek(approver, &approve_msg);
        let ix: solana_instruction::Instruction = quasar_client::approve::ApproveInstruction {
            wallet: wallet_pk_addr,
            intent: add_intent_addr,
            proposal: proposal_add_addr,
            expiry: DEFAULT_EXPIRY,
            approver_index: idx,
            signature: sig,
        }
        .into();
        send_tx(&client, &payer, vec![sdk_ix_from_ext(ix)], &[]);
    }
    ok("AddIntent approved");

    // ---------------------------------------------------------------
    // 7. Execute AddIntent — writes the new intent at index 3
    // ---------------------------------------------------------------
    log(
        "7/12",
        "Executing AddIntent → writes EVM intent at index 3...",
    );

    let (custom_intent_addr, _) =
        find_intent_address(&wallet_pk_addr, 3, &pk_to_addr(clear_wallet_program_id));
    let custom_intent_pk = addr_to_pk(custom_intent_addr);

    let exec_ix: solana_instruction::Instruction = quasar_client::execute::ExecuteInstruction {
        wallet: wallet_pk_addr,
        vault: vault_addr,
        intent: add_intent_addr,
        proposal: proposal_add_addr,
        system_program: pk_to_addr(system_program::id()),
        remaining_accounts: vec![
            // payer for new intent rent (writable signer)
            solana_instruction::AccountMeta {
                pubkey: pk_to_addr(payer.pubkey()),
                is_signer: true,
                is_writable: true,
            },
            // new intent PDA being created
            solana_instruction::AccountMeta {
                pubkey: custom_intent_addr,
                is_signer: false,
                is_writable: true,
            },
        ],
    }
    .into();
    send_tx(&client, &payer, vec![sdk_ix_from_ext(exec_ix)], &[]);
    ok(&format!("Custom EVM intent at index 3: {custom_intent_pk}"));
    println!();

    // ---------------------------------------------------------------
    // 8. Bind dWallet
    // ---------------------------------------------------------------
    log(
        "8/12",
        "Binding dWallet to clear-msig wallet (chain=evm_1559)...",
    );

    let (ika_config_addr, _) = find_ika_config_address(
        &wallet_pk_addr,
        CHAIN_KIND_EVM,
        &pk_to_addr(clear_wallet_program_id),
    );
    let ika_config_pk = addr_to_pk(ika_config_addr);

    // Per-dWallet ownership lock PDA — required by the program's bind_dwallet
    // and ika_sign instructions so that a second clear-msig wallet cannot
    // hijack a dWallet already bound by someone else.
    let (dwallet_ownership_pk, _) = Pubkey::find_program_address(
        &[SEED_DWALLET_OWNERSHIP, dwallet_pda.as_ref()],
        &clear_wallet_program_id,
    );

    // user_pubkey is the dWallet's secp256k1 public key. Pad/truncate to 32 bytes
    // for the on-chain field — pre-alpha mock doesn't validate this. In a real
    // deployment this is the compressed secp256k1 pubkey.
    let mut user_pubkey = [0u8; 32];
    let copy_len = dwallet_public_key.len().min(32);
    user_pubkey[..copy_len].copy_from_slice(&dwallet_public_key[..copy_len]);

    let bind_ix: solana_instruction::Instruction =
        quasar_client::bind_dwallet::BindDwalletInstruction {
            payer: pk_to_addr(payer.pubkey()),
            wallet: wallet_pk_addr,
            ika_config: ika_config_addr,
            dwallet_ownership: pk_to_addr(dwallet_ownership_pk),
            dwallet: pk_to_addr(dwallet_pda),
            cpi_authority: pk_to_addr(cpi_authority_pk),
            caller_program: pk_to_addr(clear_wallet_program_id),
            dwallet_program: pk_to_addr(dwallet_program_id),
            system_program: pk_to_addr(system_program::id()),
            instructions_sysvar: pk_to_addr(solana_sdk::sysvar::instructions::id()),
            chain_kind: CHAIN_KIND_EVM,
            user_pubkey,
            signature_scheme: 0,
            cpi_authority_bump,
        }
        .into();
    send_tx(
        &client,
        &payer,
        vec![transfer_ix, sdk_ix_from_ext(bind_ix)],
        &[],
    );
    ok(&format!("IkaConfig: {ika_config_pk}"));
    println!();

    // ---------------------------------------------------------------
    // 9. Propose a Custom EVM intent — transfer 1 Gwei to 0x42..42
    // ---------------------------------------------------------------
    log("9/12", "Proposing Custom EVM transfer...");

    let evm_nonce: u64 = 0;
    let evm_to: [u8; 20] = [0x42; 20];
    let evm_value: u64 = 1_000_000_000; // 1 Gwei in wei
    let evm_data: Vec<u8> = vec![];

    // params_data wire layout matches param order in evm_transfer.json:
    //   nonce (u64 LE) + to (Bytes20) + value (u64 LE) + data (string: u8 len + bytes)
    let mut evm_params = Vec::new();
    evm_params.extend_from_slice(&evm_nonce.to_le_bytes());
    evm_params.extend_from_slice(&evm_to);
    evm_params.extend_from_slice(&evm_value.to_le_bytes());
    evm_params.push(evm_data.len() as u8);
    evm_params.extend_from_slice(&evm_data);

    let proposal_index_custom: u64 = 1;
    let (proposal_custom_addr, _) = find_proposal_address(
        &custom_intent_addr,
        proposal_index_custom,
        &pk_to_addr(clear_wallet_program_id),
    );
    let proposal_custom_pk = addr_to_pk(proposal_custom_addr);

    let custom_msg = custom_evm_msg(
        "propose",
        DEFAULT_EXPIRY,
        &wallet_name,
        proposal_index_custom,
        evm_nonce,
        &evm_to,
        evm_value,
    );
    let custom_sig = sign_dalek(&proposer, &custom_msg);

    let prop2_ix: solana_instruction::Instruction = quasar_client::propose::ProposeInstruction {
        payer: pk_to_addr(payer.pubkey()),
        wallet: wallet_pk_addr,
        intent: custom_intent_addr,
        proposal: proposal_custom_addr,
        system_program: pk_to_addr(system_program::id()),
        proposal_index: proposal_index_custom,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: proposer_pk_bytes,
        signature: custom_sig,
        params_data: quasar_lang::client::TailBytes(evm_params.clone()),
    }
    .into();
    send_tx(&client, &payer, vec![sdk_ix_from_ext(prop2_ix)], &[]);
    ok(&format!("EVM transfer proposal: {proposal_custom_pk}"));

    log("10/12", "Approving EVM transfer (2/2)...");

    let approve2_msg = custom_evm_msg(
        "approve",
        DEFAULT_EXPIRY,
        &wallet_name,
        proposal_index_custom,
        evm_nonce,
        &evm_to,
        evm_value,
    );
    for (idx, approver) in [(0u8, &approver1), (1u8, &approver2)] {
        let sig = sign_dalek(approver, &approve2_msg);
        let ix: solana_instruction::Instruction = quasar_client::approve::ApproveInstruction {
            wallet: wallet_pk_addr,
            intent: custom_intent_addr,
            proposal: proposal_custom_addr,
            expiry: DEFAULT_EXPIRY,
            approver_index: idx,
            signature: sig,
        }
        .into();
        send_tx(&client, &payer, vec![sdk_ix_from_ext(ix)], &[]);
    }
    ok("EVM transfer approved");
    println!();

    // ---------------------------------------------------------------
    // 11. ika_sign — clear-wallet builds the EVM RLP sighash and CPIs approve_message
    // ---------------------------------------------------------------
    log(
        "11/12",
        "ika_sign → builds EIP-1559 RLP sighash + CPIs approve_message...",
    );

    // Compute the same RLP preimage off-chain so we can pass it to the gRPC Sign request.
    let evm_tx = Tx1559 {
        chain_id: 1,
        nonce: evm_nonce,
        max_priority_fee_per_gas: 1_500_000_000,
        max_fee_per_gas: 30_000_000_000,
        gas_limit: 21_000,
        to: evm_to,
        value: evm_value,
        data: evm_data.clone(),
    };
    let rlp_preimage = evm_tx.rlp_preimage();

    // Compute keccak256 of the preimage to derive the MessageApproval PDA.
    let message_hash = {
        use tiny_keccak::{Hasher, Keccak};
        let mut h = Keccak::v256();
        h.update(&rlp_preimage);
        let mut out = [0u8; 32];
        h.finalize(&mut out);
        out
    };

    let (message_approval_pda, message_approval_bump) = Pubkey::find_program_address(
        &[SEED_MESSAGE_APPROVAL, dwallet_pda.as_ref(), &message_hash],
        &dwallet_program_id,
    );

    let sign_ix: solana_instruction::Instruction = quasar_client::ika_sign::IkaSignInstruction {
        payer: pk_to_addr(payer.pubkey()),
        wallet: wallet_pk_addr,
        intent: custom_intent_addr,
        proposal: proposal_custom_addr,
        ika_config: ika_config_addr,
        dwallet_ownership: pk_to_addr(dwallet_ownership_pk),
        dwallet: pk_to_addr(dwallet_pda),
        message_approval: pk_to_addr(message_approval_pda),
        coordinator: pk_to_addr(coordinator_pda),
        cpi_authority: pk_to_addr(cpi_authority_pk),
        caller_program: pk_to_addr(clear_wallet_program_id),
        dwallet_program: pk_to_addr(dwallet_program_id),
        system_program: pk_to_addr(system_program::id()),
        message_approval_bump,
        cpi_authority_bump,
        blake2b_hashes: [0u8; 96],
    }
    .into();
    let quorum_tx_sig = send_tx(&client, &payer, vec![sdk_ix_from_ext(sign_ix)], &[]);
    ok(&format!("ika_sign tx: {quorum_tx_sig}"));

    let ma_data = poll_until(
        &client,
        &message_approval_pda,
        |d| d.len() > MA_STATUS && d[0] == DISC_MESSAGE_APPROVAL,
        Duration::from_secs(15),
    );
    assert_eq!(ma_data[MA_STATUS], 0);
    ok(&format!("MessageApproval: {message_approval_pda}"));
    val("Status", "Pending");
    val("RLP length", rlp_preimage.len());
    val("Message hash", hex::encode(message_hash));
    println!();

    // ---------------------------------------------------------------
    // 12. gRPC Presign + Sign + verify
    // ---------------------------------------------------------------
    log("12/12", "Allocating presign + signing via gRPC...");

    let presign_request = build_grpc_request(
        &payer,
        SignedRequestData {
            session_identifier_preimage: dwallet_addr,
            epoch: 1,
            chain_id: ChainId::Solana,
            intended_chain_sender: payer.pubkey().to_bytes().to_vec(),
            request: DWalletRequest::Presign {
                dwallet_network_encryption_public_key: vec![0u8; 32],
                curve: DWalletCurve::Curve25519,
                signature_algorithm: DWalletSignatureAlgorithm::EdDSA,
            },
        },
    );
    let presign_response = grpc_client
        .submit_transaction(presign_request)
        .await
        .expect("presign");
    let presign_data: TransactionResponseData =
        bcs::from_bytes(&presign_response.into_inner().response_data).expect("BCS");
    // Presign now returns an Attestation carrying a VersionedPresignDataAttestation.
    // The V1 body's presign_session_identifier is the opaque handle that Sign
    // consumes.
    let presign_attestation = match presign_data {
        TransactionResponseData::Attestation(att) => att,
        TransactionResponseData::Error { message } => panic!("presign failed: {message}"),
        other => panic!("unexpected presign response: {other:?}"),
    };
    let VersionedPresignDataAttestation::V1(presign_body) =
        bcs::from_bytes::<VersionedPresignDataAttestation>(&presign_attestation.attestation_data)
            .expect("decode presign attestation body");
    let presign_session_identifier = presign_body.presign_session_identifier.clone();
    ok("Presign allocated");
    val(
        "Presign session id",
        hex::encode(&presign_session_identifier),
    );

    let sign_request = build_grpc_request(
        &payer,
        SignedRequestData {
            session_identifier_preimage: dwallet_addr,
            epoch: 1,
            chain_id: ChainId::Solana,
            intended_chain_sender: payer.pubkey().to_bytes().to_vec(),
            request: DWalletRequest::Sign {
                message: rlp_preimage.clone(),
                // The redesigned Sign carries message_metadata (an opaque blob
                // the network forwards along with the signature — for Zcash
                // this encodes the Blake2b personal+salt; for EVM/BTC it's
                // empty). The clear-wallet dispatcher mirrors this via
                // `crate::chains::message_metadata`.
                message_metadata: Vec::new(),
                presign_session_identifier,
                message_centralized_signature: vec![0u8; 64],
                // Post-redesign (2026-04-13), Sign pins the authoritative
                // dWallet record via the DKG attestation itself. We hand back
                // what DKG returned (moved — it isn't referenced again).
                dwallet_attestation: dkg_attestation,
                approval_proof: ApprovalProof::Solana {
                    transaction_signature: quorum_tx_sig.as_ref().to_vec(),
                    slot: 0,
                },
            },
        },
    );
    let sign_response = grpc_client
        .submit_transaction(sign_request)
        .await
        .expect("sign");
    let sign_data: TransactionResponseData =
        bcs::from_bytes(&sign_response.into_inner().response_data).expect("BCS");
    let grpc_signature = match sign_data {
        TransactionResponseData::Signature { signature } => signature,
        TransactionResponseData::Error { message } => panic!("sign failed: {message}"),
        other => panic!("unexpected sign response: {other:?}"),
    };
    ok("Signature received from gRPC");
    val("Signature", hex::encode(&grpc_signature));

    // Wait for the network to commit the signature back into MessageApproval.
    let ma_signed = poll_until(
        &client,
        &message_approval_pda,
        |d| d.len() > MA_STATUS && d[MA_STATUS] == MA_STATUS_SIGNED,
        Duration::from_secs(15),
    );
    let onchain_sig_len = read_u16_le(&ma_signed, MA_SIGNATURE_LEN) as usize;
    let onchain_signature = &ma_signed[MA_SIGNATURE..MA_SIGNATURE + onchain_sig_len];
    assert_eq!(onchain_signature, grpc_signature.as_slice());
    ok("Signature committed on-chain");

    println!();
    println!("{BOLD}{GREEN}\u{2550}\u{2550}\u{2550} E2E PASSED \u{2550}\u{2550}\u{2550}{RESET}");
    println!();
    val("clear-msig wallet", wallet_pk);
    val("Bound dWallet", dwallet_pda);
    val("EVM tx (RLP)", hex::encode(&rlp_preimage));
    val("Final signature", hex::encode(onchain_signature));
    println!();
}
