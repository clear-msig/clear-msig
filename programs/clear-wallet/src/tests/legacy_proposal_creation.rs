use super::*;

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
