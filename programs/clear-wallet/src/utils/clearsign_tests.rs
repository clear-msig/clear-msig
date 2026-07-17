use alloc::vec::Vec;

use super::*;

const V3_SEND_DOCUMENT: &[u8] = b"ClearSig Proposal\n\nACTION\nSend 2.5 SOL from Team to Sarah\n\nDETAILS\nFrom wallet: Team\nNetwork: Solana devnet\nAmount: 2.5 SOL\nTo: Sarah\nPayload: 222222222222...222222222222\n\nPOLICY\nApproval: Wallet's onchain threshold must be met\nExecution: Onchain policy and timelock must pass\nCommitment: 111111111111...111111111111\nEnforcement: Exact payload and policy must match onchain\nDisplay profile: clearsig-full-v1@1\n\nRISK\nCategory: Funds movement\nSigner check: Verify amount, asset, network, and every destination\n\nPURPOSE\nPayroll";

fn amount(asset: &'static [u8], raw_amount: u128) -> ClearSignAmount<'static> {
    ClearSignAmount { asset, raw_amount }
}

fn id32(label: &[u8]) -> [u8; 32] {
    let mut hasher = sha2::Sha256::new();
    hasher.update(label);
    finish_hash(hasher)
}

fn replace_once(source: &[u8], needle: &[u8], replacement: &[u8]) -> Vec<u8> {
    let offset = find_bytes(source, needle).expect("test fixture contains marker");
    source[..offset]
        .iter()
        .copied()
        .chain(replacement.iter().copied())
        .chain(source[offset + needle.len()..].iter().copied())
        .collect()
}

fn test_envelope<'a>(
    action_id: &'a [u8],
    nonce: &'a [u8],
    payload_hash: [u8; 32],
) -> ClearSignEnvelope<'a> {
    ClearSignEnvelope {
        kind: ClearSignActionKind::Send,
        wallet_name: b"Team",
        wallet_id: b"Team#abc",
        action_id,
        nonce,
        expires_at: 1_800_000_000,
        policy_commitment: hash_policy_commitment(&[b"threshold:2", b"members:alice,bob"]),
        payload_hash,
        clear_text_hash: hash_clear_text(b"Send 2.5 SOL to Sarah").unwrap(),
    }
}

#[test]
fn action_codes_are_stable() {
    assert_eq!(ClearSignActionKind::Send.code(), 1);
    assert_eq!(ClearSignActionKind::ReturnEscrowFunds.code(), 8);
    assert_eq!(ClearSignActionKind::SwapIntent.code(), 11);
    assert_eq!(ClearSignActionKind::AgentRiskPolicy.code(), 13);
    assert_eq!(ClearSignActionKind::AgentTradeSettlement.code(), 14);
    assert_eq!(
        ClearSignActionKind::from_code(9),
        Some(ClearSignActionKind::AgentTradeApproval)
    );
    assert_eq!(ClearSignActionKind::from_code(99), None);
}

#[test]
fn v3_document_validation_is_strict_and_ordered() {
    assert_eq!(validate_v3_document(V3_SEND_DOCUMENT), Ok(()));
    assert_eq!(
        validate_v3_document(b"ClearSign v2 propose\nWallet Team"),
        Err(ClearSignError::InvalidVoteMessage)
    );

    let reordered = V3_SEND_DOCUMENT
        .windows(b"\n\nPOLICY\n".len())
        .position(|window| window == b"\n\nPOLICY\n")
        .unwrap();
    let mut malformed = V3_SEND_DOCUMENT.to_vec();
    malformed.splice(
        reordered..reordered + b"\n\nPOLICY\n".len(),
        b"\n\nPURPOSE\n".iter().copied(),
    );
    assert_eq!(
        validate_v3_document(&malformed),
        Err(ClearSignError::InvalidVoteMessage)
    );

    let injected = V3_SEND_DOCUMENT
        .iter()
        .copied()
        .chain(b"\n\nPROOF\nNot allowed".iter().copied())
        .collect::<Vec<_>>();
    assert_eq!(
        validate_v3_document(&injected),
        Err(ClearSignError::InvalidVoteMessage)
    );

    let control_character = V3_SEND_DOCUMENT
        .iter()
        .copied()
        .chain([b'\t'])
        .collect::<Vec<_>>();
    assert_eq!(
        validate_v3_document(&control_character),
        Err(ClearSignError::InvalidVoteMessage)
    );

    let missing_profile = V3_SEND_DOCUMENT
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.starts_with(b"Display profile:"))
        .collect::<Vec<_>>()
        .join(&b'\n');
    assert_eq!(
        validate_v3_document(&missing_profile),
        Err(ClearSignError::InvalidVoteMessage)
    );

    let unknown_profile = replace_once(
        V3_SEND_DOCUMENT,
        CLEARSIGN_V3_FULL_PROFILE,
        b"Display profile: browser-custom-v9@1",
    );
    assert_eq!(
        validate_v3_document(&unknown_profile),
        Err(ClearSignError::InvalidVoteMessage)
    );

    let duplicate_profile = replace_once(
        V3_SEND_DOCUMENT,
        CLEARSIGN_V3_FULL_PROFILE,
        b"Display profile: clearsig-full-v1@1\nDisplay profile: clearsig-ledger-solana-v1@1",
    );
    assert_eq!(
        validate_v3_document(&duplicate_profile),
        Err(ClearSignError::InvalidVoteMessage)
    );

    let mut oversized_compact = replace_once(
        V3_SEND_DOCUMENT,
        CLEARSIGN_V3_FULL_PROFILE,
        CLEARSIGN_V3_LEDGER_PROFILE,
    );
    oversized_compact.extend(core::iter::repeat(b'x').take(700));
    assert!(oversized_compact.len() > MAX_CLEARSIGN_LEDGER_DOCUMENT_BYTES);
    assert_eq!(
        validate_v3_document(&oversized_compact),
        Err(ClearSignError::InvalidVoteMessage)
    );
}

