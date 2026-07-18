use super::*;

fn pubkey(byte: u8) -> ([u8; 32], String) {
    let raw = [byte; 32];
    (raw, bs58::encode(raw).into_string())
}

fn request(recipient: &str, amount: &str) -> ClearSignV4PrepareRequest {
    let (_, actor) = pubkey(8);
    let (_, wallet) = pubkey(7);
    ClearSignV4PrepareRequest {
        envelope: ClearSignV4EnvelopeRequest {
            version: 4,
            kind: "send".into(),
            network: "Solana devnet".into(),
            wallet_name: "Team treasury".into(),
            wallet_id: Some(wallet),
            action_id: "send-action-1".into(),
            nonce: "send-nonce-1".into(),
            expires_at: current_unix_timestamp().unwrap() + 600,
            policy_commitment: Some(to_hex(&policy_commitment(&[]))),
            payload: serde_json::json!({
                "recipient": recipient,
                "recipientEncoding": "solana_pubkey",
                "amount": amount,
                "asset": "SOL",
                "note": "Vendor invoice 42"
            }),
        },
        intent_index: 3,
        actor_pubkey: actor,
        policy_bytes_hex: None,
        device_profile: None,
    }
}

fn trusted() -> TrustedIntentContext {
    let (wallet_id, _) = pubkey(7);
    let (actor, _) = pubkey(8);
    TrustedIntentContext {
        wallet_id,
        wallet_name: "Team treasury".into(),
        proposal_index: 6,
        chain_kind: 0,
        approval_threshold: 2,
        approved: true,
        proposers: vec![actor],
        execution_commitment: [0u8; 32],
        current_policy_commitment: None,
        escrow_binding: TrustedEscrowBinding::default(),
    }
}

fn escrow_request(payload: Value) -> ClearSignV4PrepareRequest {
    let (_, actor) = pubkey(8);
    let (_, wallet) = pubkey(7);
    ClearSignV4PrepareRequest {
        envelope: ClearSignV4EnvelopeRequest {
            version: 4,
            kind: "release_milestone".into(),
            network: "Solana devnet".into(),
            wallet_name: "Team treasury".into(),
            wallet_id: Some(wallet),
            action_id: "escrow-action-1".into(),
            nonce: "escrow-nonce-1".into(),
            expires_at: current_unix_timestamp().unwrap() + 600,
            policy_commitment: Some(to_hex(&policy_commitment(&[]))),
            payload,
        },
        intent_index: 3,
        actor_pubkey: actor,
        policy_bytes_hex: None,
        device_profile: None,
    }
}

#[test]
fn spl_escrow_binds_token_accounts_and_owner_to_readable_payment() {
    let (_, mint) = pubkey(20);
    let (_, source) = pubkey(21);
    let (_, destination) = pubkey(22);
    let (_, other_destination) = pubkey(23);
    let (_, owner) = pubkey(24);
    let payload = |destination_token: &str, recipient: &str| {
        serde_json::json!({
            "escrowId": "escrow-1",
            "escrowTitle": "Vendor delivery",
            "milestoneId": "milestone-1",
            "milestoneTitle": "Accepted",
            "recipient": recipient,
            "recipientEncoding": "solana_pubkey",
            "amount": "12.5",
            "asset": mint,
            "assetEncoding": "solana_pubkey",
            "decimals": 6,
            "displayAsset": "USDC",
            "execution": {
                "mode": "spl",
                "mint": mint,
                "sourceToken": source,
                "destinationToken": destination_token,
                "recipientOwner": owner
            }
        })
    };
    let first =
        prepare_clearsign_v4_response(escrow_request(payload(&destination, &owner)), trusted())
            .unwrap();
    let changed = prepare_clearsign_v4_response(
        escrow_request(payload(&other_destination, &owner)),
        trusted(),
    )
    .unwrap();
    assert_ne!(first.payload_hash, changed.payload_hash);
    assert!(first.signable_text.contains("12.5 USDC"));
    let (_, wrong_owner) = pubkey(25);
    assert!(prepare_clearsign_v4_response(
        escrow_request(payload(&destination, &wrong_owner)),
        trusted(),
    )
    .is_err());
}

