use super::*;

pub(in crate::commands::proposal) fn typed_approve_or_cancel(
    config: &RuntimeConfig,
    wallet_name: &str,
    proposal_addr_str: &str,
    is_approve: bool,
) -> Result<()> {
    let client = rpc::client(config);
    let (wallet_pubkey, wallet_account) = rpc::resolve_wallet_by_name(&client, wallet_name)?;
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

    let intent_pubkey: Pubkey = proposal_account
        .intent
        .parse()
        .with_context(|| "invalid intent address in typed proposal")?;
    let intent_data = rpc::fetch_account(&client, &intent_pubkey)?;
    let intent_account = accounts::parse_intent(&intent_data)?;
    let signer_pubkey_b58 = bs58::encode(config.signer.pubkey()).into_string();
    let approver_index = intent_account
        .approvers
        .iter()
        .position(|a| a == &signer_pubkey_b58)
        .ok_or(anyhow!(
            "signer {} is not an approver on this intent",
            signer_pubkey_b58
        ))? as u8;

    let action = if is_approve { "approve" } else { "cancel" };
    let member_bit = 1u16
        .checked_shl(approver_index as u32)
        .ok_or_else(|| anyhow!("invalid approver index {approver_index}"))?;
    if is_approve && (proposal_account.approval_bitmap & member_bit) != 0 {
        print_json(&serde_json::json!({
            "txid": null,
            "action": "typed_approve",
            "approver_index": approver_index,
            "status": proposal_account.status,
            "already_recorded": true,
        }));
        return Ok(());
    }
    if !is_approve && (proposal_account.cancellation_bitmap & member_bit) != 0 {
        print_json(&serde_json::json!({
            "txid": null,
            "action": "typed_cancel",
            "approver_index": approver_index,
            "status": proposal_account.status,
            "already_recorded": true,
        }));
        return Ok(());
    }

    let vote_kind = if is_approve {
        ClearSignVoteKind::Approve
    } else {
        ClearSignVoteKind::Cancel
    };
    let approval_requirement = if is_approve {
        intent_account.approval_threshold
    } else {
        intent_account.cancellation_threshold
    };
    let approval_count_after = if is_approve {
        proposal_account.approval_bitmap.count_ones() as u8 + 1
    } else {
        proposal_account.cancellation_bitmap.count_ones() as u8 + 1
    };
    let vote_message = typed_vote_message(
        vote_kind,
        &wallet_account.name,
        &config.signer.pubkey(),
        proposal_account.proposal_index,
        proposal_account.envelope_hash,
        proposal_account.expires_at,
        approval_requirement,
        approval_count_after,
        &proposal_account.clear_text,
    )?;

    if config.dry_run {
        print_typed_dry_run(&crate::output::TypedDryRunDescriptor {
            action: if is_approve {
                "proposal_typed_approve"
            } else {
                "proposal_typed_cancel"
            },
            wallet_name: &wallet_account.name,
            wallet_pubkey: wallet_pubkey.to_string(),
            intent_index: intent_account.intent_index,
            intent_pubkey: intent_pubkey.to_string(),
            proposal_pubkey: proposal_pubkey.to_string(),
            proposal_index: proposal_account.proposal_index,
            signer_pubkey: signer_pubkey_b58,
            approval_requirement,
            approval_count_after,
            approval_kind: if is_approve {
                "approvals"
            } else {
                "cancellations"
            },
            action_kind: proposal_account.action_kind,
            policy_commitment_hex: crate::output::hex_of(&proposal_account.policy_commitment),
            payload_hash_hex: crate::output::hex_of(&proposal_account.payload_hash),
            envelope_hash_hex: crate::output::hex_of(&proposal_account.envelope_hash),
            action_id: String::from_utf8_lossy(&proposal_account.action_id).to_string(),
            nonce: String::from_utf8_lossy(&proposal_account.nonce).to_string(),
            canonical_intent_hex: None,
            message_hex: crate::output::hex_of(&vote_message),
            message_flavor: typed_message_flavor(&proposal_account.clear_text),
            expiry: proposal_account.expires_at,
        });
        return Ok(());
    }

    crate::progress!(
        "Signing ClearSign {action} document:\n{}",
        String::from_utf8_lossy(&vote_message)
    );
    let signed_message = config
        .signed_message_override
        .as_deref()
        .unwrap_or(&vote_message);
    let signature = config.signer.sign_message(signed_message)?;
    let ix = if is_approve {
        crate::instructions::approve_typed(
            wallet_pubkey,
            intent_pubkey,
            proposal_pubkey,
            approver_index,
            signature,
        )
    } else {
        crate::instructions::cancel_typed(
            wallet_pubkey,
            intent_pubkey,
            proposal_pubkey,
            approver_index,
            signature,
        )
    };
    let sig = rpc::send_instruction(&client, config, ix)?;
    print_json(&serde_json::json!({
        "txid": sig.to_string(),
        "action": if is_approve { "typed_approve" } else { "typed_cancel" },
        "approver_index": approver_index,
    }));
    Ok(())
}

