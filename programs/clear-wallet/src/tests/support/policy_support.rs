fn build_cleanup_typed_ix(proposal: Pubkey, rent_refund: Pubkey) -> Instruction {
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(proposal, false),
            AccountMeta::new(rent_refund, false),
        ],
        data: vec![16u8],
    }
}

fn fund_vault(svm: &mut QuasarSvm, payer: Pubkey, wallet: Pubkey, amount: u64) -> Pubkey {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let fund_vault_ix = solana_instruction::Instruction {
        program_id: quasar_svm::system_program::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(vault, false),
        ],
        data: {
            let mut d = vec![2, 0, 0, 0]; // System Transfer discriminator
            d.extend_from_slice(&amount.to_le_bytes());
            d
        },
    };
    let result = svm.process_instruction(
        &fund_vault_ix,
        &[funded_account(payer), empty_account(vault)],
    );
    assert!(result.is_ok(), "fund vault failed: {:?}", result.raw_result);
    vault
}

fn sign_typed_vote(
    key: &ed25519_dalek::SigningKey,
    vote_kind: ClearSignVoteKind,
    wallet_name: &str,
    proposal_index: u64,
    envelope_hash: [u8; 32],
) -> [u8; 64] {
    sign_typed_vote_with_approval(
        key,
        vote_kind,
        wallet_name,
        proposal_index,
        envelope_hash,
        1,
        1,
    )
}

fn sign_typed_vote_with_approval(
    key: &ed25519_dalek::SigningKey,
    vote_kind: ClearSignVoteKind,
    wallet_name: &str,
    proposal_index: u64,
    envelope_hash: [u8; 32],
    approvals_required: u8,
    approvals_after: u8,
) -> [u8; 64] {
    sign_typed_vote_for_text(
        key,
        vote_kind,
        wallet_name,
        proposal_index,
        envelope_hash,
        approvals_required,
        approvals_after,
        TEST_CLEAR_TEXT,
    )
}

#[allow(clippy::too_many_arguments)]
fn sign_typed_vote_for_text(
    key: &ed25519_dalek::SigningKey,
    vote_kind: ClearSignVoteKind,
    wallet_name: &str,
    proposal_index: u64,
    envelope_hash: [u8; 32],
    approvals_required: u8,
    approvals_after: u8,
    clear_text: &[u8],
) -> [u8; 64] {
    let mut message = [0u8; MAX_CLEARSIGN_VOTE_MESSAGE_BYTES];
    let message_len = write_vote_message_for_clear_text(
        &mut message,
        vote_kind,
        wallet_name.as_bytes(),
        &key.verifying_key().to_bytes(),
        proposal_index,
        envelope_hash,
        typed_test_expiry(),
        approvals_required,
        approvals_after,
        clear_text,
    )
    .expect("test ClearSign vote message should be valid");
    let signature = key.sign(&message[..message_len]).to_bytes();
    brine_ed25519::sig_verify(
        &key.verifying_key().to_bytes(),
        &signature,
        &message[..message_len],
    )
    .expect("test ClearSign signature should verify locally");
    signature
}

const TEST_CLEAR_TEXT: &[u8] = b"ClearSig Proposal\n\nACTION\nSend 1 SOL\n\nDETAILS\nFrom wallet: test wallet\nNetwork: Solana devnet\nAmount: 1 SOL\nTo: test recipient\nPayload: test\n\nPOLICY\nApproval: Wallet's onchain threshold must be met\nExecution: Onchain policy and timelock must pass\nCommitment: test\nEnforcement: Exact payload and policy must match onchain\nDisplay profile: clearsig-full-v1@1\n\nRISK\nCategory: Funds movement\nSigner check: Verify amount, asset, network, and every destination\n\nPURPOSE\nProgram test";

fn typed_sol_policy_bytes(
    mode: u8,
    max_amount_lamports: u64,
    extra_cooldown_seconds: u32,
    recipients: &[Pubkey],
    required_approvers: &[Pubkey],
) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"CSP1");
    out.push(mode);
    out.extend_from_slice(&max_amount_lamports.to_le_bytes());
    out.extend_from_slice(&extra_cooldown_seconds.to_le_bytes());
    out.push(recipients.len() as u8);
    out.push(required_approvers.len() as u8);
    for recipient in recipients {
        out.extend_from_slice(recipient.as_ref());
    }
    for approver in required_approvers {
        out.extend_from_slice(approver.as_ref());
    }
    out
}

fn typed_sol_policy_bytes_with_velocity(
    mode: u8,
    max_amount_lamports: u64,
    extra_cooldown_seconds: u32,
    recipients: &[Pubkey],
    required_approvers: &[Pubkey],
    velocity_cap_lamports: u64,
    velocity_window_seconds: u32,
) -> Vec<u8> {
    let mut out = typed_sol_policy_bytes(
        mode,
        max_amount_lamports,
        extra_cooldown_seconds,
        recipients,
        required_approvers,
    );
    out.push(1);
    out.extend_from_slice(&12u16.to_le_bytes());
    out.extend_from_slice(&velocity_cap_lamports.to_le_bytes());
    out.extend_from_slice(&velocity_window_seconds.to_le_bytes());
    out
}

