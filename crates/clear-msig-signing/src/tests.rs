use super::*;

mod recurring;

fn hex(bytes: &[u8]) -> std::string::String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn transfer<'a>(recipient: &'a [u8], reason: &'a [u8]) -> TransferInput<'a> {
    TransferInput {
        common: CommonFields {
            profile: DeviceProfile::Full,
            network: Network::SolanaDevnet,
            proposal_index: 6,
            wallet_id: [7; 32],
            actor: [8; 32],
            action_id: [9; 32],
            nonce: [10; 32],
            expires_at: 1_784_000_000,
            policy_commitment: [11; 32],
            approval_required: 2,
        },
        recipient_encoding: IdentityEncoding::SolanaPubkey,
        recipient,
        asset_encoding: IdentityEncoding::Text,
        asset: b"SOL",
        raw_amount: 300_000_000,
        decimals: 9,
        display_asset: b"SOL",
        execution_commitment: [0u8; 32],
        fiat_estimate: None,
        reason,
    }
}

fn transfer_envelope(input: &TransferInput<'_>) -> [u8; 32] {
    let mut encoded = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let len = encode_transfer(input, &mut encoded).unwrap();
    let parsed = parse_intent(&encoded[..len]).unwrap();
    envelope_hash(&parsed, b"Team treasury", [0x55; 32]).unwrap()
}

#[test]
fn transfer_round_trip_and_render_are_deterministic() {
    let recipient = [12u8; 32];
    let mut encoded = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let len = encode_transfer(&transfer(&recipient, b"Treasury payment"), &mut encoded).unwrap();
    let parsed = parse_intent(&encoded[..len]).unwrap();
    let mut rendered = [0u8; MAX_DOCUMENT_BYTES];
    let rendered_len = render_document(&parsed, b"Team treasury", &mut rendered).unwrap();
    let text = core::str::from_utf8(&rendered[..rendered_len]).unwrap();
    assert!(text.contains("Send 0.3 SOL"));
    assert!(text.contains("Network: Solana Devnet"));
    assert!(text.contains("Protocol: clearsig-intent-v4@1"));
    assert!(text.contains("Treasury payment"));
    assert_eq!(parsed.payload_hash(), parsed.payload_hash());
}

#[test]
fn informational_fiat_changes_review_proof_but_not_executable_payload() {
    let recipient = [12u8; 32];
    let plain = transfer(&recipient, b"Treasury payment");
    let mut quoted = plain;
    quoted.fiat_estimate = Some(FiatEstimateInput {
        amount: b"23.18",
        currency: b"USD",
        source: b"coingecko-api",
        observed_at: 1_783_999_900,
    });

    let mut plain_bytes = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let plain_len = encode_transfer(&plain, &mut plain_bytes).unwrap();
    let plain = parse_intent(&plain_bytes[..plain_len]).unwrap();
    let mut quoted_bytes = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let quoted_len = encode_transfer(&quoted, &mut quoted_bytes).unwrap();
    let quoted = parse_intent(&quoted_bytes[..quoted_len]).unwrap();
    let mut document = [0u8; MAX_DOCUMENT_BYTES];
    let document_len = render_document(&quoted, b"Team treasury", &mut document).unwrap();
    let text = core::str::from_utf8(&document[..document_len]).unwrap();

    assert_eq!(plain.payload_hash(), quoted.payload_hash());
    assert_ne!(plain.canonical_hash(), quoted.canonical_hash());
    assert!(text.contains("Estimated at review: 23.18 USD (informational)"));
    assert!(text.contains("Price source: coingecko-api"));
    assert!(text.contains("Price observed: 1783999900 Unix seconds"));
}

