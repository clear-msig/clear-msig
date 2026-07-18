use super::*;

fn key(byte: u8) -> Pubkey {
    Pubkey::new_from_array([byte; 32])
}

#[test]
fn typed_propose_uses_expected_accounts_and_discriminator() {
    let ix = propose_typed(ProposeTypedArgs {
        payer: key(1),
        wallet: key(2),
        intent: key(3),
        proposal: key(4),
        proposal_index: 7,
        expiry: 1_900_000_000,
        action_kind: 8,
        policy_commitment: [5; 32],
        payload_hash: [6; 32],
        envelope_hash: [7; 32],
        proposer_pubkey: [8; 32],
        signature: [9; 64],
        action_id: [10; 32],
        nonce: [11; 32],
        policy_bytes: &[],
        clear_text: b"Readable action",
    });

    assert_eq!(ix.program_id, program_id());
    assert_eq!(ix.data[0], 8);
    assert_eq!(ix.accounts.len(), 5);
    assert!(ix.accounts[0].is_signer);
    assert!(ix.accounts[0].is_writable);
    assert!(ix.accounts[1].is_writable);
    assert!(ix.accounts[2].is_writable);
    assert!(ix.accounts[3].is_writable);
    assert!(!ix.accounts[4].is_writable);
}

#[test]
fn typed_approve_cancel_execute_use_expected_discriminators() {
    let approve = approve_typed(key(1), key(2), key(3), 1, [4; 64]);
    let cancel = cancel_typed(key(1), key(2), key(3), 1, [4; 64]);
    let execute = execute_typed(key(1), key(2), key(3), 8, [4; 32], [5; 32], [6; 32]);

    assert_eq!(approve.data[0], 9);
    assert_eq!(cancel.data[0], 10);
    assert_eq!(execute.data[0], 11);
    assert_eq!(approve.data.len(), 66);
    assert_eq!(cancel.data.len(), 66);
    assert_eq!(execute.data.len(), 98);
    assert!(!approve.accounts[0].is_writable);
    assert!(!approve.accounts[1].is_writable);
    assert!(approve.accounts[2].is_writable);
    assert!(cancel.accounts[1].is_writable);
    assert!(execute.accounts[1].is_writable);
    assert!(execute.accounts[2].is_writable);
}

#[test]
fn typed_escrow_executors_use_expected_accounts_and_discriminators() {
    let release = execute_typed_escrow_release(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        [6; 32],
        [7; 32],
        1_000_000,
        [8; 32],
        [9; 32],
    );
    let mut amount_bytes = Vec::new();
    amount_bytes.extend_from_slice(&1_000_000u64.to_le_bytes());
    amount_bytes.extend_from_slice(&2_000_000u64.to_le_bytes());
    let unwind = execute_typed_escrow_return(
        key(1),
        key(2),
        key(3),
        key(4),
        [6; 32],
        [7; 32],
        [10; 32],
        &amount_bytes,
        vec![
            AccountMeta::new(key(8), false),
            AccountMeta::new(key(9), false),
        ],
    );

    assert_eq!(release.data[0], 12);
    assert_eq!(unwind.data[0], 13);
    assert_eq!(release.accounts.len(), 6);
    assert_eq!(unwind.accounts.len(), 7);
    assert!(!release.accounts[0].is_writable);
    assert!(release.accounts[1].is_writable);
    assert!(release.accounts[2].is_writable);
    assert!(release.accounts[3].is_writable);
    assert!(release.accounts[4].is_writable);
    assert!(!release.accounts[5].is_writable);
    assert!(unwind.accounts[1].is_writable);
    assert!(!unwind.accounts[4].is_writable);
    assert!(unwind.accounts[5].is_writable);
    assert!(unwind.accounts[6].is_writable);
}

