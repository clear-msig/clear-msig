use super::super::*;

pub(super) fn handle(action: ProposalAction, config: &RuntimeConfig) -> Result<()> {
    match action {
        ProposalAction::Execute {
            wallet: wallet_name,
            proposal: proposal_addr_str,
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
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());

            // Resolve wallet by name. Creator-scoped PDA — see
            // intent.rs:120 for context.
            let client = rpc::client(config);
            let (wallet_pubkey, _) = rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            let (vault_addr, _) = clear_wallet_client::pda::find_vault_address(&wallet_addr, &pid);
            let vault_pubkey = Pubkey::new_from_array(vault_addr.to_bytes());

            let proposal_pubkey: Pubkey = proposal_addr_str
                .parse()
                .with_context(|| "invalid proposal address")?;

            let client = rpc::client(config);
            let proposal_data = rpc::fetch_account(&client, &proposal_pubkey)?;
            let proposal_account = accounts::parse_proposal(&proposal_data)?;

            if proposal_account.status != "Approved" {
                return Err(anyhow!(
                    "proposal status is '{}', must be 'Approved' to execute",
                    proposal_account.status
                ));
            }

            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in proposal")?;
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)?;
            let intent_account = accounts::parse_intent(&intent_data)?;

            // Routing:
            // - Meta-intents (AddIntent=0, RemoveIntent=1, UpdateIntent=2)
            //   always run locally — they mutate program state, no remote
            //   chain involved.
            // - Custom intents (3) on chain_kind=0 (Solana) also run via
            //   the local execute path — the program's `execute_custom`
            //   handler does the CPI directly. SOL transfers fall here.
            // - Custom intents on any other chain go through Ika dWallet
            //   signing.
            let is_local = intent_account.intent_type <= 2 || intent_account.chain_kind == 0;
            if is_local {
                let payer_pubkey = solana_sdk::signer::Signer::pubkey(&config.payer);
                let remaining = resolve::resolve_remaining_accounts(
                    &client,
                    &intent_account,
                    &wallet_pubkey,
                    &vault_pubkey,
                    &proposal_account.params_data,
                    &payer_pubkey,
                )?;
                let ix = crate::instructions::execute(
                    wallet_pubkey,
                    vault_pubkey,
                    intent_pubkey,
                    proposal_pubkey,
                    remaining,
                );
                let sig = rpc::send_instruction(&client, config, ix)?;
                let path = if intent_account.intent_type <= 2 {
                    "meta-intent"
                } else {
                    "custom-local"
                };
                print_json(&serde_json::json!({
                    "txid": sig.to_string(),
                    "path": path,
                    "status": "executed",
                }));
            } else {
                let dwallet_program_pk: Pubkey = dwallet_program
                    .ok_or(anyhow!("proposal execution requires --dwallet-program",))?
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
                    &proposal_account.params_data,
                    dwallet_program_pk,
                    &grpc_url,
                    rpc_url.as_deref(),
                    broadcast,
                    IkaOnchainSignMode::LegacyProposal,
                )?;
            }
        }

        ProposalAction::List {
            wallet: wallet_name,
        } => {
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());

            // Resolve wallet by name. Creator-scoped PDA upgrade —
            // see comment in intent.rs:120 for context.
            let client = rpc::client(config);
            let (wallet_pubkey, wallet_account) =
                rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            // Iterate all intents, then all proposals for each
            let mut proposals = Vec::new();
            for intent_idx in 0..=wallet_account.intent_index {
                let (intent_addr, _) =
                    clear_wallet_client::pda::find_intent_address(&wallet_addr, intent_idx, &pid);

                // Try fetching proposals for this intent
                // We don't know the exact count, so scan from 0 up to wallet.proposal_index
                for prop_idx in 0..wallet_account.proposal_index {
                    let (proposal_addr, _) = clear_wallet_client::pda::find_proposal_address(
                        &intent_addr,
                        prop_idx,
                        &pid,
                    );
                    let proposal_pubkey = Pubkey::new_from_array(proposal_addr.to_bytes());
                    if let Some(data) = rpc::fetch_account_optional(&client, &proposal_pubkey)? {
                        if let Ok(p) = accounts::parse_proposal(&data) {
                            proposals.push(serde_json::json!({
                                "address": proposal_pubkey.to_string(),
                                "intent_index": intent_idx,
                                "proposal_index": p.proposal_index,
                                "proposer": p.proposer,
                                "status": p.status,
                                "proposed_at": p.proposed_at,
                                "approved_at": p.approved_at,
                                "approval_bitmap": p.approval_bitmap,
                                "cancellation_bitmap": p.cancellation_bitmap,
                            }));
                        }
                    }
                }
            }

            print_json(&proposals);
        }

        ProposalAction::Show {
            proposal: proposal_addr_str,
        } => {
            let proposal_pubkey: Pubkey = proposal_addr_str
                .parse()
                .with_context(|| "invalid proposal address")?;

            let client = rpc::client(config);
            let data = rpc::fetch_account(&client, &proposal_pubkey)?;
            let proposal = accounts::parse_proposal(&data)?;

            print_json(&serde_json::json!({
                "address": proposal_pubkey.to_string(),
                "wallet": proposal.wallet,
                "intent": proposal.intent,
                "proposal_index": proposal.proposal_index,
                "proposer": proposal.proposer,
                "status": proposal.status,
                "proposed_at": proposal.proposed_at,
                "approved_at": proposal.approved_at,
                "approval_bitmap": proposal.approval_bitmap,
                "cancellation_bitmap": proposal.cancellation_bitmap,
                "rent_refund": proposal.rent_refund,
                "params_data": bs58::encode(&proposal.params_data).into_string(),
            }));
        }

        ProposalAction::Cleanup {
            proposal: proposal_addr_str,
        } => {
            let proposal_pubkey: Pubkey = proposal_addr_str
                .parse()
                .with_context(|| "invalid proposal address")?;

            let client = rpc::client(config);
            let data = rpc::fetch_account(&client, &proposal_pubkey)?;
            let (proposal_kind, rent_refund, ix) = match data.first().copied() {
                Some(3) => {
                    let proposal = accounts::parse_proposal(&data)?;
                    let rent_refund: Pubkey = proposal
                        .rent_refund
                        .parse()
                        .with_context(|| "invalid rent_refund address in proposal")?;
                    (
                        "legacy",
                        rent_refund,
                        crate::instructions::cleanup(proposal_pubkey, rent_refund),
                    )
                }
                Some(6) => {
                    let proposal = accounts::parse_typed_proposal(&data)?;
                    let rent_refund: Pubkey = proposal
                        .rent_refund
                        .parse()
                        .with_context(|| "invalid rent_refund address in typed proposal")?;
                    (
                        "typed",
                        rent_refund,
                        crate::instructions::cleanup_typed(proposal_pubkey, rent_refund),
                    )
                }
                Some(discriminator) => {
                    return Err(anyhow!(
                        "account {} is not a proposal account (discriminator={})",
                        proposal_pubkey,
                        discriminator
                    ));
                }
                None => return Err(anyhow!("proposal account data is empty")),
            };
            let sig = rpc::send_instruction(&client, config, ix)?;

            print_json(&serde_json::json!({
                "kind": proposal_kind,
                "rent_refund": rent_refund.to_string(),
                "txid": sig.to_string(),
                "status": "cleaned up",
            }));
        }
        _ => unreachable!("proposal handler group mismatch"),
    }
    Ok(())
}