#[test]
fn remote_and_private_escrow_evidence_changes_the_signed_payload() {
    let hash = |byte: u8| to_hex(&[byte; 32]);
    let remote_payload = |route: &str, artifact: &str| {
        serde_json::json!({
            "escrowId": "escrow-remote",
            "escrowTitle": "Remote vendor",
            "milestoneId": "milestone-remote",
            "milestoneTitle": "Settlement verified",
            "recipient": "0x1111111111111111111111111111111111111111",
            "recipientEncoding": "sha256_text",
            "amount": "3",
            "asset": "USDC",
            "assetEncoding": "sha256_text",
            "decimals": 6,
            "execution": {
                "mode": "cross_chain",
                "routeHash": route,
                "settlementArtifactHash": artifact
            }
        })
    };
    let mut remote_context = trusted();
    remote_context.chain_kind = 1;
    remote_context.execution_commitment = [31; 32];
    remote_context.escrow_binding = TrustedEscrowBinding {
        ika_config: Some([32; 32]),
        dwallet: Some([33; 32]),
        policy_ciphertexts_hash: None,
    };
    let mut first_request = escrow_request(remote_payload(&hash(34), &hash(35)));
    first_request.envelope.network = "Ethereum Sepolia".into();
    let first = prepare_clearsign_v4_response(first_request, remote_context.clone()).unwrap();
    let mut changed_request = escrow_request(remote_payload(&hash(36), &hash(35)));
    changed_request.envelope.network = "Ethereum Sepolia".into();
    let changed = prepare_clearsign_v4_response(changed_request, remote_context).unwrap();
    assert_ne!(first.payload_hash, changed.payload_hash);

    let private_payload = |evaluation: &str| {
        serde_json::json!({
            "escrowId": "escrow-private",
            "escrowTitle": "Private vendor",
            "milestoneId": "milestone-private",
            "milestoneTitle": "Private policy passed",
            "recipient": "private-recipient",
            "recipientEncoding": "sha256_text",
            "amount": "2",
            "asset": "USDC",
            "assetEncoding": "sha256_text",
            "decimals": 6,
            "execution": {
                "mode": "private",
                "privateEvaluationHash": evaluation,
                "settlementArtifactHash": hash(41)
            }
        })
    };
    let mut private_context = trusted();
    private_context.escrow_binding.policy_ciphertexts_hash = Some([40; 32]);
    let private_first = prepare_clearsign_v4_response(
        escrow_request(private_payload(&hash(42))),
        private_context.clone(),
    )
    .unwrap();
    let private_changed =
        prepare_clearsign_v4_response(escrow_request(private_payload(&hash(43))), private_context)
            .unwrap();
    assert_ne!(private_first.payload_hash, private_changed.payload_hash);
}

#[test]
fn derives_authoritative_send_document_and_canonical_bytes() {
    let (_, recipient) = pubkey(12);
    let response = prepare_clearsign_v4_response(request(&recipient, "0.3"), trusted()).unwrap();
    assert_eq!(response.version, 4);
    assert!(response.signable_text.contains("Send 0.3 SOL"));
    assert!(response.signable_text.contains(&recipient));
    assert!(response.signable_text.contains("2 signatures required"));
    let canonical = decode_bounded_hex(&response.canonical_intent_hex, "canonical").unwrap();
    let parsed = parse_intent(&canonical).unwrap();
    assert_eq!(parsed.common.proposal_index, 6);
    assert_eq!(
        parsed.payload_hash(),
        decode_hex_32(&response.payload_hash, "payload").unwrap()
    );
}

