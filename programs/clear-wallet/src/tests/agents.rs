use super::*;

#[test]
fn test_execute_typed_agent_session_grant_binds_status_and_revokes() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-agent-session";
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
    let session_id_hash = sha256_hash(b"session:bounded");
    let agent_id_hash = sha256_hash(b"agent:bounded");
    let venue_hash = sha256_hash(b"hyperliquid_testnet");
    let market_hash = sha256_hash(b"BTC-PERP");
    let policy_commitment = v4_policy_commitment(&[]);
    let max_notional_raw = 500_000_000u128;
    let max_leverage_x100 = 300u32;
    let session_expires_at = typed_test_expiry() + 3_600;
    let session = find_agent_session_address(&wallet, &session_id_hash, &crate::ID).0;

    let (grant_proposal, grant_envelope) = propose_typed_agent_session(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        0,
        &proposer,
        policy_commitment,
        b"session:bounded",
        b"agent:bounded",
        b"hyperliquid_testnet",
        b"BTC-PERP",
        max_notional_raw,
        max_leverage_x100,
        session_expires_at,
        1,
    );
    let changed_status = build_execute_typed_agent_session_grant_ix(
        payer,
        wallet,
        intent,
        grant_proposal,
        session,
        policy_commitment,
        grant_envelope,
        session_id_hash,
        agent_id_hash,
        venue_hash,
        market_hash,
        max_notional_raw,
        max_leverage_x100,
        session_expires_at,
        2,
    );
    assert!(svm
        .process_instruction(
            &changed_status,
            &[funded_account(payer), empty_account(session)]
        )
        .is_err());

    let grant = build_execute_typed_agent_session_grant_ix(
        payer,
        wallet,
        intent,
        grant_proposal,
        session,
        policy_commitment,
        grant_envelope,
        session_id_hash,
        agent_id_hash,
        venue_hash,
        market_hash,
        max_notional_raw,
        max_leverage_x100,
        session_expires_at,
        1,
    );
    assert!(svm
        .process_instruction(&grant, &[funded_account(payer), empty_account(session)])
        .is_ok());
    let account = svm.get_account(&session).unwrap();
    let granted = crate::state::AgentSession::read(&account.data).unwrap();
    assert!(granted.is_active());
    assert_eq!(granted.agent_id_hash, agent_id_hash);
    assert_eq!(granted.policy_commitment, policy_commitment);

    let (revoke_proposal, revoke_envelope) = propose_typed_agent_session(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        1,
        &proposer,
        policy_commitment,
        b"session:bounded",
        b"agent:bounded",
        b"hyperliquid_testnet",
        b"BTC-PERP",
        max_notional_raw,
        max_leverage_x100,
        session_expires_at,
        2,
    );
    let revoke = build_execute_typed_agent_session_grant_ix(
        payer,
        wallet,
        intent,
        revoke_proposal,
        session,
        policy_commitment,
        revoke_envelope,
        session_id_hash,
        agent_id_hash,
        venue_hash,
        market_hash,
        max_notional_raw,
        max_leverage_x100,
        session_expires_at,
        2,
    );
    assert!(svm
        .process_instruction(&revoke, &[funded_account(payer)])
        .is_ok());
    let account = svm.get_account(&session).unwrap();
    let revoked = crate::state::AgentSession::read(&account.data).unwrap();
    assert!(!revoked.is_active());
}

