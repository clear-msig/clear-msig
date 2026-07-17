use super::*;

#[test]
fn test_execute_spl_token_transfer() {
    use quasar_svm::token::{
        create_keyed_mint_account, create_keyed_token_account, Mint, TokenAccount,
    };
    use quasar_svm::{SPL_ASSOCIATED_TOKEN_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID};
    use spl_token::solana_program::program_pack::Pack;
    use spl_token::state::AccountState;

    let mut svm = setup_with_tokens();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "token-transfer";
    let transfer_amount = 500_000u64;

    // 1. Create the wallet
    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    svm.process_instruction(&instruction, &accounts).unwrap();

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (vault, _) = find_vault_address(&wallet, &crate::ID);

    // 2. Add a transfer_tokens intent
    let built_intent = intents::transfer_tokens::build(&intents::transfer_sol::IntentConfig {
        proposers: &[pubkey_of(&proposer)],
        approvers: &[pubkey_of(&approver)],
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 0,
    });
    let intent_body = built_intent.serialize_body(&wallet, 0, 3, 3);
    let (new_intent_address, _) = find_intent_address(&wallet, 3, &crate::ID);

    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: add_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: intent_body,
        msg_fn: &add_intent_msg,
        execute_remaining: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(new_intent_address, false),
        ],
        execute_extra_accounts: vec![funded_account(payer), empty_account(new_intent_address)],
    });
    assert_eq!(
        svm.get_account(&new_intent_address).unwrap().data[0],
        2,
        "intent created"
    );

    // 3. Set up token accounts
    let mint_address = Pubkey::new_unique();
    let destination_wallet = Pubkey::new_unique();
    let decimals = 6u8;
    let initial_supply = 1_000_000u64;

    // Create mint
    let mint_account = create_keyed_mint_account(
        &mint_address,
        &Mint {
            decimals,
            supply: initial_supply,
            is_initialized: true,
            ..Default::default()
        },
    );

    // Derive ATAs
    let (source_ata, _) = Pubkey::find_program_address(
        &[
            vault.as_ref(),
            SPL_TOKEN_PROGRAM_ID.as_ref(),
            mint_address.as_ref(),
        ],
        &SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    let (dest_ata, _) = Pubkey::find_program_address(
        &[
            destination_wallet.as_ref(),
            SPL_TOKEN_PROGRAM_ID.as_ref(),
            mint_address.as_ref(),
        ],
        &SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Create source ATA with tokens
    let source_token_account = create_keyed_token_account(
        &source_ata,
        &TokenAccount {
            mint: mint_address,
            owner: vault,
            amount: initial_supply,
            state: AccountState::Initialized,
            ..Default::default()
        },
    );

    // Load token accounts into SVM
    svm.set_account(mint_account);
    svm.set_account(source_token_account);

    // Fund the vault with SOL for ATA creation rent via system transfer
    let fund_vault_ix = solana_instruction::Instruction {
        program_id: quasar_svm::system_program::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(vault, false),
        ],
        data: {
            let mut d = vec![2, 0, 0, 0]; // Transfer instruction
            d.extend_from_slice(&10_000_000_000u64.to_le_bytes());
            d
        },
    };
    svm.process_instruction(
        &fund_vault_ix,
        &[funded_account(payer), empty_account(vault)],
    )
    .unwrap();

    // 4. Build params_data for the token transfer proposal
    // The transfer_tokens intent params are: destination(address), mint(address), amount(u64)
    let mut params_data = Vec::new();
    params_data.extend_from_slice(destination_wallet.as_ref()); // param 0: destination (32 bytes)
    params_data.extend_from_slice(mint_address.as_ref()); // param 1: mint (32 bytes)
    params_data.extend_from_slice(&transfer_amount.to_le_bytes()); // param 2: amount (8 bytes)

    // 5. Build the human-readable message for this custom intent
    // Template: "transfer {2} of mint {1} to {0}"
    // This needs to match what the on-chain message builder produces.
    let rendered_template = format!(
        "transfer {transfer_amount} of mint {} to {}",
        bs58::encode(mint_address.as_ref()).into_string(),
        bs58::encode(destination_wallet.as_ref()).into_string(),
    );
    let propose_msg = wrap_offchain(
        format!(
            "expires {}: propose {rendered_template}{}",
            format_timestamp(DEFAULT_EXPIRY),
            message_suffix(wallet_name, 1), // proposal_index = 1 (we already used 0 for add intent)
        )
        .as_bytes(),
    );
    let approve_msg = wrap_offchain(
        format!(
            "expires {}: approve {rendered_template}{}",
            format_timestamp(DEFAULT_EXPIRY),
            message_suffix(wallet_name, 1),
        )
        .as_bytes(),
    );

    let proposal_address = get_proposal_address(new_intent_address, 1);

    // 6. Propose the token transfer
    let instruction = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent: new_intent_address,
        proposal_index: 1,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &propose_msg),
        params_data: params_data.clone(),
    });
    let result = svm.process_instruction(
        &instruction,
        &[funded_account(payer), empty_account(proposal_address)],
    );
    assert!(
        result.is_ok(),
        "propose token transfer failed: {:?}",
        result.raw_result
    );
    println!("  TOKEN PROPOSE CU: {}", result.compute_units_consumed);

    // 7. Approve the token transfer
    let instruction = build_approve_ix(
        wallet,
        new_intent_address,
        proposal_address,
        DEFAULT_EXPIRY,
        0,
        sign_message(&approver, &approve_msg),
    );
    let result = svm.process_instruction(&instruction, &[]);
    assert!(
        result.is_ok(),
        "approve token transfer failed: {:?}",
        result.raw_result
    );
    println!("  TOKEN APPROVE CU: {}", result.compute_units_consumed);

    // 8. Execute the token transfer
    // The transfer_tokens intent defines these accounts:
    //   0: Token Program, 1: ATA Program, 2: System Program,
    //   3: Vault, 4: Destination wallet, 5: Mint,
    //   6: Source ATA (PDA), 7: Dest ATA (PDA)
    let (execute_instruction, _execute_vault) = build_execute_ix(
        wallet,
        new_intent_address,
        proposal_address,
        vec![
            AccountMeta::new_readonly(SPL_TOKEN_PROGRAM_ID, false),
            AccountMeta::new_readonly(SPL_ASSOCIATED_TOKEN_PROGRAM_ID, false),
            // system_program and vault are NOT passed — they're injected from
            // declared Execute accounts (quasar rejects duplicate remaining accounts)
            AccountMeta::new_readonly(destination_wallet, false),
            AccountMeta::new_readonly(mint_address, false),
            AccountMeta::new(source_ata, false),
            AccountMeta::new(dest_ata, false),
        ],
    );
    let result = svm.process_instruction(
        &execute_instruction,
        &[empty_account(destination_wallet), empty_account(dest_ata)],
    );
    assert!(
        result.is_ok(),
        "execute token transfer failed: {:?}",
        result.raw_result
    );
    println!("  TOKEN EXECUTE CU: {}", result.compute_units_consumed);

    // 9. Verify the transfer happened
    let dest_account_data = svm.get_account(&dest_ata).unwrap();
    assert_eq!(
        dest_account_data.owner, SPL_TOKEN_PROGRAM_ID,
        "dest ATA should be owned by token program"
    );

    // Parse the token account to check amount
    let dest_token: TokenAccount = TokenAccount::unpack(&dest_account_data.data).unwrap();
    assert_eq!(
        dest_token.amount, transfer_amount,
        "dest should have received tokens"
    );
    assert_eq!(
        dest_token.owner, destination_wallet,
        "dest ATA should be owned by destination wallet"
    );
    assert_eq!(
        dest_token.mint, mint_address,
        "dest ATA should have correct mint"
    );

    // Check source was debited
    let source_account_data = svm.get_account(&source_ata).unwrap();
    let source_token: TokenAccount = TokenAccount::unpack(&source_account_data.data).unwrap();
    assert_eq!(
        source_token.amount,
        initial_supply - transfer_amount,
        "source should be debited"
    );

    println!("  TOKEN_TRANSFER: {transfer_amount} tokens transferred successfully!");
}

