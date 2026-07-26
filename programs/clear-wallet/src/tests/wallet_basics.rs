use super::*;

#[test]
fn test_create_wallet() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let (instruction, accounts) = create_wallet_ix(
        payer,
        "treasury",
        &[Pubkey::new_unique()],
        &[Pubkey::new_unique()],
        1,
    );
    let result = svm.process_instruction(&instruction, &accounts);
    assert!(result.is_ok(), "create failed: {:?}", result.raw_result);

    let creator = solana_address::Address::new_from_array(payer.to_bytes());
    let (wallet, _) = find_wallet_address("treasury", &creator, &crate::ID);
    assert_eq!(result.account(&wallet).unwrap().data[0], 1);
    for index in 0..3u8 {
        let (intent_address, _) = find_intent_address(&wallet, index, &crate::ID);
        assert_eq!(result.account(&intent_address).unwrap().data[0], 2);
    }
    println!("  CREATE CU: {}", result.compute_units_consumed);
}

#[test]
fn test_legacy_and_typed_proposals_share_wallet_index_without_pda_collision() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "mixed-proposal-index";

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
    let (intent, _) = find_intent_address(&wallet, 1, &crate::ID);

    let legacy_index = 0u64;
    let legacy_proposal = get_proposal_address(intent, legacy_index);
    let legacy_params = vec![0u8];
    let legacy_msg = remove_intent_msg(
        "propose",
        DEFAULT_EXPIRY,
        wallet_name,
        legacy_index,
        legacy_params[0],
    );
    let legacy = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent,
        proposal_index: legacy_index,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &legacy_msg),
        params_data: legacy_params,
    });
    let result = svm.process_instruction(
        &legacy,
        &[funded_account(payer), empty_account(legacy_proposal)],
    );
    assert!(
        result.is_ok(),
        "legacy proposal create failed: {:?}",
        result.raw_result
    );

    let typed_index = 1u64;
    let (typed_proposal, _) = propose_typed_wallet_policy_update_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        typed_index,
        &proposer,
        [0u8; 32],
        0,
        &[],
    );

    assert_ne!(
        legacy_proposal, typed_proposal,
        "legacy and typed proposal PDAs must use separate namespaces"
    );
    assert_eq!(svm.get_account(&legacy_proposal).unwrap().data[0], 3);
    assert_eq!(svm.get_account(&typed_proposal).unwrap().data[0], 6);
    let wallet_data = svm.get_account(&wallet).unwrap().data;
    let proposal_index = u64::from_le_bytes(wallet_data[2..10].try_into().unwrap());
    assert_eq!(
        proposal_index, 2,
        "legacy and typed creates must share one monotonic wallet proposal index"
    );
}

#[test]
fn test_create_wallet_wrong_wallet_address_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = Pubkey::new_unique();
    let approver = Pubkey::new_unique();
    let (wallet, _) = find_wallet_address(
        "wrong-name",
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (update_intent, _) = find_intent_address(&wallet, 2, &crate::ID);

    let wrong_name_hash = Pubkey::from([0u8; 32]);
    let instruction: Instruction = CreateWalletInstruction {
        payer,
        name_hash: wrong_name_hash,
        wallet,
        add_intent,
        remove_intent,
        update_intent,
        system_program: quasar_svm::system_program::ID,
        name: DynBytes::new(b"actual-name".to_vec()),
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 0,
        proposers: DynVec::new(vec![proposer.to_bytes()]),
        approvers: DynVec::new(vec![approver.to_bytes()]),
        policy_ciphertexts: TailBytes(Vec::new()),
    }
    .into();

    let result = svm.process_instruction(
        &instruction,
        &[
            funded_account(payer),
            empty_account(wrong_name_hash),
            empty_account(wallet),
            empty_account(add_intent),
            empty_account(remove_intent),
            empty_account(update_intent),
        ],
    );
    assert!(
        result.is_err(),
        "wrong wallet address should fail PDA check"
    );
}

#[test]
fn test_create_wallet_bad_threshold_fails() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let (instruction, accounts) = create_wallet_ix(
        payer,
        "bad",
        &[Pubkey::new_unique()],
        &[Pubkey::new_unique()],
        2,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_err());
}
