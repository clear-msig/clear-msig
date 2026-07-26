use super::*;

#[test]
fn test_timelock_enforcement() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "timelock-test";

    let name_hash = Pubkey::from(compute_name_hash(wallet_name));
    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (update_intent, _) = find_intent_address(&wallet, 2, &crate::ID);

    let instruction: Instruction = CreateWalletInstruction {
        payer,
        name_hash,
        wallet,
        add_intent,
        remove_intent,
        update_intent,
        system_program: quasar_svm::system_program::ID,
        name: DynBytes::new(wallet_name.as_bytes().to_vec()),
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 3600,
        proposers: DynVec::new(vec![pubkey_of(&proposer).to_bytes()]),
        approvers: DynVec::new(vec![pubkey_of(&approver).to_bytes()]),
        policy_ciphertexts: TailBytes(Vec::new()),
    }
    .into();

    svm.process_instruction(
        &instruction,
        &[
            funded_account(payer),
            empty_account(name_hash),
            empty_account(wallet),
            empty_account(add_intent),
            empty_account(remove_intent),
            empty_account(update_intent),
        ],
    )
    .unwrap();

    let params_data = vec![0u8];
    let proposal_address = get_proposal_address(remove_intent, 0);

    // Propose + approve
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
            params_data: params_data.clone(),
        }),
        &[funded_account(payer), empty_account(proposal_address)],
    )
    .unwrap();

    let msg = remove_intent_msg("approve", DEFAULT_EXPIRY, wallet_name, 0, 0);
    svm.process_instruction(
        &build_approve_ix(
            wallet,
            remove_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            0,
            sign_message(&approver, &msg),
        ),
        &[],
    )
    .unwrap();

    // Execute immediately should fail (clock=0, timelock=3600)
    let (instruction, vault) = build_execute_ix(
        wallet,
        remove_intent,
        proposal_address,
        vec![AccountMeta::new(add_intent, false)],
    );
    assert!(svm
        .process_instruction(&instruction, &[empty_account(vault)])
        .is_err());
    println!("  TIMELOCK: correctly blocked execution");
}

#[test]
fn test_execute_not_approved_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "not-approved";

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

    // Propose but don't approve
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

    let (instruction, vault) = build_execute_ix(
        wallet,
        remove_intent,
        proposal_address,
        vec![AccountMeta::new(add_intent, false)],
    );
    assert!(svm
        .process_instruction(&instruction, &[empty_account(vault)])
        .is_err());
}

#[test]
fn test_multi_approver_threshold() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver1 = new_keypair();
    let approver2 = new_keypair();
    let approver3 = new_keypair();
    let wallet_name = "multi-approve";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[
            pubkey_of(&approver1),
            pubkey_of(&approver2),
            pubkey_of(&approver3),
        ],
        2,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let proposal_address = get_proposal_address(remove_intent, 0);

    let params_data = vec![0u8];
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
            params_data: params_data.clone(),
        }),
        &[funded_account(payer), empty_account(proposal_address)],
    )
    .unwrap();

    // First approval — not enough
    let msg = remove_intent_msg("approve", DEFAULT_EXPIRY, wallet_name, 0, 0);
    svm.process_instruction(
        &build_approve_ix(
            wallet,
            remove_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            0,
            sign_message(&approver1, &msg),
        ),
        &[],
    )
    .unwrap();
    assert_eq!(
        svm.get_account(&proposal_address).unwrap().data[105],
        0,
        "should still be Active"
    );

    // Second approval — threshold met
    svm.process_instruction(
        &build_approve_ix(
            wallet,
            remove_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            1,
            sign_message(&approver2, &msg),
        ),
        &[],
    )
    .unwrap();
    assert_eq!(
        svm.get_account(&proposal_address).unwrap().data[105],
        1,
        "should be Approved"
    );
    println!("  MULTI_APPROVE: 2-of-3 threshold works");
}

#[test]
fn test_cancel_reverts_approved_to_active() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver1 = new_keypair();
    let approver2 = new_keypair();
    let wallet_name = "revert-test";

    let name_hash = Pubkey::from(compute_name_hash(wallet_name));
    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (update_intent, _) = find_intent_address(&wallet, 2, &crate::ID);

    let instruction: Instruction = CreateWalletInstruction {
        payer,
        name_hash,
        wallet,
        add_intent,
        remove_intent,
        update_intent,
        system_program: quasar_svm::system_program::ID,
        name: DynBytes::new(wallet_name.as_bytes().to_vec()),
        approval_threshold: 2,
        cancellation_threshold: 2,
        timelock_seconds: 0,
        proposers: DynVec::new(vec![pubkey_of(&proposer).to_bytes()]),
        approvers: DynVec::new(vec![
            pubkey_of(&approver1).to_bytes(),
            pubkey_of(&approver2).to_bytes(),
        ]),
        policy_ciphertexts: TailBytes(Vec::new()),
    }
    .into();
    svm.process_instruction(
        &instruction,
        &[
            funded_account(payer),
            empty_account(name_hash),
            empty_account(wallet),
            empty_account(add_intent),
            empty_account(remove_intent),
            empty_account(update_intent),
        ],
    )
    .unwrap();

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
            params_data: params_data.clone(),
        }),
        &[funded_account(payer), empty_account(proposal_address)],
    )
    .unwrap();

    // Both approve
    let approve_msg = remove_intent_msg("approve", DEFAULT_EXPIRY, wallet_name, 0, 0);
    svm.process_instruction(
        &build_approve_ix(
            wallet,
            remove_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            0,
            sign_message(&approver1, &approve_msg),
        ),
        &[],
    )
    .unwrap();
    svm.process_instruction(
        &build_approve_ix(
            wallet,
            remove_intent,
            proposal_address,
            DEFAULT_EXPIRY,
            1,
            sign_message(&approver2, &approve_msg),
        ),
        &[],
    )
    .unwrap();
    assert_eq!(
        svm.get_account(&proposal_address).unwrap().data[105],
        1,
        "should be Approved"
    );

    // approver1 switches to cancel
    let cancel_msg = wrap_offchain(
        format!(
            "expires {}: cancel remove intent 0{}",
            format_timestamp(DEFAULT_EXPIRY),
            message_suffix(wallet_name, 0)
        )
        .as_bytes(),
    );
    svm.process_instruction(
        &build_cancel_ix(
            wallet,
            remove_intent,
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
        0,
        "should revert to Active"
    );
    println!("  REVERT: Approved → Active after vote switch");
}

#[test]
fn test_non_approver_approve_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let random_key = new_keypair();
    let wallet_name = "non-approver";

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
    let proposal_address = get_proposal_address(remove_intent, 0);

    let params_data = vec![0u8];
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

    let msg = remove_intent_msg("approve", DEFAULT_EXPIRY, wallet_name, 0, 0);
    assert!(svm
        .process_instruction(
            &build_approve_ix(
                wallet,
                remove_intent,
                proposal_address,
                DEFAULT_EXPIRY,
                99,
                sign_message(&random_key, &msg)
            ),
            &[]
        )
        .is_err());
}
