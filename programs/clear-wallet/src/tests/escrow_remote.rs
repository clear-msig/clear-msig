use super::*;

#[test]
fn test_execute_typed_cross_chain_escrow_release_finalizes_verified_artifact() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "typed-cross-chain-release";
    let chain_kind = 2u8;
    let amount_raw = 100_000_000u128;
    let escrow_id_hash = sha256_hash(b"btc-escrow-release-1");
    let milestone_id_hash = sha256_hash(b"btc-milestone-1");
    let recipient_hash = sha256_hash(b"tb1qrecipientaddress");
    let asset_id_hash = sha256_hash(b"BTC:testnet");
    let route_hash = sha256_hash(b"ika:btc:p2wpkh:testnet");
    let settlement_artifact_hash = sha256_hash(b"btc-txid:approved-artifact");
    let wrong_artifact_hash = sha256_hash(b"btc-txid:wrong-artifact");
    let tx_template = b"btc-p2wpkh-template-v1";
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
        .set_template("Release BTC escrow milestone")
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
    let chain_byte = [chain_kind];
    let execution_commitment = v4_execution_commitment(&[
        b"cross_chain_escrow_release",
        &chain_byte,
        ika_config.as_ref(),
        dwallet.as_ref(),
        &route_hash,
        &tx_template_hash,
        &settlement_artifact_hash,
    ]);
    let (typed_proposal, policy_commitment, envelope_hash) = propose_typed_escrow_release_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        remote_intent,
        proposal_index,
        &proposer,
        V4Network::BitcoinTestnet,
        b"btc-escrow-release-1",
        b"btc-milestone-1",
        V4TransferRowInput {
            recipient_encoding: V4IdentityEncoding::Sha256Text,
            recipient: b"tb1qrecipientaddress",
            asset_encoding: V4IdentityEncoding::Sha256Text,
            asset: b"BTC:testnet",
            raw_amount: amount_raw,
            decimals: 8,
            display_asset: b"BTC",
        },
        execution_commitment,
    );

    let wrong_execute = build_execute_typed_cross_chain_escrow_release_ix(
        wallet,
        remote_intent,
        typed_proposal,
        ika_config,
        dwallet,
        policy_commitment,
        envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        milestone_id_hash,
        recipient_hash,
        asset_id_hash,
        route_hash,
        tx_template_hash,
        wrong_artifact_hash,
    );
    assert!(svm
        .process_instruction(&wrong_execute, &[empty_account(dwallet)])
        .is_err());

    let execute = build_execute_typed_cross_chain_escrow_release_ix(
        wallet,
        remote_intent,
        typed_proposal,
        ika_config,
        dwallet,
        policy_commitment,
        envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        milestone_id_hash,
        recipient_hash,
        asset_id_hash,
        route_hash,
        tx_template_hash,
        settlement_artifact_hash,
    );
    let result = svm.process_instruction(&execute, &[empty_account(dwallet)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed cross-chain escrow release execute failed: {:?}",
        result.raw_result
    );
    assert_eq!(
        svm.get_account(&typed_proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );

    let return_proposal_index = 2u64;
    let refund_recipient_hash = sha256_hash(b"tb1qrefundrecipient");
    let return_artifact_hash = sha256_hash(b"btc-refund-txid:approved-artifact");
    let wrong_return_artifact_hash = sha256_hash(b"btc-refund-txid:wrong-artifact");
    let return_execution_commitment = v4_execution_commitment(&[
        b"cross_chain_escrow_return",
        &chain_byte,
        ika_config.as_ref(),
        dwallet.as_ref(),
        &route_hash,
        &tx_template_hash,
        &return_artifact_hash,
    ]);
    let return_rows = [V4TransferRowInput {
        recipient_encoding: V4IdentityEncoding::Sha256Text,
        recipient: b"tb1qrefundrecipient",
        asset_encoding: V4IdentityEncoding::Sha256Text,
        asset: b"BTC:testnet",
        raw_amount: amount_raw,
        decimals: 8,
        display_asset: b"BTC",
    }];
    let (return_proposal, return_policy_commitment, return_envelope_hash) =
        propose_typed_escrow_return_on_wallet(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            remote_intent,
            return_proposal_index,
            &proposer,
            V4Network::BitcoinTestnet,
            b"btc-escrow-release-1",
            &return_rows,
            return_execution_commitment,
        );

    let wrong_return = build_execute_typed_cross_chain_escrow_return_ix(
        wallet,
        remote_intent,
        return_proposal,
        ika_config,
        dwallet,
        return_policy_commitment,
        return_envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        refund_recipient_hash,
        asset_id_hash,
        route_hash,
        tx_template_hash,
        wrong_return_artifact_hash,
    );
    assert!(svm
        .process_instruction(&wrong_return, &[empty_account(dwallet)])
        .is_err());

    let execute_return = build_execute_typed_cross_chain_escrow_return_ix(
        wallet,
        remote_intent,
        return_proposal,
        ika_config,
        dwallet,
        return_policy_commitment,
        return_envelope_hash,
        chain_kind,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        refund_recipient_hash,
        asset_id_hash,
        route_hash,
        tx_template_hash,
        return_artifact_hash,
    );
    let result = svm.process_instruction(&execute_return, &[empty_account(dwallet)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed cross-chain escrow return execute failed: {:?}",
        result.raw_result
    );
    assert_eq!(
        svm.get_account(&return_proposal).unwrap().data[105],
        2,
        "typed return proposal should be Executed(2)"
    );
}

#[test]
fn test_execute_typed_private_escrow_finalizes_ciphertext_bound_artifacts() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "typed-private-escrow";
    let amount_raw = 42_000_000u128;
    let escrow_id_hash = sha256_hash(b"private-escrow-1");
    let milestone_id_hash = sha256_hash(b"private-milestone-1");
    let recipient_hash = sha256_hash(b"private-recipient-commitment");
    let refund_recipient_hash = sha256_hash(b"private-refund-commitment");
    let asset_id_hash = sha256_hash(b"PRIVATE:USDC");
    let private_evaluation_hash = sha256_hash(b"encrypt-evaluation:allowed");
    let wrong_private_evaluation_hash = sha256_hash(b"encrypt-evaluation:wrong");
    let settlement_artifact_hash = sha256_hash(b"private-settlement-artifact");
    let refund_artifact_hash = sha256_hash(b"private-refund-artifact");
    let policy_ciphertexts = {
        let mut out = Vec::new();
        out.extend_from_slice(&2u16.to_le_bytes());
        for id in [
            b"enc_policy_limit".as_slice(),
            b"enc_policy_recipient".as_slice(),
        ] {
            out.extend_from_slice(&(id.len() as u16).to_le_bytes());
            out.extend_from_slice(id);
        }
        out
    };
    let policy_ciphertexts_hash = sha256_hash(&policy_ciphertexts);

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
        .set_governance(1, 1, 0)
        .add_proposer(solana_address::Address::new_from_array(
            pubkey_of(&proposer).to_bytes(),
        ))
        .add_approver(solana_address::Address::new_from_array(
            pubkey_of(&proposer).to_bytes(),
        ))
        .set_template("Release private escrow milestone")
        .set_policy_ciphertexts(&policy_ciphertexts);
    let built_intent = builder.build();
    let intent_index = 3u8;
    let intent_body = built_intent.serialize_body(&wallet, 0, intent_index, 3);
    let (private_intent, _) = find_intent_address(&wallet, intent_index, &crate::ID);

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
            AccountMeta::new(private_intent, false),
        ],
        execute_extra_accounts: vec![funded_account(payer), empty_account(private_intent)],
    });

    let release_proposal_index = 1u64;
    let release_execution_commitment = v4_execution_commitment(&[
        b"private_escrow_release",
        &policy_ciphertexts_hash,
        &private_evaluation_hash,
        &settlement_artifact_hash,
    ]);
    let (release_proposal, release_policy_commitment, release_envelope_hash) =
        propose_typed_escrow_release_on_wallet(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            private_intent,
            release_proposal_index,
            &proposer,
            V4Network::SolanaDevnet,
            b"private-escrow-1",
            b"private-milestone-1",
            V4TransferRowInput {
                recipient_encoding: V4IdentityEncoding::Sha256Text,
                recipient: b"private-recipient-commitment",
                asset_encoding: V4IdentityEncoding::Sha256Text,
                asset: b"PRIVATE:USDC",
                raw_amount: amount_raw,
                decimals: 6,
                display_asset: b"USDC",
            },
            release_execution_commitment,
        );

    let wrong_release = build_execute_typed_private_escrow_release_ix(
        wallet,
        private_intent,
        release_proposal,
        release_policy_commitment,
        release_envelope_hash,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        milestone_id_hash,
        recipient_hash,
        asset_id_hash,
        policy_ciphertexts_hash,
        wrong_private_evaluation_hash,
        settlement_artifact_hash,
    );
    assert!(svm.process_instruction(&wrong_release, &[]).is_err());

    let execute_release = build_execute_typed_private_escrow_release_ix(
        wallet,
        private_intent,
        release_proposal,
        release_policy_commitment,
        release_envelope_hash,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        milestone_id_hash,
        recipient_hash,
        asset_id_hash,
        policy_ciphertexts_hash,
        private_evaluation_hash,
        settlement_artifact_hash,
    );
    let result = svm.process_instruction(&execute_release, &[]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed private escrow release execute failed: {:?}",
        result.raw_result
    );
    assert_eq!(
        svm.get_account(&release_proposal).unwrap().data[105],
        2,
        "typed private release proposal should be Executed(2)"
    );

    let return_proposal_index = 2u64;
    let return_execution_commitment = v4_execution_commitment(&[
        b"private_escrow_return",
        &policy_ciphertexts_hash,
        &private_evaluation_hash,
        &refund_artifact_hash,
    ]);
    let return_rows = [V4TransferRowInput {
        recipient_encoding: V4IdentityEncoding::Sha256Text,
        recipient: b"private-refund-commitment",
        asset_encoding: V4IdentityEncoding::Sha256Text,
        asset: b"PRIVATE:USDC",
        raw_amount: amount_raw,
        decimals: 6,
        display_asset: b"USDC",
    }];
    let (return_proposal, return_policy_commitment, return_envelope_hash) =
        propose_typed_escrow_return_on_wallet(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            private_intent,
            return_proposal_index,
            &proposer,
            V4Network::SolanaDevnet,
            b"private-escrow-1",
            &return_rows,
            return_execution_commitment,
        );

    let execute_return = build_execute_typed_private_escrow_return_ix(
        wallet,
        private_intent,
        return_proposal,
        return_policy_commitment,
        return_envelope_hash,
        amount_raw.to_le_bytes(),
        escrow_id_hash,
        refund_recipient_hash,
        asset_id_hash,
        policy_ciphertexts_hash,
        private_evaluation_hash,
        refund_artifact_hash,
    );
    let result = svm.process_instruction(&execute_return, &[]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed private escrow return execute failed: {:?}",
        result.raw_result
    );
    assert_eq!(
        svm.get_account(&return_proposal).unwrap().data[105],
        2,
        "typed private return proposal should be Executed(2)"
    );
}

