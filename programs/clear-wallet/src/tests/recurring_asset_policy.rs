use super::*;

use quasar_svm::token::{
    create_keyed_mint_account, create_keyed_token_account, Mint, TokenAccount,
};
use spl_token::solana_program::program_pack::Pack;
use spl_token::state::AccountState;

fn csp2_usdc_policy(mint: Pubkey, recipient: Pubkey, cap: u64) -> Vec<u8> {
    let inner = typed_sol_policy_bytes_with_velocity(1, cap, 0, &[recipient], &[], cap, 86_400);
    let inner = append_send_count_extension(inner, 1, 86_400);
    let inner = append_allowed_time_extension(inner, 0, 23, 0x7f, 0);
    let mut bytes = b"CSP2".to_vec();
    bytes.extend_from_slice(&[1, 6]);
    bytes.extend_from_slice(mint.as_ref());
    bytes.extend_from_slice(&inner);
    bytes
}

#[allow(clippy::too_many_arguments)]
fn asset_policy_update_ix(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    mint: Pubkey,
    current: [u8; 32],
    envelope: [u8; 32],
    policy: &[u8],
) -> Instruction {
    let (asset_policy, _) = find_asset_policy_address(&wallet, &mint, &crate::ID);
    let mut data = vec![36u8];
    wincode::serialize_into(&mut data, &current).unwrap();
    wincode::serialize_into(&mut data, &envelope).unwrap();
    wincode::serialize_into(&mut data, &0u8).unwrap();
    wincode::serialize_into(&mut data, &1u8).unwrap();
    wincode::serialize_into(&mut data, &6u8).unwrap();
    wincode::serialize_into(&mut data, &mint.to_bytes()).unwrap();
    wincode::serialize_into(&mut data, &DynBytes::<u32>::new(b"USDC".to_vec())).unwrap();
    wincode::serialize_into(&mut data, &DynBytes::<u32>::new(policy.to_vec())).unwrap();
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(asset_policy, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn recurring_asset_schedule_ix(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    schedule: Pubkey,
    mint: Pubkey,
    source: Pubkey,
    destination: Pubkey,
    recipient: Pubkey,
    policy_commitment: [u8; 32],
    envelope: [u8; 32],
    schedule_hash: [u8; 32],
    amount: u64,
) -> Instruction {
    let (asset_policy, _) = find_asset_policy_address(&wallet, &mint, &crate::ID);
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let mut data = vec![37u8];
    for value in [&policy_commitment, &envelope, &schedule_hash] {
        wincode::serialize_into(&mut data, value).unwrap();
    }
    wincode::serialize_into(&mut data, &amount).unwrap();
    wincode::serialize_into(&mut data, &3_600u32).unwrap();
    wincode::serialize_into(&mut data, &0i64).unwrap();
    wincode::serialize_into(&mut data, &2u32).unwrap();
    wincode::serialize_into(&mut data, &1u8).unwrap();
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new_readonly(asset_policy, false),
            AccountMeta::new_readonly(vault, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new(schedule, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(source, false),
            AccountMeta::new_readonly(destination, false),
            AccountMeta::new_readonly(recipient, false),
            AccountMeta::new_readonly(quasar_svm::SPL_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn recurring_asset_payment_ix(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    schedule: Pubkey,
    mint: Pubkey,
    source: Pubkey,
    destination: Pubkey,
    recipient: Pubkey,
    schedule_hash: [u8; 32],
) -> Instruction {
    let (asset_policy, _) = find_asset_policy_address(&wallet, &mint, &crate::ID);
    let (spend, _) = find_asset_policy_spend_address(&wallet, &mint, &crate::ID);
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let mut data = vec![38u8];
    wincode::serialize_into(&mut data, &schedule_hash).unwrap();
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new_readonly(asset_policy, false),
            AccountMeta::new(spend, false),
            AccountMeta::new_readonly(vault, false),
            AccountMeta::new_readonly(intent, false),
            AccountMeta::new(schedule, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(source, false),
            AccountMeta::new(destination, false),
            AccountMeta::new_readonly(recipient, false),
            AccountMeta::new_readonly(quasar_svm::SPL_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

#[test]
fn csp2_usdc_policy_is_governed_and_shared_across_schedules() {
    let mut svm = setup_with_tokens();
    let payer = Pubkey::new_unique();
    let relayer = Pubkey::new_unique();
    let proposer = new_keypair();
    let recipient = Pubkey::new_unique();
    let mint: Pubkey = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        .parse()
        .unwrap();
    let amount = 1_250_000u64;
    let initial_supply = amount * 4;
    let wallet_name = "csp2-recurring-usdc";

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
    let source = Pubkey::new_unique();
    let destination = Pubkey::new_unique();
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
        &source,
        &TokenAccount {
            mint,
            owner: vault,
            amount: initial_supply,
            state: AccountState::Initialized,
            ..Default::default()
        },
    ));
    svm.set_account(create_keyed_token_account(
        &destination,
        &TokenAccount {
            mint,
            owner: recipient,
            amount: 0,
            state: AccountState::Initialized,
            ..Default::default()
        },
    ));

    let policy = csp2_usdc_policy(mint, recipient, amount);
    let commitment = v4_policy_commitment(&policy);
    assert_eq!(hash_typed_policy(&policy), commitment);
    let expiry = typed_test_expiry();
    let mut update_canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let update_len = encode_v4_asset_policy_update(
        &V4AssetPolicyUpdateInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network: V4Network::SolanaDevnet,
                proposal_index: 0,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(&proposer),
                action_id: sha256_hash(b"csp2-policy-action"),
                nonce: sha256_hash(b"csp2-policy-nonce"),
                expires_at: expiry,
                policy_commitment: [0u8; 32],
                approval_required: 1,
            },
            chain_kind: 0,
            scope_kind: 1,
            decimals: 6,
            asset_id: mint.to_bytes(),
            display_asset: b"USDC",
            new_policy_commitment: commitment,
            reason: b"USDC recurring cap",
        },
        &mut update_canonical,
    )
    .unwrap();
    let parsed_update = parse_v4_intent(&update_canonical[..update_len]).unwrap();
    let V4Action::AssetPolicyUpdate(parsed_policy) = parsed_update.action else {
        panic!("asset policy update codec changed action kind");
    };
    assert_eq!(parsed_policy.new_policy_commitment, commitment);
    assert_eq!(v4_wallet_policy_commitment(&policy), commitment);
    let (update_proposal, _, update_envelope) = submit_typed_v4_proposal(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        0,
        &proposer,
        &policy,
        &update_canonical[..update_len],
        1,
    );
    let (asset_policy, _) = find_asset_policy_address(&wallet, &mint, &crate::ID);
    let update = asset_policy_update_ix(
        payer,
        wallet,
        intent,
        update_proposal,
        mint,
        [0u8; 32],
        update_envelope,
        &policy,
    );
    let result = svm.process_instruction(
        &update,
        &[funded_account(payer), empty_account(asset_policy)],
    );
    if result.is_err() {
        result.print_logs();
    }
    assert!(result.is_ok());

    // A stale-current replay cannot replace or clear the newly active policy.
    assert!(svm.process_instruction(&update, &[]).is_err());

    let execution_commitment = v4_execution_commitment(&[
        b"spl_recurring_payment",
        mint.as_ref(),
        source.as_ref(),
        destination.as_ref(),
    ]);
    let mut schedules = Vec::new();
    for (proposal_index, label) in [
        (1u64, b"schedule-a".as_slice()),
        (2u64, b"schedule-b".as_slice()),
    ] {
        let schedule_hash = sha256_hash(label);
        let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
        let canonical_len = encode_v4_recurring_schedule(
            &V4RecurringScheduleInput {
                common: V4CommonFields {
                    profile: V4DeviceProfile::Full,
                    network: V4Network::SolanaDevnet,
                    proposal_index,
                    wallet_id: wallet.to_bytes(),
                    actor: pubkey_bytes(&proposer),
                    action_id: sha256_hash(&[label, b"-action"].concat()),
                    nonce: sha256_hash(&[label, b"-nonce"].concat()),
                    expires_at: expiry,
                    policy_commitment: commitment,
                    approval_required: 1,
                },
                schedule_id: label,
                payment: V4TransferRowInput {
                    recipient_encoding: V4IdentityEncoding::SolanaPubkey,
                    recipient: recipient.as_ref(),
                    asset_encoding: V4IdentityEncoding::SolanaPubkey,
                    asset: mint.as_ref(),
                    raw_amount: amount as u128,
                    decimals: 6,
                    display_asset: b"USDC",
                },
                execution_commitment,
                interval_seconds: 3_600,
                first_execution_at: 0,
                payment_count: 2,
                status: 1,
                reason: b"Bound CSP2 payment",
            },
            &mut canonical,
        )
        .unwrap();
        let (proposal, _, envelope) = submit_typed_v4_proposal(
            &mut svm,
            payer,
            wallet_name,
            wallet,
            intent,
            proposal_index,
            &proposer,
            &policy,
            &canonical[..canonical_len],
            1,
        );
        let (schedule, _) = find_recurring_schedule_address(&wallet, &schedule_hash, &crate::ID);
        let configure = recurring_asset_schedule_ix(
            payer,
            wallet,
            intent,
            proposal,
            schedule,
            mint,
            source,
            destination,
            recipient,
            commitment,
            envelope,
            schedule_hash,
            amount,
        );
        let result = svm.process_instruction(&configure, &[empty_account(schedule)]);
        if result.is_err() {
            result.print_logs();
        }
        assert!(result.is_ok());
        schedules.push((schedule, schedule_hash));
    }

    let (spend, _) = find_asset_policy_spend_address(&wallet, &mint, &crate::ID);
    let first = recurring_asset_payment_ix(
        relayer,
        wallet,
        intent,
        schedules[0].0,
        mint,
        source,
        destination,
        recipient,
        schedules[0].1,
    );
    let result = svm.process_instruction(&first, &[funded_account(relayer), empty_account(spend)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(result.is_ok());

    let second = recurring_asset_payment_ix(
        relayer,
        wallet,
        intent,
        schedules[1].0,
        mint,
        source,
        destination,
        recipient,
        schedules[1].1,
    );
    let second_result = svm.process_instruction(&second, &[]);
    assert!(
        second_result.is_err(),
        "a second schedule must not bypass the wallet-wide USDC velocity/count ledger",
    );
    let destination_state =
        TokenAccount::unpack(&svm.get_account(&destination).unwrap().data).unwrap();
    assert_eq!(destination_state.amount, amount);
}