#[test]
fn typed_spl_escrow_executor_uses_expected_accounts_and_discriminator() {
    let release = execute_typed_spl_escrow_release(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        key(6),
        key(7),
        key(8),
        [9; 32],
        [10; 32],
        1_000_000,
        [11; 32],
        [12; 32],
    );
    let unwind = execute_typed_spl_escrow_return(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        key(6),
        [9; 32],
        [10; 32],
        [11; 32],
        &1_000_000u64.to_le_bytes(),
        vec![
            AccountMeta::new(key(7), false),
            AccountMeta::new_readonly(key(8), false),
            AccountMeta::new(key(9), false),
            AccountMeta::new_readonly(key(10), false),
        ],
    );

    assert_eq!(release.data[0], 17);
    assert_eq!(release.accounts.len(), 9);
    assert!(!release.accounts[0].is_writable);
    assert!(!release.accounts[1].is_writable);
    assert!(release.accounts[2].is_writable);
    assert!(release.accounts[3].is_writable);
    assert!(!release.accounts[4].is_writable);
    assert!(release.accounts[5].is_writable);
    assert!(release.accounts[6].is_writable);
    assert!(!release.accounts[7].is_writable);
    assert!(!release.accounts[8].is_writable);
    assert_eq!(release.accounts[8].pubkey, spl_token_program_id());
    assert_eq!(unwind.data[0], 18);
    assert_eq!(unwind.accounts.len(), 11);
    assert!(!unwind.accounts[0].is_writable);
    assert!(!unwind.accounts[1].is_writable);
    assert!(unwind.accounts[2].is_writable);
    assert!(unwind.accounts[3].is_writable);
    assert!(!unwind.accounts[4].is_writable);
    assert!(unwind.accounts[5].is_writable);
    assert!(!unwind.accounts[6].is_writable);
    assert_eq!(unwind.accounts[6].pubkey, spl_token_program_id());
    assert!(unwind.accounts[7].is_writable);
    assert!(!unwind.accounts[8].is_writable);
    assert!(unwind.accounts[9].is_writable);
    assert!(!unwind.accounts[10].is_writable);
}

#[test]
fn typed_cross_chain_escrow_executor_uses_expected_accounts_and_discriminator() {
    let release = execute_typed_cross_chain_escrow_release(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        [6; 32],
        [7; 32],
        2,
        100_000_000u128.to_le_bytes(),
        [8; 32],
        [9; 32],
        [10; 32],
        [11; 32],
        [12; 32],
        [13; 32],
        [14; 32],
    );
    let refund = execute_typed_cross_chain_escrow_return(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        [6; 32],
        [7; 32],
        2,
        100_000_000u128.to_le_bytes(),
        [8; 32],
        [10; 32],
        [11; 32],
        [12; 32],
        [13; 32],
        [14; 32],
    );

    assert_eq!(release.data[0], 19);
    assert_eq!(release.data.len(), 306);
    assert_eq!(release.accounts.len(), 5);
    assert!(!release.accounts[0].is_writable);
    assert!(release.accounts[1].is_writable);
    assert!(release.accounts[2].is_writable);
    assert!(!release.accounts[3].is_writable);
    assert!(!release.accounts[4].is_writable);
    assert_eq!(refund.data[0], 20);
    assert_eq!(refund.data.len(), 274);
    assert_eq!(refund.accounts.len(), 5);
    assert!(!refund.accounts[0].is_writable);
    assert!(refund.accounts[1].is_writable);
    assert!(refund.accounts[2].is_writable);
    assert!(!refund.accounts[3].is_writable);
    assert!(!refund.accounts[4].is_writable);
}

#[test]
fn typed_private_escrow_executor_uses_expected_accounts_and_discriminator() {
    let release = execute_typed_private_escrow_release(
        key(1),
        key(2),
        key(3),
        [4; 32],
        [5; 32],
        100_000_000u128.to_le_bytes(),
        [6; 32],
        [7; 32],
        [8; 32],
        [9; 32],
        [10; 32],
        [11; 32],
        [12; 32],
    );
    let refund = execute_typed_private_escrow_return(
        key(1),
        key(2),
        key(3),
        [4; 32],
        [5; 32],
        100_000_000u128.to_le_bytes(),
        [6; 32],
        [8; 32],
        [9; 32],
        [10; 32],
        [11; 32],
        [12; 32],
    );

    assert_eq!(release.data[0], 21);
    assert_eq!(release.data.len(), 305);
    assert_eq!(release.accounts.len(), 3);
    assert!(!release.accounts[0].is_writable);
    assert!(release.accounts[1].is_writable);
    assert!(release.accounts[2].is_writable);
    assert_eq!(refund.data[0], 22);
    assert_eq!(refund.data.len(), 273);
    assert_eq!(refund.accounts.len(), 3);
    assert!(!refund.accounts[0].is_writable);
    assert!(refund.accounts[1].is_writable);
    assert!(refund.accounts[2].is_writable);
}