#[test]
fn test_execute_sol_transfer() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "sol-transfer";
    let transfer_amount = 100_000_000u64; // 0.1 SOL — same shape as the live test we just ran

    // 1. Create the wallet.
    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    svm.process_instruction(&instruction, &accounts).unwrap();

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (vault, _) = find_vault_address(&wallet, &crate::ID);

    // 2. Add the SOL transfer intent at slot 3 via the AddIntent
    //    meta path. Same intent shape as
    //    examples/intents/solana_transfer.json: 2 params + 3
    //    accounts (system / vault / param-0) + 1 System Transfer
    //    instruction.
    let built_intent = intents::transfer_sol::build(&intents::transfer_sol::IntentConfig {
        proposers: &[pubkey_of(&proposer)],
        approvers: &[pubkey_of(&approver)],
        approval_threshold: 1,
        cancellation_threshold: 1,
        timelock_seconds: 0,
    });
    let intent_body = built_intent.serialize_body(&wallet, 0, 3, 3);
    let (new_intent_address, _) = find_intent_address(&wallet, 3, &crate::ID);

    propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: add_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: intent_body,
        msg_fn: &add_intent_msg,
        execute_remaining: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(new_intent_address, false),
        ],
        execute_extra_accounts: vec![funded_account(payer), empty_account(new_intent_address)],
    });
    assert_eq!(
        svm.get_account(&new_intent_address).unwrap().data[0],
        2,
        "intent created"
    );

    // 3. Fund the vault with enough SOL to cover the transfer +
    //    rent-exempt minimum. System Transfer between System-owned
    //    accounts works as long as the source has the balance.
    let fund_amount = transfer_amount + 5_000_000; // 0.1 + 0.005 SOL
    let fund_vault_ix = solana_instruction::Instruction {
        program_id: quasar_svm::system_program::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(vault, false),
        ],
        data: {
            let mut d = vec![2, 0, 0, 0]; // System Transfer discriminator
            d.extend_from_slice(&fund_amount.to_le_bytes());
            d
        },
    };
    svm.process_instruction(
        &fund_vault_ix,
        &[funded_account(payer), empty_account(vault)],
    )
    .unwrap();
    let vault_pre = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    assert!(
        vault_pre >= fund_amount,
        "vault should be funded; got {vault_pre}",
    );

    // 4. Build params_data for the SOL transfer proposal.
    //    Params per transfer_sol.rs: [destination(address), amount(u64)].
    let destination = Pubkey::new_unique();
    let mut params_data = Vec::new();
    params_data.extend_from_slice(destination.as_ref()); // 32 bytes
    params_data.extend_from_slice(&transfer_amount.to_le_bytes()); // 8 bytes

    // 5. Render the human-readable message the on-chain builder
    //    will reproduce exactly. Template is
    //    "transfer {1:10^9} SOL to {0}". Param[0] is base58'd
    //    address, param[1] is lamports rendered as display SOL.
    let rendered_template = format!(
        "transfer 0.1 SOL to {}",
        bs58::encode(destination.as_ref()).into_string(),
    );
    let propose_msg = wrap_offchain(
        format!(
            "expires {}: propose {rendered_template}{}",
            format_timestamp(DEFAULT_EXPIRY),
            message_suffix(wallet_name, 1),
        )
        .as_bytes(),
    );
    let approve_msg = wrap_offchain(
        format!(
            "expires {}: approve {rendered_template}{}",
            format_timestamp(DEFAULT_EXPIRY),
            message_suffix(wallet_name, 1),
        )
        .as_bytes(),
    );

    let proposal_address = get_proposal_address(new_intent_address, 1);

    // 6. Propose the SOL transfer.
    let instruction = build_propose_ix(ProposeArgs {
        payer,
        wallet,
        intent: new_intent_address,
        proposal_index: 1,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(&proposer),
        signature: sign_message(&proposer, &propose_msg),
        params_data: params_data.clone(),
    });
    let result = svm.process_instruction(
        &instruction,
        &[funded_account(payer), empty_account(proposal_address)],
    );
    assert!(
        result.is_ok(),
        "propose SOL transfer failed: {:?}",
        result.raw_result
    );

    // 7. Approve.
    let instruction = build_approve_ix(
        wallet,
        new_intent_address,
        proposal_address,
        DEFAULT_EXPIRY,
        0,
        sign_message(&approver, &approve_msg),
    );
    let result = svm.process_instruction(&instruction, &[]);
    assert!(
        result.is_ok(),
        "approve SOL transfer failed: {:?}",
        result.raw_result
    );

    // 8. Execute. CRITICAL: only the destination is passed in
    //    remaining_accounts. The on-chain handler auto-injects
    //    system_program (Static matching declared) + vault (Vault
    //    source). Passing them in remaining_accounts here would
    //    misalign positions and trigger AccountAddressMismatch
    //    (0x1785) — that's exactly the regression this test
    //    guards.
    let (execute_instruction, _) = build_execute_ix(
        wallet,
        new_intent_address,
        proposal_address,
        vec![
            // ONLY the destination — vault and system_program are
            // auto-injected by execute_custom from `declared`.
            AccountMeta::new(destination, false),
        ],
    );
    let result = svm.process_instruction(&execute_instruction, &[empty_account(destination)]);
    assert!(
        result.is_ok(),
        "execute SOL transfer failed: {:?}",
        result.raw_result,
    );

    // 9. Verify lamports actually moved. This is the assertion
    //    that would have caught the silent no-op outright.
    let dest_lamports = svm
        .get_account(&destination)
        .map(|a| a.lamports)
        .unwrap_or(0);
    assert_eq!(
        dest_lamports, transfer_amount,
        "destination should have received exactly {transfer_amount} lamports",
    );
    let vault_post = svm.get_account(&vault).map(|a| a.lamports).unwrap_or(0);
    assert_eq!(
        vault_post,
        vault_pre - transfer_amount,
        "vault should have been debited by exactly {transfer_amount} lamports",
    );
}

