use super::super::*;

pub(super) fn handle(action: ProposalAction, config: &RuntimeConfig) -> Result<()> {
    match action {
        ProposalAction::TypedSolSend {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            recipient,
            amount_lamports,
        } => {
            if amount_lamports == 0 {
                return Err(anyhow!("amount-lamports must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::Send,
                "typed SOL send",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let recipient_pubkey: Pubkey = recipient
                .parse()
                .with_context(|| "invalid recipient address")?;
            let ix = crate::instructions::execute_typed_sol_send(
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet_pubkey,
                wallet_policy_pubkey(wallet_pubkey),
                policy_spend_pubkey(wallet_pubkey, intent_pubkey),
                member_allowance_pubkey(wallet_pubkey, intent_pubkey),
                vault_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                recipient_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                amount_lamports,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_sol_send",
                "status": "executed",
                "recipient": recipient_pubkey.to_string(),
                "amount_lamports": amount_lamports,
            }));
        }

        ProposalAction::TypedChainSend {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            chain_kind,
            amount_raw,
            recipient_hash,
            asset_id_hash,
        } => {
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::Send,
                "typed chain send",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)
                .with_context(|| "failed to fetch typed proposal intent")?;
            let intent_account = accounts::parse_intent(&intent_data)?;
            if intent_account.chain_kind != chain_kind {
                return Err(anyhow!(
                    "typed chain send chain_kind mismatch: intent has {}, command got {}",
                    intent_account.chain_kind,
                    chain_kind
                ));
            }

            let program_id = crate::instructions::program_id();
            let (ika_config_pubkey, _) =
                crate::ika::ika_config_pda(&program_id, &wallet_pubkey, chain_kind);
            let ika_config_data =
                rpc::fetch_account(&client, &ika_config_pubkey).with_context(|| {
                    format!(
                        "wallet has no IkaConfig for chain_kind={chain_kind}; bind the chain first"
                    )
                })?;
            let ika_config = accounts::parse_ika_config(&ika_config_data)?;
            let dwallet_pubkey: Pubkey = ika_config
                .dwallet
                .parse()
                .with_context(|| "invalid dwallet address in IkaConfig")?;

            let recipient_hash = decode_hex_32(&recipient_hash, "recipient_hash")?;
            let asset_id_hash = decode_hex_32(&asset_id_hash, "asset_id_hash")?;
            let tx_template_hash = intent_tx_template_hash(&intent_account)?;
            let ix = crate::instructions::execute_typed_chain_send(
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet_pubkey,
                wallet_policy_pubkey(wallet_pubkey),
                policy_spend_pubkey(wallet_pubkey, intent_pubkey),
                member_allowance_pubkey(wallet_pubkey, intent_pubkey),
                intent_pubkey,
                proposal_pubkey,
                ika_config_pubkey,
                dwallet_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                chain_kind,
                amount_raw.to_le_bytes(),
                recipient_hash,
                asset_id_hash,
                tx_template_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_chain_send",
                "status": "executed",
                "chain_kind": chain_kind,
                "amount_raw": amount_raw.to_string(),
                "recipient_hash": crate::output::hex_of(&recipient_hash),
                "asset_id_hash": crate::output::hex_of(&asset_id_hash),
                "ika_config": ika_config_pubkey.to_string(),
                "dwallet": dwallet_pubkey.to_string(),
                "tx_template_hash": crate::output::hex_of(&tx_template_hash),
            }));
        }

        ProposalAction::TypedChainSendIka {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            chain_kind,
            amount_raw,
            recipient_hash,
            asset_id_hash,
            params_data_hex,
            dwallet_program,
            grpc_url,
            rpc_url,
            broadcast,
        } => {
            if broadcast && rpc_url.is_none() {
                return Err(anyhow!(
                    "--broadcast requires --rpc-url <URL> for the destination chain"
                ));
            }
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            if !matches!(chain_kind, 1..=5) {
                return Err(anyhow!(
                    "typed-chain-send-ika currently supports chain kinds 1 through 5"
                ));
            }

            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::Send,
                "typed chain send Ika",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)
                .with_context(|| "failed to fetch typed proposal intent")?;
            let intent_account = accounts::parse_intent(&intent_data)?;
            if intent_account.chain_kind != chain_kind {
                return Err(anyhow!(
                    "typed chain send Ika chain_kind mismatch: intent has {}, command got {}",
                    intent_account.chain_kind,
                    chain_kind
                ));
            }

            let params_data =
                parse_hex_local(&params_data_hex).with_context(|| "invalid params_data_hex")?;
            let recipient_hash = decode_hex_32(&recipient_hash, "recipient_hash")?;
            let asset_id_hash = decode_hex_32(&asset_id_hash, "asset_id_hash")?;
            let tx_template_hash = intent_tx_template_hash(&intent_account)?;
            let dwallet_program_pk: Pubkey = dwallet_program
                .parse()
                .with_context(|| "invalid dWallet program ID")?;

            execute_via_ika(
                config,
                &client,
                &wallet_name,
                wallet_pubkey,
                intent_pubkey,
                &intent_account,
                proposal_pubkey,
                &params_data,
                dwallet_program_pk,
                &grpc_url,
                rpc_url.as_deref(),
                broadcast,
                IkaOnchainSignMode::TypedChainSend {
                    policy_commitment: proposal_account.policy_commitment,
                    envelope_hash: proposal_account.envelope_hash,
                    amount_raw_le: amount_raw.to_le_bytes(),
                    recipient_hash,
                    asset_id_hash,
                    tx_template_hash,
                },
            )?;
        }

        ProposalAction::TypedSolBatchSend {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            payments,
        } => {
            if payments.is_empty() {
                return Err(anyhow!(
                    "at least one --payment recipient:lamports is required"
                ));
            }
            if payments.len() > 16 {
                return Err(anyhow!(
                    "typed SOL batch send supports at most 16 recipients"
                ));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::BatchSend,
                "typed SOL batch send",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let parsed_payments = payments
                .iter()
                .map(|row| parse_recipient_lamports_row(row, "payment"))
                .collect::<Result<Vec<_>>>()?;
            let mut amount_bytes = Vec::with_capacity(parsed_payments.len() * 8);
            let mut recipient_accounts = Vec::with_capacity(parsed_payments.len());
            for (recipient, lamports) in &parsed_payments {
                amount_bytes.extend_from_slice(&lamports.to_le_bytes());
                recipient_accounts.push(AccountMeta::new(*recipient, false));
            }
            let ix = crate::instructions::execute_typed_sol_batch_send(
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet_pubkey,
                wallet_policy_pubkey(wallet_pubkey),
                policy_spend_pubkey(wallet_pubkey, intent_pubkey),
                member_allowance_pubkey(wallet_pubkey, intent_pubkey),
                vault_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                &amount_bytes,
                recipient_accounts,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_sol_batch_send",
                "status": "executed",
                "payments": parsed_payments
                    .iter()
                    .map(|(recipient, lamports)| serde_json::json!({
                        "recipient": recipient.to_string(),
                        "amount_lamports": lamports,
                    }))
                    .collect::<Vec<_>>(),
            }));
        }
        _ => unreachable!("proposal handler group mismatch"),
    }
    Ok(())
}
