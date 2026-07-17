#[allow(clippy::too_many_arguments)]
fn propose_typed_agent_session(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &ed25519_dalek::SigningKey,
    policy_commitment: [u8; 32],
    session_id: &[u8],
    agent_id: &[u8],
    venue: &[u8],
    market: &[u8],
    max_notional_raw: u128,
    max_leverage_x100: u32,
    session_expires_at: i64,
    status: u8,
) -> (Pubkey, [u8; 32]) {
    let action_id = sha256_hash(&[b"session-action".as_slice(), &[status]].concat());
    let nonce = sha256_hash(&proposal_index.to_le_bytes());
    let expiry = typed_test_expiry();
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_agent_session(
        &V4AgentSessionInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network: V4Network::SolanaDevnet,
                proposal_index,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(proposer),
                action_id,
                nonce,
                expires_at: expiry,
                policy_commitment,
                approval_required: 1,
            },
            session_id,
            agent_id,
            venue,
            market,
            max_notional_raw,
            max_leverage_x100,
            session_expires_at,
            status,
            reason: b"Program agent session test",
        },
        &mut canonical,
    )
    .expect("agent session should encode as canonical v4 intent");
    let (proposal, _, envelope_hash) = submit_typed_v4_proposal(
        svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        proposer,
        &[],
        &canonical[..canonical_len],
        1,
    );
    (proposal, envelope_hash)
}

#[allow(clippy::too_many_arguments)]
fn propose_typed_agent_risk_policy(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &ed25519_dalek::SigningKey,
    policy_commitment: [u8; 32],
    session_id: &[u8],
    oracle_policy_hash: [u8; 32],
    max_loss_raw: u128,
    status: u8,
) -> (Pubkey, [u8; 32]) {
    let action_id = sha256_hash(
        &[
            b"agent-risk-action:".as_slice(),
            &proposal_index.to_le_bytes(),
        ]
        .concat(),
    );
    let nonce = sha256_hash(
        &[
            b"agent-risk-nonce:".as_slice(),
            &proposal_index.to_le_bytes(),
        ]
        .concat(),
    );
    let expiry = typed_test_expiry();
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_agent_risk_policy(
        &V4AgentRiskPolicyInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network: V4Network::SolanaDevnet,
                proposal_index,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(proposer),
                action_id,
                nonce,
                expires_at: expiry,
                policy_commitment,
                approval_required: 1,
            },
            session_id,
            oracle_policy_hash,
            max_loss_raw,
            status,
            reason: b"Program agent risk test",
        },
        &mut canonical,
    )
    .expect("agent risk policy should encode as canonical v4 intent");
    let (proposal, _, envelope_hash) = submit_typed_v4_proposal(
        svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        proposer,
        &[],
        &canonical[..canonical_len],
        1,
    );
    (proposal, envelope_hash)
}

#[allow(clippy::too_many_arguments)]
fn propose_typed_agent_settlement(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &ed25519_dalek::SigningKey,
    policy_commitment: [u8; 32],
    session_id: &[u8],
    execution_id: &[u8],
    settlement_artifact_hash: [u8; 32],
    oracle_policy_hash: [u8; 32],
    closed_notional_raw: u128,
    outcome: u8,
    pnl_abs_raw: u128,
    settlement_sequence: u64,
) -> (Pubkey, [u8; 32]) {
    let action_id = sha256_hash(
        &[
            b"agent-settlement-action:".as_slice(),
            &proposal_index.to_le_bytes(),
        ]
        .concat(),
    );
    let nonce = sha256_hash(
        &[
            b"agent-settlement-nonce:".as_slice(),
            &proposal_index.to_le_bytes(),
        ]
        .concat(),
    );
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_agent_settlement(
        &V4AgentSettlementInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network: V4Network::SolanaDevnet,
                proposal_index,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(proposer),
                action_id,
                nonce,
                expires_at: typed_test_expiry(),
                policy_commitment,
                approval_required: 1,
            },
            session_id,
            execution_id,
            settlement_artifact_hash,
            oracle_policy_hash,
            closed_notional_raw,
            outcome,
            pnl_abs_raw,
            settlement_sequence,
            reason: b"Program agent settlement test",
        },
        &mut canonical,
    )
    .expect("agent settlement should encode as canonical v4 intent");
    let (proposal, _, envelope_hash) = submit_typed_v4_proposal(
        svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        proposer,
        &[],
        &canonical[..canonical_len],
        1,
    );
    (proposal, envelope_hash)
}

#[allow(clippy::too_many_arguments)]
fn propose_typed_wallet_policy_update_on_wallet(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &ed25519_dalek::SigningKey,
    current_policy_commitment: [u8; 32],
    chain_kind: u8,
    new_policy_bytes: &[u8],
) -> (Pubkey, [u8; 32]) {
    let action_id = sha256_hash(
        &[
            wallet_name.as_bytes(),
            b":policy-update:",
            &proposal_index.to_le_bytes(),
        ]
        .concat(),
    );
    let nonce = sha256_hash(
        &[
            wallet_name.as_bytes(),
            b":policy-update-nonce:",
            &proposal_index.to_le_bytes(),
        ]
        .concat(),
    );
    let expiry = typed_test_expiry();
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_policy_update(
        &V4PolicyUpdateInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network: V4Network::SolanaDevnet,
                proposal_index,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(proposer),
                action_id,
                nonce,
                expires_at: expiry,
                policy_commitment: current_policy_commitment,
                approval_required: 1,
            },
            chain_kind,
            new_policy_commitment: v4_wallet_policy_commitment(new_policy_bytes),
            reason: b"Program wallet policy update test",
        },
        &mut canonical,
    )
    .expect("wallet policy update should encode as canonical v4 intent");
    let (proposal, _, envelope_hash) = submit_typed_v4_proposal(
        svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        proposer,
        new_policy_bytes,
        &canonical[..canonical_len],
        1,
    );

    (proposal, envelope_hash)
}

fn propose_typed_sol_batch_with_policy(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    proposer: &ed25519_dalek::SigningKey,
    payments: &[(Pubkey, u64)],
    policy_bytes: &[u8],
) -> (Pubkey, Pubkey, Pubkey, [u8; 32], [u8; 32]) {
    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(proposer)],
        &[pubkey_of(proposer)],
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
    let action_id = sha256_hash(&[wallet_name.as_bytes(), b":batch"].concat());
    let nonce = sha256_hash(&[wallet_name.as_bytes(), b":nonce"].concat());
    let expiry = typed_test_expiry();
    let policy_commitment = v4_policy_commitment(policy_bytes);
    let rows: Vec<_> = payments
        .iter()
        .map(|(recipient, amount)| V4TransferRowInput {
            recipient_encoding: V4IdentityEncoding::SolanaPubkey,
            recipient: recipient.as_ref(),
            asset_encoding: V4IdentityEncoding::Text,
            asset: b"SOL",
            raw_amount: *amount as u128,
            decimals: 9,
            display_asset: b"SOL",
        })
        .collect();
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_batch_transfer(
        &V4BatchTransferInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network: V4Network::SolanaDevnet,
                proposal_index,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(proposer),
                action_id,
                nonce,
                expires_at: expiry,
                policy_commitment,
                approval_required: 1,
            },
            rows: &rows,
            reason: b"Program batch execution test",
        },
        &mut canonical,
    )
    .expect("SOL batch should encode as canonical v4 intent");
    let (proposal, policy_commitment, envelope_hash) = submit_typed_v4_proposal(
        svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        proposer,
        policy_bytes,
        &canonical[..canonical_len],
        1,
    );
    (wallet, intent, proposal, policy_commitment, envelope_hash)
}
