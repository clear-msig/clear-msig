use super::*;

#[test]
fn test_execute_typed_chain_send_finalizes_verified_remote_send() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "typed-chain-send";
    let chain_kind = 2u8;
    let amount_raw = 250_000_000u128;
    let recipient_text = b"tb1qrecipientaddress";
    let recipient_hash = sha256_hash(recipient_text);
    let wrong_recipient_hash = sha256_hash(b"tb1qattackeraddress");
    let asset_text = b"BTC:testnet";
    let asset_id_hash = sha256_hash(asset_text);
    let tx_template = b"btc-send-template-v1";
    let tx_template_hash = sha256_hash(tx_template);

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
    let mut builder = IntentBuilder::new();
    builder
        .set_chain_kind(chain_kind)
        .set_governance(1, 1, 0)
        .add_proposer(solana_address::Address::new_from_array(
            pubkey_of(&proposer).to_bytes(),
        ))
        .add_approver(solana_address::Address::new_from_array(
            pubkey_of(&proposer).to_bytes(),
        ))
        .set_template("Send BTC")
        .set_tx_template(tx_template);
    let built_intent = builder.build();
    let intent_index = 3u8;
    let intent_body = built_intent.serialize_body(&wallet, 0, intent_index, 3);
    let (remote_intent, _) = find_intent_address(&wallet, intent_index, &crate::ID);

    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: add_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: intent_body,
        msg_fn: &add_intent_msg,
        execute_remaining: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(remote_intent, false),
        ],
        execute_extra_accounts: vec![funded_account(payer), empty_account(remote_intent)],
    });

    let (ika_config, ika_config_bump) =
        Pubkey::find_program_address(&[b"ika_config", wallet.as_ref(), &[chain_kind]], &crate::ID);
    let dwallet = Pubkey::new_unique();
    svm.set_account(keyed_ika_config_account(
        ika_config,
        wallet,
        dwallet,
        chain_kind,
        1,
        ika_config_bump,
    ));

    let proposal_index = 1u64;
    let (typed_proposal, policy_commitment, envelope_hash) = propose_typed_remote_send_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        remote_intent,
        proposal_index,
        &proposer,
        chain_kind,
        amount_raw,
        recipient_text,
        asset_text,
        tx_template_hash,
        &[],
    );

    let wrong_execute = build_execute_typed_chain_send_ix(
        payer,
        wallet,
        remote_intent,
        typed_proposal,
        ika_config,
        dwallet,
        policy_commitment,
        envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        wrong_recipient_hash,
        asset_id_hash,
        tx_template_hash,
    );
    assert!(svm
        .process_instruction(
            &wrong_execute,
            &[
                funded_account(payer),
                empty_wallet_policy_account(wallet),
                empty_policy_spend_account(wallet, remote_intent, policy_commitment),
                empty_member_allowance_account(wallet, remote_intent),
                empty_account(dwallet)
            ]
        )
        .is_err());

    for (label, mutation) in [
        (
            "amount",
            build_execute_typed_chain_send_ix(
                payer,
                wallet,
                remote_intent,
                typed_proposal,
                ika_config,
                dwallet,
                policy_commitment,
                envelope_hash,
                chain_kind,
                (amount_raw + 1).to_le_bytes(),
                recipient_hash,
                asset_id_hash,
                tx_template_hash,
            ),
        ),
        (
            "asset",
            build_execute_typed_chain_send_ix(
                payer,
                wallet,
                remote_intent,
                typed_proposal,
                ika_config,
                dwallet,
                policy_commitment,
                envelope_hash,
                chain_kind,
                amount_raw.to_le_bytes(),
                recipient_hash,
                sha256_hash(b"BTC:mainnet"),
                tx_template_hash,
            ),
        ),
        (
            "chain",
            build_execute_typed_chain_send_ix(
                payer,
                wallet,
                remote_intent,
                typed_proposal,
                ika_config,
                dwallet,
                policy_commitment,
                envelope_hash,
                3,
                amount_raw.to_le_bytes(),
                recipient_hash,
                asset_id_hash,
                tx_template_hash,
            ),
        ),
        (
            "transaction template",
            build_execute_typed_chain_send_ix(
                payer,
                wallet,
                remote_intent,
                typed_proposal,
                ika_config,
                dwallet,
                policy_commitment,
                envelope_hash,
                chain_kind,
                amount_raw.to_le_bytes(),
                recipient_hash,
                asset_id_hash,
                sha256_hash(b"attacker-template"),
            ),
        ),
    ] {
        assert!(
            svm.process_instruction(
                &mutation,
                &[
                    funded_account(payer),
                    empty_wallet_policy_account(wallet),
                    empty_policy_spend_account(wallet, remote_intent, policy_commitment),
                    empty_member_allowance_account(wallet, remote_intent),
                    empty_account(dwallet),
                ],
            )
            .is_err(),
            "typed remote send accepted substituted {label}"
        );
    }

    let execute = build_execute_typed_chain_send_ix(
        payer,
        wallet,
        remote_intent,
        typed_proposal,
        ika_config,
        dwallet,
        policy_commitment,
        envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        recipient_hash,
        asset_id_hash,
        tx_template_hash,
    );
    let result = svm.process_instruction(
        &execute,
        &[
            funded_account(payer),
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, remote_intent, policy_commitment),
            empty_member_allowance_account(wallet, remote_intent),
            empty_account(dwallet),
        ],
    );
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed chain send execute failed: {:?}",
        result.raw_result
    );
    assert_eq!(
        svm.get_account(&typed_proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );

    let blocked_proposal_index = 2u64;
    let blocked_policy_bytes = typed_hash_policy_bytes(2, 0, 0, &[recipient_hash], &[]);
    let (blocked_proposal, blocked_policy_commitment, blocked_envelope_hash) =
        propose_typed_remote_send_on_wallet(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            remote_intent,
            blocked_proposal_index,
            &proposer,
            chain_kind,
            amount_raw,
            recipient_text,
            asset_text,
            tx_template_hash,
            &blocked_policy_bytes,
        );

    let blocked_execute = build_execute_typed_chain_send_ix(
        payer,
        wallet,
        remote_intent,
        blocked_proposal,
        ika_config,
        dwallet,
        blocked_policy_commitment,
        blocked_envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        recipient_hash,
        asset_id_hash,
        tx_template_hash,
    );
    let result = svm.process_instruction(
        &blocked_execute,
        &[
            funded_account(payer),
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, remote_intent, blocked_policy_commitment),
            empty_member_allowance_account(wallet, remote_intent),
            empty_account(dwallet),
        ],
    );
    assert!(
        result.is_err(),
        "typed chain send blocklist policy did not stop execution"
    );

    // BTC allowlist accept (mode=1, listed recipient).
    let allow_proposal_index = 3u64;
    let allow_policy = typed_hash_policy_bytes(1, 0, 0, &[recipient_hash], &[]);
    let (allow_proposal, allow_commitment, allow_envelope) = propose_typed_remote_send_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        remote_intent,
        allow_proposal_index,
        &proposer,
        chain_kind,
        amount_raw,
        recipient_text,
        asset_text,
        tx_template_hash,
        &allow_policy,
    );
    let allow_execute = build_execute_typed_chain_send_ix(
        payer,
        wallet,
        remote_intent,
        allow_proposal,
        ika_config,
        dwallet,
        allow_commitment,
        allow_envelope,
        chain_kind,
        amount_raw.to_le_bytes(),
        recipient_hash,
        asset_id_hash,
        tx_template_hash,
    );
    let allow_result = svm.process_instruction(
        &allow_execute,
        &[
            funded_account(payer),
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, remote_intent, allow_commitment),
            empty_member_allowance_account(wallet, remote_intent),
            empty_account(dwallet),
        ],
    );
    assert!(
        allow_result.is_ok(),
        "BTC allowlist accept failed: {:?}",
        allow_result.raw_result
    );

    // BTC amount cap reject.
    let cap_proposal_index = 4u64;
    let cap_policy = typed_hash_policy_bytes(0, 1_000, 0, &[], &[]);
    let (cap_proposal, cap_commitment, cap_envelope) = propose_typed_remote_send_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        remote_intent,
        cap_proposal_index,
        &proposer,
        chain_kind,
        amount_raw,
        recipient_text,
        asset_text,
        tx_template_hash,
        &cap_policy,
    );
    let cap_execute = build_execute_typed_chain_send_ix(
        payer,
        wallet,
        remote_intent,
        cap_proposal,
        ika_config,
        dwallet,
        cap_commitment,
        cap_envelope,
        chain_kind,
        amount_raw.to_le_bytes(),
        recipient_hash,
        asset_id_hash,
        tx_template_hash,
    );
    let cap_result = svm.process_instruction(
        &cap_execute,
        &[
            funded_account(payer),
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, remote_intent, cap_commitment),
            empty_member_allowance_account(wallet, remote_intent),
            empty_account(dwallet),
        ],
    );
    assert!(
        cap_result.is_err(),
        "BTC amount cap did not reject oversize send"
    );
}

