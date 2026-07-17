use super::*;

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
