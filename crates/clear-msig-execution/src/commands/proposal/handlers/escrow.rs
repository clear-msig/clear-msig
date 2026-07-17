use super::super::*;

pub(super) fn handle(action: ProposalAction, config: &RuntimeConfig) -> Result<()> {
    match action {
        ProposalAction::TypedEscrowRelease {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            recipient,
            amount_lamports,
            escrow_id,
            milestone_id,
        } => {
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReleaseMilestone,
                "typed escrow release",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let recipient_pubkey: Pubkey = recipient
                .parse()
                .with_context(|| "invalid recipient address")?;
            let ix = crate::instructions::execute_typed_escrow_release(
                wallet_pubkey,
                vault_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                recipient_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                amount_lamports,
                crate::message::sha256_hash(escrow_id.as_bytes()),
                crate::message::sha256_hash(milestone_id.as_bytes()),
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_escrow_release",
                "status": "executed",
                "recipient": recipient_pubkey.to_string(),
                "amount_lamports": amount_lamports,
            }));
        }

        ProposalAction::TypedSplEscrowRelease {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            mint,
            source_token,
            destination_token,
            recipient_owner,
            amount_tokens,
            escrow_id,
            milestone_id,
        } => {
            if amount_tokens == 0 {
                return Err(anyhow!("amount-tokens must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReleaseMilestone,
                "typed SPL escrow release",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let mint_pubkey: Pubkey = mint.parse().with_context(|| "invalid mint address")?;
            let source_token_pubkey: Pubkey = source_token
                .parse()
                .with_context(|| "invalid source token account address")?;
            let destination_token_pubkey: Pubkey = destination_token
                .parse()
                .with_context(|| "invalid destination token account address")?;
            let recipient_owner_pubkey: Pubkey = recipient_owner
                .parse()
                .with_context(|| "invalid recipient owner address")?;
            let ix = crate::instructions::execute_typed_spl_escrow_release(
                wallet_pubkey,
                vault_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                mint_pubkey,
                source_token_pubkey,
                destination_token_pubkey,
                recipient_owner_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                amount_tokens,
                crate::message::sha256_hash(escrow_id.as_bytes()),
                crate::message::sha256_hash(milestone_id.as_bytes()),
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_spl_escrow_release",
                "status": "executed",
                "mint": mint_pubkey.to_string(),
                "source_token": source_token_pubkey.to_string(),
                "destination_token": destination_token_pubkey.to_string(),
                "recipient_owner": recipient_owner_pubkey.to_string(),
                "amount_tokens": amount_tokens,
            }));
        }

        ProposalAction::TypedSplEscrowReturn {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            mint,
            source_token,
            escrow_id,
            returns,
        } => {
            if returns.is_empty() {
                return Err(anyhow!(
                    "at least one --return destination_token:funder_owner:tokens is required"
                ));
            }
            if returns.len() > 16 {
                return Err(anyhow!(
                    "typed SPL escrow return supports at most 16 recipients"
                ));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReturnEscrowFunds,
                "typed SPL escrow return",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let mint_pubkey: Pubkey = mint.parse().with_context(|| "invalid mint address")?;
            let source_token_pubkey: Pubkey = source_token
                .parse()
                .with_context(|| "invalid source token account address")?;
            let parsed_returns = returns
                .iter()
                .map(|row| parse_token_return_row(row))
                .collect::<Result<Vec<_>>>()?;
            let mut amount_bytes = Vec::with_capacity(parsed_returns.len() * 8);
            let mut return_accounts = Vec::with_capacity(parsed_returns.len() * 2);
            for (destination_token, funder_owner, amount_tokens) in &parsed_returns {
                amount_bytes.extend_from_slice(&amount_tokens.to_le_bytes());
                return_accounts.push(AccountMeta::new(*destination_token, false));
                return_accounts.push(AccountMeta::new_readonly(*funder_owner, false));
            }
            let ix = crate::instructions::execute_typed_spl_escrow_return(
                wallet_pubkey,
                vault_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                mint_pubkey,
                source_token_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                crate::message::sha256_hash(escrow_id.as_bytes()),
                &amount_bytes,
                return_accounts,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_spl_escrow_return",
                "status": "executed",
                "mint": mint_pubkey.to_string(),
                "source_token": source_token_pubkey.to_string(),
                "returns": parsed_returns
                    .iter()
                    .map(|(destination_token, funder_owner, amount_tokens)| serde_json::json!({
                        "destination_token": destination_token.to_string(),
                        "funder_owner": funder_owner.to_string(),
                        "amount_tokens": amount_tokens,
                    }))
                    .collect::<Vec<_>>(),
            }));
        }

        ProposalAction::TypedCrossChainEscrowRelease {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            chain_kind,
            amount_raw,
            escrow_id,
            milestone_id,
            recipient_hash,
            asset_id_hash,
            route_hash,
            settlement_artifact_hash,
        } => {
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReleaseMilestone,
                "typed cross-chain escrow release",
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
                    "typed cross-chain escrow release chain_kind mismatch: intent has {}, command got {}",
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
            let route_hash = decode_hex_32(&route_hash, "route_hash")?;
            let settlement_artifact_hash =
                decode_hex_32(&settlement_artifact_hash, "settlement_artifact_hash")?;
            let tx_template_hash = intent_tx_template_hash(&intent_account)?;
            let ix = crate::instructions::execute_typed_cross_chain_escrow_release(
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                ika_config_pubkey,
                dwallet_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                chain_kind,
                amount_raw.to_le_bytes(),
                crate::message::sha256_hash(escrow_id.as_bytes()),
                crate::message::sha256_hash(milestone_id.as_bytes()),
                recipient_hash,
                asset_id_hash,
                route_hash,
                tx_template_hash,
                settlement_artifact_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_cross_chain_escrow_release",
                "status": "executed",
                "chain_kind": chain_kind,
                "ika_config": ika_config_pubkey.to_string(),
                "dwallet": dwallet_pubkey.to_string(),
                "amount_raw": amount_raw.to_string(),
                "escrow_id": escrow_id,
                "milestone_id": milestone_id,
                "recipient_hash": crate::output::hex_of(&recipient_hash),
                "asset_id_hash": crate::output::hex_of(&asset_id_hash),
                "route_hash": crate::output::hex_of(&route_hash),
                "tx_template_hash": crate::output::hex_of(&tx_template_hash),
                "settlement_artifact_hash": crate::output::hex_of(&settlement_artifact_hash),
            }));
        }

        ProposalAction::TypedCrossChainEscrowReturn {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            chain_kind,
            amount_raw,
            escrow_id,
            refund_recipient_hash,
            asset_id_hash,
            route_hash,
            settlement_artifact_hash,
        } => {
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReturnEscrowFunds,
                "typed cross-chain escrow return",
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
                    "typed cross-chain escrow return chain_kind mismatch: intent has {}, command got {}",
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

            let refund_recipient_hash =
                decode_hex_32(&refund_recipient_hash, "refund_recipient_hash")?;
            let asset_id_hash = decode_hex_32(&asset_id_hash, "asset_id_hash")?;
            let route_hash = decode_hex_32(&route_hash, "route_hash")?;
            let settlement_artifact_hash =
                decode_hex_32(&settlement_artifact_hash, "settlement_artifact_hash")?;
            let tx_template_hash = intent_tx_template_hash(&intent_account)?;
            let ix = crate::instructions::execute_typed_cross_chain_escrow_return(
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                ika_config_pubkey,
                dwallet_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                chain_kind,
                amount_raw.to_le_bytes(),
                crate::message::sha256_hash(escrow_id.as_bytes()),
                refund_recipient_hash,
                asset_id_hash,
                route_hash,
                tx_template_hash,
                settlement_artifact_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_cross_chain_escrow_return",
                "status": "executed",
                "chain_kind": chain_kind,
                "ika_config": ika_config_pubkey.to_string(),
                "dwallet": dwallet_pubkey.to_string(),
                "amount_raw": amount_raw.to_string(),
                "escrow_id": escrow_id,
                "refund_recipient_hash": crate::output::hex_of(&refund_recipient_hash),
                "asset_id_hash": crate::output::hex_of(&asset_id_hash),
                "route_hash": crate::output::hex_of(&route_hash),
                "tx_template_hash": crate::output::hex_of(&tx_template_hash),
                "settlement_artifact_hash": crate::output::hex_of(&settlement_artifact_hash),
            }));
        }

        ProposalAction::TypedPrivateEscrowRelease {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            amount_raw,
            escrow_id,
            milestone_id,
            recipient_hash,
            asset_id_hash,
            private_evaluation_hash,
            settlement_artifact_hash,
        } => {
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReleaseMilestone,
                "typed private escrow release",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)
                .with_context(|| "failed to fetch typed proposal intent")?;
            let intent_account = accounts::parse_intent(&intent_data)?;

            let recipient_hash = decode_hex_32(&recipient_hash, "recipient_hash")?;
            let asset_id_hash = decode_hex_32(&asset_id_hash, "asset_id_hash")?;
            let private_evaluation_hash =
                decode_hex_32(&private_evaluation_hash, "private_evaluation_hash")?;
            let settlement_artifact_hash =
                decode_hex_32(&settlement_artifact_hash, "settlement_artifact_hash")?;
            let policy_ciphertexts_hash = intent_policy_ciphertexts_hash(&intent_account)?;
            let ix = crate::instructions::execute_typed_private_escrow_release(
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                amount_raw.to_le_bytes(),
                crate::message::sha256_hash(escrow_id.as_bytes()),
                crate::message::sha256_hash(milestone_id.as_bytes()),
                recipient_hash,
                asset_id_hash,
                policy_ciphertexts_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_private_escrow_release",
                "status": "executed",
                "amount_raw": amount_raw.to_string(),
                "escrow_id": escrow_id,
                "milestone_id": milestone_id,
                "recipient_hash": crate::output::hex_of(&recipient_hash),
                "asset_id_hash": crate::output::hex_of(&asset_id_hash),
                "policy_ciphertexts_hash": crate::output::hex_of(&policy_ciphertexts_hash),
                "private_evaluation_hash": crate::output::hex_of(&private_evaluation_hash),
                "settlement_artifact_hash": crate::output::hex_of(&settlement_artifact_hash),
            }));
        }

        ProposalAction::TypedPrivateEscrowReturn {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            amount_raw,
            escrow_id,
            refund_recipient_hash,
            asset_id_hash,
            private_evaluation_hash,
            settlement_artifact_hash,
        } => {
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReturnEscrowFunds,
                "typed private escrow return",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)
                .with_context(|| "failed to fetch typed proposal intent")?;
            let intent_account = accounts::parse_intent(&intent_data)?;

            let refund_recipient_hash =
                decode_hex_32(&refund_recipient_hash, "refund_recipient_hash")?;
            let asset_id_hash = decode_hex_32(&asset_id_hash, "asset_id_hash")?;
            let private_evaluation_hash =
                decode_hex_32(&private_evaluation_hash, "private_evaluation_hash")?;
            let settlement_artifact_hash =
                decode_hex_32(&settlement_artifact_hash, "settlement_artifact_hash")?;
            let policy_ciphertexts_hash = intent_policy_ciphertexts_hash(&intent_account)?;
            let ix = crate::instructions::execute_typed_private_escrow_return(
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                amount_raw.to_le_bytes(),
                crate::message::sha256_hash(escrow_id.as_bytes()),
                refund_recipient_hash,
                asset_id_hash,
                policy_ciphertexts_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_private_escrow_return",
                "status": "executed",
                "amount_raw": amount_raw.to_string(),
                "escrow_id": escrow_id,
                "refund_recipient_hash": crate::output::hex_of(&refund_recipient_hash),
                "asset_id_hash": crate::output::hex_of(&asset_id_hash),
                "policy_ciphertexts_hash": crate::output::hex_of(&policy_ciphertexts_hash),
                "private_evaluation_hash": crate::output::hex_of(&private_evaluation_hash),
                "settlement_artifact_hash": crate::output::hex_of(&settlement_artifact_hash),
            }));
        }

        ProposalAction::TypedEscrowReturn {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            escrow_id,
            returns,
        } => {
            if returns.is_empty() {
                return Err(anyhow!(
                    "at least one --return recipient:lamports is required"
                ));
            }
            if returns.len() > 16 {
                return Err(anyhow!(
                    "typed escrow return supports at most 16 recipients"
                ));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReturnEscrowFunds,
                "typed escrow return",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let parsed_returns = returns
                .iter()
                .map(|row| parse_return_row(row))
                .collect::<Result<Vec<_>>>()?;
            let mut amount_bytes = Vec::with_capacity(parsed_returns.len() * 8);
            let mut funder_accounts = Vec::with_capacity(parsed_returns.len());
            for (recipient, lamports) in &parsed_returns {
                amount_bytes.extend_from_slice(&lamports.to_le_bytes());
                funder_accounts.push(AccountMeta::new(*recipient, false));
            }
            let ix = crate::instructions::execute_typed_escrow_return(
                wallet_pubkey,
                vault_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                crate::message::sha256_hash(escrow_id.as_bytes()),
                &amount_bytes,
                funder_accounts,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_escrow_return",
                "status": "executed",
                "returns": parsed_returns
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
