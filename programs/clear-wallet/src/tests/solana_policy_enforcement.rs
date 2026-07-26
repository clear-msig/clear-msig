use super::*;

#[test]
fn test_execute_typed_sol_send_is_permissionless_and_idempotent() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-sol-send";
    let recipient = Pubkey::new_unique();
    let amount_lamports = 1_750_000u64;

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
    let (proposal, policy_commitment, envelope_hash) = propose_typed_sol_send_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        &proposer,
        recipient,
        amount_lamports,
        &[],
    );

    let vault = fund_vault(&mut svm, payer, wallet, amount_lamports + 1_000_000);
    let vault_pre = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    let relayer = Pubkey::new_unique();
    assert_ne!(relayer, payer);
    assert_ne!(relayer, pubkey_of(&proposer));
    let execute = build_execute_typed_sol_send_ix(
        relayer,
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
            funded_account(relayer),
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
            empty_account(recipient),
        ],
    );
    if result.is_err() {
        result.print_logs();
    }
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

    let recipient_after_first = svm.get_account(&recipient).unwrap();
    let vault_after_first = svm.get_account(&vault).unwrap().lamports;
    let replay = svm.process_instruction(
        &execute,
        &[
            funded_account(relayer),
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
            recipient_after_first.clone(),
        ],
    );
    assert!(replay.is_err(), "executed typed send must reject replay");
    assert_eq!(
        svm.get_account(&recipient).unwrap().lamports,
        recipient_after_first.lamports,
        "duplicate execute moved recipient funds twice"
    );
    assert_eq!(
        svm.get_account(&vault).unwrap().lamports,
        vault_after_first,
        "duplicate execute debited the vault twice"
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
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
            empty_account(recipient),
        ],
    );
    assert!(result.is_err(), "policy amount cap did not stop execute");
}

#[test]
fn test_execute_typed_sol_send_enforces_independent_member_allowances() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let member_a = new_keypair();
    let member_b = new_keypair();
    let wallet_name = "typed-member-allowances";
    let member_a_pubkey = pubkey_of(&member_a);
    let member_b_pubkey = pubkey_of(&member_b);
    let (create, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[member_a_pubkey, member_b_pubkey],
        &[member_a_pubkey, member_b_pubkey],
        1,
    );
    assert!(svm.process_instruction(&create, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let policy = append_member_allowance_extension(
        typed_sol_policy_bytes(0, 0, 0, &[], &[]),
        &[
            (member_a_pubkey, 1_000_000, 604_800),
            (member_b_pubkey, 2_000_000, 604_800),
        ],
    );
    fund_vault(&mut svm, payer, wallet, 5_000_000);

    let execute = |svm: &mut QuasarSvm,
                   proposal_index: u64,
                   proposer: &ed25519_dalek::SigningKey,
                   recipient: Pubkey,
                   amount: u64,
                   first: bool| {
        let (proposal, commitment, envelope) = propose_typed_sol_send_on_wallet(
            svm,
            payer,
            wallet_name,
            wallet,
            intent,
            proposal_index,
            proposer,
            recipient,
            amount,
            &policy,
        );
        let instruction = build_execute_typed_sol_send_ix(
            payer, wallet, intent, proposal, recipient, commitment, envelope, amount,
        );
        let mut supplemental = vec![funded_account(payer), empty_account(recipient)];
        if first {
            supplemental.push(empty_wallet_policy_account(wallet));
            supplemental.push(empty_policy_spend_account(wallet, intent, commitment));
            supplemental.push(empty_member_allowance_account(wallet, intent));
        }
        svm.process_instruction(&instruction, &supplemental)
    };

    assert!(execute(&mut svm, 0, &member_a, Pubkey::new_unique(), 600_000, true,).is_ok());
    assert!(execute(&mut svm, 1, &member_a, Pubkey::new_unique(), 500_000, false,).is_err());
    assert!(execute(
        &mut svm,
        2,
        &member_b,
        Pubkey::new_unique(),
        1_500_000,
        false,
    )
    .is_ok());
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
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
            empty_account(recipient),
        ],
    );
    assert!(result.is_err(), "policy blocklist did not stop execute");
}

#[test]
fn test_execute_typed_sol_send_rejects_recipient_outside_allowlist() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let recipient = Pubkey::new_unique();
    let allowed_recipient = Pubkey::new_unique();
    let amount_lamports = 1_000_000u64;
    let policy_bytes = typed_sol_policy_bytes(1, 0, 0, &[allowed_recipient], &[]);

    let (wallet, intent, proposal, policy_commitment, envelope_hash) =
        propose_typed_sol_send_with_policy(
            &mut svm,
            payer,
            "typed-sol-policy-allowlist-reject",
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
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
            empty_account(recipient),
        ],
    );
    assert!(
        result.is_err(),
        "recipient outside the signed allowlist did not stop execute"
    );
}

#[test]
fn test_execute_typed_sol_send_rejects_outside_allowed_hours() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let recipient = Pubkey::new_unique();
    let amount_lamports = 1_000_000u64;
    // Equal start/end is an intentionally empty allowed-hours window.
    let policy_bytes =
        append_allowed_time_extension(typed_sol_policy_bytes(0, 0, 0, &[], &[]), 9, 9, 0, 0);

    let (wallet, intent, proposal, policy_commitment, envelope_hash) =
        propose_typed_sol_send_with_policy(
            &mut svm,
            payer,
            "typed-sol-policy-allowed-hours-reject",
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
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
            empty_account(recipient),
        ],
    );
    assert!(
        result.is_err(),
        "program executed a send outside the signed allowed-hours window"
    );
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
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
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
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
            empty_account(recipient),
        ],
    );
    assert!(
        result.is_ok(),
        "committed policy should allow execute: {:?}",
        result.raw_result
    );
}