#[test]
fn v3_vote_message_round_trips_and_binds_expiry() {
    let envelope_hash = [0xabu8; 32];
    let mut message = [0u8; MAX_CLEARSIGN_VOTE_MESSAGE_BYTES];
    let len = write_vote_message_for_clear_text(
        &mut message,
        ClearSignVoteKind::Approve,
        b"Team",
        &[1u8; 32],
        7,
        envelope_hash,
        1_800_000_000,
        2,
        1,
        V3_SEND_DOCUMENT,
    )
    .unwrap();

    assert_eq!(
        extract_clear_text_from_vote_message(
            ClearSignVoteKind::Approve,
            b"Team",
            &[1u8; 32],
            7,
            envelope_hash,
            1_800_000_000,
            2,
            1,
            &message[..len],
        ),
        Ok(V3_SEND_DOCUMENT)
    );
    assert_eq!(
        extract_clear_text_from_vote_message(
            ClearSignVoteKind::Approve,
            b"Team",
            &[1u8; 32],
            7,
            envelope_hash,
            1_800_000_001,
            2,
            1,
            &message[..len],
        ),
        Err(ClearSignError::InvalidVoteMessage)
    );
}

#[test]
fn legacy_v2_vote_messages_remain_verifiable_for_existing_proposals() {
    let envelope_hash = [0x11u8; 32];
    let clear_text = b"Send 2.5 SOL to Sarah";
    let mut message = [0u8; MAX_CLEARSIGN_VOTE_MESSAGE_BYTES];
    let len = write_vote_message(
        &mut message,
        ClearSignVoteKind::Approve,
        b"Team",
        3,
        envelope_hash,
        clear_text,
    )
    .unwrap();

    assert_eq!(
        extract_clear_text_from_vote_message(
            ClearSignVoteKind::Approve,
            b"Team",
            &[1u8; 32],
            3,
            envelope_hash,
            1_800_000_000,
            1,
            1,
            &message[..len],
        ),
        Ok(clear_text.as_slice())
    );
}

#[test]
fn intent_governance_payload_binds_final_membership() {
    let alice = [1u8; 32];
    let bob = [2u8; 32];
    let h1 = hash_intent_governance_payload(
        ClearSignActionKind::AddMember,
        3,
        2,
        1,
        0,
        &[alice, bob],
        &[alice, bob],
    );
    let h2 = hash_intent_governance_payload(
        ClearSignActionKind::AddMember,
        3,
        2,
        1,
        0,
        &[alice, bob],
        &[alice, bob],
    );
    let h3 = hash_intent_governance_payload(
        ClearSignActionKind::RemoveMember,
        3,
        2,
        1,
        0,
        &[alice, bob],
        &[alice, bob],
    );
    let h4 = hash_intent_governance_payload(
        ClearSignActionKind::AddMember,
        3,
        1,
        1,
        0,
        &[alice, bob],
        &[alice, bob],
    );
    assert_eq!(h1, h2);
    assert_ne!(h1, h3);
    assert_ne!(h1, h4);
}

#[test]
fn clear_headlines_stay_human() {
    assert_eq!(ClearSignActionKind::Send.clear_headline(), "Send funds");
    assert_eq!(
        ClearSignActionKind::ReturnEscrowFunds.clear_headline(),
        "Return escrow funds"
    );
}