fn typed_sol_policy_bytes_with_send_count(
    max_send_count: u32,
    count_window_seconds: u32,
) -> Vec<u8> {
    let mut out = typed_sol_policy_bytes(0, 0, 0, &[], &[]);
    out.push(2);
    out.extend_from_slice(&8u16.to_le_bytes());
    out.extend_from_slice(&max_send_count.to_le_bytes());
    out.extend_from_slice(&count_window_seconds.to_le_bytes());
    out
}

fn append_send_count_extension(
    mut policy: Vec<u8>,
    max_send_count: u32,
    count_window_seconds: u32,
) -> Vec<u8> {
    policy.push(2);
    policy.extend_from_slice(&8u16.to_le_bytes());
    policy.extend_from_slice(&max_send_count.to_le_bytes());
    policy.extend_from_slice(&count_window_seconds.to_le_bytes());
    policy
}

fn append_allowed_time_extension(
    mut policy: Vec<u8>,
    start_hour: u8,
    end_hour: u8,
    days_mask: u8,
    utc_offset_minutes: i16,
) -> Vec<u8> {
    policy.push(3);
    policy.extend_from_slice(&5u16.to_le_bytes());
    policy.push(start_hour);
    policy.push(end_hour);
    policy.push(days_mask);
    policy.extend_from_slice(&utc_offset_minutes.to_le_bytes());
    policy
}

fn append_member_allowance_extension(mut policy: Vec<u8>, rows: &[(Pubkey, u64, u32)]) -> Vec<u8> {
    policy.push(4);
    policy.extend_from_slice(&((rows.len() * 44) as u16).to_le_bytes());
    for (member, cap_lamports, window_seconds) in rows {
        policy.extend_from_slice(member.as_ref());
        policy.extend_from_slice(&cap_lamports.to_le_bytes());
        policy.extend_from_slice(&window_seconds.to_le_bytes());
    }
    policy
}

fn append_advanced_rules_extension(mut policy: Vec<u8>, rules: &[u8]) -> Vec<u8> {
    policy.push(5);
    policy.extend_from_slice(&(rules.len() as u16).to_le_bytes());
    policy.extend_from_slice(rules);
    policy
}

fn advanced_recipient_rule(action: u8, recipient: [u8; 32]) -> Vec<u8> {
    let mut rule = vec![action, 1, 0];
    rule.extend_from_slice(&0u32.to_le_bytes());
    rule.push(1);
    rule.extend_from_slice(&34u16.to_le_bytes());
    rule.push(1);
    rule.push(1);
    rule.extend_from_slice(&recipient);
    rule
}

fn advanced_unconditional_rule(action: u8) -> Vec<u8> {
    let mut rule = vec![action, 0, 0];
    rule.extend_from_slice(&0u32.to_le_bytes());
    rule
}

fn advanced_required_approver_rule(approver: Pubkey) -> Vec<u8> {
    let mut rule = vec![2, 0, 1];
    rule.extend_from_slice(&0u32.to_le_bytes());
    rule.extend_from_slice(approver.as_ref());
    rule
}

fn advanced_cooldown_rule(seconds: u32) -> Vec<u8> {
    let mut rule = vec![3, 0, 0];
    rule.extend_from_slice(&seconds.to_le_bytes());
    rule
}

fn typed_hash_policy_bytes(
    mode: u8,
    max_amount_raw: u64,
    extra_cooldown_seconds: u32,
    recipients: &[[u8; 32]],
    required_approvers: &[Pubkey],
) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"CSP1");
    out.push(mode);
    out.extend_from_slice(&max_amount_raw.to_le_bytes());
    out.extend_from_slice(&extra_cooldown_seconds.to_le_bytes());
    out.push(recipients.len() as u8);
    out.push(required_approvers.len() as u8);
    for recipient in recipients {
        out.extend_from_slice(recipient);
    }
    for approver in required_approvers {
        out.extend_from_slice(approver.as_ref());
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn propose_typed_sol_send_with_policy(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    proposer: &ed25519_dalek::SigningKey,
    approvers: &[Pubkey],
    threshold: u8,
    recipient: Pubkey,
    amount_lamports: u64,
    policy_bytes: &[u8],
) -> (Pubkey, Pubkey, Pubkey, [u8; 32], [u8; 32]) {
    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(proposer)],
        approvers,
        threshold,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (proposal, policy_commitment, envelope_hash) =
        propose_typed_sol_send_on_wallet_with_approval(
            svm,
            payer,
            wallet_name,
            wallet,
            intent,
            0,
            proposer,
            recipient,
            amount_lamports,
            policy_bytes,
            threshold,
        );

    (wallet, intent, proposal, policy_commitment, envelope_hash)
}