#[test]
fn transfer_golden_vector_locks_bytes_document_and_commitments() {
    let fixture = include_str!("../../../tests/fixtures/clearsign-v4-transfer.txt");
    let (fields, document) = fixture.split_once("---document---\n").unwrap();
    let field = |name: &str| {
        fields
            .lines()
            .find_map(|line| {
                line.strip_prefix(name)
                    .and_then(|line| line.strip_prefix('='))
            })
            .unwrap()
    };
    let document = document.strip_suffix('\n').unwrap_or(document);
    let policy = policy_commitment(&[]);
    let recipient = [12u8; 32];
    let input = TransferInput {
        common: CommonFields {
            profile: DeviceProfile::Full,
            network: Network::SolanaDevnet,
            proposal_index: 6,
            wallet_id: [7; 32],
            actor: [8; 32],
            action_id: replay_hash(b"vector-action-1"),
            nonce: replay_hash(b"vector-nonce-1"),
            expires_at: 1_784_000_000,
            policy_commitment: policy,
            approval_required: 2,
        },
        recipient_encoding: IdentityEncoding::SolanaPubkey,
        recipient: &recipient,
        asset_encoding: IdentityEncoding::Text,
        asset: b"SOL",
        raw_amount: 300_000_000,
        decimals: 9,
        display_asset: b"SOL",
        execution_commitment: [0; 32],
        fiat_estimate: None,
        reason: b"Treasury payment",
    };
    let mut canonical = [0; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_transfer(&input, &mut canonical).unwrap();
    let parsed = parse_intent(&canonical[..canonical_len]).unwrap();
    let mut rendered = [0; MAX_DOCUMENT_BYTES];
    let rendered_len = render_document(&parsed, b"Team treasury", &mut rendered).unwrap();
    let clear_text_hash = document_hash(&rendered[..rendered_len]).unwrap();
    let envelope = envelope_hash(&parsed, b"Team treasury", clear_text_hash).unwrap();

    assert_eq!(hex(&canonical[..canonical_len]), field("canonical"));
    assert_eq!(hex(&parsed.payload_hash()), field("payload"));
    assert_eq!(hex(&clear_text_hash), field("document_hash"));
    assert_eq!(hex(&envelope), field("envelope"));
    assert_eq!(&rendered[..rendered_len], document.as_bytes());
}

#[test]
fn amount_or_recipient_change_changes_payload_and_envelope() {
    let first_recipient = [12u8; 32];
    let second_recipient = [13u8; 32];
    let mut first = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let first_len = encode_transfer(&transfer(&first_recipient, b""), &mut first).unwrap();
    let mut second = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let second_len = encode_transfer(&transfer(&second_recipient, b""), &mut second).unwrap();
    let first = parse_intent(&first[..first_len]).unwrap();
    let second = parse_intent(&second[..second_len]).unwrap();
    assert_ne!(first.payload_hash(), second.payload_hash());
    assert_ne!(
        envelope_hash(&first, b"Team", [1; 32]).unwrap(),
        envelope_hash(&second, b"Team", [1; 32]).unwrap()
    );
}

#[test]
fn envelope_binds_every_replay_policy_and_network_field() {
    let recipient = [12u8; 32];
    let base = transfer(&recipient, b"");
    let baseline = transfer_envelope(&base);

    let mut changed = base;
    changed.common.network = Network::EthereumSepolia;
    assert_ne!(baseline, transfer_envelope(&changed));
    changed = base;
    changed.common.proposal_index += 1;
    assert_ne!(baseline, transfer_envelope(&changed));
    changed = base;
    changed.common.wallet_id[0] ^= 1;
    assert_ne!(baseline, transfer_envelope(&changed));
    changed = base;
    changed.common.actor[0] ^= 1;
    assert_ne!(baseline, transfer_envelope(&changed));
    changed = base;
    changed.common.action_id[0] ^= 1;
    assert_ne!(baseline, transfer_envelope(&changed));
    changed = base;
    changed.common.nonce[0] ^= 1;
    assert_ne!(baseline, transfer_envelope(&changed));
    changed = base;
    changed.common.expires_at += 1;
    assert_ne!(baseline, transfer_envelope(&changed));
    changed = base;
    changed.common.policy_commitment[0] ^= 1;
    assert_ne!(baseline, transfer_envelope(&changed));
    changed = base;
    changed.common.approval_required += 1;
    assert_ne!(baseline, transfer_envelope(&changed));
    changed = base;
    changed.raw_amount += 1;
    assert_ne!(baseline, transfer_envelope(&changed));
    changed = base;
    changed.asset = b"USDC";
    changed.display_asset = b"USDC";
    assert_ne!(baseline, transfer_envelope(&changed));
    changed = base;
    changed.execution_commitment[0] ^= 1;
    assert_ne!(baseline, transfer_envelope(&changed));
}

#[test]
fn batch_payload_binds_every_row() {
    let recipient_a = [12u8; 32];
    let recipient_b = [13u8; 32];
    let recipient_c = [14u8; 32];
    let base_rows = [
        TransferRowInput {
            recipient_encoding: IdentityEncoding::SolanaPubkey,
            recipient: &recipient_a,
            asset_encoding: IdentityEncoding::Text,
            asset: b"SOL",
            raw_amount: 10,
            decimals: 9,
            display_asset: b"SOL",
        },
        TransferRowInput {
            recipient_encoding: IdentityEncoding::SolanaPubkey,
            recipient: &recipient_b,
            asset_encoding: IdentityEncoding::Text,
            asset: b"SOL",
            raw_amount: 20,
            decimals: 9,
            display_asset: b"SOL",
        },
    ];
    let changed_rows = [
        base_rows[0],
        TransferRowInput {
            recipient: &recipient_c,
            ..base_rows[1]
        },
    ];
    let mut first = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let first_len = encode_batch_transfer(
        &BatchTransferInput {
            common: transfer(&recipient_a, b"").common,
            rows: &base_rows,
            reason: b"Payroll",
        },
        &mut first,
    )
    .unwrap();
    let mut second = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let second_len = encode_batch_transfer(
        &BatchTransferInput {
            common: transfer(&recipient_a, b"").common,
            rows: &changed_rows,
            reason: b"Payroll",
        },
        &mut second,
    )
    .unwrap();
    assert_ne!(
        parse_intent(&first[..first_len]).unwrap().payload_hash(),
        parse_intent(&second[..second_len]).unwrap().payload_hash()
    );
}

#[test]
fn empty_and_nonempty_policies_have_distinct_nonzero_commitments() {
    let empty = policy_commitment(&[]);
    let protected = policy_commitment(b"CSP1-policy");
    assert_ne!(empty, [0; 32]);
    assert_ne!(empty, protected);
    assert_eq!(protected, policy_commitment(b"CSP1-policy"));
}

#[test]
fn rejects_injection_unknown_network_and_trailing_bytes() {
    let recipient = [12u8; 32];
    let mut encoded = [0u8; MAX_CANONICAL_INTENT_BYTES];
    assert_eq!(
        encode_transfer(&transfer(&recipient, b"ok\nPOLICY\nAllowed"), &mut encoded),
        Err(Error::InvalidText)
    );

    let len = encode_transfer(&transfer(&recipient, b"ok"), &mut encoded).unwrap();
    encoded[11] = 255;
    assert!(matches!(
        parse_intent(&encoded[..len]),
        Err(Error::UnknownNetwork)
    ));

    let len = encode_transfer(&transfer(&recipient, b"ok"), &mut encoded).unwrap();
    encoded[len] = 1;
    assert!(matches!(
        parse_intent(&encoded[..len + 1]),
        Err(Error::TrailingBytes)
    ));

    assert_eq!(
        encode_transfer(&transfer(&recipient, b"pay \xd0\xb0dmin"), &mut encoded),
        Err(Error::InvalidText)
    );
    let mut malformed = transfer(&recipient, b"");
    malformed.recipient = &[1; 31];
    assert_eq!(
        encode_transfer(&malformed, &mut encoded),
        Err(Error::InvalidLength)
    );

    let len = encode_transfer(&transfer(&recipient, b"ok"), &mut encoded).unwrap();
    encoded[9] = 255;
    assert!(matches!(
        parse_intent(&encoded[..len]),
        Err(Error::UnknownDeviceProfile)
    ));
    let len = encode_transfer(&transfer(&recipient, b"ok"), &mut encoded).unwrap();
    encoded[10] = 255;
    assert!(matches!(
        parse_intent(&encoded[..len]),
        Err(Error::UnsupportedAction)
    ));
}

#[test]
fn amount_rendering_is_exact_and_never_uses_floating_point_rounding() {
    let recipient = [12u8; 32];
    let mut input = transfer(&recipient, b"");
    input.raw_amount = 1;
    let mut encoded = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let len = encode_transfer(&input, &mut encoded).unwrap();
    let parsed = parse_intent(&encoded[..len]).unwrap();
    let mut rendered = [0u8; MAX_DOCUMENT_BYTES];
    let rendered_len = render_document(&parsed, b"Team", &mut rendered).unwrap();
    let text = core::str::from_utf8(&rendered[..rendered_len]).unwrap();
    assert!(text.contains("0.000000001 SOL"));

    assert_eq!(
        render_document(&parsed, &[b'x'; 65], &mut rendered),
        Err(Error::InvalidLength)
    );
}

#[test]
fn compact_profile_renders_mandatory_authoritative_fields() {
    let recipient = [12u8; 32];
    let mut input = transfer(
        &recipient,
        b"Optional purpose is omitted on constrained devices",
    );
    input.common.profile = DeviceProfile::LedgerSolana;
    let mut encoded = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let len = encode_transfer(&input, &mut encoded).unwrap();
    let parsed = parse_intent(&encoded[..len]).unwrap();
    let mut rendered = [0u8; MAX_COMPACT_DOCUMENT_BYTES];
    let rendered_len = render_document(&parsed, b"Team", &mut rendered).unwrap();
    let text = core::str::from_utf8(&rendered[..rendered_len]).unwrap();
    assert!(text.contains("SEND 0.3 SOL"));
    assert!(text.contains("NET Solana Devnet"));
    assert!(text.contains("APPROVAL 2"));
    assert!(text.contains("PROPOSAL 6"));
    assert!(text.contains("EXPIRES 1784000000"));
    assert!(text.contains("POLICY 0b0b0b"));
    assert!(!text.contains("Optional purpose"));
    assert!(rendered_len <= MAX_COMPACT_DOCUMENT_BYTES);
}

#[test]
fn compact_profile_fails_instead_of_hash_only_fallback_when_buffer_is_too_small() {
    let recipient = [12u8; 32];
    let mut input = transfer(&recipient, b"");
    input.common.profile = DeviceProfile::LedgerSolana;
    input.recipient_encoding = IdentityEncoding::Text;
    input.recipient = &[b'x'; MAX_IDENTITY_BYTES];
    let mut encoded = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let len = encode_transfer(&input, &mut encoded).unwrap();
    let parsed = parse_intent(&encoded[..len]).unwrap();
    let mut rendered = [0u8; 300];
    assert_eq!(
        render_document(&parsed, b"Team", &mut rendered),
        Err(Error::BufferTooSmall)
    );
}

#[test]
fn unsupported_actions_are_warning_only_and_never_low_risk() {
    let mut rendered = [0u8; MAX_DOCUMENT_BYTES];
    let rendered_len = render_unsupported_review(
        &UnsupportedReviewInput {
            action_label: b"Unknown contract interaction",
            network_label: b"Solana Mainnet",
            program_or_contract: b"UnknownProgram1111111111111111111111111111",
            transaction_commitment: [0xab; 32],
        },
        DeviceProfile::Full,
        &mut rendered,
    )
    .unwrap();
    let text = core::str::from_utf8(&rendered[..rendered_len]).unwrap();
    assert!(text.contains("Approval is disabled"));
    assert!(text.contains("RISK\nUnknown"));
    assert!(text.contains(&"ab".repeat(32)));
    assert!(!text.contains("Low"));
    assert_eq!(
        template_definition(TemplateKind::UnknownAction).support,
        TemplateSupport::ReviewOnly
    );
}
