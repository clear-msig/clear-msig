use super::super::*;

pub(super) fn handle(action: ProposalAction, config: &RuntimeConfig) -> Result<()> {
    match action {
        ProposalAction::TypedAgentTradeApproval {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            amount_raw,
            agent_id_hash,
            venue_hash,
            market_hash,
            side_hash,
            asset_id_hash,
            max_leverage_x100,
            session_id_hash,
            route_hash,
            risk_check_hash,
        } => {
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            if max_leverage_x100 == 0 {
                return Err(anyhow!("max-leverage-x100 must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::AgentTradeApproval,
                "typed agent trade approval",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let venue_hash = decode_hex_32(&venue_hash, "venue_hash")?;
            let agent_id_hash = decode_hex_32(&agent_id_hash, "agent_id_hash")?;
            let market_hash = decode_hex_32(&market_hash, "market_hash")?;
            let side_hash = decode_hex_32(&side_hash, "side_hash")?;
            let asset_id_hash = decode_hex_32(&asset_id_hash, "asset_id_hash")?;
            let session_id_hash = decode_hex_32(&session_id_hash, "session_id_hash")?;
            let route_hash = decode_hex_32(&route_hash, "route_hash")?;
            let risk_check_hash = decode_hex_32(&risk_check_hash, "risk_check_hash")?;
            let session_pubkey = agent_session_pubkey(wallet_pubkey, session_id_hash);
            let risk_ledger_pubkey = agent_risk::risk_pubkey(wallet_pubkey, session_id_hash);
            let ix = crate::instructions::execute_typed_agent_trade_approval(
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                session_pubkey,
                risk_ledger_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                amount_raw.to_le_bytes(),
                agent_id_hash,
                venue_hash,
                market_hash,
                side_hash,
                asset_id_hash,
                max_leverage_x100,
                session_id_hash,
                route_hash,
                risk_check_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_agent_trade_approval",
                "status": "executed",
                "amount_raw": amount_raw.to_string(),
                "agent_id_hash": crate::output::hex_of(&agent_id_hash),
                "venue_hash": crate::output::hex_of(&venue_hash),
                "market_hash": crate::output::hex_of(&market_hash),
                "side_hash": crate::output::hex_of(&side_hash),
                "asset_id_hash": crate::output::hex_of(&asset_id_hash),
                "max_leverage_x100": max_leverage_x100,
                "session_id_hash": crate::output::hex_of(&session_id_hash),
                "route_hash": crate::output::hex_of(&route_hash),
                "risk_check_hash": crate::output::hex_of(&risk_check_hash),
                "session": session_pubkey.to_string(),
                "risk_ledger": risk_ledger_pubkey.to_string(),
            }));
        }

        ProposalAction::TypedAgentSessionGrant {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            session_id_hash,
            agent_id_hash,
            venue_hash,
            market_hash,
            max_notional_raw,
            max_leverage_x100,
            expires_at,
            status,
        } => {
            if status != 1 && status != 2 {
                return Err(anyhow!("status must be 1 (active) or 2 (revoked)"));
            }
            if status == 1 && (max_notional_raw == 0 || max_leverage_x100 == 0) {
                return Err(anyhow!(
                    "active session requires positive notional and leverage"
                ));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::AgentSessionGrant,
                "typed agent session grant",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let session_id_hash = decode_hex_32(&session_id_hash, "session_id_hash")?;
            let agent_id_hash = decode_hex_32(&agent_id_hash, "agent_id_hash")?;
            let venue_hash = decode_hex_32(&venue_hash, "venue_hash")?;
            let market_hash = decode_hex_32(&market_hash, "market_hash")?;
            let session = agent_session_pubkey(wallet_pubkey, session_id_hash);
            let ix = crate::instructions::execute_typed_agent_session_grant(
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                session,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                session_id_hash,
                agent_id_hash,
                venue_hash,
                market_hash,
                max_notional_raw.to_le_bytes(),
                max_leverage_x100,
                expires_at,
                status,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_agent_session_grant",
                "status": "executed",
                "session": session.to_string(),
            }));
        }

        ProposalAction::TypedAgentRiskPolicy {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            session_id_hash,
            oracle_policy_hash,
            max_loss_raw,
            status,
        } => agent_risk::execute_risk_policy(
            config,
            agent_risk::RiskPolicyExecution {
                wallet: wallet_name,
                proposal: proposal_addr_str,
                session_id_hash,
                oracle_policy_hash,
                max_loss_raw,
                status,
            },
        )?,

        ProposalAction::TypedAgentTradeSettlement {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            session_id_hash,
            execution_id_hash,
            settlement_artifact_hash,
            oracle_policy_hash,
            closed_notional_raw,
            outcome,
            pnl_abs_raw,
            settlement_sequence,
        } => agent_risk::execute_settlement(
            config,
            agent_risk::SettlementExecution {
                wallet: wallet_name,
                proposal: proposal_addr_str,
                session_id_hash,
                execution_id_hash,
                settlement_artifact_hash,
                oracle_policy_hash,
                closed_notional_raw,
                outcome,
                pnl_abs_raw,
                settlement_sequence,
            },
        )?,
        _ => unreachable!("proposal handler group mismatch"),
    }
    Ok(())
}
