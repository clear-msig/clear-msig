use super::super::*;

pub(super) fn handle(action: ProposalAction, config: &RuntimeConfig) -> Result<()> {
    match action {
        ProposalAction::TypedRecurringSchedule {
            wallet: wallet_name,
            proposal: proposal_address,
            schedule_id,
            recipient,
            amount_lamports,
            interval_seconds,
            first_execution_at,
            payment_count,
            status,
        } => {
            let client = rpc::client(config);
            let (wallet, proposal, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_address)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::RecurringSchedule,
                "typed recurring schedule",
            )?;
            let intent: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let recipient: Pubkey = recipient
                .parse()
                .with_context(|| "invalid recurring recipient address")?;
            let schedule_id_hash = crate::message::sha256_hash(schedule_id.as_bytes());
            let program = crate::instructions::program_id();
            let (schedule, _) = Pubkey::find_program_address(
                &[b"recurring", wallet.as_ref(), &schedule_id_hash],
                &program,
            );
            let (wallet_policy, _) =
                Pubkey::find_program_address(&[b"wallet_policy", wallet.as_ref()], &program);
            let payer = solana_sdk::signer::Signer::pubkey(&config.payer);
            let ix = crate::instructions::execute_typed_recurring_schedule(
                payer,
                wallet,
                wallet_policy,
                intent,
                proposal,
                schedule,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                schedule_id_hash,
                recipient.to_bytes(),
                amount_lamports,
                interval_seconds,
                first_execution_at,
                payment_count,
                status,
            );
            let signature = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": signature.to_string(),
                "proposal": proposal.to_string(),
                "schedule": schedule.to_string(),
                "schedule_id": schedule_id,
                "status": if status == 1 { "active" } else { "revoked" },
            }));
        }
        ProposalAction::RecurringPayment {
            wallet: wallet_name,
            intent,
            schedule_id,
            recipient,
        } => {
            let client = rpc::client(config);
            let (wallet, _) = rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let intent: Pubkey = intent.parse().with_context(|| "invalid intent address")?;
            let recipient: Pubkey = recipient
                .parse()
                .with_context(|| "invalid recurring recipient address")?;
            let schedule_id_hash = crate::message::sha256_hash(schedule_id.as_bytes());
            let program = crate::instructions::program_id();
            let (schedule, _) = Pubkey::find_program_address(
                &[b"recurring", wallet.as_ref(), &schedule_id_hash],
                &program,
            );
            let (wallet_policy, _) =
                Pubkey::find_program_address(&[b"wallet_policy", wallet.as_ref()], &program);
            let (policy_spend, _) = Pubkey::find_program_address(
                &[b"policy_spend", wallet.as_ref(), intent.as_ref()],
                &program,
            );
            let payer = solana_sdk::signer::Signer::pubkey(&config.payer);
            let ix = crate::instructions::execute_recurring_payment(
                payer,
                wallet,
                wallet_policy,
                policy_spend,
                vault_pubkey(wallet),
                intent,
                schedule,
                recipient,
                schedule_id_hash,
            );
            let signature = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": signature.to_string(),
                "schedule": schedule.to_string(),
                "schedule_id": schedule_id,
                "status": "paid",
            }));
        }
        _ => unreachable!("recurring handler received non-recurring action"),
    }
    Ok(())
}