#[test]
fn replay_fields_are_required_and_bounded() {
    let payload = hash_send_payload(b"Sarah", &amount(b"SOL", 2_500_000_000));
    assert_eq!(
        test_envelope(&id32(b"action-1"), &id32(b"nonce-1"), payload)
            .validate_replay_fields(1_799_999_000),
        Ok(())
    );
    assert_eq!(
        test_envelope(b"", b"nonce-1", payload).validate_replay_fields(1_799_999_000),
        Err(ClearSignError::MissingActionId)
    );
    assert_eq!(
        test_envelope(&id32(b"action-1"), b"", payload).validate_replay_fields(1_799_999_000),
        Err(ClearSignError::MissingNonce)
    );
    assert_eq!(
        test_envelope(&id32(b"action-1"), &id32(b"nonce-1"), payload)
            .validate_replay_fields(1_800_000_000),
        Err(ClearSignError::Expired)
    );
    assert_eq!(
        test_envelope(&id32(b"action-1"), &id32(b"nonce-1"), payload).validate_replay_fields(1),
        Err(ClearSignError::ExpiryTooFar)
    );
}

#[test]
fn envelope_hash_binds_replay_and_payload() {
    let send_payload = hash_send_payload(b"Sarah", &amount(b"SOL", 2_500_000_000));
    let changed_payload = hash_send_payload(b"Sarah", &amount(b"SOL", 2_400_000_000));
    let base = hash_envelope(&test_envelope(
        &id32(b"action-1"),
        &id32(b"nonce-1"),
        send_payload,
    ));
    assert_ne!(
        base,
        hash_envelope(&test_envelope(
            &id32(b"action-1"),
            &id32(b"nonce-2"),
            send_payload
        ))
    );
    assert_ne!(
        base,
        hash_envelope(&test_envelope(
            &id32(b"action-1"),
            &id32(b"nonce-1"),
            changed_payload
        ))
    );
}

#[test]
fn escrow_return_hash_binds_each_funder_return() {
    let returns = [
        ClearSignRecipientAmount {
            recipient: b"Alice",
            amount: amount(b"SOL", 4_500_000_000),
        },
        ClearSignRecipientAmount {
            recipient: b"Bob",
            amount: amount(b"SOL", 3_000_000_000),
        },
    ];
    let changed = [
        ClearSignRecipientAmount {
            recipient: b"Alice",
            amount: amount(b"SOL", 4_000_000_000),
        },
        ClearSignRecipientAmount {
            recipient: b"Bob",
            amount: amount(b"SOL", 3_500_000_000),
        },
    ];
    assert_ne!(
        hash_return_escrow_funds_payload(b"escrow-1", &returns),
        hash_return_escrow_funds_payload(b"escrow-1", &changed)
    );
    assert_ne!(
        hash_return_escrow_funds_payload(b"escrow-1", &returns),
        hash_return_escrow_funds_payload(b"escrow-2", &returns)
    );
    assert_eq!(
        hash_return_escrow_funds_payload(b"escrow-1", &returns),
        hash_return_escrow_sol_payload_iter(
            b"escrow-1",
            [
                (b"Alice".as_slice(), 4_500_000_000),
                (b"Bob".as_slice(), 3_000_000_000),
            ]
            .into_iter(),
        )
    );
}

#[test]
fn escrow_release_and_return_hashes_are_not_interchangeable() {
    let release = hash_release_milestone_payload(
        b"escrow-1",
        b"milestone-1",
        b"Builder",
        &amount(b"SOL", 2_000_000_000),
    );
    let returns = [ClearSignRecipientAmount {
        recipient: b"Builder",
        amount: amount(b"SOL", 2_000_000_000),
    }];
    let unwind = hash_return_escrow_funds_payload(b"escrow-1", &returns);

    assert_ne!(release, unwind);

    let release_envelope = ClearSignEnvelope {
        kind: ClearSignActionKind::ReleaseMilestone,
        wallet_name: b"Team",
        wallet_id: b"wallet-pda",
        action_id: &id32(b"escrow-action"),
        nonce: &id32(b"nonce-1"),
        expires_at: 1_800_000_000,
        policy_commitment: hash_policy_commitment(&[b"escrow:escrow-1"]),
        payload_hash: release,
        clear_text_hash: hash_clear_text(b"Release escrow milestone").unwrap(),
    };
    let return_envelope = ClearSignEnvelope {
        kind: ClearSignActionKind::ReturnEscrowFunds,
        payload_hash: unwind,
        ..release_envelope
    };

    assert_ne!(
        hash_envelope(&release_envelope),
        hash_envelope(&return_envelope)
    );
}
