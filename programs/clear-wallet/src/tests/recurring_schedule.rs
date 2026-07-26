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
            execution_commitment: [0u8; 32],
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
fn recurring_usdc_moves_only_the_bound_token_accounts() {
    use quasar_svm::token::{
        create_keyed_mint_account, create_keyed_token_account, Mint, TokenAccount,
    };
    use spl_token::solana_program::program_pack::Pack;
    use spl_token::state::AccountState;

    let mut svm = setup_with_tokens();
    let payer = Pubkey::new_unique();
    let relayer = Pubkey::new_unique();
    let proposer = new_keypair();
    let recipient_owner = Pubkey::new_unique();
    let wallet_name = "recurring-usdc";
    let mint: Pubkey = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        .parse()
        .unwrap();
    let amount_tokens = 1_250_000u64;
    let initial_supply = 5_000_000u64;
    let schedule_id_hash = sha256_hash(b"usdc-schedule-1");

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
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let source_token = Pubkey::new_unique();
    let destination_token = Pubkey::new_unique();
    let wrong_destination = Pubkey::new_unique();
    svm.set_account(create_keyed_mint_account(
        &mint,
        &Mint {
            decimals: 6,
            supply: initial_supply,
            is_initialized: true,
            ..Default::default()
        },
    ));
    svm.set_account(create_keyed_token_account(
        &source_token,
        &TokenAccount {
            mint,
            owner: vault,
            amount: initial_supply,
            state: AccountState::Initialized,
            ..Default::default()
        },
    ));
    for destination in [destination_token, wrong_destination] {
        svm.set_account(create_keyed_token_account(
            &destination,
            &TokenAccount {
                mint,
                owner: recipient_owner,
                amount: 0,
                state: AccountState::Initialized,
                ..Default::default()
            },
        ));
    }

    let execution_commitment = v4_execution_commitment(&[
        b"spl_recurring_payment",
        mint.as_ref(),
        source_token.as_ref(),
        destination_token.as_ref(),
    ]);
    let policy_bytes = Vec::new();
    let policy_commitment = v4_policy_commitment(&policy_bytes);
    let expiry = typed_test_expiry();
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_recurring_schedule(
        &V4RecurringScheduleInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network: V4Network::SolanaDevnet,
                proposal_index: 0,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(&proposer),
                action_id: sha256_hash(b"recurring-usdc-action"),
                nonce: sha256_hash(b"recurring-usdc-nonce"),
                expires_at: expiry,
                policy_commitment,
                approval_required: 1,
            },
            schedule_id: b"usdc-schedule-1",
            payment: V4TransferRowInput {
                recipient_encoding: V4IdentityEncoding::SolanaPubkey,
                recipient: recipient_owner.as_ref(),
                asset_encoding: V4IdentityEncoding::SolanaPubkey,
                asset: mint.as_ref(),
                raw_amount: amount_tokens as u128,
                decimals: 6,
                display_asset: b"USDC",
            },
            execution_commitment,
            interval_seconds: 3_600,
            first_execution_at: 0,
            payment_count: 2,
            status: 1,
            reason: b"USDC operations",
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
        0,
        &proposer,
        &policy_bytes,
        &canonical[..canonical_len],
        1,
    );
    let (schedule, _) = find_recurring_schedule_address(&wallet, &schedule_id_hash, &crate::ID);
    let (wallet_policy, _) = find_wallet_policy_address(&wallet, &crate::ID);
    let configure = ExecuteTypedRecurringTokenScheduleInstruction {
        payer,
        wallet,
        wallet_policy,
        vault,
        intent,
        proposal,
        schedule,
        mint,
        source_token,
        destination_token,
        recipient_owner,
        token_program: quasar_svm::SPL_TOKEN_PROGRAM_ID,
        system_program: quasar_svm::system_program::ID,
        policy_commitment,
        envelope_hash,
        schedule_id_hash,
        amount_tokens,
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
            empty_account(recipient_owner),
        ],
    );
    if result.is_err() {
        result.print_logs();
    }
    assert!(result.is_ok());

    let wrong = ExecuteRecurringTokenPaymentInstruction {
        payer: relayer,
        wallet,
        wallet_policy,
        vault,
        intent,
        schedule,
        mint,
        source_token,
        destination_token: wrong_destination,
        recipient_owner,
        token_program: quasar_svm::SPL_TOKEN_PROGRAM_ID,
        schedule_id_hash,
    }
    .into();
    assert!(svm
        .process_instruction(&wrong, &[funded_account(relayer)])
        .is_err());

    let payment = ExecuteRecurringTokenPaymentInstruction {
        payer: relayer,
        wallet,
        wallet_policy,
        vault,
        intent,
        schedule,
        mint,
        source_token,
        destination_token,
        recipient_owner,
        token_program: quasar_svm::SPL_TOKEN_PROGRAM_ID,
        schedule_id_hash,
    }
    .into();
    let result = svm.process_instruction(&payment, &[funded_account(relayer)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(result.is_ok());
    let source = TokenAccount::unpack(&svm.get_account(&source_token).unwrap().data).unwrap();
    let destination =
        TokenAccount::unpack(&svm.get_account(&destination_token).unwrap().data).unwrap();
    assert_eq!(source.amount, initial_supply - amount_tokens);
    assert_eq!(destination.amount, amount_tokens);
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

#[test]
fn recurring_usdc_rejects_sol_denominated_numeric_policy_controls() {
    let recipient = Pubkey::new_unique();
    let numeric = typed_sol_policy_bytes(0, 1_000_000_000, 0, &[], &[]);
    assert!(crate::utils::policy::validate_recurring_token_policy(
        &numeric,
        v4_policy_commitment(&numeric),
        &recipient.to_bytes(),
    )
    .is_err());

    let recipient_only = typed_sol_policy_bytes(1, 0, 0, &[recipient], &[]);
    assert!(crate::utils::policy::validate_recurring_token_policy(
        &recipient_only,
        v4_policy_commitment(&recipient_only),
        &recipient.to_bytes(),
    )
    .is_ok());
}