#[test]
#[ignore] // quasar-svm returns UnbalancedInstruction on close; works on real validator
fn test_cleanup_executed_proposal() {
    let mut svm = setup();
    let payer = Pubkey::new_unique();
    let proposer = new_keypair();
    let approver = new_keypair();
    let wallet_name = "cleanup-test";

    let (instruction, accounts) = create_wallet_ix(
        payer,
        wallet_name,
        &[pubkey_of(&proposer)],
        &[pubkey_of(&approver)],
        1,
    );
    assert!(svm.process_instruction(&instruction, &accounts).is_ok());

    let (wallet, _) = find_wallet_address(
        wallet_name,
        &solana_address::Address::new_from_array(payer.to_bytes()),
        &crate::ID,
    );
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);

    let proposal_address = propose_approve_execute(ProposeApproveExecuteArgs {
        svm: &mut svm,
        payer,
        wallet,
        wallet_name,
        intent: remove_intent,
        proposal_index: 0,
        proposer: &proposer,
        approver: &approver,
        params_data: vec![0u8],
        msg_fn: &|action, expiry, wallet_name, proposal_index, data| {
            remove_intent_msg(action, expiry, wallet_name, proposal_index, data[0])
        },
        execute_remaining: vec![AccountMeta::new(add_intent, false)],
        execute_extra_accounts: vec![],
    });

    assert_eq!(
        svm.get_account(&proposal_address).unwrap().data[105],
        2,
        "should be Executed"
    );

    let instruction: Instruction = CleanupProposalInstruction {
        proposal: proposal_address,
        rent_refund: payer,
    }
    .into();
    let result = svm.process_instruction(&instruction, &[]);
    assert!(result.is_ok(), "cleanup failed: {:?}", result.raw_result);

    let account = svm.get_account(&proposal_address);
    assert!(
        account.is_none_or(|a| a.data.is_empty() || a.lamports == 0),
        "proposal should be closed"
    );
    println!("  CLEANUP: proposal closed successfully");
}
