use super::*;

#[test]
fn test_execute_typed_escrow_release_moves_sol() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-release";
    let amount_lamports = 2_000_000u64;
    let escrow_id_hash = sha256_hash(b"escrow-release-1");
    let milestone_id_hash = sha256_hash(b"milestone-1");

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
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
    let recipient = Pubkey::new_unique();
    let (proposal, policy_commitment, envelope_hash) = propose_typed_escrow_release_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        &proposer,
        V4Network::SolanaDevnet,
        b"escrow-release-1",
        b"milestone-1",
        V4TransferRowInput {
            recipient_encoding: V4IdentityEncoding::SolanaPubkey,
            recipient: recipient.as_ref(),
            asset_encoding: V4IdentityEncoding::Text,
            asset: b"SOL",
            raw_amount: amount_lamports as u128,
            decimals: 9,
            display_asset: b"SOL",
        },
        [0u8; 32],
    );

    let vault = fund_vault(&mut svm, payer, wallet, amount_lamports + 1_000_000);
    let vault_pre = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    let execute = build_execute_typed_escrow_release_ix(
        wallet,
        intent,
        proposal,
        recipient,
        policy_commitment,
        envelope_hash,
        amount_lamports,
        escrow_id_hash,
        milestone_id_hash,
    );
    let result = svm.process_instruction(&execute, &[empty_account(recipient)]);
    assert!(
        result.is_ok(),
        "typed escrow release execute failed: {:?}",
        result.raw_result
    );

    assert_eq!(
        svm.get_account(&recipient).map(|a| a.lamports).unwrap_or(0),
        amount_lamports
    );
    assert_eq!(
        svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0),
        vault_pre - amount_lamports
    );
    assert_eq!(
        svm.get_account(&proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );

    let recipient_after_first = svm.get_account(&recipient).unwrap();
    let vault_after_first = svm.get_account(&vault).unwrap().lamports;
    let replay = svm.process_instruction(
        &execute,
        &[
            funded_account(payer),
            empty_wallet_policy_account(wallet),
            empty_policy_spend_account(wallet, intent, policy_commitment),
            empty_member_allowance_account(wallet, intent),
            recipient_after_first,
        ],
    );
    assert!(
        replay.is_err(),
        "executed typed send must not execute twice"
    );
    assert_eq!(
        svm.get_account(&recipient).unwrap().lamports,
        amount_lamports,
        "duplicate execute moved recipient funds twice"
    );
    assert_eq!(
        svm.get_account(&vault).unwrap().lamports,
        vault_after_first,
        "duplicate execute debited the vault twice"
    );
}

#[test]
fn test_execute_typed_spl_escrow_release_moves_tokens() {
    use quasar_svm::token::{
        create_keyed_mint_account, create_keyed_token_account, Mint, TokenAccount,
    };
    use spl_token::solana_program::program_pack::Pack;
    use spl_token::state::AccountState;

    let mut svm = setup_with_tokens();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-spl-release";
    let amount_tokens = 250_000u64;
    let initial_supply = 1_000_000u64;
    let escrow_id_hash = sha256_hash(b"spl-escrow-release-1");
    let milestone_id_hash = sha256_hash(b"spl-milestone-1");

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let proposal_index = 0u64;
    let mint = Pubkey::new_unique();
    let recipient_owner = Pubkey::new_unique();
    let source_token = Pubkey::new_unique();
    let destination_token = Pubkey::new_unique();

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
    svm.set_account(create_keyed_token_account(
        &destination_token,
        &TokenAccount {
            mint,
            owner: recipient_owner,
            amount: 0,
            state: AccountState::Initialized,
            ..Default::default()
        },
    ));

    let execution_commitment = v4_execution_commitment(&[
        b"spl_escrow_release",
        mint.as_ref(),
        source_token.as_ref(),
        destination_token.as_ref(),
    ]);
    let (proposal, policy_commitment, envelope_hash) = propose_typed_escrow_release_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        &proposer,
        V4Network::SolanaDevnet,
        b"spl-escrow-release-1",
        b"spl-milestone-1",
        V4TransferRowInput {
            recipient_encoding: V4IdentityEncoding::SolanaPubkey,
            recipient: recipient_owner.as_ref(),
            asset_encoding: V4IdentityEncoding::SolanaPubkey,
            asset: mint.as_ref(),
            raw_amount: amount_tokens as u128,
            decimals: 6,
            display_asset: b"SPL",
        },
        execution_commitment,
    );

    let execute = build_execute_typed_spl_escrow_release_ix(
        wallet,
        intent,
        proposal,
        mint,
        source_token,
        destination_token,
        recipient_owner,
        policy_commitment,
        envelope_hash,
        amount_tokens,
        escrow_id_hash,
        milestone_id_hash,
    );
    let result = svm.process_instruction(&execute, &[empty_account(recipient_owner)]);
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed SPL escrow release execute failed: {:?}",
        result.raw_result
    );

    let source_account = svm.get_account(&source_token).unwrap();
    let source_state: TokenAccount = TokenAccount::unpack(&source_account.data).unwrap();
    assert_eq!(source_state.amount, initial_supply - amount_tokens);

    let destination_account = svm.get_account(&destination_token).unwrap();
    let destination_state: TokenAccount = TokenAccount::unpack(&destination_account.data).unwrap();
    assert_eq!(destination_state.amount, amount_tokens);
    assert_eq!(destination_state.owner, recipient_owner);
    assert_eq!(destination_state.mint, mint);
    assert_eq!(
        svm.get_account(&proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );
}

