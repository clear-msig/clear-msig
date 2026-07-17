use super::*;

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
    let policy_commitment = v4_policy_commitment(&[]);
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

#[test]
fn test_typed_v4_propose_derives_readable_transfer_from_execution_fields() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-v4-binding";
    let recipient = Pubkey::new_unique();
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
    let policy_commitment = v4_policy_commitment(&[]);
    let mut encoded = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let encoded_len = encode_v4_transfer(
        &V4TransferInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network: V4Network::SolanaDevnet,
                proposal_index,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(&proposer),
                action_id: sha256_hash(b"typed-v4-action"),
                nonce: sha256_hash(b"typed-v4-nonce"),
                expires_at: expiry,
                policy_commitment,
                approval_required: 1,
            },
            recipient_encoding: V4IdentityEncoding::SolanaPubkey,
            recipient: recipient.as_ref(),
            asset_encoding: V4IdentityEncoding::Text,
            asset: b"SOL",
            raw_amount: 300_000_000,
            decimals: 9,
            display_asset: b"SOL",
            execution_commitment: [0u8; 32],
            fiat_estimate: None,
            reason: b"Vendor invoice 42",
        },
        &mut encoded,
    )
    .unwrap();
    let canonical = parse_v4_intent(&encoded[..encoded_len]).unwrap();
    let mut clear_text = [0u8; MAX_DOCUMENT_BYTES];
    let clear_text_len =
        render_v4_document(&canonical, wallet_name.as_bytes(), &mut clear_text).unwrap();
    let clear_text = &clear_text[..clear_text_len];
    let envelope_hash = hash_v4_envelope(
        &canonical,
        wallet_name.as_bytes(),
        hash_clear_text(clear_text).unwrap(),
    )
    .unwrap();
    let signature = sign_typed_vote_for_text(
        &proposer,
        ClearSignVoteKind::Propose,
        wallet_name,
        proposal_index,
        envelope_hash,
        1,
        1,
        clear_text,
    );
    let propose = build_propose_typed_v4_ix(TypedProposalV4Args {
        payer,
        wallet,
        intent,
        proposal_index,
        signature,
        policy_bytes: Vec::new(),
        canonical_intent: encoded[..encoded_len].to_vec(),
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "v4 proposal failed: {:?}",
        result.raw_result
    );

    let proposal_data = svm.get_account(&proposal).unwrap().data;
    assert_eq!(&proposal_data[200..232], canonical.payload_hash().as_ref());
    assert_eq!(&proposal_data[232..264], envelope_hash.as_ref());
    assert!(proposal_data
        .windows(clear_text.len())
        .any(|row| row == clear_text));
    let readable = core::str::from_utf8(clear_text).unwrap();
    assert!(readable.contains("Send 0.3 SOL"));
    assert!(readable.contains(&recipient.to_string()));
    assert!(readable.contains("Vendor invoice 42"));
}

#[test]
fn test_typed_v4_rejects_signature_for_different_transfer() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-v4-mismatch";
    let signed_recipient = Pubkey::new_unique();
    let submitted_recipient = Pubkey::new_unique();
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
    let proposal = get_typed_proposal_address(intent, 0);
    let policy_commitment = hash_policy_commitment(&[b"send:sol"]);
    let common = V4CommonFields {
        profile: V4DeviceProfile::Full,
        network: V4Network::SolanaDevnet,
        proposal_index: 0,
        wallet_id: wallet.to_bytes(),
        actor: pubkey_bytes(&proposer),
        action_id: sha256_hash(b"typed-v4-mismatch-action"),
        nonce: sha256_hash(b"typed-v4-mismatch-nonce"),
        expires_at: expiry,
        policy_commitment,
        approval_required: 1,
    };
    let encode = |recipient: &Pubkey, out: &mut [u8]| {
        encode_v4_transfer(
            &V4TransferInput {
                common,
                recipient_encoding: V4IdentityEncoding::SolanaPubkey,
                recipient: recipient.as_ref(),
                asset_encoding: V4IdentityEncoding::Text,
                asset: b"SOL",
                raw_amount: 300_000_000,
                decimals: 9,
                display_asset: b"SOL",
                execution_commitment: [0u8; 32],
                fiat_estimate: None,
                reason: b"Mismatch test",
            },
            out,
        )
        .unwrap()
    };
    let mut signed_bytes = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let signed_len = encode(&signed_recipient, &mut signed_bytes);
    let signed = parse_v4_intent(&signed_bytes[..signed_len]).unwrap();
    let mut text = [0u8; MAX_DOCUMENT_BYTES];
    let text_len = render_v4_document(&signed, wallet_name.as_bytes(), &mut text).unwrap();
    let envelope_hash = hash_v4_envelope(
        &signed,
        wallet_name.as_bytes(),
        hash_clear_text(&text[..text_len]).unwrap(),
    )
    .unwrap();
    let signature = sign_typed_vote_for_text(
        &proposer,
        ClearSignVoteKind::Propose,
        wallet_name,
        0,
        envelope_hash,
        1,
        1,
        &text[..text_len],
    );

    let mut submitted_bytes = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let submitted_len = encode(&submitted_recipient, &mut submitted_bytes);
    let propose = build_propose_typed_v4_ix(TypedProposalV4Args {
        payer,
        wallet,
        intent,
        proposal_index: 0,
        signature,
        policy_bytes: Vec::new(),
        canonical_intent: submitted_bytes[..submitted_len].to_vec(),
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);
    assert!(
        result.is_err(),
        "v4 accepted a signature bound to a different recipient"
    );
}

#[test]
fn test_typed_propose_rejects_semantically_unbound_document() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-semantic-binding";
    let action_id = sha256_hash(b"semantic-binding-action");
    let nonce = sha256_hash(b"semantic-binding-nonce");
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
    let misleading_document = b"ClearSig Proposal\n\nACTION\nSend 99 SOL to attacker\n\nDETAILS\nFrom wallet: typed-semantic-binding\nNetwork: Solana devnet\nAmount: 99 SOL\nTo: attacker\nPayload: internally-consistent\n\nPOLICY\nApproval: Wallet's onchain threshold must be met\nExecution: Onchain policy and timelock must pass\nCommitment: internally-consistent\nEnforcement: Exact payload and policy must match onchain\nDisplay profile: clearsig-full-v1@1\n\nRISK\nCategory: Funds movement\nSigner check: Verify amount, asset, network, and every destination\n\nPURPOSE\nAdversarial binding test";
    let payload_hash = hash_send_payload(
        b"intended recipient",
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
        clear_text_hash: hash_clear_text(misleading_document).unwrap(),
    });
    let signature = sign_typed_vote_for_text(
        &proposer,
        ClearSignVoteKind::Propose,
        wallet_name,
        proposal_index,
        envelope_hash,
        1,
        1,
        misleading_document,
    );
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
        signature,
        clear_text: misleading_document.to_vec(),
        policy_bytes: Vec::new(),
        action_id,
        nonce,
    });
    let result =
        svm.process_instruction(&propose, &[funded_account(payer), empty_account(proposal)]);

    assert!(
        result.is_err(),
        "typed proposal accepted readable text that was not derived from its executable payload"
    );
}
