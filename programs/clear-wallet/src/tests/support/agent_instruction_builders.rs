#[allow(clippy::too_many_arguments)]
fn build_execute_typed_agent_trade_approval_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    session: Pubkey,
    risk_ledger: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_raw_le: [u8; 16],
    agent_id_hash: [u8; 32],
    venue_hash: [u8; 32],
    market_hash: [u8; 32],
    side_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    max_leverage_x100: u32,
    session_id_hash: [u8; 32],
    route_hash: [u8; 32],
    risk_check_hash: [u8; 32],
) -> Instruction {
    let mut data = vec![23u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &agent_id_hash).unwrap();
    wincode::serialize_into(&mut data, &venue_hash).unwrap();
    wincode::serialize_into(&mut data, &market_hash).unwrap();
    wincode::serialize_into(&mut data, &side_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &max_leverage_x100).unwrap();
    wincode::serialize_into(&mut data, &session_id_hash).unwrap();
    wincode::serialize_into(&mut data, &route_hash).unwrap();
    wincode::serialize_into(&mut data, &risk_check_hash).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new(session, false),
            AccountMeta::new(risk_ledger, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_agent_session_grant_ix(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    session: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    session_id_hash: [u8; 32],
    agent_id_hash: [u8; 32],
    venue_hash: [u8; 32],
    market_hash: [u8; 32],
    max_notional_raw: u128,
    max_leverage_x100: u32,
    expires_at: i64,
    status: u8,
) -> Instruction {
    let mut data = vec![28u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &session_id_hash).unwrap();
    wincode::serialize_into(&mut data, &agent_id_hash).unwrap();
    wincode::serialize_into(&mut data, &venue_hash).unwrap();
    wincode::serialize_into(&mut data, &market_hash).unwrap();
    wincode::serialize_into(&mut data, &max_notional_raw.to_le_bytes()).unwrap();
    wincode::serialize_into(&mut data, &max_leverage_x100).unwrap();
    wincode::serialize_into(&mut data, &expires_at).unwrap();
    wincode::serialize_into(&mut data, &status).unwrap();
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new(session, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_agent_risk_policy_ix(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    session: Pubkey,
    risk_ledger: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    session_id_hash: [u8; 32],
    oracle_policy_hash: [u8; 32],
    max_loss_raw: u128,
    status: u8,
) -> Instruction {
    let mut data = vec![29u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &session_id_hash).unwrap();
    wincode::serialize_into(&mut data, &oracle_policy_hash).unwrap();
    wincode::serialize_into(&mut data, &max_loss_raw.to_le_bytes()).unwrap();
    wincode::serialize_into(&mut data, &status).unwrap();
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(session, false),
            AccountMeta::new(risk_ledger, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_agent_trade_settlement_ix(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    session: Pubkey,
    risk_ledger: Pubkey,
    receipt: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    session_id_hash: [u8; 32],
    execution_id_hash: [u8; 32],
    settlement_artifact_hash: [u8; 32],
    oracle_policy_hash: [u8; 32],
    closed_notional_raw: u128,
    outcome: u8,
    pnl_abs_raw: u128,
    settlement_sequence: u64,
) -> Instruction {
    let mut data = vec![30u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &session_id_hash).unwrap();
    wincode::serialize_into(&mut data, &execution_id_hash).unwrap();
    wincode::serialize_into(&mut data, &settlement_artifact_hash).unwrap();
    wincode::serialize_into(&mut data, &oracle_policy_hash).unwrap();
    wincode::serialize_into(&mut data, &closed_notional_raw.to_le_bytes()).unwrap();
    wincode::serialize_into(&mut data, &outcome).unwrap();
    wincode::serialize_into(&mut data, &pnl_abs_raw.to_le_bytes()).unwrap();
    wincode::serialize_into(&mut data, &settlement_sequence).unwrap();
    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new(session, false),
            AccountMeta::new(risk_ledger, false),
            AccountMeta::new(receipt, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

fn active_agent_session_account(
    wallet: Pubkey,
    session_id_hash: [u8; 32],
    agent_id_hash: [u8; 32],
    venue_hash: [u8; 32],
    market_hash: [u8; 32],
    policy_commitment: [u8; 32],
    max_notional_raw: u128,
    max_leverage_x100: u32,
    expires_at: i64,
) -> Account {
    let (session, bump) = find_agent_session_address(&wallet, &session_id_hash, &crate::ID);
    let mut data = vec![0u8; 1 + 32 + 32 + 32 + 32 + 32 + 32 + 16 + 4 + 8 + 16 + 1 + 1];
    data[0] = 9; // AGENT_SESSION_DISCRIMINATOR
    let mut offset = 1;
    data[offset..offset + 32].copy_from_slice(wallet.as_ref());
    offset += 32;
    data[offset..offset + 32].copy_from_slice(&session_id_hash);
    offset += 32;
    data[offset..offset + 32].copy_from_slice(&agent_id_hash);
    offset += 32;
    data[offset..offset + 32].copy_from_slice(&venue_hash);
    offset += 32;
    data[offset..offset + 32].copy_from_slice(&market_hash);
    offset += 32;
    data[offset..offset + 32].copy_from_slice(&policy_commitment);
    offset += 32;
    data[offset..offset + 16].copy_from_slice(&max_notional_raw.to_le_bytes());
    offset += 16;
    data[offset..offset + 4].copy_from_slice(&max_leverage_x100.to_le_bytes());
    offset += 4;
    data[offset..offset + 8].copy_from_slice(&expires_at.to_le_bytes());
    offset += 8;
    data[offset..offset + 16].copy_from_slice(&0u128.to_le_bytes());
    offset += 16;
    data[offset] = 1; // ACTIVE
    offset += 1;
    data[offset] = bump;
    Account {
        address: session,
        lamports: 1_000_000,
        data,
        owner: crate::ID,
        executable: false,
    }
}

#[allow(clippy::too_many_arguments)]
fn active_agent_risk_account(
    wallet: Pubkey,
    session_id_hash: [u8; 32],
    oracle_policy_hash: [u8; 32],
    max_loss_raw: u128,
    realized_loss_raw: u128,
    open_notional_raw: u128,
    next_settlement_sequence: u64,
    status: u8,
) -> Account {
    let (risk, bump) = find_agent_risk_address(&wallet, &session_id_hash, &crate::ID);
    let mut data = vec![0u8; crate::state::AGENT_RISK_LEDGER_LEN];
    let ledger = crate::state::AgentRiskLedger {
        wallet: solana_address::Address::new_from_array(wallet.to_bytes()),
        session_id_hash,
        oracle_policy_hash,
        max_loss_raw_le: max_loss_raw.to_le_bytes(),
        realized_loss_raw_le: realized_loss_raw.to_le_bytes(),
        open_notional_raw_le: open_notional_raw.to_le_bytes(),
        next_settlement_sequence,
        last_settlement_artifact_hash: [0u8; 32],
        status,
        bump,
    };
    unsafe { ledger.write(data.as_mut_ptr()) };
    Account {
        address: risk,
        lamports: 1_000_000,
        data,
        owner: crate::ID,
        executable: false,
    }
}

fn build_execute_typed_escrow_return_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    escrow_id_hash: [u8; 32],
    amount_lamports_le: Vec<u8>,
    remaining_accounts: Vec<AccountMeta>,
) -> Instruction {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let mut data = vec![13u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    data.extend_from_slice(&amount_lamports_le);

    let mut accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
    ];
    accounts.extend(remaining_accounts);

    Instruction {
        program_id: crate::ID,
        accounts,
        data,
    }
}

fn build_execute_typed_sol_send_ix(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    recipient: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_lamports: u64,
) -> Instruction {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let (policy_spend, _) = find_policy_spend_address(&wallet, &intent, &crate::ID);
    let (member_allowance, _) =
        clear_wallet_client::pda::find_member_allowance_address(&wallet, &intent, &crate::ID);
    let (wallet_policy, _) = find_wallet_policy_address(&wallet, &crate::ID);
    let mut data = vec![14u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_lamports).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(wallet_policy, false),
            AccountMeta::new(policy_spend, false),
            AccountMeta::new(member_allowance, false),
            AccountMeta::new(vault, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new(recipient, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

fn empty_policy_spend_account(
    wallet: Pubkey,
    intent: Pubkey,
    policy_commitment: [u8; 32],
) -> Account {
    let _ = policy_commitment;
    let (policy_spend, _) = find_policy_spend_address(&wallet, &intent, &crate::ID);
    empty_account(policy_spend)
}

fn empty_member_allowance_account(wallet: Pubkey, intent: Pubkey) -> Account {
    let (member_allowance, _) =
        clear_wallet_client::pda::find_member_allowance_address(&wallet, &intent, &crate::ID);
    empty_account(member_allowance)
}

fn empty_wallet_policy_account(wallet: Pubkey) -> Account {
    let (wallet_policy, _) = find_wallet_policy_address(&wallet, &crate::ID);
    empty_account(wallet_policy)
}

fn build_execute_typed_wallet_policy_update_ix(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    current_policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    chain_kind: u8,
    new_policy_bytes: &[u8],
) -> Instruction {
    let (wallet_policy, _) = find_wallet_policy_address(&wallet, &crate::ID);
    let mut data = vec![26u8];
    wincode::serialize_into(&mut data, &current_policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &chain_kind).unwrap();
    wincode::serialize_into(&mut data, &DynBytes::<u32>::new(new_policy_bytes.to_vec())).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(wallet_policy, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

fn build_execute_typed_sol_batch_send_ix(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_lamports_le: Vec<u8>,
    remaining_accounts: Vec<AccountMeta>,
) -> Instruction {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let (policy_spend, _) = find_policy_spend_address(&wallet, &intent, &crate::ID);
    let (member_allowance, _) =
        clear_wallet_client::pda::find_member_allowance_address(&wallet, &intent, &crate::ID);
    let (wallet_policy, _) = find_wallet_policy_address(&wallet, &crate::ID);
    let mut data = vec![15u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    data.extend_from_slice(&amount_lamports_le);

    let mut accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(wallet_policy, false),
        AccountMeta::new(policy_spend, false),
        AccountMeta::new(member_allowance, false),
        AccountMeta::new(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
    ];
    accounts.extend(remaining_accounts);

    Instruction {
        program_id: crate::ID,
        accounts,
        data,
    }
}

fn get_proposal_address(intent: Pubkey, index: u64) -> Pubkey {
    find_proposal_address(&intent, index, &crate::ID).0
}

fn get_typed_proposal_address(intent: Pubkey, index: u64) -> Pubkey {
    find_typed_proposal_address(&intent, index, &crate::ID).0
}