#[test]
fn test_execute_typed_spl_escrow_return_moves_tokens_to_funders() {
    use quasar_svm::token::{
        create_keyed_mint_account, create_keyed_token_account, Mint, TokenAccount,
    };
    use spl_token::solana_program::program_pack::Pack;
    use spl_token::state::AccountState;

    let mut svm = setup_with_tokens();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let wallet_name = "typed-spl-return";
    let initial_supply = 1_000_000u64;
    let amount_a = 125_000u64;
    let amount_b = 275_000u64;
    let escrow_id_hash = sha256_hash(b"spl-escrow-return-1");

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&proposer)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let proposal_index = 0u64;
    let mint = Pubkey::new_unique();
    let funder_a = Pubkey::new_unique();
    let funder_b = Pubkey::new_unique();
    let source_token = Pubkey::new_unique();
    let destination_a = Pubkey::new_unique();
    let destination_b = Pubkey::new_unique();

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
    svm.set_account(create_keyed_token_account(
        &destination_a,
        &TokenAccount {
            mint,
            owner: funder_a,
            amount: 0,
            state: AccountState::Initialized,
            ..Default::default()
        },
    ));
    svm.set_account(create_keyed_token_account(
        &destination_b,
        &TokenAccount {
            mint,
            owner: funder_b,
            amount: 0,
            state: AccountState::Initialized,
            ..Default::default()
        },
    ));

    let execution_commitment = v4_spl_return_execution_commitment(
        mint.as_ref(),
        source_token.as_ref(),
        [destination_a.as_ref(), destination_b.as_ref()].into_iter(),
    );
    let rows = [
        V4TransferRowInput {
            recipient_encoding: V4IdentityEncoding::SolanaPubkey,
            recipient: funder_a.as_ref(),
            asset_encoding: V4IdentityEncoding::SolanaPubkey,
            asset: mint.as_ref(),
            raw_amount: amount_a as u128,
            decimals: 6,
            display_asset: b"SPL",
        },
        V4TransferRowInput {
            recipient_encoding: V4IdentityEncoding::SolanaPubkey,
            recipient: funder_b.as_ref(),
            asset_encoding: V4IdentityEncoding::SolanaPubkey,
            asset: mint.as_ref(),
            raw_amount: amount_b as u128,
            decimals: 6,
            display_asset: b"SPL",
        },
    ];
    let (proposal, policy_commitment, envelope_hash) = propose_typed_escrow_return_on_wallet(
        &mut svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        &proposer,
        V4Network::SolanaDevnet,
        b"spl-escrow-return-1",
        &rows,
        execution_commitment,
    );

    let mut amount_bytes = Vec::new();
    amount_bytes.extend_from_slice(&amount_a.to_le_bytes());
    amount_bytes.extend_from_slice(&amount_b.to_le_bytes());
    let execute = build_execute_typed_spl_escrow_return_ix(
        wallet,
        intent,
        proposal,
        mint,
        source_token,
        policy_commitment,
        envelope_hash,
        escrow_id_hash,
        amount_bytes,
        vec![
            AccountMeta::new(destination_a, false),
            AccountMeta::new_readonly(funder_a, false),
            AccountMeta::new(destination_b, false),
            AccountMeta::new_readonly(funder_b, false),
        ],
    );
    let result = svm.process_instruction(
        &execute,
        &[empty_account(funder_a), empty_account(funder_b)],
    );
    if result.is_err() {
        result.print_logs();
    }
    assert!(
        result.is_ok(),
        "typed SPL escrow return execute failed: {:?}",
        result.raw_result
    );

    let source_account = svm.get_account(&source_token).unwrap();
    let source_state: TokenAccount = TokenAccount::unpack(&source_account.data).unwrap();
    assert_eq!(source_state.amount, initial_supply - amount_a - amount_b);

    let destination_a_account = svm.get_account(&destination_a).unwrap();
    let destination_a_state: TokenAccount =
        TokenAccount::unpack(&destination_a_account.data).unwrap();
    assert_eq!(destination_a_state.amount, amount_a);
    assert_eq!(destination_a_state.owner, funder_a);

    let destination_b_account = svm.get_account(&destination_b).unwrap();
    let destination_b_state: TokenAccount =
        TokenAccount::unpack(&destination_b_account.data).unwrap();
    assert_eq!(destination_b_state.amount, amount_b);
    assert_eq!(destination_b_state.owner, funder_b);
    assert_eq!(
        svm.get_account(&proposal).unwrap().data[105],
        2,
        "typed proposal should be Executed(2)"
    );
}
