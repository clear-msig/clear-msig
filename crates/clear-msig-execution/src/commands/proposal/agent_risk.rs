use super::*;

pub(super) struct RiskPolicyExecution {
    pub wallet: String,
    pub proposal: String,
    pub session_id_hash: String,
    pub oracle_policy_hash: String,
    pub max_loss_raw: u128,
    pub status: u8,
}

pub(super) fn execute_risk_policy(
    config: &RuntimeConfig,
    input: RiskPolicyExecution,
) -> Result<()> {
    if input.status != 1 && input.status != 2 {
        return Err(anyhow!("status must be 1 (active) or 2 (paused)"));
    }
    if input.status == 1 && input.max_loss_raw == 0 {
        return Err(anyhow!("active risk policy requires positive max loss"));
    }
    let client = rpc::client(config);
    let (wallet, proposal, proposal_account) =
        resolve_approved_typed_proposal(config, &client, &input.wallet, &input.proposal)?;
    ensure_typed_action(
        &proposal_account,
        ClearSignActionKind::AgentRiskPolicy,
        "typed agent risk policy",
    )?;
    let intent: Pubkey = proposal_account
        .intent
        .parse()
        .with_context(|| "invalid intent address in typed proposal")?;
    let session_id_hash = decode_hex_32(&input.session_id_hash, "session_id_hash")?;
    let oracle_policy_hash = decode_hex_32(&input.oracle_policy_hash, "oracle_policy_hash")?;
    let session = agent_session_pubkey(wallet, session_id_hash);
    let risk_ledger = risk_pubkey(wallet, session_id_hash);
    let ix = crate::instructions::execute_typed_agent_risk_policy(
        solana_sdk::signer::Signer::pubkey(&config.payer),
        wallet,
        intent,
        proposal,
        session,
        risk_ledger,
        proposal_account.policy_commitment,
        proposal_account.envelope_hash,
        session_id_hash,
        oracle_policy_hash,
        input.max_loss_raw.to_le_bytes(),
        input.status,
    );
    let sig = rpc::send_instruction(&client, config, ix)?;
    print_json(&serde_json::json!({
        "txid": sig.to_string(),
        "proposal": proposal.to_string(),
        "path": "typed_agent_risk_policy",
        "status": "executed",
        "session": session.to_string(),
        "risk_ledger": risk_ledger.to_string(),
    }));
    Ok(())
}

pub(super) struct SettlementExecution {
    pub wallet: String,
    pub proposal: String,
    pub session_id_hash: String,
    pub execution_id_hash: String,
    pub settlement_artifact_hash: String,
    pub oracle_policy_hash: String,
    pub closed_notional_raw: u128,
    pub outcome: u8,
    pub pnl_abs_raw: u128,
    pub settlement_sequence: u64,
}

pub(super) fn execute_settlement(config: &RuntimeConfig, input: SettlementExecution) -> Result<()> {
    if input.closed_notional_raw == 0 {
        return Err(anyhow!("closed-notional-raw must be greater than zero"));
    }
    if !(1..=3).contains(&input.outcome) {
        return Err(anyhow!("outcome must be 1 (profit), 2 (loss), or 3 (flat)"));
    }
    if (input.outcome == 3 && input.pnl_abs_raw != 0)
        || (input.outcome != 3 && input.pnl_abs_raw == 0)
    {
        return Err(anyhow!("pnl-abs-raw does not match settlement outcome"));
    }
    let client = rpc::client(config);
    let (wallet, proposal, proposal_account) =
        resolve_approved_typed_proposal(config, &client, &input.wallet, &input.proposal)?;
    ensure_typed_action(
        &proposal_account,
        ClearSignActionKind::AgentTradeSettlement,
        "typed agent trade settlement",
    )?;
    let intent: Pubkey = proposal_account
        .intent
        .parse()
        .with_context(|| "invalid intent address in typed proposal")?;
    let session_id_hash = decode_hex_32(&input.session_id_hash, "session_id_hash")?;
    let execution_id_hash = decode_hex_32(&input.execution_id_hash, "execution_id_hash")?;
    let settlement_artifact_hash =
        decode_hex_32(&input.settlement_artifact_hash, "settlement_artifact_hash")?;
    let oracle_policy_hash = decode_hex_32(&input.oracle_policy_hash, "oracle_policy_hash")?;
    let session = agent_session_pubkey(wallet, session_id_hash);
    let risk_ledger = risk_pubkey(wallet, session_id_hash);
    let settlement_receipt = settlement_receipt_pubkey(wallet, settlement_artifact_hash);
    let ix = crate::instructions::execute_typed_agent_trade_settlement(
        solana_sdk::signer::Signer::pubkey(&config.payer),
        wallet,
        intent,
        proposal,
        session,
        risk_ledger,
        settlement_receipt,
        proposal_account.policy_commitment,
        proposal_account.envelope_hash,
        session_id_hash,
        execution_id_hash,
        settlement_artifact_hash,
        oracle_policy_hash,
        input.closed_notional_raw.to_le_bytes(),
        input.outcome,
        input.pnl_abs_raw.to_le_bytes(),
        input.settlement_sequence,
    );
    let sig = rpc::send_instruction(&client, config, ix)?;
    print_json(&serde_json::json!({
        "txid": sig.to_string(),
        "proposal": proposal.to_string(),
        "path": "typed_agent_trade_settlement",
        "status": "executed",
        "session": session.to_string(),
        "risk_ledger": risk_ledger.to_string(),
        "settlement_receipt": settlement_receipt.to_string(),
        "settlement_sequence": input.settlement_sequence,
    }));
    Ok(())
}

pub(super) fn risk_pubkey(wallet: Pubkey, session_id_hash: [u8; 32]) -> Pubkey {
    let (risk, _) = clear_wallet_client::pda::find_agent_risk_address(
        &solana_address::Address::new_from_array(wallet.to_bytes()),
        &session_id_hash,
        &solana_address::Address::new_from_array(crate::instructions::program_id().to_bytes()),
    );
    Pubkey::new_from_array(risk.to_bytes())
}

fn settlement_receipt_pubkey(wallet: Pubkey, settlement_artifact_hash: [u8; 32]) -> Pubkey {
    let (receipt, _) = clear_wallet_client::pda::find_agent_settlement_receipt_address(
        &solana_address::Address::new_from_array(wallet.to_bytes()),
        &settlement_artifact_hash,
        &solana_address::Address::new_from_array(crate::instructions::program_id().to_bytes()),
    );
    Pubkey::new_from_array(receipt.to_bytes())
}