#[test]
fn test_execute_typed_escrow_return_moves_sol_to_funders() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-return";
    let escrow_id_hash = sha256_hash(b"escrow-return-1");
    let funder_a = Pubkey::new_unique();
    let funder_b = Pubkey::new_unique();
    let amount_a = 3_000_000u64;
    let amount_b = 5_000_000u64;

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
            recipient: funder_a.as_ref(),
            asset_encoding: V4IdentityEncoding::Text,
            asset: b"SOL",
            raw_amount: amount_a as u128,
            decimals: 9,
            display_asset: b"SOL",
        },
        V4TransferRowInput {
            recipient_encoding: V4IdentityEncoding::SolanaPubkey,
            recipient: funder_b.as_ref(),
            asset_encoding: V4IdentityEncoding::Text,
            asset: b"SOL",
            raw_amount: amount_b as u128,
            decimals: 9,
            display_asset: b"SOL",
        },
    ];
    let (proposal, policy_commitment, envelope_hash) = propose_typed_escrow_return_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        &proposer,
        V4Network::SolanaDevnet,
        b"escrow-return-1",
        &rows,
        [0u8; 32],
    );

    let total = amount_a + amount_b;
    let vault = fund_vault(&mut svm, payer, wallet, total + 1_000_000);
    let vault_pre = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    let mut amount_bytes = Vec::new();
    amount_bytes.extend_from_slice(&amount_a.to_le_bytes());
    amount_bytes.extend_from_slice(&amount_b.to_le_bytes());
    let execute = build_execute_typed_escrow_return_ix(
        wallet,
        intent,
        proposal,
        policy_commitment,
        envelope_hash,
        escrow_id_hash,
        amount_bytes,
        vec![
            AccountMeta::new(funder_a, false),
            AccountMeta::new(funder_b, false),
        ],
    );
    let result = svm.process_instruction(
        &execute,
        &[empty_account(funder_a), empty_account(funder_b)],
    );
    assert!(
        result.is_ok(),
        "typed escrow return execute failed: {:?}",
        result.raw_result
    );

    assert_eq!(
        svm.get_account(&funder_a).map(|a| a.lamports).unwrap_or(0),
        amount_a
    );
    assert_eq!(
        svm.get_account(&funder_b).map(|a| a.lamports).unwrap_or(0),
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
