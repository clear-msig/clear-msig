use super::super::*;

pub(super) fn handle(action: ProposalAction, config: &RuntimeConfig) -> Result<()> {
    match action {
        ProposalAction::Create {
            wallet: wallet_name,
            intent_index,
            params: raw_params,
            expiry,
        } => {
            let expiry_ts = message::resolve_expiry(&expiry, config)?;
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());

            // Resolve wallet by name. Creator-scoped PDA upgrade —
            // see comment in intent.rs:120 for context.
            let client = rpc::client(config);
            let (wallet_pubkey, wallet_account) =
                rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            let (intent_addr, _) =
                clear_wallet_client::pda::find_intent_address(&wallet_addr, intent_index, &pid);
            let intent_pubkey = Pubkey::new_from_array(intent_addr.to_bytes());
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)?;
            let intent_account = accounts::parse_intent(&intent_data)?;

            if !intent_account.approved {
                return Err(anyhow!("intent {} is not approved", intent_index));
            }

            // Check signer is a proposer. `config.signer.pubkey()` is
            // the pre-signed pubkey in pre-signed mode, the filesystem
            // keypair's pubkey otherwise — either way this check catches
            // a caller who submits with the wrong identity.
            let signer_pubkey_b58 = bs58::encode(config.signer.pubkey()).into_string();
            if !intent_account.proposers.contains(&signer_pubkey_b58) {
                return Err(anyhow!(
                    "signer {} is not a proposer on intent {}",
                    signer_pubkey_b58,
                    intent_index
                ));
            }

            // Prefer the caller-supplied params_data in pre-signed mode;
            // fall back to encoding `--param key=value` pairs locally.
            let params_data: Vec<u8> = match &config.params_data_override {
                Some(bytes) => bytes.clone(),
                None => params::encode_params(&intent_account, &raw_params)?,
            };

            let proposal_index = wallet_account.proposal_index;
            let msg = message::build_message(
                "propose",
                expiry_ts,
                &wallet_account.name,
                proposal_index,
                &intent_account,
                &params_data,
            )?;
            let msg_plain = message::build_plain_message(
                "propose",
                expiry_ts,
                &wallet_account.name,
                proposal_index,
                &intent_account,
                &params_data,
            )?;

            let (proposal_addr, _) =
                clear_wallet_client::pda::find_proposal_address(&intent_addr, proposal_index, &pid);

            if config.dry_run {
                crate::output::print_dry_run(&crate::output::DryRunDescriptor {
                    action: "proposal_create",
                    wallet_name: &wallet_account.name,
                    wallet_pubkey: wallet_pubkey.to_string(),
                    intent_index,
                    intent_pubkey: intent_pubkey.to_string(),
                    message_hex: crate::output::hex_of(&msg),
                    params_data_hex: crate::output::hex_of(&params_data),
                    expiry: expiry_ts,
                    proposal_pubkey: Some(
                        Pubkey::new_from_array(proposal_addr.to_bytes()).to_string(),
                    ),
                    proposal_index: Some(proposal_index),
                });
                return Ok(());
            }

            crate::progress!("Signing message:\n{}", String::from_utf8_lossy(&msg[20..]));
            let signature =
                sign_message_with_flavor(&*config.signer, &msg, &msg_plain, config.message_flavor)?;
            let proposer_pubkey = config.signer.pubkey();

            let payer_pubkey = solana_sdk::signer::Signer::pubkey(&config.payer);
            let ix = crate::instructions::propose(crate::instructions::ProposeArgs {
                payer: payer_pubkey,
                wallet: wallet_pubkey,
                intent: intent_pubkey,
                proposal: Pubkey::new_from_array(proposal_addr.to_bytes()),
                proposal_index,
                expiry: expiry_ts,
                proposer_pubkey,
                signature,
                params_data: &params_data,
            });

            let sig = rpc::send_instruction(&client, config, ix)?;

            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": Pubkey::new_from_array(proposal_addr.to_bytes()).to_string(),
                "proposal_index": proposal_index,
            }));
        }

        ProposalAction::TypedCreate {
            wallet: wallet_name,
            intent_index,
            action_kind,
            policy_commitment,
            payload_hash,
            envelope_hash,
            action_id,
            nonce,
            policy_bytes_hex,
            signable_text,
            canonical_intent_hex,
            expiry,
        } => {
            if canonical_intent_hex.is_none() {
                return Err(anyhow!(
                    "new typed proposals require canonical ClearSign v4 intent bytes"
                ));
            }
            let expiry_ts = message::resolve_expiry(&expiry, config)?;
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());
            let client = rpc::client(config);
            let (wallet_pubkey, wallet_account) =
                rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            let (intent_addr, _) =
                clear_wallet_client::pda::find_intent_address(&wallet_addr, intent_index, &pid);
            let intent_pubkey = Pubkey::new_from_array(intent_addr.to_bytes());
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)?;
            let intent_account = accounts::parse_intent(&intent_data)?;
            if !intent_account.approved {
                return Err(anyhow!("intent {} is not approved", intent_index));
            }

            let signer_pubkey_b58 = bs58::encode(config.signer.pubkey()).into_string();
            if !intent_account.proposers.contains(&signer_pubkey_b58) {
                return Err(anyhow!(
                    "signer {} is not a proposer on intent {}",
                    signer_pubkey_b58,
                    intent_index
                ));
            }

            let policy_commitment = decode_hex_32(&policy_commitment, "policy_commitment")?;
            let asserted_payload_hash = decode_hex_32(&payload_hash, "payload_hash")?;
            let asserted_envelope_hash = decode_hex_32(&envelope_hash, "envelope_hash")?;
            let policy_bytes = policy_bytes_hex
                .as_deref()
                .map(parse_hex_local)
                .transpose()
                .with_context(|| "invalid policy-bytes-hex")?
                .unwrap_or_default();
            let canonical_intent_bytes = canonical_intent_hex
                .as_deref()
                .map(parse_hex_local)
                .transpose()
                .with_context(|| "invalid canonical-intent-hex")?;
            ensure_typed_text(&action_id, "action_id")?;
            ensure_typed_text(&nonce, "nonce")?;

            let proposal_index = wallet_account.proposal_index;
            let (proposal_addr, _) = clear_wallet_client::pda::find_typed_proposal_address(
                &intent_addr,
                proposal_index,
                &pid,
            );
            let proposal_pubkey = Pubkey::new_from_array(proposal_addr.to_bytes());
            let approval_count_after =
                u8::from(intent_account.approvers.contains(&signer_pubkey_b58));
            let (effective_text, payload_hash, envelope_hash, is_v4) = if let Some(
                canonical_bytes,
            ) =
                canonical_intent_bytes.as_deref()
            {
                let canonical = parse_v4_intent(canonical_bytes)
                    .map_err(|_| anyhow!("canonical intent is malformed or unsupported"))?;
                if canonical.common.proposal_index != proposal_index
                    || canonical.common.wallet_id != wallet_pubkey.to_bytes()
                    || canonical.common.actor != config.signer.pubkey()
                    || canonical.common.expires_at != expiry_ts
                    || canonical.common.approval_required != intent_account.approval_threshold
                    || canonical.common.network.chain_kind() != intent_account.chain_kind
                    || canonical.common.policy_commitment != policy_commitment
                    || canonical.kind().code() != action_kind
                    || canonical.common.action_id
                        != crate::message::sha256_hash(action_id.as_bytes())
                    || canonical.common.nonce != crate::message::sha256_hash(nonce.as_bytes())
                {
                    return Err(anyhow!(
                            "canonical intent does not match current wallet, actor, intent, replay, or policy context"
                        ));
                }
                let submitted_policy_commitment =
                    clear_msig_signing::policy_commitment(&policy_bytes);
                let policy_bytes_match = match canonical.action {
                    clear_msig_signing::Action::PolicyUpdate(policy) => {
                        policy.new_policy_commitment
                            == clear_msig_signing::wallet_policy_commitment(&policy_bytes)
                    }
                    _ => canonical.common.policy_commitment == submitted_policy_commitment,
                };
                if !policy_bytes_match {
                    return Err(anyhow!(
                        "submitted policy bytes do not match the canonical v4 policy action"
                    ));
                }
                let mut rendered = [0u8; MAX_V4_DOCUMENT_BYTES];
                let rendered_len =
                    render_v4_document(&canonical, wallet_account.name.as_bytes(), &mut rendered)
                        .map_err(|_| anyhow!("canonical intent cannot be rendered safely"))?;
                let rendered = rendered[..rendered_len].to_vec();
                if let Some(asserted) = signable_text.as_deref() {
                    if asserted.as_bytes() != rendered {
                        return Err(anyhow!(
                            "--signable-text does not match the program-derived v4 document"
                        ));
                    }
                }
                let derived_payload_hash = canonical.payload_hash();
                let derived_envelope_hash = hash_v4_envelope(
                    &canonical,
                    wallet_account.name.as_bytes(),
                    crate::message::sha256_hash(&rendered),
                )
                .map_err(|_| anyhow!("canonical v4 envelope is invalid"))?;
                if asserted_payload_hash != derived_payload_hash
                    || asserted_envelope_hash != derived_envelope_hash
                {
                    return Err(anyhow!(
                        "legacy hash assertions do not match the canonical v4 intent"
                    ));
                }
                (
                    Cow::Owned(rendered),
                    derived_payload_hash,
                    derived_envelope_hash,
                    true,
                )
            } else {
                let text = signable_text
                    .as_deref()
                    .map(|value| Cow::Borrowed(value.as_bytes()))
                    .ok_or_else(|| anyhow!("--signable-text is required for v3 typed-create"))?;
                (text, asserted_payload_hash, asserted_envelope_hash, false)
            };
            let vote_message = Some(typed_vote_message(
                ClearSignVoteKind::Propose,
                &wallet_account.name,
                &config.signer.pubkey(),
                proposal_index,
                envelope_hash,
                expiry_ts,
                intent_account.approval_threshold,
                approval_count_after,
                effective_text.as_ref(),
            )?);

            if config.dry_run {
                let vote_message = vote_message.as_ref().ok_or_else(|| {
                    anyhow!("--signable-text is required for typed-create dry-run")
                })?;
                print_typed_dry_run(&crate::output::TypedDryRunDescriptor {
                    action: "proposal_typed_create",
                    wallet_name: &wallet_account.name,
                    wallet_pubkey: wallet_pubkey.to_string(),
                    intent_index,
                    intent_pubkey: intent_pubkey.to_string(),
                    proposal_pubkey: proposal_pubkey.to_string(),
                    proposal_index,
                    signer_pubkey: signer_pubkey_b58.clone(),
                    approval_requirement: intent_account.approval_threshold,
                    approval_count_after,
                    approval_kind: "approvals",
                    action_kind,
                    policy_commitment_hex: crate::output::hex_of(&policy_commitment),
                    payload_hash_hex: crate::output::hex_of(&payload_hash),
                    envelope_hash_hex: crate::output::hex_of(&envelope_hash),
                    action_id: action_id.clone(),
                    nonce: nonce.clone(),
                    canonical_intent_hex: canonical_intent_bytes
                        .as_deref()
                        .map(crate::output::hex_of),
                    message_hex: crate::output::hex_of(vote_message),
                    message_flavor: typed_message_flavor(effective_text.as_ref()),
                    expiry: expiry_ts,
                });
                return Ok(());
            }

            crate::progress!(
                "Signing ClearSign proposal document:\n{}",
                String::from_utf8_lossy(vote_message.as_deref().unwrap_or_else(|| {
                    config
                        .signed_message_override
                        .as_deref()
                        .unwrap_or_default()
                }))
            );
            let signed_message = config
                .signed_message_override
                .as_deref()
                .or(vote_message.as_deref())
                .ok_or_else(|| {
                    anyhow!(
                        "--signable-text or global --signed-message is required for typed-create"
                    )
                })?;
            let signed_clear_text = extract_clear_text_from_vote_message(
                ClearSignVoteKind::Propose,
                wallet_account.name.as_bytes(),
                &config.signer.pubkey(),
                proposal_index,
                envelope_hash,
                expiry_ts,
                intent_account.approval_threshold,
                approval_count_after,
                signed_message,
            )
            .map_err(|_| anyhow!("--signed-message is not a valid ClearSign proposal document"))?;
            if signed_clear_text != effective_text.as_ref() {
                return Err(anyhow!(
                    "signed readable text does not match the canonical dry-run document"
                ));
            }
            if !is_v4 {
                validate_v3_document(signed_clear_text).map_err(|_| {
                    anyhow!("legacy typed proposals require a canonical ClearSign v3 document")
                })?;
            }
            let signature = config.signer.sign_message(signed_message)?;
            let payer_pubkey = solana_sdk::signer::Signer::pubkey(&config.payer);
            let ix = if let Some(canonical_intent) = canonical_intent_bytes.as_deref() {
                crate::instructions::propose_typed_v4(crate::instructions::ProposeTypedV4Args {
                    payer: payer_pubkey,
                    wallet: wallet_pubkey,
                    intent: intent_pubkey,
                    proposal: proposal_pubkey,
                    proposal_index,
                    signature,
                    policy_bytes: &policy_bytes,
                    canonical_intent,
                })
            } else {
                crate::instructions::propose_typed(crate::instructions::ProposeTypedArgs {
                    payer: payer_pubkey,
                    wallet: wallet_pubkey,
                    intent: intent_pubkey,
                    proposal: proposal_pubkey,
                    proposal_index,
                    expiry: expiry_ts,
                    action_kind,
                    policy_commitment,
                    payload_hash,
                    envelope_hash,
                    proposer_pubkey: config.signer.pubkey(),
                    signature,
                    action_id: crate::message::sha256_hash(action_id.as_bytes()),
                    nonce: crate::message::sha256_hash(nonce.as_bytes()),
                    policy_bytes: &policy_bytes,
                    clear_text: signed_clear_text,
                })
            };
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "proposal_index": proposal_index,
                "typed": true,
            }));
        }
        _ => unreachable!("proposal handler group mismatch"),
    }
    Ok(())
}