#[test]
fn recipient_amount_and_network_changes_change_or_reject_the_binding() {
    let (_, first) = pubkey(12);
    let (_, second) = pubkey(13);
    let first_response = prepare_clearsign_v4_response(request(&first, "0.3"), trusted()).unwrap();
    let second_response =
        prepare_clearsign_v4_response(request(&second, "0.3"), trusted()).unwrap();
    let amount_response = prepare_clearsign_v4_response(request(&first, "0.4"), trusted()).unwrap();
    assert_ne!(first_response.payload_hash, second_response.payload_hash);
    assert_ne!(first_response.envelope_hash, second_response.envelope_hash);
    assert_ne!(first_response.payload_hash, amount_response.payload_hash);

    let mut wrong_network = request(&first, "0.3");
    wrong_network.envelope.network = "Ethereum Sepolia".into();
    assert!(prepare_clearsign_v4_response(wrong_network, trusted()).is_err());
}

#[test]
fn sepolia_native_and_erc20_use_distinct_canonical_network_ids() {
    let (_, recipient) = pubkey(12);
    let mut native_request = request(&recipient, "0.3");
    native_request.envelope.network = "Ethereum Sepolia".into();
    native_request.envelope.payload = serde_json::json!({
        "recipient": "0x1111111111111111111111111111111111111111",
        "recipientEncoding": "sha256_text",
        "amount": "0.3",
        "asset": "ETH",
        "assetEncoding": "sha256_text"
    });
    let mut native_context = trusted();
    native_context.chain_kind = 1;
    let native = prepare_clearsign_v4_response(native_request, native_context).unwrap();

    let mut token_request = request(&recipient, "1.5");
    token_request.envelope.network = "Ethereum Sepolia".into();
    token_request.envelope.payload = serde_json::json!({
        "recipient": "0x1111111111111111111111111111111111111111",
        "recipientEncoding": "sha256_text",
        "amount": "1.5",
        "asset": "0x2222222222222222222222222222222222222222",
        "assetEncoding": "sha256_text",
        "decimals": 6,
        "displayAsset": "USDC"
    });
    let mut token_context = trusted();
    token_context.chain_kind = 4;
    let token = prepare_clearsign_v4_response(token_request, token_context).unwrap();

    let native_bytes = decode_bounded_hex(&native.canonical_intent_hex, "canonical").unwrap();
    let token_bytes = decode_bounded_hex(&token.canonical_intent_hex, "canonical").unwrap();
    assert_eq!(parse_intent(&native_bytes).unwrap().common.network as u8, 2);
    assert_eq!(parse_intent(&token_bytes).unwrap().common.network as u8, 8);
    assert_ne!(native.envelope_hash, token.envelope_hash);
    assert!(token.signable_text.contains("1.5 USDC"));
    assert!(token.signable_text.contains("Asset ID:"));
}

#[test]
fn every_supported_send_network_renders_bound_readable_details() {
    let cases = [
        (
            0,
            "Solana devnet",
            pubkey(12).1,
            "solana_pubkey",
            "SOL",
            None,
        ),
        (
            1,
            "Ethereum Sepolia",
            "0x1111111111111111111111111111111111111111".into(),
            "sha256_text",
            "ETH",
            None,
        ),
        (
            2,
            "Bitcoin testnet",
            "tb1qexampledestination000000000000000000000".into(),
            "sha256_text",
            "BTC",
            None,
        ),
        (
            2,
            "Bitcoin signet",
            "tb1qsignetdestination0000000000000000000000".into(),
            "sha256_text",
            "BTC",
            None,
        ),
        (
            2,
            "Bitcoin testnet4",
            "tb1qtestnet4destination00000000000000000000".into(),
            "sha256_text",
            "BTC",
            None,
        ),
        (
            3,
            "Zcash testnet",
            "tmExampleTransparentDestination1111111111111".into(),
            "sha256_text",
            "ZEC",
            None,
        ),
        (
            4,
            "Ethereum Sepolia",
            "0x2222222222222222222222222222222222222222".into(),
            "sha256_text",
            "0x3333333333333333333333333333333333333333",
            Some("USDC"),
        ),
        (
            5,
            "Hyperliquid testnet",
            "0x4444444444444444444444444444444444444444".into(),
            "sha256_text",
            "HYPE",
            None,
        ),
    ];

    for (chain_kind, network, recipient, recipient_encoding, asset, display_asset) in cases {
        let mut send = request(&recipient, "0.3");
        send.envelope.network = network.into();
        send.envelope.payload = serde_json::json!({
            "recipient": recipient,
            "recipientEncoding": recipient_encoding,
            "amount": "0.3",
            "asset": asset,
            "assetEncoding": if chain_kind == 0 { "text" } else { "sha256_text" },
            "displayAsset": display_asset,
            "note": "Cross-chain test"
        });
        let mut context = trusted();
        context.chain_kind = chain_kind;
        let response = prepare_clearsign_v4_response(send, context).unwrap();
        let shown_asset = display_asset.unwrap_or(asset);
        assert!(response
            .signable_text
            .contains(&format!("Send 0.3 {shown_asset}")));
        assert!(response.signable_text.contains(&format!("To: {recipient}")));
        assert!(response.signable_text.contains("Cross-chain test"));
        assert!(response.signable_text.contains("clearsig-intent-v4@1"));
    }
}