#[test]
fn test_all_remote_asset_policies_reject_unsafe_execution() {
    for (chain_kind, wallet_name, recipient_text, asset_text, template) in [
        (
            1u8,
            "eth-policy-matrix",
            b"0x1111111111111111111111111111111111111111".as_slice(),
            b"ETH:sepolia".as_slice(),
            b"eth-policy-template".as_slice(),
        ),
        (
            2u8,
            "btc-policy-matrix",
            b"tb1qrecipient".as_slice(),
            b"BTC:testnet".as_slice(),
            b"btc-policy-template".as_slice(),
        ),
        (
            3u8,
            "zec-policy-matrix",
            b"tmZcashRecipient".as_slice(),
            b"ZEC:testnet".as_slice(),
            b"zec-policy-template".as_slice(),
        ),
        (
            4u8,
            "usdc-policy-matrix",
            b"0x2222222222222222222222222222222222222222".as_slice(),
            b"USDC:sepolia".as_slice(),
            b"erc20-usdc-policy-template".as_slice(),
        ),
        (
            5u8,
            "hype-policy-matrix",
            b"0x3333333333333333333333333333333333333333".as_slice(),
            b"HYPE:testnet".as_slice(),
            b"hype-policy-template".as_slice(),
        ),
    ] {
        let mut svm = setup();
        let payer = Pubkey::new_unique();
        let proposer = new_keypair();
        let approver = new_keypair();
        let (create, accounts) = create_wallet_ix(
            payer,
            wallet_name,
            &[pubkey_of(&proposer)],
            &[pubkey_of(&approver)],
            1,
        );
        assert!(svm.process_instruction(&create, &accounts).is_ok());
        let (wallet, _) = find_wallet_address(
            wallet_name,
            &solana_address::Address::new_from_array(payer.to_bytes()),
            &crate::ID,
        );
        let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
        let intent_index = 3u8;
        let (remote_intent, _) = find_intent_address(&wallet, intent_index, &crate::ID);
        let mut builder = IntentBuilder::new();
        builder
            .set_chain_kind(chain_kind)
            .set_governance(1, 1, 0)
            .add_proposer(solana_address::Address::new_from_array(
                pubkey_of(&proposer).to_bytes(),
            ))
            .add_approver(solana_address::Address::new_from_array(
                pubkey_of(&proposer).to_bytes(),
            ))
            .set_template("Remote send")
            .set_tx_template(template);
        let intent_body = builder.build().serialize_body(&wallet, 0, intent_index, 3);
        propose_approve_execute(ProposeApproveExecuteArgs {
            svm: &mut svm,
            payer,
            wallet,
            wallet_name,
            intent: add_intent,
            proposal_index: 0,
            proposer: &proposer,
            approver: &approver,
            params_data: intent_body,
            msg_fn: &add_intent_msg,
            execute_remaining: vec![
                AccountMeta::new(payer, true),
                AccountMeta::new(remote_intent, false),
            ],
            execute_extra_accounts: vec![funded_account(payer), empty_account(remote_intent)],
        });

        let (ika_config, ika_config_bump) = Pubkey::find_program_address(
            &[b"ika_config", wallet.as_ref(), &[chain_kind]],
            &crate::ID,
        );
        let dwallet = Pubkey::new_unique();
        svm.set_account(keyed_ika_config_account(
            ika_config,
            wallet,
            dwallet,
            chain_kind,
            1,
            ika_config_bump,
        ));
        let recipient_hash = sha256_hash(recipient_text);
        let tx_template_hash = sha256_hash(template);
        let policy_spend = empty_policy_spend_account(wallet, remote_intent, [0u8; 32]);
        let member_allowance = empty_member_allowance_account(wallet, remote_intent);
        svm.set_account(empty_wallet_policy_account(wallet));
        svm.set_account(policy_spend);
        svm.set_account(member_allowance);
        svm.set_account(empty_account(dwallet));

        let disallowed_recipient = sha256_hash(b"disallowed-recipient");
        let allowlist = typed_hash_policy_bytes(1, 0, 0, &[disallowed_recipient], &[]);
        assert!(!execute_typed_remote_send_with_policy(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            remote_intent,
            1,
            &proposer,
            ika_config,
            dwallet,
            chain_kind,
            100,
            recipient_text,
            asset_text,
            tx_template_hash,
            &allowlist,
        ));

        let amount_cap = typed_hash_policy_bytes(0, 99, 0, &[], &[]);
        assert!(!execute_typed_remote_send_with_policy(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            remote_intent,
            2,
            &proposer,
            ika_config,
            dwallet,
            chain_kind,
            100,
            recipient_text,
            asset_text,
            tx_template_hash,
            &amount_cap,
        ));

        let mut ordered_rules = vec![1, 2];
        ordered_rules.extend_from_slice(&advanced_recipient_rule(1, recipient_hash));
        ordered_rules.extend_from_slice(&advanced_unconditional_rule(0));
        let velocity = append_advanced_rules_extension(
            typed_sol_policy_bytes_with_velocity(0, 0, 0, &[], &[], 1_000, 86_400),
            &ordered_rules,
        );
        assert!(execute_typed_remote_send_with_policy(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            remote_intent,
            3,
            &proposer,
            ika_config,
            dwallet,
            chain_kind,
            600,
            recipient_text,
            asset_text,
            tx_template_hash,
            &velocity,
        ));
        assert!(!execute_typed_remote_send_with_policy(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            remote_intent,
            4,
            &proposer,
            ika_config,
            dwallet,
            chain_kind,
            500,
            recipient_text,
            asset_text,
            tx_template_hash,
            &velocity,
        ));

        let send_count = typed_sol_policy_bytes_with_send_count(1, 86_400);
        assert!(execute_typed_remote_send_with_policy(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            remote_intent,
            5,
            &proposer,
            ika_config,
            dwallet,
            chain_kind,
            100,
            recipient_text,
            asset_text,
            tx_template_hash,
            &send_count,
        ));
        assert!(!execute_typed_remote_send_with_policy(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            remote_intent,
            6,
            &proposer,
            ika_config,
            dwallet,
            chain_kind,
            100,
            recipient_text,
            asset_text,
            tx_template_hash,
            &send_count,
        ));

        let never_allowed =
            append_allowed_time_extension(typed_hash_policy_bytes(0, 0, 0, &[], &[]), 9, 9, 0, 0);
        assert!(!execute_typed_remote_send_with_policy(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            remote_intent,
            7,
            &proposer,
            ika_config,
            dwallet,
            chain_kind,
            100,
            recipient_text,
            asset_text,
            tx_template_hash,
            &never_allowed,
        ));

        let required_approver = Pubkey::new_unique();
        let mut required_rules = vec![1, 1];
        required_rules.extend_from_slice(&advanced_required_approver_rule(required_approver));
        let required = append_advanced_rules_extension(
            typed_hash_policy_bytes(0, 0, 0, &[], &[]),
            &required_rules,
        );
        assert!(!execute_typed_remote_send_with_policy(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            remote_intent,
            8,
            &proposer,
            ika_config,
            dwallet,
            chain_kind,
            100,
            recipient_text,
            asset_text,
            tx_template_hash,
            &required,
        ));

        let mut cooldown_rules = vec![1, 1];
        cooldown_rules.extend_from_slice(&advanced_cooldown_rule(u32::MAX));
        let cooldown = append_advanced_rules_extension(
            typed_hash_policy_bytes(0, 0, 0, &[], &[]),
            &cooldown_rules,
        );
        assert!(!execute_typed_remote_send_with_policy(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            remote_intent,
            9,
            &proposer,
            ika_config,
            dwallet,
            chain_kind,
            100,
            recipient_text,
            asset_text,
            tx_template_hash,
            &cooldown,
        ));

        let mut deny_rules = vec![1, 1];
        deny_rules.extend_from_slice(&advanced_recipient_rule(0, recipient_hash));
        let advanced_deny = append_advanced_rules_extension(
            typed_hash_policy_bytes(0, 0, 0, &[], &[]),
            &deny_rules,
        );
        assert!(!execute_typed_remote_send_with_policy(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            remote_intent,
            10,
            &proposer,
            ika_config,
            dwallet,
            chain_kind,
            100,
            recipient_text,
            asset_text,
            tx_template_hash,
            &advanced_deny,
        ));
    }
}
