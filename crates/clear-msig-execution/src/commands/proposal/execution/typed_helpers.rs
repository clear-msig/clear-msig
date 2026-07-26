use super::*;

pub(in crate::commands::proposal) fn parse_hex_local(s: &str) -> Result<Vec<u8>> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if !s.len().is_multiple_of(2) {
        return Err(anyhow!("hex string has odd length"));
    }
    (0..s.len() / 2)
        .map(|i| {
            u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|e| anyhow!("invalid hex: {e}"))
        })
        .collect()
}

pub(in crate::commands::proposal) fn decode_hex_32(value: &str, field: &str) -> Result<[u8; 32]> {
    let bytes = parse_hex_local(value).with_context(|| format!("invalid {field} hex"))?;
    if bytes.len() != 32 {
        return Err(anyhow!("{field} must be 32 bytes, got {}", bytes.len()));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

pub(in crate::commands::proposal) fn ensure_typed_text(value: &str, field: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(anyhow!("{field} must not be empty"));
    }
    if value.len() > 128 {
        return Err(anyhow!("{field} must be 128 bytes or fewer"));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub(in crate::commands::proposal) fn typed_vote_message(
    vote_kind: ClearSignVoteKind,
    wallet_name: &str,
    signer_pubkey: &[u8; 32],
    proposal_index: u64,
    envelope_hash: [u8; 32],
    expires_at: i64,
    approvals_required: u8,
    approvals_after: u8,
    clear_text: &[u8],
) -> Result<Vec<u8>> {
    let mut out = vec![0u8; MAX_CLEARSIGN_VOTE_MESSAGE_BYTES];
    let len = write_vote_message_for_clear_text(
        &mut out,
        vote_kind,
        wallet_name.as_bytes(),
        signer_pubkey,
        proposal_index,
        envelope_hash,
        expires_at,
        approvals_required,
        approvals_after,
        clear_text,
    )
    .map_err(|error| anyhow!("could not build canonical ClearSign vote message: {error:?}"))?;
    out.truncate(len);
    Ok(out)
}

pub(in crate::commands::proposal) fn typed_message_flavor(clear_text: &[u8]) -> &'static str {
    if is_v4_document(clear_text) {
        "clearsign_v4_document"
    } else if is_v3_document(clear_text) {
        "clearsign_v3_document"
    } else {
        "clearsign_v2_text"
    }
}

pub(in crate::commands::proposal) fn resolve_approved_typed_proposal(
    _config: &RuntimeConfig,
    client: &crate::rpc::Client,
    wallet_name: &str,
    proposal_addr_str: &str,
) -> Result<(Pubkey, Pubkey, accounts::TypedProposalAccount)> {
    let (wallet_pubkey, _) = rpc::resolve_wallet_by_name(client, wallet_name)?;
    let proposal_pubkey: Pubkey = proposal_addr_str
        .parse()
        .with_context(|| "invalid proposal address")?;
    let proposal_data = rpc::fetch_account(client, &proposal_pubkey)?;
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
    Ok((wallet_pubkey, proposal_pubkey, proposal_account))
}

pub(in crate::commands::proposal) fn ensure_typed_action(
    proposal: &accounts::TypedProposalAccount,
    expected: ClearSignActionKind,
    label: &str,
) -> Result<()> {
    if proposal.action_kind != expected.code() {
        return Err(anyhow!(
            "{label} requires action kind {}, got {}",
            expected.code(),
            proposal.action_kind
        ));
    }
    Ok(())
}

pub(in crate::commands::proposal) fn ensure_generic_typed_execute_allowed(
    proposal: &accounts::TypedProposalAccount,
) -> Result<()> {
    let specialized = match ClearSignActionKind::from_code(proposal.action_kind) {
        Some(ClearSignActionKind::AddMember) => Some("typed-intent-governance"),
        Some(ClearSignActionKind::RemoveMember) => Some("typed-intent-governance"),
        Some(ClearSignActionKind::ChangeThreshold) => Some("typed-intent-governance"),
        Some(ClearSignActionKind::SetProtection) => Some("typed-wallet-policy-update"),
        _ => None,
    };
    if let Some(command) = specialized {
        return Err(anyhow!(
            "action kind {} requires proposal {command}; generic typed-execute would not apply the state change",
            proposal.action_kind
        ));
    }
    Ok(())
}

pub(in crate::commands::proposal) fn committed_governance_payload(
    committed: &[u8],
    requested_target: Option<u8>,
) -> Result<(u8, Vec<u8>)> {
    let (&committed_target, committed_body) = committed
        .split_first()
        .filter(|(_, body)| !body.is_empty())
        .ok_or_else(|| {
            anyhow!("typed governance proposal is missing its committed execution payload")
        })?;
    if let Some(requested_target) = requested_target {
        if requested_target != committed_target {
            return Err(anyhow!(
                "target-index {requested_target} does not match committed target {committed_target}"
            ));
        }
    }
    Ok((committed_target, committed_body.to_vec()))
}

pub(in crate::commands::proposal) fn parse_return_row(row: &str) -> Result<(Pubkey, u64)> {
    parse_recipient_lamports_row(row, "return")
}

pub(in crate::commands::proposal) fn parse_token_return_row(
    row: &str,
) -> Result<(Pubkey, Pubkey, u64)> {
    let mut parts = row.split(':');
    let destination_token = parts
        .next()
        .ok_or_else(|| anyhow!("token return row must be destination_token:funder_owner:tokens"))?
        .parse::<Pubkey>()
        .with_context(|| "invalid token return destination token account address")?;
    let funder_owner = parts
        .next()
        .ok_or_else(|| anyhow!("token return row must be destination_token:funder_owner:tokens"))?
        .parse::<Pubkey>()
        .with_context(|| "invalid token return funder owner address")?;
    let amount_tokens = parts
        .next()
        .ok_or_else(|| anyhow!("token return row must be destination_token:funder_owner:tokens"))?
        .parse::<u64>()
        .with_context(|| "invalid token return token amount")?;
    if parts.next().is_some() {
        return Err(anyhow!(
            "token return row must be destination_token:funder_owner:tokens"
        ));
    }
    if amount_tokens == 0 {
        return Err(anyhow!(
            "token return token amount must be greater than zero"
        ));
    }
    Ok((destination_token, funder_owner, amount_tokens))
}

pub(in crate::commands::proposal) fn intent_tx_template_hash(
    intent: &accounts::IntentAccount,
) -> Result<[u8; 32]> {
    let start = intent.tx_template_offset as usize;
    let end = start
        .checked_add(intent.tx_template_len as usize)
        .ok_or_else(|| anyhow!("intent tx_template range overflow"))?;
    let bytes = intent
        .byte_pool
        .get(start..end)
        .ok_or_else(|| anyhow!("intent tx_template range is outside byte pool"))?;
    Ok(crate::message::sha256_hash(bytes))
}

pub(in crate::commands::proposal) fn intent_policy_ciphertexts_hash(
    intent: &accounts::IntentAccount,
) -> Result<[u8; 32]> {
    if intent.policy_ciphertexts.is_empty() {
        return Err(anyhow!(
            "typed private escrow requires intent policy ciphertext identifiers"
        ));
    }
    Ok(crate::message::sha256_hash(&intent.policy_ciphertexts))
}

pub(in crate::commands::proposal) fn parse_recipient_lamports_row(
    row: &str,
    label: &str,
) -> Result<(Pubkey, u64)> {
    let (recipient, amount) = row
        .split_once(':')
        .ok_or_else(|| anyhow!("{label} row must be recipient:lamports"))?;
    let recipient = recipient
        .parse::<Pubkey>()
        .with_context(|| format!("invalid {label} recipient address"))?;
    let amount = amount
        .parse::<u64>()
        .with_context(|| format!("invalid {label} lamports amount"))?;
    if amount == 0 {
        return Err(anyhow!("{label} lamports amount must be greater than zero"));
    }
    Ok((recipient, amount))
}

pub(in crate::commands::proposal) fn vault_pubkey(wallet_pubkey: Pubkey) -> Pubkey {
    let (vault, _) = clear_wallet_client::pda::find_vault_address(
        &solana_address::Address::new_from_array(wallet_pubkey.to_bytes()),
        &solana_address::Address::new_from_array(crate::instructions::program_id().to_bytes()),
    );
    Pubkey::new_from_array(vault.to_bytes())
}

pub(in crate::commands::proposal) fn policy_spend_pubkey(
    wallet_pubkey: Pubkey,
    intent_pubkey: Pubkey,
) -> Pubkey {
    let (policy_spend, _) = clear_wallet_client::pda::find_policy_spend_address(
        &solana_address::Address::new_from_array(wallet_pubkey.to_bytes()),
        &solana_address::Address::new_from_array(intent_pubkey.to_bytes()),
        &solana_address::Address::new_from_array(crate::instructions::program_id().to_bytes()),
    );
    Pubkey::new_from_array(policy_spend.to_bytes())
}

pub(in crate::commands::proposal) fn member_allowance_pubkey(
    wallet_pubkey: Pubkey,
    intent_pubkey: Pubkey,
) -> Pubkey {
    let (member_allowance, _) = clear_wallet_client::pda::find_member_allowance_address(
        &solana_address::Address::new_from_array(wallet_pubkey.to_bytes()),
        &solana_address::Address::new_from_array(intent_pubkey.to_bytes()),
        &solana_address::Address::new_from_array(crate::instructions::program_id().to_bytes()),
    );
    Pubkey::new_from_array(member_allowance.to_bytes())
}

pub(in crate::commands::proposal) fn agent_session_pubkey(
    wallet_pubkey: Pubkey,
    session_id_hash: [u8; 32],
) -> Pubkey {
    let (session, _) = clear_wallet_client::pda::find_agent_session_address(
        &solana_address::Address::new_from_array(wallet_pubkey.to_bytes()),
        &session_id_hash,
        &solana_address::Address::new_from_array(crate::instructions::program_id().to_bytes()),
    );
    Pubkey::new_from_array(session.to_bytes())
}

pub(in crate::commands::proposal) fn wallet_policy_pubkey(wallet_pubkey: Pubkey) -> Pubkey {
    let (wallet_policy, _) = clear_wallet_client::pda::find_wallet_policy_address(
        &solana_address::Address::new_from_array(wallet_pubkey.to_bytes()),
        &solana_address::Address::new_from_array(crate::instructions::program_id().to_bytes()),
    );
    Pubkey::new_from_array(wallet_policy.to_bytes())
}