#[test]
fn batch_rows_and_governance_final_state_are_canonical() {
    let (_, first) = pubkey(12);
    let (_, second) = pubkey(13);
    let mut batch = request(&first, "0.3");
    batch.envelope.kind = "batch_send".into();
    batch.envelope.payload = serde_json::json!({
        "recipients": [
            {
                "recipient": first,
                "recipientEncoding": "solana_pubkey",
                "amount": "0.3",
                "asset": "SOL"
            },
            {
                "recipient": second,
                "recipientEncoding": "solana_pubkey",
                "amount": "0.7",
                "asset": "SOL"
            }
        ]
    });
    let batch = prepare_clearsign_v4_response(batch, trusted()).unwrap();
    assert!(batch.signable_text.contains("batch of 2 payments"));
    assert!(batch.signable_text.contains("Payment 1: 0.3 SOL"));
    assert!(batch.signable_text.contains("Payment 2: 0.7 SOL"));

    let (new_member, new_member_text) = pubkey(14);
    let (actor, actor_text) = pubkey(8);
    let policy_bytes = vec![3, 1, 2, 3];
    let mut governance = request(&first, "0.3");
    governance.envelope.kind = "add_member".into();
    governance.envelope.policy_commitment = Some(to_hex(&policy_commitment(&policy_bytes)));
    governance.policy_bytes_hex = Some(to_hex(&policy_bytes));
    governance.envelope.payload = serde_json::json!({
        "member": new_member_text,
        "role": "approver",
        "targetIntentIndex": 3,
        "proposers": [actor_text],
        "approvers": [bs58::encode(actor).into_string(), bs58::encode(new_member).into_string()],
        "approvalThreshold": 2,
        "cancellationThreshold": 1,
        "timelockSeconds": 900
    });
    let governance = prepare_clearsign_v4_response(governance, trusted()).unwrap();
    assert!(governance.signable_text.contains("Update member authority"));
    assert!(governance.signable_text.contains("Approval threshold: 2"));
    assert!(governance.signable_text.contains("Timelock seconds: 900"));
    assert!(governance.signable_text.contains("Final approvers:"));
}

#[test]
fn rejects_untrusted_actor_policy_wallet_and_threshold_context() {
    let (_, recipient) = pubkey(12);
    let (_, outsider) = pubkey(99);
    let mut wrong_actor = request(&recipient, "0.3");
    wrong_actor.actor_pubkey = outsider;
    assert!(prepare_clearsign_v4_response(wrong_actor, trusted()).is_err());

    let mut wrong_policy = request(&recipient, "0.3");
    wrong_policy.envelope.policy_commitment = Some("00".repeat(32));
    assert!(prepare_clearsign_v4_response(wrong_policy, trusted()).is_err());

    let mut wrong_wallet = request(&recipient, "0.3");
    wrong_wallet.envelope.wallet_id = Some(pubkey(55).1);
    assert!(prepare_clearsign_v4_response(wrong_wallet, trusted()).is_err());

    let mut invalid_threshold = trusted();
    invalid_threshold.approval_threshold = 0;
    assert!(prepare_clearsign_v4_response(request(&recipient, "0.3"), invalid_threshold).is_err());
}