/// Shared logic for approve and cancel.
pub(in crate::commands::proposal) fn approve_or_cancel(
    config: &RuntimeConfig,
    wallet_name: &str,
    proposal_addr_str: &str,
    expiry: &Option<String>,
    is_approve: bool,
) -> Result<()> {
    let expiry_ts = message::resolve_expiry(expiry, config)?;

    // Resolve wallet by name. Creator-scoped PDA upgrade — see
    // intent.rs:120 for context.
    let client = rpc::client(config);
    let (wallet_pubkey, wallet_account) = rpc::resolve_wallet_by_name(&client, wallet_name)?;

    let proposal_pubkey: Pubkey = proposal_addr_str
        .parse()
        .with_context(|| "invalid proposal address")?;
    let proposal_data = rpc::fetch_account(&client, &proposal_pubkey)?;
    let proposal_account = accounts::parse_proposal(&proposal_data)?;

    let intent_pubkey: Pubkey = proposal_account
        .intent
        .parse()
        .with_context(|| "invalid intent address in proposal")?;
    let intent_data = rpc::fetch_account(&client, &intent_pubkey)?;
    let intent_account = accounts::parse_intent(&intent_data)?;

    // Find our index in the approvers list
    let signer_pubkey_b58 = bs58::encode(config.signer.pubkey()).into_string();
    let approver_index = intent_account
        .approvers
        .iter()
        .position(|a| a == &signer_pubkey_b58)
        .ok_or(anyhow!(
            "signer {} is not an approver on this intent",
            signer_pubkey_b58
        ))? as u8;

    let action = if is_approve { "approve" } else { "cancel" };
    let member_bit = 1u16
        .checked_shl(approver_index as u32)
        .ok_or_else(|| anyhow!("invalid approver index {approver_index}"))?;
    if is_approve && (proposal_account.approval_bitmap & member_bit) != 0 {
        print_json(&serde_json::json!({
            "txid": null,
            "action": action,
            "approver_index": approver_index,
            "status": proposal_account.status,
            "already_recorded": true,
        }));
        return Ok(());
    }
    if !is_approve && (proposal_account.cancellation_bitmap & member_bit) != 0 {
        print_json(&serde_json::json!({
            "txid": null,
            "action": action,
            "approver_index": approver_index,
            "status": proposal_account.status,
            "already_recorded": true,
        }));
        return Ok(());
    }

    let msg = message::build_message(
        action,
        expiry_ts,
        &wallet_account.name,
        proposal_account.proposal_index,
        &intent_account,
        &proposal_account.params_data,
    )?;
    let msg_plain = message::build_plain_message(
        action,
        expiry_ts,
        &wallet_account.name,
        proposal_account.proposal_index,
        &intent_account,
        &proposal_account.params_data,
    )?;

    if config.dry_run {
        crate::output::print_dry_run(&crate::output::DryRunDescriptor {
            action: if is_approve {
                "proposal_approve"
            } else {
                "proposal_cancel"
            },
            wallet_name: &wallet_account.name,
            wallet_pubkey: wallet_pubkey.to_string(),
            intent_index: intent_account.intent_index,
            intent_pubkey: intent_pubkey.to_string(),
            message_hex: crate::output::hex_of(&msg),
            params_data_hex: crate::output::hex_of(&proposal_account.params_data),
            expiry: expiry_ts,
            proposal_pubkey: Some(proposal_pubkey.to_string()),
            proposal_index: Some(proposal_account.proposal_index),
        });
        return Ok(());
    }

    crate::progress!("Signing message:\n{}", String::from_utf8_lossy(&msg[20..]));
    let signature =
        sign_message_with_flavor(&*config.signer, &msg, &msg_plain, config.message_flavor)?;

    let ix = if is_approve {
        crate::instructions::approve(
            wallet_pubkey,
            intent_pubkey,
            proposal_pubkey,
            expiry_ts,
            approver_index,
            signature,
        )
    } else {
        crate::instructions::cancel(
            wallet_pubkey,
            intent_pubkey,
            proposal_pubkey,
            expiry_ts,
            approver_index,
            signature,
        )
    };

    let sig = rpc::send_instruction(&client, config, ix)?;

    print_json(&serde_json::json!({
        "txid": sig.to_string(),
        "action": action,
        "approver_index": approver_index,
    }));

    Ok(())
}