#[test]
fn typed_agent_trade_executor_uses_expected_accounts_and_discriminator() {
    let trade = execute_typed_agent_trade_approval(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        [5; 32],
        [6; 32],
        100_000_000u128.to_le_bytes(),
        [7; 32],
        [8; 32],
        [9; 32],
        [10; 32],
        [11; 32],
        250,
        [12; 32],
        [13; 32],
        [14; 32],
    );

    assert_eq!(trade.data[0], 23);
    assert_eq!(trade.data.len(), 341);
    assert_eq!(trade.accounts.len(), 5);
    assert!(!trade.accounts[0].is_writable);
    assert!(trade.accounts[1].is_writable);
    assert!(trade.accounts[2].is_writable);
    assert!(trade.accounts[3].is_writable);
    assert!(trade.accounts[4].is_writable);
}

#[test]
fn typed_agent_risk_and_settlement_use_program_owned_ledgers() {
    let risk = execute_typed_agent_risk_policy(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        key(6),
        [7; 32],
        [8; 32],
        [9; 32],
        [10; 32],
        100u128.to_le_bytes(),
        1,
    );
    assert_eq!(risk.data[0], 29);
    assert_eq!(risk.accounts.len(), 7);
    assert!(risk.accounts[5].is_writable);

    let settlement = execute_typed_agent_trade_settlement(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        key(6),
        key(7),
        [8; 32],
        [9; 32],
        [10; 32],
        [11; 32],
        [12; 32],
        [13; 32],
        250u128.to_le_bytes(),
        2,
        50u128.to_le_bytes(),
        0,
    );
    assert_eq!(settlement.data[0], 30);
    assert_eq!(settlement.accounts.len(), 8);
    assert!(settlement.accounts[4].is_writable);
    assert!(settlement.accounts[5].is_writable);
    assert!(settlement.accounts[6].is_writable);
}

#[test]
fn typed_chain_send_ika_sign_uses_expected_accounts_and_discriminator() {
    let ix = ika_sign_typed_chain_send(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        key(6),
        key(7),
        key(8),
        key(9),
        key(10),
        key(11),
        key(12),
        key(13),
        key(14),
        [15; 32],
        [16; 32],
        1,
        1_000_000u128.to_le_bytes(),
        [17; 32],
        [18; 32],
        [19; 32],
        19,
        20,
        [21; 96],
        &[0xaa, 0xbb, 0xcc],
    );

    assert_eq!(ix.data[0], 25);
    assert_eq!(
        ix.data.len(),
        1 + 32 + 32 + 1 + 16 + 32 + 32 + 32 + 1 + 1 + 96 + 3
    );
    assert_eq!(ix.accounts.len(), 16);
    assert!(ix.accounts[0].is_signer);
    assert!(ix.accounts[0].is_writable);
    assert!(!ix.accounts[1].is_writable);
    assert!(ix.accounts[2].is_writable);
    assert!(ix.accounts[3].is_writable);
    assert!(ix.accounts[4].is_writable);
    assert!(ix.accounts[5].is_writable);
    assert!(ix.accounts[6].is_writable);
    assert!(!ix.accounts[7].is_writable);
    assert!(!ix.accounts[8].is_writable);
    assert!(ix.accounts[9].is_writable);
    assert!(ix.accounts[10].is_writable);
    assert!(!ix.accounts[11].is_writable);
    assert!(!ix.accounts[12].is_writable);
    assert!(!ix.accounts[13].is_writable);
    assert_eq!(ix.accounts[13].pubkey, program_id());
    assert!(!ix.accounts[14].is_writable);
    assert!(!ix.accounts[15].is_writable);
    assert_eq!(ix.data[ix.data.len() - 3..], [0xaa, 0xbb, 0xcc]);
}

#[test]
fn typed_sol_send_executors_use_expected_accounts_and_discriminators() {
    let send = execute_typed_sol_send(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        key(6),
        key(7),
        key(8),
        key(9),
        [8; 32],
        [9; 32],
        1_000_000,
    );
    let batch = execute_typed_sol_batch_send(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        key(6),
        key(7),
        key(8),
        [7; 32],
        [8; 32],
        &1_000_000u64.to_le_bytes(),
        vec![AccountMeta::new(key(9), false)],
    );

    assert_eq!(send.data[0], 14);
    assert_eq!(batch.data[0], 15);
    assert_eq!(send.accounts.len(), 10);
    assert_eq!(batch.accounts.len(), 10);
    assert!(batch.accounts[0].is_signer);
    assert!(batch.accounts[0].is_writable);
    assert!(!batch.accounts[1].is_writable);
    assert!(batch.accounts[2].is_writable);
    assert!(send.accounts[0].is_signer);
    assert!(send.accounts[0].is_writable);
    assert!(!send.accounts[1].is_writable);
    assert!(send.accounts[2].is_writable);
    assert!(send.accounts[3].is_writable);
    assert!(send.accounts[4].is_writable);
    assert!(send.accounts[5].is_writable);
    assert!(send.accounts[6].is_writable);
    assert!(send.accounts[7].is_writable);
    assert!(send.accounts[8].is_writable);
    assert!(batch.accounts[3].is_writable);
    assert!(batch.accounts[7].is_writable);
    assert!(!batch.accounts[8].is_writable);
    assert!(batch.accounts[5].is_writable);
}