#[test]
fn replay_expiry_and_reason_are_bound_and_injection_fails_closed() {
    let (_, recipient) = pubkey(12);
    let base = prepare_clearsign_v4_response(request(&recipient, "0.3"), trusted()).unwrap();
    let mut changed_nonce = request(&recipient, "0.3");
    changed_nonce.envelope.nonce = "send-nonce-2".into();
    let changed = prepare_clearsign_v4_response(changed_nonce, trusted()).unwrap();
    assert_ne!(base.envelope_hash, changed.envelope_hash);
    assert_ne!(base.canonical_intent_hash, changed.canonical_intent_hash);

    let mut expired = request(&recipient, "0.3");
    expired.envelope.expires_at = current_unix_timestamp().unwrap() - 1;
    assert!(prepare_clearsign_v4_response(expired, trusted()).is_err());

    let mut injected = request(&recipient, "0.3");
    injected.envelope.payload["note"] = Value::String("ok\nPOLICY\nAllowed".into());
    assert!(prepare_clearsign_v4_response(injected, trusted()).is_err());
}

#[test]
fn agent_authority_and_settlement_fields_are_canonical_and_mutation_sensitive() {
    let (_, recipient) = pubkey(12);
    let mut context = trusted();
    context.chain_kind = 5;

    let mut trade = request(&recipient, "0.3");
    trade.envelope.kind = "agent_trade_approval".into();
    trade.envelope.network = "Hyperliquid testnet".into();
    trade.envelope.payload = serde_json::json!({
        "agentId": "agent-42",
        "venue": "hyperliquid",
        "market": "BTC-USD",
        "side": "long",
        "assetId": "USDC:hyperliquid",
        "maxNotionalUsd": "1250.25",
        "maxLeverage": "2.5x",
        "sessionId": "session-7",
        "route": "hyperliquid:limit",
        "riskCheckHash": "11".repeat(32)
    });
    let first = prepare_clearsign_v4_response(trade, context.clone()).unwrap();
    assert!(first.signable_text.contains("Approve agent trade"));
    assert!(first
        .signable_text
        .contains("Maximum notional: 1250.25 USD"));

    let mut changed = request(&recipient, "0.3");
    changed.envelope.kind = "agent_trade_approval".into();
    changed.envelope.network = "Hyperliquid testnet".into();
    changed.envelope.payload = serde_json::json!({
        "agentId": "agent-42",
        "venue": "hyperliquid",
        "market": "BTC-USD",
        "side": "long",
        "assetId": "USDC:hyperliquid",
        "maxNotionalUsd": "1250.25",
        "maxLeverage": "2.5x",
        "sessionId": "session-7",
        "route": "hyperliquid:limit",
        "riskCheckHash": "22".repeat(32)
    });
    let changed = prepare_clearsign_v4_response(changed, context.clone()).unwrap();
    assert_ne!(first.payload_hash, changed.payload_hash);

    let mut session = request(&recipient, "0.3");
    session.envelope.kind = "agent_session_grant".into();
    session.envelope.network = "Hyperliquid testnet".into();
    session.envelope.payload = serde_json::json!({
        "sessionId": "session-7",
        "agentId": "agent-42",
        "venue": "hyperliquid",
        "market": "BTC-USD",
        "maxNotionalUsd": "1250.25",
        "maxLeverage": "2.5x",
        "expiresAt": current_unix_timestamp().unwrap() + 3600,
        "status": "active"
    });
    assert!(prepare_clearsign_v4_response(session, context.clone())
        .unwrap()
        .signable_text
        .contains("Grant agent session"));

    let mut risk = request(&recipient, "0.3");
    risk.envelope.kind = "agent_risk_policy".into();
    risk.envelope.network = "Hyperliquid testnet".into();
    risk.envelope.payload = serde_json::json!({
        "sessionId": "session-7",
        "oraclePolicyHash": "33".repeat(32),
        "maxLossRaw": "50000000",
        "status": "active"
    });
    assert!(prepare_clearsign_v4_response(risk, context.clone())
        .unwrap()
        .signable_text
        .contains("Set agent risk policy"));

    let mut settlement = request(&recipient, "0.3");
    settlement.envelope.kind = "agent_trade_settlement".into();
    settlement.envelope.network = "Hyperliquid testnet".into();
    settlement.envelope.payload = serde_json::json!({
        "sessionId": "session-7",
        "executionId": "execution-9",
        "settlementArtifactHash": "44".repeat(32),
        "oraclePolicyHash": "33".repeat(32),
        "closedNotionalRaw": "1250250000",
        "outcome": "profit",
        "pnlAbsRaw": "12500000",
        "settlementSequence": 8
    });
    assert!(prepare_clearsign_v4_response(settlement, context)
        .unwrap()
        .signable_text
        .contains("Settlement sequence: 8"));
}

