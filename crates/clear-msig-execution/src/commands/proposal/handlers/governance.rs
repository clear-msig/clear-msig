use super::super::*;

pub(super) fn handle(action: ProposalAction, config: &RuntimeConfig) -> Result<()> {
    match action {
        ProposalAction::TypedExecute {
            wallet: wallet_name,
            proposal: proposal_addr_str,
        } => {
            let client = rpc::client(config);
            let (wallet_pubkey, _) = rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let proposal_pubkey: Pubkey = proposal_addr_str
                .parse()
                .with_context(|| "invalid proposal address")?;
            let proposal_data = rpc::fetch_account(&client, &proposal_pubkey)?;
            let proposal_account = accounts::parse_typed_proposal(&proposal_data)?;
            if proposal_account.wallet != wallet_pubkey.to_string() {
                return Err(anyhow!(
                    "typed proposal does not belong to wallet {wallet_name}"
                ));
            }
            if proposal_account.status != "Approved" {
                return Err(anyhow!(
                    "typed proposal status is '{}', must be 'Approved' to execute",
                    proposal_account.status
                ));
            }
            ensure_generic_typed_execute_allowed(&proposal_account)?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let ix = crate::instructions::execute_typed(
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                proposal_account.action_kind,
                proposal_account.policy_commitment,
                proposal_account.payload_hash,
                proposal_account.envelope_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed",
                "status": "executed",
            }));
        }

        ProposalAction::TypedWalletPolicyUpdate {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            policy_bytes_hex,
            chain_kind,
        } => {
            let policy_bytes =
                parse_hex_local(&policy_bytes_hex).with_context(|| "invalid policy-bytes-hex")?;
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::SetProtection,
                "typed wallet policy update",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let ix = crate::instructions::execute_typed_wallet_policy_update(
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet_pubkey,
                wallet_policy_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                chain_kind,
                &policy_bytes,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_wallet_policy_update",
                "status": "executed",
            }));
        }
        ProposalAction::TypedAssetPolicyUpdate {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            policy_bytes_hex,
            chain_kind,
            scope_kind,
            decimals,
            asset_id,
            display_asset,
        } => {
            let policy_bytes =
                parse_hex_local(&policy_bytes_hex).with_context(|| "invalid policy-bytes-hex")?;
            let client = rpc::client(config);
            let (wallet, proposal, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::SetAssetProtection,
                "typed asset policy update",
            )?;
            let intent: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address")?;
            let asset: Pubkey = asset_id
                .parse()
                .with_context(|| "invalid asset-id pubkey")?;
            let program = crate::instructions::program_id();
            let (asset_policy, _) = Pubkey::find_program_address(
                &[b"asset_policy", wallet.as_ref(), asset.as_ref()],
                &program,
            );
            let ix = crate::instructions::execute_typed_asset_policy_update(
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet,
                asset_policy,
                intent,
                proposal,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                chain_kind,
                scope_kind,
                decimals,
                asset.to_bytes(),
                display_asset.as_bytes(),
                &policy_bytes,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal.to_string(),
                "asset_policy": asset_policy.to_string(),
                "asset_id": asset.to_string(),
                "path": "typed_asset_policy_update",
                "status": "executed",
            }));
        }

        ProposalAction::TypedIntentGovernance {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            action_kind,
            target_index,
            new_intent_body_hex,
            file,
            proposers,
            approvers,
            threshold,
            cancellation_threshold,
            timelock,
        } => {
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            let action_kind = action_kind.unwrap_or(proposal_account.action_kind);
            let kind = ClearSignActionKind::from_code(action_kind).ok_or_else(|| {
                anyhow!("invalid action-kind {action_kind} (expected 3, 4, or 5)")
            })?;
            if !matches!(
                kind,
                ClearSignActionKind::AddMember
                    | ClearSignActionKind::RemoveMember
                    | ClearSignActionKind::ChangeThreshold
            ) {
                return Err(anyhow!(
                    "typed-intent-governance only supports action kinds 3/4/5, got {action_kind}"
                ));
            }
            ensure_typed_action(&proposal_account, kind, "typed intent governance")?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            let committed = &proposal_account.policy_bytes;
            let (target_index, new_intent_body) = if new_intent_body_hex.is_none() && file.is_none()
            {
                committed_governance_payload(committed, target_index)?
            } else {
                let target_index = target_index.ok_or_else(|| {
                    anyhow!("--target-index is required with an explicit intent body or file")
                })?;
                let body = if let Some(hex) = new_intent_body_hex {
                    parse_hex_local(&hex).with_context(|| "invalid new-intent-body-hex")?
                } else {
                    let file = file.ok_or_else(|| {
                        anyhow!("typed-intent-governance requires committed bytes or --file")
                    })?;
                    let proposers = proposers.ok_or_else(|| anyhow!("--proposers is required"))?;
                    let approvers = approvers.ok_or_else(|| anyhow!("--approvers is required"))?;
                    let threshold = threshold.ok_or_else(|| {
                        anyhow!("--threshold is required when building from --file")
                    })?;
                    let json_str = std::fs::read_to_string(&file)
                        .with_context(|| format!("reading intent file: {file}"))?;
                    let tx_json: IntentTransactionJson = serde_json::from_str(&json_str)
                        .with_context(|| "parsing intent transaction JSON")?;
                    let full_json = tx_json.with_governance(
                        proposers,
                        approvers,
                        threshold,
                        cancellation_threshold,
                        timelock,
                    );
                    let built = full_json.to_built().map_err(|e| anyhow!("{e}"))?;
                    built.serialize_body(&wallet_addr, 0, target_index, 3)
                };
                (target_index, body)
            };

            let mut expected_committed = Vec::with_capacity(new_intent_body.len() + 1);
            expected_committed.push(target_index);
            expected_committed.extend_from_slice(&new_intent_body);
            if committed != &expected_committed {
                return Err(anyhow!(
                    "execution payload does not match the bytes committed in the typed proposal"
                ));
            }
            let (target_addr, _) =
                clear_wallet_client::pda::find_intent_address(&wallet_addr, target_index, &pid);
            let target_pubkey = Pubkey::new_from_array(target_addr.to_bytes());

            let ix = crate::instructions::execute_typed_intent_governance(
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                target_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                action_kind,
                target_index,
                &new_intent_body,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_intent_governance",
                "target_index": target_index,
                "action_kind": action_kind,
                "status": "executed",
            }));
        }
        _ => unreachable!("proposal handler group mismatch"),
    }
    Ok(())
}