#[test]
fn test_execute_typed_agent_risk_policy_creates_bound_ledger() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-agent-risk";
    let session_id_hash = sha256_hash(b"session:risk-policy");
    let agent_id_hash = sha256_hash(b"agent:risk-policy");
    let venue_hash = sha256_hash(b"hyperliquid:testnet");
    let market_hash = sha256_hash(b"BTC-PERP");
    let oracle_policy_hash = sha256_hash(b"oracle:hyperliquid-account-state:v1");
    let max_loss_raw = 75_000_000u128;
    let policy_commitment = v4_policy_commitment(&[]);

    let (create, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&create, &accounts).is_ok());
    let wallet = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    )
    .0;
    let intent = find_intent_address(&wallet, 0, &crate::ID).0;
    let session_account = active_agent_session_account(
        wallet,
        session_id_hash,
        agent_id_hash,
        venue_hash,
        market_hash,
        policy_commitment,
        1_000_000_000,
        200,
        typed_test_expiry() + 3_600,
    );
    let session = session_account.address;
    svm.set_account(session_account);
    let risk = find_agent_risk_address(&wallet, &session_id_hash, &crate::ID).0;
    let (proposal, envelope_hash) = propose_typed_agent_risk_policy(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        0,
        &proposer,
        policy_commitment,
        b"session:risk-policy",
        oracle_policy_hash,
        max_loss_raw,
        crate::state::AGENT_RISK_STATUS_ACTIVE,
    );
    let changed_oracle = build_execute_typed_agent_risk_policy_ix(
        payer,
        wallet,
        intent,
        proposal,
        session,
        risk,
        policy_commitment,
        envelope_hash,
        session_id_hash,
        sha256_hash(b"oracle:compromised-adapter"),
        max_loss_raw,
        crate::state::AGENT_RISK_STATUS_ACTIVE,
    );
    assert!(
        svm.process_instruction(
            &changed_oracle,
            &[funded_account(payer), empty_account(risk)]
        )
        .is_err(),
        "risk policy accepted a substituted oracle commitment"
    );
    let execute = build_execute_typed_agent_risk_policy_ix(
        payer,
        wallet,
        intent,
        proposal,
        session,
        risk,
        policy_commitment,
        envelope_hash,
        session_id_hash,
        oracle_policy_hash,
        max_loss_raw,
        crate::state::AGENT_RISK_STATUS_ACTIVE,
    );
    let result = svm.process_instruction(&execute, &[funded_account(payer), empty_account(risk)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(result.is_ok(), "risk policy execution failed");
    let ledger =
        crate::state::AgentRiskLedger::read(&svm.get_account(&risk).unwrap().data).unwrap();
    assert!(ledger.is_active());
    assert_eq!(ledger.max_loss_raw(), max_loss_raw);
    assert_eq!(ledger.oracle_policy_hash, oracle_policy_hash);
    assert_eq!(ledger.realized_loss_raw(), 0);
    assert_eq!(ledger.open_notional_raw(), 0);
}

#[test]
fn test_agent_settlement_binds_artifact_replays_and_loss_cap() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-agent-settlement";
    let session_id_hash = sha256_hash(b"session:settlement");
    let agent_id_hash = sha256_hash(b"agent:settlement");
    let venue_hash = sha256_hash(b"hyperliquid:testnet");
    let market_hash = sha256_hash(b"BTC-PERP");
    let oracle_policy_hash = sha256_hash(b"oracle:hyperliquid-account-state:v1");
    let policy_commitment = v4_policy_commitment(&[]);

    let (create, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&create, &accounts).is_ok());
    let wallet = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    )
    .0;
    let intent = find_intent_address(&wallet, 0, &crate::ID).0;
    let session_account = active_agent_session_account(
        wallet,
        session_id_hash,
        agent_id_hash,
        venue_hash,
        market_hash,
        policy_commitment,
        1_000_000_000,
        200,
        typed_test_expiry() + 3_600,
    );
    let session = session_account.address;
    svm.set_account(session_account);
    let risk_account = active_agent_risk_account(
        wallet,
        session_id_hash,
        oracle_policy_hash,
        100,
        0,
        500,
        0,
        crate::state::AGENT_RISK_STATUS_ACTIVE,
    );
    let risk = risk_account.address;
    svm.set_account(risk_account);

    let first_execution = sha256_hash(b"execution:first");
    let first_artifact = sha256_hash(b"venue-receipt:first");
    let (first_proposal, first_envelope) = propose_typed_agent_settlement(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        0,
        &proposer,
        policy_commitment,
        b"session:settlement",
        b"execution:first",
        first_artifact,
        oracle_policy_hash,
        250,
        crate::instructions::AGENT_SETTLEMENT_OUTCOME_LOSS,
        60,
        0,
    );
    let first_receipt =
        find_agent_settlement_receipt_address(&wallet, &first_artifact, &crate::ID).0;
    let changed_artifact = build_execute_typed_agent_trade_settlement_ix(
        payer,
        wallet,
        intent,
        first_proposal,
        session,
        risk,
        first_receipt,
        policy_commitment,
        first_envelope,
        session_id_hash,
        first_execution,
        sha256_hash(b"venue-receipt:forged"),
        oracle_policy_hash,
        250,
        crate::instructions::AGENT_SETTLEMENT_OUTCOME_LOSS,
        60,
        0,
    );
    assert!(
        svm.process_instruction(
            &changed_artifact,
            &[funded_account(payer), empty_account(first_receipt)]
        )
        .is_err(),
        "settlement accepted a compromised adapter artifact"
    );
    let first = build_execute_typed_agent_trade_settlement_ix(
        payer,
        wallet,
        intent,
        first_proposal,
        session,
        risk,
        first_receipt,
        policy_commitment,
        first_envelope,
        session_id_hash,
        first_execution,
        first_artifact,
        oracle_policy_hash,
        250,
        crate::instructions::AGENT_SETTLEMENT_OUTCOME_LOSS,
        60,
        0,
    );
    assert!(svm
        .process_instruction(
            &first,
            &[funded_account(payer), empty_account(first_receipt)]
        )
        .is_ok());
    let after_first =
        crate::state::AgentRiskLedger::read(&svm.get_account(&risk).unwrap().data).unwrap();
    assert_eq!(after_first.open_notional_raw(), 250);
    assert_eq!(after_first.realized_loss_raw(), 60);
    assert_eq!(after_first.next_settlement_sequence, 1);
    assert!(svm.get_account(&first_receipt).is_some());

    let (replay_proposal, replay_envelope) = propose_typed_agent_settlement(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        1,
        &proposer,
        policy_commitment,
        b"session:settlement",
        b"execution:replay",
        first_artifact,
        oracle_policy_hash,
        100,
        crate::instructions::AGENT_SETTLEMENT_OUTCOME_PROFIT,
        1,
        1,
    );
    let replay = build_execute_typed_agent_trade_settlement_ix(
        payer,
        wallet,
        intent,
        replay_proposal,
        session,
        risk,
        first_receipt,
        policy_commitment,
        replay_envelope,
        session_id_hash,
        sha256_hash(b"execution:replay"),
        first_artifact,
        oracle_policy_hash,
        100,
        crate::instructions::AGENT_SETTLEMENT_OUTCOME_PROFIT,
        1,
        1,
    );
    assert!(
        svm.process_instruction(&replay, &[funded_account(payer)])
            .is_err(),
        "settlement artifact receipt was replayed"
    );

    let second_execution = sha256_hash(b"execution:second");
    let second_artifact = sha256_hash(b"venue-receipt:second");
    let (second_proposal, second_envelope) = propose_typed_agent_settlement(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        2,
        &proposer,
        policy_commitment,
        b"session:settlement",
        b"execution:second",
        second_artifact,
        oracle_policy_hash,
        250,
        crate::instructions::AGENT_SETTLEMENT_OUTCOME_LOSS,
        50,
        1,
    );
    let second_receipt =
        find_agent_settlement_receipt_address(&wallet, &second_artifact, &crate::ID).0;
    let second = build_execute_typed_agent_trade_settlement_ix(
        payer,
        wallet,
        intent,
        second_proposal,
        session,
        risk,
        second_receipt,
        policy_commitment,
        second_envelope,
        session_id_hash,
        second_execution,
        second_artifact,
        oracle_policy_hash,
        250,
        crate::instructions::AGENT_SETTLEMENT_OUTCOME_LOSS,
        50,
        1,
    );
    assert!(svm
        .process_instruction(
            &second,
            &[funded_account(payer), empty_account(second_receipt)]
        )
        .is_ok());
    let final_risk =
        crate::state::AgentRiskLedger::read(&svm.get_account(&risk).unwrap().data).unwrap();
    let final_session =
        crate::state::AgentSession::read(&svm.get_account(&session).unwrap().data).unwrap();
    assert_eq!(final_risk.open_notional_raw(), 0);
    assert_eq!(final_risk.realized_loss_raw(), 110);
    assert!(!final_risk.is_active());
    assert!(!final_session.is_active());
}