#[test]
fn rejects_unknown_top_level_and_nested_payload_fields() {
    let (_, recipient) = pubkey(12);
    let mut top_level = request(&recipient, "0.3");
    top_level
        .envelope
        .payload
        .as_object_mut()
        .unwrap()
        .insert("transactionHex".into(), serde_json::json!("deadbeef"));
    let error = prepare_clearsign_v4_response(top_level, trusted()).unwrap_err();
    assert!(error
        .to_string()
        .contains("payload contains unsupported field transactionHex"));

    let mut batch = request(&recipient, "0.3");
    batch.envelope.kind = "batch_send".into();
    batch.envelope.payload = serde_json::json!({
        "recipients": [{
            "recipient": recipient,
            "recipientEncoding": "solana_pubkey",
            "amount": "0.3",
            "asset": "SOL",
            "displayOverride": "Send 0.1 SOL"
        }]
    });
    let error = prepare_clearsign_v4_response(batch, trusted()).unwrap_err();
    assert!(error
        .to_string()
        .contains("payload row 0 contains unsupported field displayOverride"));
}

#[test]
fn fiat_estimates_are_fresh_informational_and_non_authoritative() {
    let (_, recipient) = pubkey(12);
    let now = current_unix_timestamp().unwrap();
    let mut quoted = request(&recipient, "0.3");
    quoted.envelope.payload.as_object_mut().unwrap().insert(
        "fiatEstimate".into(),
        serde_json::json!({
            "amount": "23.18",
            "currency": "USD",
            "source": "coingecko-api",
            "observedAt": now,
            "informationalOnly": true
        }),
    );
    let quoted_response = prepare_clearsign_v4_response(quoted, trusted()).unwrap();
    let plain_response =
        prepare_clearsign_v4_response(request(&recipient, "0.3"), trusted()).unwrap();
    assert_eq!(quoted_response.payload_hash, plain_response.payload_hash);
    assert_ne!(
        quoted_response.canonical_intent_hash,
        plain_response.canonical_intent_hash
    );
    assert!(quoted_response
        .signable_text
        .contains("Estimated at review: 23.18 USD (informational)"));

    let mut stale = request(&recipient, "0.3");
    stale.envelope.payload.as_object_mut().unwrap().insert(
        "fiatEstimate".into(),
        serde_json::json!({
            "amount": "23.18",
            "currency": "USD",
            "source": "coingecko-api",
            "observedAt": now - MAX_FIAT_ESTIMATE_AGE_SECONDS - 1,
            "informationalOnly": true
        }),
    );
    assert!(prepare_clearsign_v4_response(stale, trusted()).is_err());
}
