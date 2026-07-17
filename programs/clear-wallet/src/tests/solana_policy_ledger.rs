use super::*;

#[test]
fn test_wallet_policy_creation_rejects_spoofed_current_commitment() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "wallet-policy-spoofed-current";
    let policy_bytes = typed_sol_policy_bytes(0, 1_000_000, 0, &[], &[]);

    let (create, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&create, &accounts).is_ok());
    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let spoofed_current = sha256_hash(b"policy-that-never-existed");
    let (proposal, envelope_hash) = propose_typed_wallet_policy_update_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        0,
        &proposer,
        spoofed_current,
        0,
        &policy_bytes,
    );
    let execute = build_execute_typed_wallet_policy_update_ix(
        payer,
        wallet,
        intent,
        proposal,
        spoofed_current,
        envelope_hash,
        0,
        &policy_bytes,
    );
    let result = svm.process_instruction(
        &execute,
        &[funded_account(payer), empty_wallet_policy_account(wallet)],
    );
    assert!(
        result.is_err(),
        "an absent policy account accepted a spoofed current commitment"
    );
}

#[test]
fn test_wallet_policy_rejects_proposal_that_omits_active_policy() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = ed25519_dalek::SigningKey::from_bytes(&[42u8; 32]);
    let allowed_recipient = Pubkey::new_unique();
    let blocked_recipient = Pubkey::new_unique();
    let policy_bytes = typed_sol_policy_bytes(1, 0, 0, &[allowed_recipient], &[]);
    let active_policy_commitment = hash_typed_policy(&policy_bytes);
    let wallet_name = "persistent-policy";

    let (create, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&create, &accounts).is_ok());
    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let no_previous_policy = [0u8; 32];
    let (policy_proposal, policy_envelope_hash) = propose_typed_wallet_policy_update_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        0,
        &proposer,
        no_previous_policy,
        0,
        &policy_bytes,
    );
    let update = build_execute_typed_wallet_policy_update_ix(
        payer,
        wallet,
        intent,
        policy_proposal,
        no_previous_policy,
        policy_envelope_hash,
        0,
        &policy_bytes,
    );
    let result = svm.process_instruction(
        &update,
        &[funded_account(payer), empty_wallet_policy_account(wallet)],
    );
    assert!(
        result.is_ok(),
        "wallet policy update should execute: {:?}",
        result.raw_result
    );

    let (send_proposal, stale_policy_commitment, send_envelope_hash) =
        propose_typed_sol_send_on_wallet(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            intent,
            1,
            &proposer,
            blocked_recipient,
            1_000_000,
            &[],
        );
    assert_ne!(stale_policy_commitment, active_policy_commitment);
    let vault = fund_vault(&mut svm, payer, wallet, 2_000_000);
    let vault_pre = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    let execute = build_execute_typed_sol_send_ix(
        payer,
        wallet,
        intent,
        send_proposal,
        blocked_recipient,
        stale_policy_commitment,
        send_envelope_hash,
        1_000_000,
    );
    let result = svm.process_instruction(
        &execute,
        &[
            funded_account(payer),
            empty_policy_spend_account(wallet, intent, stale_policy_commitment),
            empty_member_allowance_account(wallet, intent),
            empty_account(blocked_recipient),
        ],
    );
    assert!(
        result.is_err(),
        "active wallet policy should reject a typed send that omits policy bytes"
    );
    assert_eq!(
        svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0),
        vault_pre,
        "rejected policy bypass must not move lamports"
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
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
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
fn test_execute_typed_sol_send_enforces_count_window() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-sol-policy-count";
    let recipient_a = Pubkey::new_unique();
    let recipient_b = Pubkey::new_unique();
    let amount_lamports = 100_000u64;
    let policy_bytes = typed_sol_policy_bytes_with_send_count(1, 24 * 60 * 60);

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
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
            empty_account(recipient_a),
        ],
    );
    assert!(result.is_ok(), "first count-tracked send should execute");

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
        "second send should exceed the on-chain send-count cap"
    );
}

#[test]
fn test_policy_change_does_not_reset_spend_window() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-sol-policy-change";
    let recipient_a = Pubkey::new_unique();
    let recipient_b = Pubkey::new_unique();
    let amount_lamports = 600_000u64;
    let policy_a = typed_sol_policy_bytes_with_velocity(0, 0, 0, &[], &[], 1_000_000, 86_400);

    let (wallet, intent, proposal_a, commitment_a, envelope_a) = propose_typed_sol_send_with_policy(
        &mut svm,
        payer,
        wallet_name,
        &proposer,
        &[pubkey_of(&proposer)],
        1,
        recipient_a,
        amount_lamports,
        &policy_a,
    );
    fund_vault(&mut svm, payer, wallet, amount_lamports * 3);
    let execute_a = build_execute_typed_sol_send_ix(
        payer,
        wallet,
        intent,
        proposal_a,
        recipient_a,
        commitment_a,
        envelope_a,
        amount_lamports,
    );
    let first = svm.process_instruction(
        &execute_a,
        &[
            funded_account(payer),
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, commitment_a),
            empty_member_allowance_account(wallet, intent),
            empty_account(recipient_a),
        ],
    );
    assert!(
        first.is_ok(),
        "first spend should establish the rolling window"
    );

    let policy_b = append_send_count_extension(policy_a, 99, 86_400);
    let (proposal_b, commitment_b, envelope_b) = propose_typed_sol_send_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        1,
        &proposer,
        recipient_b,
        amount_lamports,
        &policy_b,
    );
    assert_ne!(commitment_b, commitment_a);
    let execute_b = build_execute_typed_sol_send_ix(
        payer,
        wallet,
        intent,
        proposal_b,
        recipient_b,
        commitment_b,
        envelope_b,
        amount_lamports,
    );
    let second = svm.process_instruction(
        &execute_b,
        &[funded_account(payer), empty_account(recipient_b)],
    );
    assert!(
        second.is_err(),
        "changing policy bytes must not erase previously-accounted spend"
    );
}