#[test]
fn typed_wallet_policy_update_uses_expected_accounts_and_discriminator() {
    let ix = execute_typed_wallet_policy_update(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        [6; 32],
        [7; 32],
        2,
        &[0xca, 0xfe],
    );

    assert_eq!(ix.data[0], 26);
    assert_eq!(ix.accounts.len(), 6);
    assert!(ix.accounts[0].is_signer);
    assert!(ix.accounts[0].is_writable);
    assert!(!ix.accounts[1].is_writable);
    assert!(ix.accounts[2].is_writable);
    assert!(ix.accounts[3].is_writable);
    assert!(ix.accounts[4].is_writable);
    assert!(!ix.accounts[5].is_writable);
}

#[test]
fn asset_policy_and_recurring_asset_instructions_lock_the_v4_abi() {
    let policy = execute_typed_asset_policy_update(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        [6; 32],
        [7; 32],
        0,
        1,
        6,
        [8; 32],
        b"USDC",
        b"CSP2-policy",
    );
    assert_eq!(policy.data[0], 36);
    assert_eq!(policy.accounts.len(), 6);
    assert!(policy.accounts[0].is_signer && policy.accounts[0].is_writable);
    assert!(!policy.accounts[1].is_writable);
    assert!(policy.accounts[2].is_writable);
    assert!(policy.accounts[3].is_writable);
    assert!(policy.accounts[4].is_writable);
    assert!(!policy.accounts[5].is_writable);

    let schedule = execute_typed_recurring_asset_schedule(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        key(6),
        key(7),
        key(8),
        key(9),
        key(10),
        key(11),
        [12; 32],
        [13; 32],
        [14; 32],
        1_250_000,
        86_400,
        1_800_000_000,
        12,
        1,
    );
    assert_eq!(schedule.data[0], 37);
    assert_eq!(schedule.accounts.len(), 13);
    assert!(schedule.accounts[0].is_signer && schedule.accounts[0].is_writable);
    assert!(!schedule.accounts[1].is_writable);
    assert!(!schedule.accounts[2].is_writable);
    assert!(!schedule.accounts[3].is_writable);
    assert!(schedule.accounts[4].is_writable);
    assert!(schedule.accounts[5].is_writable);
    assert!(schedule.accounts[6].is_writable);
    assert!(schedule.accounts[7..]
        .iter()
        .all(|account| !account.is_writable));

    let payment = execute_recurring_asset_payment(
        key(1),
        key(2),
        key(3),
        key(4),
        key(5),
        key(6),
        key(7),
        key(8),
        key(9),
        key(10),
        key(11),
        [12; 32],
    );
    assert_eq!(payment.data[0], 38);
    assert_eq!(payment.accounts.len(), 13);
    assert!(payment.accounts[0].is_signer && payment.accounts[0].is_writable);
    assert!(!payment.accounts[1].is_writable);
    assert!(!payment.accounts[2].is_writable);
    assert!(payment.accounts[3].is_writable);
    assert!(!payment.accounts[4].is_writable);
    assert!(!payment.accounts[5].is_writable);
    assert!(payment.accounts[6].is_writable);
    assert!(!payment.accounts[7].is_writable);
    assert!(payment.accounts[8].is_writable);
    assert!(payment.accounts[9].is_writable);
    assert!(payment.accounts[10..]
        .iter()
        .all(|account| !account.is_writable));
}

#[test]
fn cleanup_instructions_use_expected_discriminators() {
    let legacy = cleanup(key(1), key(2));
    let typed = cleanup_typed(key(1), key(2));

    assert_eq!(legacy.data, vec![5]);
    assert_eq!(typed.data, vec![16]);
    assert_eq!(legacy.accounts.len(), 2);
    assert_eq!(typed.accounts.len(), 2);
    assert!(legacy.accounts[0].is_writable);
    assert!(legacy.accounts[1].is_writable);
    assert!(typed.accounts[0].is_writable);
    assert!(typed.accounts[1].is_writable);
}