#[test]
fn test_execute_typed_agent_trade_approval_finalizes_verified_digest() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-agent-trade";
    let amount_raw = 250_000_000u128;
    let venue_hash = sha256_hash(b"hyperliquid:testnet");
    let market_hash = sha256_hash(b"BTC-PERP");
    let side_hash = sha256_hash(b"long");
    let asset_id_hash = sha256_hash(b"USDC:hyperliquid:testnet");
    let max_leverage_x100 = 250u32;
    let session_id_hash = sha256_hash(b"agent-session:morning-risk-pass");
    let route_hash = sha256_hash(b"clearsig-agent:hyperliquid:testnet:limit");
    let risk_check_hash = sha256_hash(b"risk-ok:cap-velocity-thesis-stoploss-v1");
    let oracle_policy_hash = sha256_hash(b"oracle:hyperliquid-testnet:account-state-v1");
    let wrong_risk_check_hash = sha256_hash(b"risk-skipped:wrong-artifact");
    let action_id = sha256_hash(b"agent-trade-action-1");
    let nonce = sha256_hash(b"agent-trade-nonce-1");
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
    let policy_commitment = v4_policy_commitment(&[]);
    let agent_id_hash = sha256_hash(b"agent:alpha-trader");
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_agent_trade_approval(
        &V4AgentTradeApprovalInput {
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
            agent_id: b"agent:alpha-trader",
            venue: b"hyperliquid:testnet",
            market: b"BTC-PERP",
            side: b"long",
            asset_id: b"USDC:hyperliquid:testnet",
            max_notional_raw: amount_raw,
            max_leverage_x100,
            session_id: b"agent-session:morning-risk-pass",
            route: b"clearsig-agent:hyperliquid:testnet:limit",
            risk_check_hash,
            reason: b"Program agent trade test",
        },
        &mut canonical,
    )
    .expect("agent trade should encode as canonical v4 intent");
    let (proposal, _, envelope_hash) = submit_typed_v4_proposal(
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

    let session_account = active_agent_session_account(
        wallet,
        session_id_hash,
        agent_id_hash,
        venue_hash,
        market_hash,
        policy_commitment,
        1_000_000_000u128,
        max_leverage_x100,
        expiry + 3_600,
    );
    let session_pk = session_account.address;
    svm.set_account(session_account.clone());
    let risk_pk = find_agent_risk_address(&wallet, &session_id_hash, &crate::ID).0;
    let missing_risk_execute = build_execute_typed_agent_trade_approval_ix(
        wallet,
        intent,
        proposal,
        session_pk,
        risk_pk,
        policy_commitment,
        envelope_hash,
        amount_raw.to_le_bytes(),
        agent_id_hash,
        venue_hash,
        market_hash,
        side_hash,
        asset_id_hash,
        max_leverage_x100,
        session_id_hash,
        route_hash,
        risk_check_hash,
    );
    assert!(
        svm.process_instruction(&missing_risk_execute, &[]).is_err(),
        "agent trade executed without a program-owned risk ledger"
    );
    let risk_account = active_agent_risk_account(
        wallet,
        session_id_hash,
        oracle_policy_hash,
        100_000_000,
        0,
        0,
        0,
        crate::state::AGENT_RISK_STATUS_ACTIVE,
    );
    assert_eq!(risk_pk, risk_account.address);
    svm.set_account(risk_account);

    let wrong_execute = build_execute_typed_agent_trade_approval_ix(
        wallet,
        intent,
        proposal,
        session_pk,
        risk_pk,
        policy_commitment,
        envelope_hash,
        amount_raw.to_le_bytes(),
        agent_id_hash,
        venue_hash,
        market_hash,
        side_hash,
        asset_id_hash,
        max_leverage_x100,
        session_id_hash,
        route_hash,
        wrong_risk_check_hash,
    );
    assert!(
        svm.process_instruction(&wrong_execute, &[]).is_err(),
        "agent trade executor accepted a changed risk-check artifact"
    );
    let wrong_route_execute = build_execute_typed_agent_trade_approval_ix(
        wallet,
        intent,
        proposal,
        session_pk,
        risk_pk,
        policy_commitment,
        envelope_hash,
        amount_raw.to_le_bytes(),
        agent_id_hash,
        venue_hash,
        market_hash,
        side_hash,
        asset_id_hash,
        max_leverage_x100,
        session_id_hash,
        sha256_hash(b"clearsig-agent:changed-route"),
        risk_check_hash,
    );
    assert!(
        svm.process_instruction(&wrong_route_execute, &[]).is_err(),
        "agent trade executor accepted a changed venue route"
    );

    let execute = build_execute_typed_agent_trade_approval_ix(
        wallet,
        intent,
        proposal,
        session_pk,
        risk_pk,
        policy_commitment,
        envelope_hash,
        amount_raw.to_le_bytes(),
        agent_id_hash,
        venue_hash,
        market_hash,
        side_hash,
        asset_id_hash,
        max_leverage_x100,
        session_id_hash,
        route_hash,
        risk_check_hash,
    );

    let rejected_sessions = [
        (
            active_agent_session_account(
                wallet,
                session_id_hash,
                sha256_hash(b"agent:wrong"),
                venue_hash,
                market_hash,
                policy_commitment,
                1_000_000_000,
                max_leverage_x100,
                expiry + 3_600,
            ),
            "wrong agent",
        ),
        (
            active_agent_session_account(
                wallet,
                session_id_hash,
                agent_id_hash,
                venue_hash,
                market_hash,
                sha256_hash(b"policy:wrong"),
                1_000_000_000,
                max_leverage_x100,
                expiry + 3_600,
            ),
            "wrong policy",
        ),
        (
            active_agent_session_account(
                wallet,
                session_id_hash,
                agent_id_hash,
                sha256_hash(b"venue:wrong"),
                market_hash,
                policy_commitment,
                1_000_000_000,
                max_leverage_x100,
                expiry + 3_600,
            ),
            "wrong venue",
        ),
        (
            active_agent_session_account(
                wallet,
                session_id_hash,
                agent_id_hash,
                venue_hash,
                sha256_hash(b"ETH-PERP"),
                policy_commitment,
                1_000_000_000,
                max_leverage_x100,
                expiry + 3_600,
            ),
            "wrong market",
        ),
        (
            active_agent_session_account(
                wallet,
                session_id_hash,
                agent_id_hash,
                venue_hash,
                market_hash,
                policy_commitment,
                1_000_000_000,
                max_leverage_x100 - 1,
                expiry + 3_600,
            ),
            "excess leverage",
        ),
        (
            active_agent_session_account(
                wallet,
                session_id_hash,
                agent_id_hash,
                venue_hash,
                market_hash,
                policy_commitment,
                amount_raw - 1,
                max_leverage_x100,
                expiry + 3_600,
            ),
            "excess notional",
        ),
        (
            active_agent_session_account(
                wallet,
                session_id_hash,
                agent_id_hash,
                venue_hash,
                market_hash,
                policy_commitment,
                1_000_000_000,
                max_leverage_x100,
                -1,
            ),
            "expired session",
        ),
    ];
    for (account, reason) in rejected_sessions {
        svm.set_account(account);
        assert!(
            svm.process_instruction(&execute, &[]).is_err(),
            "agent trade executor accepted {reason}"
        );
    }
    svm.set_account(session_account);
    svm.set_account(active_agent_risk_account(
        wallet,
        session_id_hash,
        oracle_policy_hash,
        100_000_000,
        0,
        1_000_000_000 - amount_raw + 1,
        0,
        crate::state::AGENT_RISK_STATUS_ACTIVE,
    ));
    assert!(
        svm.process_instruction(&execute, &[]).is_err(),
        "aggregate open exposure exceeded the session notional cap"
    );
    svm.set_account(active_agent_risk_account(
        wallet,
        session_id_hash,
        oracle_policy_hash,
        100_000_000,
        100_000_000,
        0,
        0,
        crate::state::AGENT_RISK_STATUS_ACTIVE,
    ));
    assert!(
        svm.process_instruction(&execute, &[]).is_err(),
        "trade executed after realized loss exhausted the risk cap"
    );
    svm.set_account(active_agent_risk_account(
        wallet,
        session_id_hash,
        oracle_policy_hash,
        100_000_000,
        0,
        0,
        0,
        crate::state::AGENT_RISK_STATUS_ACTIVE,
    ));

    let result = svm.process_instruction(&execute, &[]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed agent trade execute failed: {:?}",
        result.raw_result
    );
    assert_eq!(
        svm.get_account(&proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );
    let spent_after_first =
        crate::state::AgentSession::read(&svm.get_account(&session_pk).unwrap().data)
            .unwrap()
            .spent_notional_raw();
    assert_eq!(spent_after_first, amount_raw);
    let risk_after_first =
        crate::state::AgentRiskLedger::read(&svm.get_account(&risk_pk).unwrap().data).unwrap();
    assert_eq!(risk_after_first.open_notional_raw(), amount_raw);
    assert!(
        svm.process_instruction(&execute, &[]).is_err(),
        "executed agent trade approval must not consume session allowance twice"
    );
    let spent_after_replay =
        crate::state::AgentSession::read(&svm.get_account(&session_pk).unwrap().data)
            .unwrap()
            .spent_notional_raw();
    assert_eq!(spent_after_replay, spent_after_first);
    let risk_after_replay =
        crate::state::AgentRiskLedger::read(&svm.get_account(&risk_pk).unwrap().data).unwrap();
    assert_eq!(risk_after_replay.open_notional_raw(), amount_raw);
}