#[allow(clippy::too_many_arguments)]
fn propose_typed_sol_send_on_wallet(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &ed25519_dalek::SigningKey,
    recipient: Pubkey,
    amount_lamports: u64,
    policy_bytes: &[u8],
) -> (Pubkey, [u8; 32], [u8; 32]) {
    propose_typed_sol_send_on_wallet_with_approval(
        svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        proposer,
        recipient,
        amount_lamports,
        policy_bytes,
        1,
    )
}

#[allow(clippy::too_many_arguments)]
fn propose_typed_sol_send_on_wallet_with_approval(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &ed25519_dalek::SigningKey,
    recipient: Pubkey,
    amount_lamports: u64,
    policy_bytes: &[u8],
    approval_required: u8,
) -> (Pubkey, [u8; 32], [u8; 32]) {
    let action_id = sha256_hash(
        &[
            wallet_name.as_bytes(),
            b":sol-send:",
            &proposal_index.to_le_bytes(),
        ]
        .concat(),
    );
    let nonce = sha256_hash(
        &[
            wallet_name.as_bytes(),
            b":nonce:",
            &proposal_index.to_le_bytes(),
        ]
        .concat(),
    );
    let expiry = typed_test_expiry();
    let policy_commitment = v4_policy_commitment(policy_bytes);
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_transfer(
        &V4TransferInput {
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
                approval_required,
            },
            recipient_encoding: V4IdentityEncoding::SolanaPubkey,
            recipient: recipient.as_ref(),
            asset_encoding: V4IdentityEncoding::Text,
            asset: b"SOL",
            raw_amount: amount_lamports as u128,
            decimals: 9,
            display_asset: b"SOL",
            execution_commitment: [0u8; 32],
            fiat_estimate: None,
            reason: b"Program execution test",
        },
        &mut canonical,
    )
    .expect("SOL send should encode as canonical v4 intent");
    submit_typed_v4_proposal(
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
    )
}

#[allow(clippy::too_many_arguments)]
fn propose_typed_remote_send_on_wallet(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &ed25519_dalek::SigningKey,
    chain_kind: u8,
    amount_raw: u128,
    recipient_text: &[u8],
    asset_text: &[u8],
    tx_template_hash: [u8; 32],
    policy_bytes: &[u8],
) -> (Pubkey, [u8; 32], [u8; 32]) {
    let action_id = sha256_hash(
        &[
            wallet_name.as_bytes(),
            b":remote:",
            &proposal_index.to_le_bytes(),
        ]
        .concat(),
    );
    let nonce = sha256_hash(
        &[
            wallet_name.as_bytes(),
            b":remote-nonce:",
            &proposal_index.to_le_bytes(),
        ]
        .concat(),
    );
    let expiry = typed_test_expiry();
    let policy_commitment = v4_policy_commitment(policy_bytes);
    let (network, display_asset, decimals) = match chain_kind {
        1 => (V4Network::EthereumSepolia, b"ETH".as_slice(), 18),
        2 => (V4Network::BitcoinTestnet, b"BTC".as_slice(), 8),
        3 => (V4Network::ZcashTestnet, b"ZEC".as_slice(), 8),
        4 => (V4Network::EthereumSepoliaErc20, b"USDC".as_slice(), 6),
        5 => (V4Network::HyperliquidTestnet, b"HYPE".as_slice(), 18),
        _ => panic!("unsupported remote chain kind in test fixture"),
    };
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_transfer(
        &V4TransferInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network,
                proposal_index,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(proposer),
                action_id,
                nonce,
                expires_at: expiry,
                policy_commitment,
                approval_required: 1,
            },
            recipient_encoding: V4IdentityEncoding::Sha256Text,
            recipient: recipient_text,
            asset_encoding: V4IdentityEncoding::Sha256Text,
            asset: asset_text,
            raw_amount: amount_raw,
            decimals,
            display_asset,
            execution_commitment: tx_template_hash,
            fiat_estimate: None,
            reason: b"Remote policy execution test",
        },
        &mut canonical,
    )
    .expect("remote send should encode as canonical v4 intent");
    submit_typed_v4_proposal(
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
    )
}

#[allow(clippy::too_many_arguments)]
fn execute_typed_remote_send_with_policy(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &ed25519_dalek::SigningKey,
    ika_config: Pubkey,
    dwallet: Pubkey,
    chain_kind: u8,
    amount_raw: u128,
    recipient_text: &[u8],
    asset_text: &[u8],
    tx_template_hash: [u8; 32],
    policy_bytes: &[u8],
) -> bool {
    let recipient_hash = sha256_hash(recipient_text);
    let asset_id_hash = sha256_hash(asset_text);
    let (proposal, policy_commitment, envelope_hash) = propose_typed_remote_send_on_wallet(
        svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        proposer,
        chain_kind,
        amount_raw,
        recipient_text,
        asset_text,
        tx_template_hash,
        policy_bytes,
    );

    let execute = build_execute_typed_chain_send_ix(
        payer,
        wallet,
        intent,
        proposal,
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
    svm.process_instruction(&execute, &[funded_account(payer)])
        .is_ok()
}
