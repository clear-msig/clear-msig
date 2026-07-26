use super::*;

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
    let rows = [
        V4TransferRowInput {
            recipient_encoding: V4IdentityEncoding::SolanaPubkey,
            recipient: recipient_a.as_ref(),
            asset_encoding: V4IdentityEncoding::Text,
            asset: b"SOL",
            raw_amount: amount_a as u128,
            decimals: 9,
            display_asset: b"SOL",
        },
        V4TransferRowInput {
            recipient_encoding: V4IdentityEncoding::SolanaPubkey,
            recipient: recipient_b.as_ref(),
            asset_encoding: V4IdentityEncoding::Text,
            asset: b"SOL",
            raw_amount: amount_b as u128,
            decimals: 9,
            display_asset: b"SOL",
        },
    ];
    let policy_commitment = v4_policy_commitment(&[]);
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_batch_transfer(
        &V4BatchTransferInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network: V4Network::SolanaDevnet,
                proposal_index,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(&proposer),
                action_id,
                nonce,
                expires_at: expiry,
                policy_commitment,
                approval_required: 1,
            },
            rows: &rows,
            reason: b"Program batch execution test",
        },
        &mut canonical,
    )
    .expect("SOL batch should encode as canonical v4 intent");
    let (proposal, policy_commitment, envelope_hash) = submit_typed_v4_proposal(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        &proposer,
        &[],
        &canonical[..canonical_len],
        1,
    );

    let total = amount_a + amount_b;
    let vault = fund_vault(&mut svm, payer, wallet, total + 1_000_000);
    let vault_pre = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    let mut amount_bytes = Vec::new();
    amount_bytes.extend_from_slice(&amount_a.to_le_bytes());
    amount_bytes.extend_from_slice(&amount_b.to_le_bytes());
    let execute = build_execute_typed_sol_batch_send_ix(
        payer,
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
        &[
            funded_account(payer),
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
            empty_account(recipient_a),
            empty_account(recipient_b),
        ],
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
fn test_execute_typed_sol_batch_send_rejects_recipient_outside_allowlist() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let allowed_recipient = Pubkey::new_unique();
    let blocked_recipient = Pubkey::new_unique();
    let payments = [
        (allowed_recipient, 1_000_000),
        (blocked_recipient, 2_000_000),
    ];
    let policy_bytes = typed_sol_policy_bytes(1, 0, 0, &[allowed_recipient], &[]);
    let (wallet, intent, proposal, policy_commitment, envelope_hash) =
        propose_typed_sol_batch_with_policy(
            &mut svm,
            payer,
            "typed-sol-batch-allowlist-reject",
            &proposer,
            &payments,
            &policy_bytes,
        );
    fund_vault(&mut svm, payer, wallet, 4_000_000);

    let mut amount_bytes = Vec::new();
    for (_, amount) in payments {
        amount_bytes.extend_from_slice(&amount.to_le_bytes());
    }
    let execute = build_execute_typed_sol_batch_send_ix(
        payer,
        wallet,
        intent,
        proposal,
        policy_commitment,
        envelope_hash,
        amount_bytes,
        vec![
            AccountMeta::new(allowed_recipient, false),
            AccountMeta::new(blocked_recipient, false),
        ],
    );
    let result = svm.process_instruction(
        &execute,
        &[
            funded_account(payer),
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
            empty_account(allowed_recipient),
            empty_account(blocked_recipient),
        ],
    );
    assert!(
        result.is_err(),
        "batch recipient outside the signed allowlist did not stop execute"
    );
    assert_eq!(
        svm.get_account(&allowed_recipient)
            .map(|account| account.lamports)
            .unwrap_or(0),
        0,
        "batch rejection must be atomic"
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
    let policy_commitment = v4_policy_commitment(&[]);
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_transfer(
        &V4TransferInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network: V4Network::SolanaDevnet,
                proposal_index,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(&proposer),
                action_id,
                nonce,
                expires_at: expiry,
                policy_commitment,
                approval_required: 1,
            },
            recipient_encoding: V4IdentityEncoding::SolanaPubkey,
            recipient: recipient.as_ref(),
            asset_encoding: V4IdentityEncoding::Text,
            asset: b"SOL",
            raw_amount: amount_lamports as u128,
            decimals: 9,
            display_asset: b"SOL",
            execution_commitment: [0u8; 32],
            fiat_estimate: None,
            reason: b"Non-finalized cleanup test",
        },
        &mut canonical,
    )
    .expect("cleanup fixture should encode as canonical v4 intent");
    let (proposal, _, _) = submit_typed_v4_proposal(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        &proposer,
        &[],
        &canonical[..canonical_len],
        0,
    );

    let cleanup = build_cleanup_typed_ix(proposal, payer);
    let result = svm.process_instruction(&cleanup, &[]);
    assert!(
        result.is_err(),
        "non-finalized typed proposal cleanup should fail"
    );
}
