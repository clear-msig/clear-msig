use super::*;

fn recurring<'a>(recipient: &'a [u8; 32], amount_lamports: u64) -> RecurringScheduleInput<'a> {
    RecurringScheduleInput {
        common: transfer(recipient, b"").common,
        schedule_id: b"payroll-july",
        payment: TransferRowInput {
            recipient_encoding: IdentityEncoding::SolanaPubkey,
            recipient,
            asset_encoding: IdentityEncoding::Text,
            asset: b"SOL",
            raw_amount: amount_lamports as u128,
            decimals: 9,
            display_asset: b"SOL",
        },
        execution_commitment: [0u8; 32],
        interval_seconds: 86_400,
        first_execution_at: 1_784_100_000,
        payment_count: 3,
        status: 1,
        reason: b"Monthly operations",
    }
}

#[test]
fn recurring_usdc_binds_mint_and_exact_token_accounts() {
    let recipient = [12u8; 32];
    let mint = [21u8; 32];
    let source = [22u8; 32];
    let destination = [23u8; 32];
    let commitment =
        execution_commitment(&[b"spl_recurring_payment", &mint, &source, &destination]);
    let baseline = RecurringScheduleInput {
        common: transfer(&recipient, b"").common,
        schedule_id: b"usdc-payroll",
        payment: TransferRowInput {
            recipient_encoding: IdentityEncoding::SolanaPubkey,
            recipient: &recipient,
            asset_encoding: IdentityEncoding::SolanaPubkey,
            asset: &mint,
            raw_amount: 1_250_000,
            decimals: 6,
            display_asset: b"USDC",
        },
        execution_commitment: commitment,
        interval_seconds: 86_400,
        first_execution_at: 1_784_100_000,
        payment_count: 3,
        status: 1,
        reason: b"Payroll",
    };
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let len = encode_recurring_schedule(&baseline, &mut canonical).unwrap();
    let parsed = parse_intent(&canonical[..len]).unwrap();
    let mut document = [0u8; MAX_DOCUMENT_BYTES];
    let document_len = render_document(&parsed, b"Team treasury", &mut document).unwrap();
    let text = core::str::from_utf8(&document[..document_len]).unwrap();
    assert!(text.contains("Amount per payment: 1.25 USDC"));

    for changed_commitment in [
        execution_commitment(&[b"spl_recurring_payment", &mint, &[24u8; 32], &destination]),
        execution_commitment(&[b"spl_recurring_payment", &mint, &source, &[25u8; 32]]),
    ] {
        let changed = RecurringScheduleInput {
            execution_commitment: changed_commitment,
            ..baseline
        };
        let mut changed_bytes = [0u8; MAX_CANONICAL_INTENT_BYTES];
        let changed_len = encode_recurring_schedule(&changed, &mut changed_bytes).unwrap();
        assert_ne!(
            parsed.payload_hash(),
            parse_intent(&changed_bytes[..changed_len])
                .unwrap()
                .payload_hash()
        );
    }
}

#[test]
fn recurring_schedule_binds_authority_and_renders_every_execution_limit() {
    let recipient = [12u8; 32];
    let baseline = recurring(&recipient, 300_000_000);
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let len = encode_recurring_schedule(&baseline, &mut canonical).unwrap();
    let parsed = parse_intent(&canonical[..len]).unwrap();
    let mut document = [0u8; MAX_DOCUMENT_BYTES];
    let document_len = render_document(&parsed, b"Team treasury", &mut document).unwrap();
    let text = core::str::from_utf8(&document[..document_len]).unwrap();

    assert!(text.contains("Amount per payment: 0.3 SOL"));
    assert!(text.contains("Cadence seconds: 86400"));
    assert!(text.contains("First payment (Unix): 1784100000"));
    assert!(text.contains("Maximum payments: 3"));
    assert!(text.contains("Monthly operations"));

    for changed in [
        RecurringScheduleInput {
            payment: TransferRowInput {
                raw_amount: 300_000_001,
                ..baseline.payment
            },
            ..baseline
        },
        RecurringScheduleInput {
            payment: TransferRowInput {
                recipient: &[13u8; 32],
                ..baseline.payment
            },
            ..baseline
        },
        RecurringScheduleInput {
            interval_seconds: 172_800,
            ..baseline
        },
        RecurringScheduleInput {
            first_execution_at: 1_784_100_001,
            ..baseline
        },
        RecurringScheduleInput {
            payment_count: 4,
            ..baseline
        },
        RecurringScheduleInput {
            status: 2,
            ..baseline
        },
    ] {
        let mut changed_bytes = [0u8; MAX_CANONICAL_INTENT_BYTES];
        let changed_len = encode_recurring_schedule(&changed, &mut changed_bytes).unwrap();
        assert_ne!(
            parsed.payload_hash(),
            parse_intent(&changed_bytes[..changed_len])
                .unwrap()
                .payload_hash()
        );
    }
}
