use super::*;

/// Build execute_typed_agent_trade_approval instruction (typed proposal discriminator 23).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_agent_trade_approval(
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
    let accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new(session, false),
        AccountMeta::new(risk_ledger, false),
    ];

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
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_agent_risk_policy instruction (discriminator 29).
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_agent_risk_policy(
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
    max_loss_raw_le: [u8; 16],
    status: u8,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(session, false),
        AccountMeta::new(risk_ledger, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];
    let mut data = vec![29u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &session_id_hash).unwrap();
    wincode::serialize_into(&mut data, &oracle_policy_hash).unwrap();
    wincode::serialize_into(&mut data, &max_loss_raw_le).unwrap();
    wincode::serialize_into(&mut data, &status).unwrap();
    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_agent_trade_settlement instruction (discriminator 30).
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_agent_trade_settlement(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    session: Pubkey,
    risk_ledger: Pubkey,
    settlement_receipt: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    session_id_hash: [u8; 32],
    execution_id_hash: [u8; 32],
    settlement_artifact_hash: [u8; 32],
    oracle_policy_hash: [u8; 32],
    closed_notional_raw_le: [u8; 16],
    outcome: u8,
    pnl_abs_raw_le: [u8; 16],
    settlement_sequence: u64,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new(session, false),
        AccountMeta::new(risk_ledger, false),
        AccountMeta::new(settlement_receipt, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];
    let mut data = vec![30u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &session_id_hash).unwrap();
    wincode::serialize_into(&mut data, &execution_id_hash).unwrap();
    wincode::serialize_into(&mut data, &settlement_artifact_hash).unwrap();
    wincode::serialize_into(&mut data, &oracle_policy_hash).unwrap();
    wincode::serialize_into(&mut data, &closed_notional_raw_le).unwrap();
    wincode::serialize_into(&mut data, &outcome).unwrap();
    wincode::serialize_into(&mut data, &pnl_abs_raw_le).unwrap();
    wincode::serialize_into(&mut data, &settlement_sequence).unwrap();
    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}

/// Build execute_typed_agent_session_grant instruction (typed proposal discriminator 28).
#[allow(dead_code)]
#[allow(clippy::too_many_arguments)]
pub fn execute_typed_agent_session_grant(
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
    max_notional_raw_le: [u8; 16],
    max_leverage_x100: u32,
    expires_at: i64,
    status: u8,
) -> Instruction {
    let accounts = vec![
        AccountMeta::new(payer, true),
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new(session, false),
        AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
    ];
    let mut data = vec![28u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &session_id_hash).unwrap();
    wincode::serialize_into(&mut data, &agent_id_hash).unwrap();
    wincode::serialize_into(&mut data, &venue_hash).unwrap();
    wincode::serialize_into(&mut data, &market_hash).unwrap();
    wincode::serialize_into(&mut data, &max_notional_raw_le).unwrap();
    wincode::serialize_into(&mut data, &max_leverage_x100).unwrap();
    wincode::serialize_into(&mut data, &expires_at).unwrap();
    wincode::serialize_into(&mut data, &status).unwrap();
    Instruction {
        program_id: program_id(),
        accounts,
        data,
    }
}
