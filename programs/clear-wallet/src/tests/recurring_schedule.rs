use super::*;

#[test]
fn recurring_schedule_is_typed_permissionless_bounded_and_replay_safe() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let relayer = Pubkey::new_unique();
    let proposer = new_keypair();
    let recipient = Pubkey::new_unique();
    let wrong_recipient = Pubkey::new_unique();
    let wallet_name = "recurring-payment";
    let amount_lamports = 1_250_000u64;
    let schedule_id_hash = sha256_hash(b"schedule-1");

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
    let proposal_index = 0u64;
    let expiry = typed_test_expiry();
    let policy_bytes = typed_sol_policy_bytes(1, amount_lamports, 0, &[recipient], &[]);
    let policy_commitment = v4_policy_commitment(&policy_bytes);
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_recurring_schedule(
        &V4RecurringScheduleInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network: V4Network::SolanaDevnet,
                proposal_index,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(&proposer),
                action_id: sha256_hash(b"recurring-action"),
                nonce: sha256_hash(b"recurring-nonce"),
                expires_at: expiry,
                policy_commitment,
                approval_required: 1,
            },
            schedule_id: b"schedule-1",
            payment: V4TransferRowInput {
                recipient_encoding: V4IdentityEncoding::SolanaPubkey,
                recipient: recipient.as_ref(),
                asset_encoding: V4IdentityEncoding::Text,
                asset: b"SOL",
                raw_amount: amount_lamports as u128,
                decimals: 9,
                display_asset: b"SOL",
            },
            interval_seconds: 3_600,
            first_execution_at: 0,
            payment_count: 2,
            status: 1,
            reason: b"Bound recurring payment",
        },
        &mut canonical,
    )
    .unwrap();
    let (proposal, _, envelope_hash) = submit_typed_v4_proposal(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        &proposer,
        &policy_bytes,
        &canonical[..canonical_len],
        1,
    );
    let (schedule, _) = find_recurring_schedule_address(&wallet, &schedule_id_hash, &crate::ID);
    let (wallet_policy, _) = find_wallet_policy_address(&wallet, &crate::ID);
    let configure = ExecuteTypedRecurringScheduleInstruction {
        payer,
        wallet,
        wallet_policy,
        intent,
        proposal,
        schedule,
        system_program: quasar_svm::system_program::ID,
        policy_commitment,
        envelope_hash,
        schedule_id_hash,
        recipient: recipient.to_bytes(),
        amount_lamports,
        interval_seconds: 3_600,
        first_execution_at: 0,
        payment_count: 2,
        status: 1,
    }
    .into();
    let result = svm.process_instruction(
        &configure,
        &[
            funded_account(payer),
            empty_account(wallet_policy),
            empty_account(schedule),
        ],
    );
    if result.is_err() {
        result.print_logs();
    }
    assert!(result.is_ok());

    let vault = fund_vault(&mut svm, payer, wallet, amount_lamports * 3);
    let (policy_spend, _) = find_policy_spend_address(&wallet, &intent, &crate::ID);
    let wrong = ExecuteRecurringPaymentInstruction {
        payer: relayer,
        wallet,
        wallet_policy,
        policy_spend,
        vault,
        intent,
        schedule,
        recipient: wrong_recipient,
        system_program: quasar_svm::system_program::ID,
        schedule_id_hash,
    }
    .into();
    assert!(svm
        .process_instruction(
            &wrong,
            &[
                funded_account(relayer),
                empty_account(wallet_policy),
                empty_account(policy_spend),
                empty_account(wrong_recipient)
            ],
        )
        .is_err());

    let payment = ExecuteRecurringPaymentInstruction {
        payer: relayer,
        wallet,
        wallet_policy,
        policy_spend,
        vault,
        intent,
        schedule,
        recipient,
        system_program: quasar_svm::system_program::ID,
        schedule_id_hash,
    }
    .into();
    let result = svm.process_instruction(
        &payment,
        &[
            funded_account(relayer),
            empty_account(wallet_policy),
            empty_account(policy_spend),
            empty_account(recipient),
        ],
    );
    if result.is_err() {
        result.print_logs();
    }
    assert!(result.is_ok());
    assert_eq!(
        svm.get_account(&recipient).unwrap().lamports,
        amount_lamports
    );

    let replay = svm.process_instruction(&payment, &[]);
    assert!(
        replay.is_err(),
        "the next payment must wait for its signed interval"
    );
    let schedule_account = svm.get_account(&schedule).unwrap();
    let schedule_state = crate::state::RecurringSchedule::read(&schedule_account.data).unwrap();
    assert_eq!(schedule_state.remaining_payments, 1);
    assert_eq!(schedule_state.executed_payments, 1);
}

#[test]
fn recurring_schedule_rejects_proposal_dependent_policy_rules() {
    let recipient = Pubkey::new_unique();
    let approver = Pubkey::new_unique();
    let policy = typed_sol_policy_bytes(0, 0, 0, &[], &[approver]);
    assert!(crate::utils::policy::validate_recurring_sol_policy(
        &policy,
        v4_policy_commitment(&policy),
        &recipient.to_bytes(),
        1,
    )
    .is_err());
}
