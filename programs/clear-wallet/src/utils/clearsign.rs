use sha2::{Digest, Sha256};

use crate::utils::base58::encode_base58;

pub const CLEARSIGN_V2_VERSION: u8 = 2;
pub const CLEARSIGN_V2_DOMAIN: &[u8] = b"clearsig:policy-engine:v2";
pub const CLEARSIGN_V3_VERSION: u8 = 3;
pub const CLEARSIGN_V3_DOMAIN: &[u8] = b"clearsig:policy-engine:v3";
pub const CLEARSIGN_V2_PAYLOAD_DOMAIN: &[u8] = b"clearsig:policy-engine:v2:payload";
pub const CLEARSIGN_V2_POLICY_DOMAIN: &[u8] = b"clearsig:policy-engine:v2:policy";
pub const MAX_ACTION_TTL_SECONDS: i64 = 30 * 24 * 60 * 60;
pub const MAX_CLEARSIGN_VOTE_MESSAGE_BYTES: usize = MAX_CLEARSIGN_TEXT_BYTES + 512;
pub const CLEARSIGN_V3_DOCUMENT_PREFIX: &[u8] = b"ClearSig Proposal\n\nACTION\n";
pub const CLEARSIGN_V3_FULL_PROFILE: &[u8] = b"Display profile: clearsig-full-v1@1";
pub const CLEARSIGN_V3_LEDGER_PROFILE: &[u8] = b"Display profile: clearsig-ledger-solana-v1@1";
pub const MAX_CLEARSIGN_LEDGER_DOCUMENT_BYTES: usize = 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum ClearSignActionKind {
    Send = 1,
    BatchSend = 2,
    AddMember = 3,
    RemoveMember = 4,
    ChangeThreshold = 5,
    SetProtection = 6,
    ReleaseMilestone = 7,
    ReturnEscrowFunds = 8,
    AgentTradeApproval = 9,
    RecoveryAction = 10,
    SwapIntent = 11,
    AgentSessionGrant = 12,
    AgentRiskPolicy = 13,
    AgentTradeSettlement = 14,
}

impl ClearSignActionKind {
    pub fn from_code(code: u8) -> Option<Self> {
        match code {
            1 => Some(Self::Send),
            2 => Some(Self::BatchSend),
            3 => Some(Self::AddMember),
            4 => Some(Self::RemoveMember),
            5 => Some(Self::ChangeThreshold),
            6 => Some(Self::SetProtection),
            7 => Some(Self::ReleaseMilestone),
            8 => Some(Self::ReturnEscrowFunds),
            9 => Some(Self::AgentTradeApproval),
            10 => Some(Self::RecoveryAction),
            11 => Some(Self::SwapIntent),
            12 => Some(Self::AgentSessionGrant),
            13 => Some(Self::AgentRiskPolicy),
            14 => Some(Self::AgentTradeSettlement),
            _ => None,
        }
    }

    pub fn code(self) -> u8 {
        self as u8
    }

    pub fn clear_headline(self) -> &'static str {
        match self {
            Self::Send => "Send funds",
            Self::BatchSend => "Send batch payment",
            Self::AddMember => "Add member",
            Self::RemoveMember => "Remove member",
            Self::ChangeThreshold => "Change approval rule",
            Self::SetProtection => "Set protection",
            Self::ReleaseMilestone => "Release escrow milestone",
            Self::ReturnEscrowFunds => "Return escrow funds",
            Self::AgentTradeApproval => "Approve agent trade",
            Self::RecoveryAction => "Approve recovery",
            Self::SwapIntent => "Approve swap",
            Self::AgentSessionGrant => "Grant agent session",
            Self::AgentRiskPolicy => "Set agent risk policy",
            Self::AgentTradeSettlement => "Settle agent trade",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClearSignError {
    MissingWalletName,
    MissingActionId,
    MissingNonce,
    MissingClearText,
    MessageTooLong,
    InvalidVoteMessage,
    InvalidReplayCommitment,
    Expired,
    ExpiryTooFar,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum ClearSignVoteKind {
    Propose = 1,
    Approve = 2,
    Cancel = 3,
}

impl ClearSignVoteKind {
    pub fn label(self) -> &'static [u8] {
        match self {
            Self::Propose => b"propose",
            Self::Approve => b"approve",
            Self::Cancel => b"cancel",
        }
    }
}

pub struct ClearSignEnvelope<'a> {
    pub kind: ClearSignActionKind,
    pub wallet_name: &'a [u8],
    pub wallet_id: &'a [u8],
    pub action_id: &'a [u8],
    pub nonce: &'a [u8],
    pub expires_at: i64,
    pub policy_commitment: [u8; 32],
    pub payload_hash: [u8; 32],
    pub clear_text_hash: [u8; 32],
}

impl<'a> ClearSignEnvelope<'a> {
    pub fn validate_replay_fields(&self, now: i64) -> Result<(), ClearSignError> {
        if self.wallet_name.is_empty() {
            return Err(ClearSignError::MissingWalletName);
        }
        if self.action_id.is_empty() {
            return Err(ClearSignError::MissingActionId);
        }
        if self.nonce.is_empty() {
            return Err(ClearSignError::MissingNonce);
        }
        if self.action_id.len() != 32 || self.nonce.len() != 32 {
            return Err(ClearSignError::InvalidReplayCommitment);
        }
        if self.expires_at <= now {
            return Err(ClearSignError::Expired);
        }
        if self.expires_at - now > MAX_ACTION_TTL_SECONDS {
            return Err(ClearSignError::ExpiryTooFar);
        }
        Ok(())
    }
}

pub struct ClearSignAmount<'a> {
    pub asset: &'a [u8],
    pub raw_amount: u128,
}

pub struct ClearSignRecipientAmount<'a> {
    pub recipient: &'a [u8],
    pub amount: ClearSignAmount<'a>,
}

pub fn hash_envelope(envelope: &ClearSignEnvelope<'_>) -> [u8; 32] {
    hash_envelope_with_domain(envelope, CLEARSIGN_V3_DOMAIN, CLEARSIGN_V3_VERSION)
}

pub fn hash_envelope_v2(envelope: &ClearSignEnvelope<'_>) -> [u8; 32] {
    hash_envelope_with_domain(envelope, CLEARSIGN_V2_DOMAIN, CLEARSIGN_V2_VERSION)
}

fn hash_envelope_with_domain(
    envelope: &ClearSignEnvelope<'_>,
    domain: &[u8],
    version: u8,
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, domain);
    hasher.update([version]);
    hasher.update([envelope.kind.code()]);
    update_i64(&mut hasher, envelope.expires_at);
    update_bytes(&mut hasher, envelope.wallet_name);
    update_bytes(&mut hasher, envelope.wallet_id);
    update_bytes(&mut hasher, envelope.action_id);
    update_bytes(&mut hasher, envelope.nonce);
    hasher.update(envelope.policy_commitment);
    hasher.update(envelope.payload_hash);
    hasher.update(envelope.clear_text_hash);
    finish_hash(hasher)
}

pub fn hash_envelope_for_clear_text(
    envelope: &ClearSignEnvelope<'_>,
    clear_text: &[u8],
) -> [u8; 32] {
    if is_v3_document(clear_text) {
        hash_envelope(envelope)
    } else {
        hash_envelope_v2(envelope)
    }
}

pub fn is_v3_document(clear_text: &[u8]) -> bool {
    clear_text.starts_with(CLEARSIGN_V3_DOCUMENT_PREFIX)
}

pub fn validate_v3_document(clear_text: &[u8]) -> Result<(), ClearSignError> {
    hash_clear_text(clear_text)?;
    if !is_v3_document(clear_text)
        || clear_text
            .iter()
            .any(|byte| (*byte < 0x20 && *byte != b'\n') || *byte == 0x7f)
    {
        return Err(ClearSignError::InvalidVoteMessage);
    }
    let mut cursor = CLEARSIGN_V3_DOCUMENT_PREFIX.len();
    for section in [
        b"\n\nDETAILS\n".as_slice(),
        b"\n\nPOLICY\n".as_slice(),
        b"\n\nRISK\n".as_slice(),
        b"\n\nPURPOSE\n".as_slice(),
    ] {
        let offset =
            find_bytes(&clear_text[cursor..], section).ok_or(ClearSignError::InvalidVoteMessage)?;
        let content = &clear_text[cursor..cursor + offset];
        if content.is_empty() || find_bytes(content, b"\n\n").is_some() {
            return Err(ClearSignError::InvalidVoteMessage);
        }
        cursor += offset + section.len();
    }
    let purpose = &clear_text[cursor..];
    if purpose.is_empty() || find_bytes(purpose, b"\n\n").is_some() {
        return Err(ClearSignError::InvalidVoteMessage);
    }
    validate_v3_display_profile(clear_text)?;
    Ok(())
}

fn validate_v3_display_profile(clear_text: &[u8]) -> Result<(), ClearSignError> {
    let policy_marker = b"\n\nPOLICY\n";
    let risk_marker = b"\n\nRISK\n";
    let policy_start = find_bytes(clear_text, policy_marker)
        .ok_or(ClearSignError::InvalidVoteMessage)?
        + policy_marker.len();
    let policy_end = policy_start
        + find_bytes(&clear_text[policy_start..], risk_marker)
            .ok_or(ClearSignError::InvalidVoteMessage)?;
    let policy = &clear_text[policy_start..policy_end];
    let full = count_bytes(clear_text, CLEARSIGN_V3_FULL_PROFILE);
    let compact = count_bytes(clear_text, CLEARSIGN_V3_LEDGER_PROFILE);
    if full + compact != 1
        || (full == 1 && find_bytes(policy, CLEARSIGN_V3_FULL_PROFILE).is_none())
        || (compact == 1 && find_bytes(policy, CLEARSIGN_V3_LEDGER_PROFILE).is_none())
        || (compact == 1 && clear_text.len() > MAX_CLEARSIGN_LEDGER_DOCUMENT_BYTES)
    {
        return Err(ClearSignError::InvalidVoteMessage);
    }
    Ok(())
}

fn count_bytes(haystack: &[u8], needle: &[u8]) -> usize {
    if needle.is_empty() {
        return 0;
    }
    let mut count = 0;
    let mut cursor = haystack;
    while let Some(offset) = find_bytes(cursor, needle) {
        count += 1;
        cursor = &cursor[offset + needle.len()..];
    }
    count
}

pub fn hash_clear_text(clear_text: &[u8]) -> Result<[u8; 32], ClearSignError> {
    if clear_text.is_empty() {
        return Err(ClearSignError::MissingClearText);
    }
    if clear_text.len() > MAX_CLEARSIGN_TEXT_BYTES {
        return Err(ClearSignError::MessageTooLong);
    }
    let mut hasher = Sha256::new();
    hasher.update(clear_text);
    Ok(finish_hash(hasher))
}

pub const MAX_CLEARSIGN_TEXT_BYTES: usize = 2048;

pub fn extract_clear_text_from_vote_message<'a>(
    vote_kind: ClearSignVoteKind,
    wallet_name: &[u8],
    signer_pubkey: &[u8],
    proposal_index: u64,
    envelope_hash: [u8; 32],
    expires_at: i64,
    approvals_required: u8,
    approvals_after: u8,
    vote_message: &'a [u8],
) -> Result<&'a [u8], ClearSignError> {
    if vote_message.starts_with(CLEARSIGN_V3_DOCUMENT_PREFIX) {
        let marker = b"\n\nAPPROVAL\n";
        let split = find_bytes(vote_message, marker).ok_or(ClearSignError::InvalidVoteMessage)?;
        let clear_text = &vote_message[..split];
        let mut cursor = &vote_message[split + marker.len()..];
        cursor = strip_prefix(cursor, b"Decision: ")?;
        cursor = strip_prefix(cursor, vote_decision(vote_kind))?;
        cursor = strip_prefix(cursor, b"\nProposal: #")?;
        let decimal_len = decimal_u64_len(proposal_index);
        let mut decimal = [0u8; 20];
        write_decimal_u64(proposal_index, &mut decimal);
        cursor = strip_prefix(cursor, &decimal[..decimal_len])?;
        cursor = strip_prefix(cursor, b"\nWallet: ")?;
        cursor = strip_prefix(cursor, wallet_name)?;
        cursor = strip_prefix(cursor, b"\nRequested by: ")?;
        let mut signer = [0u8; 44];
        let signer_len =
            encode_base58(signer_pubkey, &mut signer).ok_or(ClearSignError::InvalidVoteMessage)?;
        cursor = strip_prefix(cursor, &signer[..signer_len])?;
        cursor = strip_prefix(cursor, b"\nRequirement: ")?;
        cursor = strip_decimal_u8(cursor, approvals_required)?;
        cursor = strip_prefix(
            cursor,
            approval_requirement_label(vote_kind, approvals_required),
        )?;
        cursor = strip_prefix(cursor, b"\nStatus if accepted: ")?;
        cursor = strip_decimal_u8(cursor, approvals_after)?;
        cursor = strip_prefix(cursor, b" of ")?;
        cursor = strip_decimal_u8(cursor, approvals_required)?;
        cursor = strip_prefix(
            cursor,
            approval_requirement_label(vote_kind, approvals_required),
        )?;
        cursor = strip_prefix(cursor, b"\n\nEXPIRY\n")?;
        let mut expiry = [0u8; 19];
        crate::utils::datetime::format_timestamp(expires_at, &mut expiry)
            .ok_or(ClearSignError::InvalidVoteMessage)?;
        cursor = strip_prefix(cursor, &expiry)?;
        cursor = strip_prefix(cursor, b" UTC\n\nPROOF\nClearSign: v3\nEnvelope: ")?;
        let mut hex = [0u8; 64];
        write_hex_32(&envelope_hash, &mut hex);
        cursor = strip_prefix(cursor, &hex)?;
        if !cursor.is_empty() {
            return Err(ClearSignError::InvalidVoteMessage);
        }
        return Ok(clear_text);
    }
    if vote_message.len() > MAX_CLEARSIGN_TEXT_BYTES + 160 {
        return Err(ClearSignError::MessageTooLong);
    }
    let mut cursor = vote_message;
    cursor = strip_prefix(cursor, b"ClearSign v2 ")?;
    cursor = strip_prefix(cursor, vote_kind.label())?;
    cursor = strip_prefix(cursor, b"\nWallet ")?;
    cursor = strip_prefix(cursor, wallet_name)?;
    cursor = strip_prefix(cursor, b"\nProposal ")?;
    let decimal_len = decimal_u64_len(proposal_index);
    let mut decimal = [0u8; 20];
    write_decimal_u64(proposal_index, &mut decimal);
    cursor = strip_prefix(cursor, &decimal[..decimal_len])?;
    cursor = strip_prefix(cursor, b"\nEnvelope ")?;
    let mut hex = [0u8; 64];
    write_hex_32(&envelope_hash, &mut hex);
    cursor = strip_prefix(cursor, &hex)?;
    cursor = strip_prefix(cursor, b"\n\n")?;
    if cursor.is_empty() {
        return Err(ClearSignError::MissingClearText);
    }
    if cursor.len() > MAX_CLEARSIGN_TEXT_BYTES {
        return Err(ClearSignError::MessageTooLong);
    }
    Ok(cursor)
}

pub fn write_vote_message_for_clear_text(
    out: &mut [u8],
    vote_kind: ClearSignVoteKind,
    wallet_name: &[u8],
    signer_pubkey: &[u8],
    proposal_index: u64,
    envelope_hash: [u8; 32],
    expires_at: i64,
    approvals_required: u8,
    approvals_after: u8,
    clear_text: &[u8],
) -> Result<usize, ClearSignError> {
    if !is_v3_document(clear_text) {
        return write_vote_message(
            out,
            vote_kind,
            wallet_name,
            proposal_index,
            envelope_hash,
            clear_text,
        );
    }
    hash_clear_text(clear_text)?;
    let mut len = 0usize;
    push_bytes(out, &mut len, clear_text)?;
    push_bytes(out, &mut len, b"\n\nAPPROVAL\nDecision: ")?;
    push_bytes(out, &mut len, vote_decision(vote_kind))?;
    push_bytes(out, &mut len, b"\nProposal: #")?;
    let decimal_len = decimal_u64_len(proposal_index);
    let mut decimal = [0u8; 20];
    write_decimal_u64(proposal_index, &mut decimal);
    push_bytes(out, &mut len, &decimal[..decimal_len])?;
    push_bytes(out, &mut len, b"\nWallet: ")?;
    push_bytes(out, &mut len, wallet_name)?;
    push_bytes(out, &mut len, b"\nRequested by: ")?;
    let mut signer = [0u8; 44];
    let signer_len =
        encode_base58(signer_pubkey, &mut signer).ok_or(ClearSignError::InvalidVoteMessage)?;
    push_bytes(out, &mut len, &signer[..signer_len])?;
    push_bytes(out, &mut len, b"\nRequirement: ")?;
    push_decimal_u8(out, &mut len, approvals_required)?;
    push_bytes(
        out,
        &mut len,
        approval_requirement_label(vote_kind, approvals_required),
    )?;
    push_bytes(out, &mut len, b"\nStatus if accepted: ")?;
    push_decimal_u8(out, &mut len, approvals_after)?;
    push_bytes(out, &mut len, b" of ")?;
    push_decimal_u8(out, &mut len, approvals_required)?;
    push_bytes(
        out,
        &mut len,
        approval_requirement_label(vote_kind, approvals_required),
    )?;
    push_bytes(out, &mut len, b"\n\nEXPIRY\n")?;
    let mut expiry = [0u8; 19];
    crate::utils::datetime::format_timestamp(expires_at, &mut expiry)
        .ok_or(ClearSignError::InvalidVoteMessage)?;
    push_bytes(out, &mut len, &expiry)?;
    push_bytes(out, &mut len, b" UTC\n\nPROOF\nClearSign: v3\nEnvelope: ")?;
    let mut hex = [0u8; 64];
    write_hex_32(&envelope_hash, &mut hex);
    push_bytes(out, &mut len, &hex)?;
    Ok(len)
}

fn vote_decision(kind: ClearSignVoteKind) -> &'static [u8] {
    match kind {
        ClearSignVoteKind::Propose => b"PROPOSE",
        ClearSignVoteKind::Approve => b"APPROVE",
        ClearSignVoteKind::Cancel => b"CANCEL",
    }
}

fn approval_requirement_label(kind: ClearSignVoteKind, required: u8) -> &'static [u8] {
    match (kind, required) {
        (ClearSignVoteKind::Cancel, 1) => b" cancellation",
        (ClearSignVoteKind::Cancel, _) => b" cancellations",
        (_, 1) => b" approval",
        _ => b" approvals",
    }
}

fn push_decimal_u8(out: &mut [u8], len: &mut usize, value: u8) -> Result<(), ClearSignError> {
    let mut digits = [0u8; 3];
    let width = if value >= 100 {
        3
    } else if value >= 10 {
        2
    } else {
        1
    };
    let mut remaining = value;
    for index in (0..width).rev() {
        digits[index] = b'0' + remaining % 10;
        remaining /= 10;
    }
    push_bytes(out, len, &digits[..width])
}

fn strip_decimal_u8(input: &[u8], value: u8) -> Result<&[u8], ClearSignError> {
    let mut digits = [0u8; 3];
    let mut len = 0usize;
    push_decimal_u8(&mut digits, &mut len, value)?;
    strip_prefix(input, &digits[..len])
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

pub fn write_vote_message(
    out: &mut [u8],
    vote_kind: ClearSignVoteKind,
    wallet_name: &[u8],
    proposal_index: u64,
    envelope_hash: [u8; 32],
    clear_text: &[u8],
) -> Result<usize, ClearSignError> {
    hash_clear_text(clear_text)?;
    let mut len = 0usize;
    push_bytes(out, &mut len, b"ClearSign v2 ")?;
    push_bytes(out, &mut len, vote_kind.label())?;
    push_bytes(out, &mut len, b"\nWallet ")?;
    push_bytes(out, &mut len, wallet_name)?;
    push_bytes(out, &mut len, b"\nProposal ")?;
    let decimal_len = decimal_u64_len(proposal_index);
    let mut decimal = [0u8; 20];
    write_decimal_u64(proposal_index, &mut decimal);
    push_bytes(out, &mut len, &decimal[..decimal_len])?;
    push_bytes(out, &mut len, b"\nEnvelope ")?;
    let mut hex = [0u8; 64];
    write_hex_32(&envelope_hash, &mut hex);
    push_bytes(out, &mut len, &hex)?;
    push_bytes(out, &mut len, b"\n\n")?;
    push_bytes(out, &mut len, clear_text)?;
    Ok(len)
}

pub fn hash_policy_commitment(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, CLEARSIGN_V2_POLICY_DOMAIN);
    update_u32(&mut hasher, parts.len() as u32);
    for part in parts {
        update_bytes(&mut hasher, part);
    }
    finish_hash(hasher)
}

pub fn hash_send_payload(recipient: &[u8], amount: &ClearSignAmount<'_>) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::Send);
    update_recipient_amount(&mut hasher, recipient, amount);
    finish_hash(hasher)
}

pub fn hash_wallet_policy_update_payload(
    chain_kind: u8,
    new_policy_commitment: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::SetProtection);
    update_bytes(&mut hasher, b"wallet_policy");
    hasher.update([chain_kind]);
    hasher.update(new_policy_commitment);
    finish_hash(hasher)
}

/// Bind the final governance state of a target intent.
/// Used for AddMember / RemoveMember / ChangeThreshold typed executors so
/// the signed ClearSign text and the on-chain rewrite cannot diverge.
pub fn hash_intent_governance_payload(
    action_kind: ClearSignActionKind,
    target_intent_index: u8,
    approval_threshold: u8,
    cancellation_threshold: u8,
    timelock_seconds: u32,
    proposers: &[[u8; 32]],
    approvers: &[[u8; 32]],
) -> [u8; 32] {
    let mut hasher = payload_hasher(action_kind);
    update_bytes(&mut hasher, b"intent_governance");
    hasher.update([target_intent_index]);
    hasher.update([approval_threshold]);
    hasher.update([cancellation_threshold]);
    hasher.update(timelock_seconds.to_le_bytes());
    update_u32(&mut hasher, proposers.len() as u32);
    for pk in proposers {
        hasher.update(pk);
    }
    update_u32(&mut hasher, approvers.len() as u32);
    for pk in approvers {
        hasher.update(pk);
    }
    finish_hash(hasher)
}

pub fn hash_batch_send_payload(recipients: &[ClearSignRecipientAmount<'_>]) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::BatchSend);
    update_u32(&mut hasher, recipients.len() as u32);
    for item in recipients {
        update_recipient_amount(&mut hasher, item.recipient, &item.amount);
    }
    finish_hash(hasher)
}

pub fn hash_batch_send_sol_payload_iter<'a, I>(recipients: I) -> [u8; 32]
where
    I: ExactSizeIterator<Item = (&'a [u8], u64)>,
{
    let mut hasher = payload_hasher(ClearSignActionKind::BatchSend);
    update_u32(&mut hasher, recipients.len() as u32);
    for (recipient, lamports) in recipients {
        update_recipient_amount(
            &mut hasher,
            recipient,
            &ClearSignAmount {
                asset: b"SOL",
                raw_amount: lamports as u128,
            },
        );
    }
    finish_hash(hasher)
}

pub fn hash_release_milestone_payload(
    escrow_id: &[u8],
    milestone_id: &[u8],
    recipient: &[u8],
    amount: &ClearSignAmount<'_>,
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::ReleaseMilestone);
    update_bytes(&mut hasher, escrow_id);
    update_bytes(&mut hasher, milestone_id);
    update_recipient_amount(&mut hasher, recipient, amount);
    finish_hash(hasher)
}

pub fn hash_release_token_milestone_payload(
    escrow_id: &[u8],
    milestone_id: &[u8],
    mint: &[u8],
    source_token: &[u8],
    destination_token: &[u8],
    recipient_owner: &[u8],
    amount: &ClearSignAmount<'_>,
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::ReleaseMilestone);
    update_bytes(&mut hasher, escrow_id);
    update_bytes(&mut hasher, milestone_id);
    update_bytes(&mut hasher, mint);
    update_bytes(&mut hasher, source_token);
    update_bytes(&mut hasher, destination_token);
    update_recipient_amount(&mut hasher, recipient_owner, amount);
    finish_hash(hasher)
}

pub fn hash_return_escrow_funds_payload(
    escrow_id: &[u8],
    returns: &[ClearSignRecipientAmount<'_>],
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::ReturnEscrowFunds);
    update_bytes(&mut hasher, escrow_id);
    update_u32(&mut hasher, returns.len() as u32);
    for item in returns {
        update_recipient_amount(&mut hasher, item.recipient, &item.amount);
    }
    finish_hash(hasher)
}

pub fn hash_return_escrow_sol_payload_iter<'a, I>(escrow_id: &[u8], returns: I) -> [u8; 32]
where
    I: ExactSizeIterator<Item = (&'a [u8], u64)>,
{
    let mut hasher = payload_hasher(ClearSignActionKind::ReturnEscrowFunds);
    update_bytes(&mut hasher, escrow_id);
    update_u32(&mut hasher, returns.len() as u32);
    for (recipient, lamports) in returns {
        update_recipient_amount(
            &mut hasher,
            recipient,
            &ClearSignAmount {
                asset: b"SOL",
                raw_amount: lamports as u128,
            },
        );
    }
    finish_hash(hasher)
}

pub fn hash_return_token_escrow_payload_iter<'a, I>(
    escrow_id: &[u8],
    mint: &[u8],
    source_token: &[u8],
    returns: I,
) -> [u8; 32]
where
    I: ExactSizeIterator<Item = (&'a [u8], &'a [u8], u64)>,
{
    let mut hasher = payload_hasher(ClearSignActionKind::ReturnEscrowFunds);
    update_bytes(&mut hasher, escrow_id);
    update_bytes(&mut hasher, mint);
    update_bytes(&mut hasher, source_token);
    update_u32(&mut hasher, returns.len() as u32);
    for (destination_token, funder_owner, amount_tokens) in returns {
        update_bytes(&mut hasher, destination_token);
        update_recipient_amount(
            &mut hasher,
            funder_owner,
            &ClearSignAmount {
                asset: mint,
                raw_amount: amount_tokens as u128,
            },
        );
    }
    finish_hash(hasher)
}

pub fn hash_cross_chain_escrow_release_payload(
    escrow_id: &[u8],
    milestone_id: &[u8],
    chain_kind: u8,
    ika_config: &[u8],
    dwallet: &[u8],
    recipient: &[u8],
    amount: &ClearSignAmount<'_>,
    route_hash: &[u8],
    tx_template_hash: &[u8],
    settlement_artifact_hash: &[u8],
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::ReleaseMilestone);
    update_bytes(&mut hasher, escrow_id);
    update_bytes(&mut hasher, milestone_id);
    hasher.update([chain_kind]);
    update_bytes(&mut hasher, ika_config);
    update_bytes(&mut hasher, dwallet);
    update_recipient_amount(&mut hasher, recipient, amount);
    update_bytes(&mut hasher, route_hash);
    update_bytes(&mut hasher, tx_template_hash);
    update_bytes(&mut hasher, settlement_artifact_hash);
    finish_hash(hasher)
}

pub fn hash_cross_chain_escrow_return_payload(
    escrow_id: &[u8],
    chain_kind: u8,
    ika_config: &[u8],
    dwallet: &[u8],
    refund_recipient: &[u8],
    amount: &ClearSignAmount<'_>,
    route_hash: &[u8],
    tx_template_hash: &[u8],
    settlement_artifact_hash: &[u8],
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::ReturnEscrowFunds);
    update_bytes(&mut hasher, escrow_id);
    hasher.update([chain_kind]);
    update_bytes(&mut hasher, ika_config);
    update_bytes(&mut hasher, dwallet);
    update_recipient_amount(&mut hasher, refund_recipient, amount);
    update_bytes(&mut hasher, route_hash);
    update_bytes(&mut hasher, tx_template_hash);
    update_bytes(&mut hasher, settlement_artifact_hash);
    finish_hash(hasher)
}

pub fn hash_private_escrow_release_payload(
    escrow_id: &[u8],
    milestone_id: &[u8],
    recipient: &[u8],
    amount: &ClearSignAmount<'_>,
    policy_ciphertexts_hash: &[u8],
    private_evaluation_hash: &[u8],
    settlement_artifact_hash: &[u8],
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::ReleaseMilestone);
    update_bytes(&mut hasher, escrow_id);
    update_bytes(&mut hasher, milestone_id);
    update_recipient_amount(&mut hasher, recipient, amount);
    update_bytes(&mut hasher, policy_ciphertexts_hash);
    update_bytes(&mut hasher, private_evaluation_hash);
    update_bytes(&mut hasher, settlement_artifact_hash);
    finish_hash(hasher)
}

pub fn hash_private_escrow_return_payload(
    escrow_id: &[u8],
    refund_recipient: &[u8],
    amount: &ClearSignAmount<'_>,
    policy_ciphertexts_hash: &[u8],
    private_evaluation_hash: &[u8],
    settlement_artifact_hash: &[u8],
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::ReturnEscrowFunds);
    update_bytes(&mut hasher, escrow_id);
    update_recipient_amount(&mut hasher, refund_recipient, amount);
    update_bytes(&mut hasher, policy_ciphertexts_hash);
    update_bytes(&mut hasher, private_evaluation_hash);
    update_bytes(&mut hasher, settlement_artifact_hash);
    finish_hash(hasher)
}

pub fn hash_agent_trade_payload(
    market: &[u8],
    side: &[u8],
    amount: &ClearSignAmount<'_>,
    max_leverage_x100: u32,
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::AgentTradeApproval);
    update_bytes(&mut hasher, market);
    update_bytes(&mut hasher, side);
    update_amount(&mut hasher, amount);
    update_u32(&mut hasher, max_leverage_x100);
    finish_hash(hasher)
}

/// Bound agent session grant: session id, agent, venue/market, notional, leverage, expiry.
pub fn hash_agent_session_grant_payload(
    session_id_hash: &[u8; 32],
    agent_id_hash: &[u8; 32],
    venue_hash: &[u8; 32],
    market_hash: &[u8; 32],
    max_notional_raw: u128,
    max_leverage_x100: u32,
    expires_at: i64,
    status: u8,
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::AgentSessionGrant);
    update_bytes(&mut hasher, b"agent_session");
    hasher.update(session_id_hash);
    hasher.update(agent_id_hash);
    hasher.update(venue_hash);
    hasher.update(market_hash);
    hasher.update(max_notional_raw.to_le_bytes());
    update_u32(&mut hasher, max_leverage_x100);
    update_i64(&mut hasher, expires_at);
    hasher.update([status]);
    finish_hash(hasher)
}

/// Governed loss policy for one agent session.
pub fn hash_agent_risk_policy_payload(
    session_id_hash: &[u8; 32],
    oracle_policy_hash: &[u8; 32],
    max_loss_raw: u128,
    status: u8,
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::AgentRiskPolicy);
    update_bytes(&mut hasher, b"agent_risk_policy");
    hasher.update(session_id_hash);
    hasher.update(oracle_policy_hash);
    hasher.update(max_loss_raw.to_le_bytes());
    hasher.update([status]);
    finish_hash(hasher)
}

/// Owner-approved settlement binds accounting to an immutable venue/oracle
/// artifact and a strictly increasing session sequence.
#[allow(clippy::too_many_arguments)]
pub fn hash_agent_trade_settlement_payload(
    session_id_hash: &[u8; 32],
    execution_id_hash: &[u8; 32],
    settlement_artifact_hash: &[u8; 32],
    oracle_policy_hash: &[u8; 32],
    closed_notional_raw: u128,
    outcome: u8,
    pnl_abs_raw: u128,
    settlement_sequence: u64,
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::AgentTradeSettlement);
    update_bytes(&mut hasher, b"agent_trade_settlement");
    hasher.update(session_id_hash);
    hasher.update(execution_id_hash);
    hasher.update(settlement_artifact_hash);
    hasher.update(oracle_policy_hash);
    hasher.update(closed_notional_raw.to_le_bytes());
    hasher.update([outcome]);
    hasher.update(pnl_abs_raw.to_le_bytes());
    hasher.update(settlement_sequence.to_le_bytes());
    finish_hash(hasher)
}

#[allow(clippy::too_many_arguments)]
pub fn hash_agent_trade_approval_payload(
    agent_id_hash: &[u8],
    venue_hash: &[u8],
    market_hash: &[u8],
    side_hash: &[u8],
    amount: &ClearSignAmount<'_>,
    max_leverage_x100: u32,
    session_id_hash: &[u8],
    route_hash: &[u8],
    risk_check_hash: &[u8],
) -> [u8; 32] {
    let mut hasher = payload_hasher(ClearSignActionKind::AgentTradeApproval);
    update_bytes(&mut hasher, agent_id_hash);
    update_bytes(&mut hasher, venue_hash);
    update_bytes(&mut hasher, market_hash);
    update_bytes(&mut hasher, side_hash);
    update_amount(&mut hasher, amount);
    update_u32(&mut hasher, max_leverage_x100);
    update_bytes(&mut hasher, session_id_hash);
    update_bytes(&mut hasher, route_hash);
    update_bytes(&mut hasher, risk_check_hash);
    finish_hash(hasher)
}

fn payload_hasher(kind: ClearSignActionKind) -> Sha256 {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, CLEARSIGN_V2_PAYLOAD_DOMAIN);
    hasher.update([kind.code()]);
    hasher
}

fn update_recipient_amount(hasher: &mut Sha256, recipient: &[u8], amount: &ClearSignAmount<'_>) {
    update_bytes(hasher, recipient);
    update_amount(hasher, amount);
}

fn update_amount(hasher: &mut Sha256, amount: &ClearSignAmount<'_>) {
    update_bytes(hasher, amount.asset);
    hasher.update(amount.raw_amount.to_le_bytes());
}

fn update_bytes(hasher: &mut Sha256, value: &[u8]) {
    update_u32(hasher, value.len() as u32);
    hasher.update(value);
}

fn update_i64(hasher: &mut Sha256, value: i64) {
    hasher.update(value.to_le_bytes());
}

fn update_u32(hasher: &mut Sha256, value: u32) {
    hasher.update(value.to_le_bytes());
}

fn finish_hash(hasher: Sha256) -> [u8; 32] {
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

fn strip_prefix<'a>(input: &'a [u8], prefix: &[u8]) -> Result<&'a [u8], ClearSignError> {
    input
        .strip_prefix(prefix)
        .ok_or(ClearSignError::InvalidVoteMessage)
}

fn push_bytes(out: &mut [u8], len: &mut usize, value: &[u8]) -> Result<(), ClearSignError> {
    let end = len
        .checked_add(value.len())
        .ok_or(ClearSignError::MessageTooLong)?;
    if end > out.len() {
        return Err(ClearSignError::MessageTooLong);
    }
    out[*len..end].copy_from_slice(value);
    *len = end;
    Ok(())
}

fn decimal_u64_len(mut value: u64) -> usize {
    let mut len = 1;
    while value >= 10 {
        value /= 10;
        len += 1;
    }
    len
}

fn write_decimal_u64(mut value: u64, out: &mut [u8; 20]) {
    let len = decimal_u64_len(value);
    for idx in (0..len).rev() {
        out[idx] = b'0' + (value % 10) as u8;
        value /= 10;
    }
}

fn write_hex_32(bytes: &[u8; 32], out: &mut [u8; 64]) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for (idx, byte) in bytes.iter().enumerate() {
        out[idx * 2] = HEX[(byte >> 4) as usize];
        out[idx * 2 + 1] = HEX[(byte & 0x0f) as usize];
    }
}

#[cfg(test)]
mod tests {
    use alloc::vec::Vec;

    use super::*;

    const V3_SEND_DOCUMENT: &[u8] = b"ClearSig Proposal\n\nACTION\nSend 2.5 SOL from Team to Sarah\n\nDETAILS\nFrom wallet: Team\nNetwork: Solana devnet\nAmount: 2.5 SOL\nTo: Sarah\nPayload: 222222222222...222222222222\n\nPOLICY\nApproval: Wallet's onchain threshold must be met\nExecution: Onchain policy and timelock must pass\nCommitment: 111111111111...111111111111\nEnforcement: Exact payload and policy must match onchain\nDisplay profile: clearsig-full-v1@1\n\nRISK\nCategory: Funds movement\nSigner check: Verify amount, asset, network, and every destination\n\nPURPOSE\nPayroll";

    fn amount(asset: &'static [u8], raw_amount: u128) -> ClearSignAmount<'static> {
        ClearSignAmount { asset, raw_amount }
    }

    fn id32(label: &[u8]) -> [u8; 32] {
        let mut hasher = sha2::Sha256::new();
        hasher.update(label);
        finish_hash(hasher)
    }

    fn replace_once(source: &[u8], needle: &[u8], replacement: &[u8]) -> Vec<u8> {
        let offset = find_bytes(source, needle).expect("test fixture contains marker");
        source[..offset]
            .iter()
            .copied()
            .chain(replacement.iter().copied())
            .chain(source[offset + needle.len()..].iter().copied())
            .collect()
    }

    fn test_envelope<'a>(
        action_id: &'a [u8],
        nonce: &'a [u8],
        payload_hash: [u8; 32],
    ) -> ClearSignEnvelope<'a> {
        ClearSignEnvelope {
            kind: ClearSignActionKind::Send,
            wallet_name: b"Team",
            wallet_id: b"Team#abc",
            action_id,
            nonce,
            expires_at: 1_800_000_000,
            policy_commitment: hash_policy_commitment(&[b"threshold:2", b"members:alice,bob"]),
            payload_hash,
            clear_text_hash: hash_clear_text(b"Send 2.5 SOL to Sarah").unwrap(),
        }
    }

    #[test]
    fn action_codes_are_stable() {
        assert_eq!(ClearSignActionKind::Send.code(), 1);
        assert_eq!(ClearSignActionKind::ReturnEscrowFunds.code(), 8);
        assert_eq!(ClearSignActionKind::SwapIntent.code(), 11);
        assert_eq!(ClearSignActionKind::AgentRiskPolicy.code(), 13);
        assert_eq!(ClearSignActionKind::AgentTradeSettlement.code(), 14);
        assert_eq!(
            ClearSignActionKind::from_code(9),
            Some(ClearSignActionKind::AgentTradeApproval)
        );
        assert_eq!(ClearSignActionKind::from_code(99), None);
    }

    #[test]
    fn v3_document_validation_is_strict_and_ordered() {
        assert_eq!(validate_v3_document(V3_SEND_DOCUMENT), Ok(()));
        assert_eq!(
            validate_v3_document(b"ClearSign v2 propose\nWallet Team"),
            Err(ClearSignError::InvalidVoteMessage)
        );

        let reordered = V3_SEND_DOCUMENT
            .windows(b"\n\nPOLICY\n".len())
            .position(|window| window == b"\n\nPOLICY\n")
            .unwrap();
        let mut malformed = V3_SEND_DOCUMENT.to_vec();
        malformed.splice(
            reordered..reordered + b"\n\nPOLICY\n".len(),
            b"\n\nPURPOSE\n".iter().copied(),
        );
        assert_eq!(
            validate_v3_document(&malformed),
            Err(ClearSignError::InvalidVoteMessage)
        );

        let injected = V3_SEND_DOCUMENT
            .iter()
            .copied()
            .chain(b"\n\nPROOF\nNot allowed".iter().copied())
            .collect::<Vec<_>>();
        assert_eq!(
            validate_v3_document(&injected),
            Err(ClearSignError::InvalidVoteMessage)
        );

        let control_character = V3_SEND_DOCUMENT
            .iter()
            .copied()
            .chain([b'\t'])
            .collect::<Vec<_>>();
        assert_eq!(
            validate_v3_document(&control_character),
            Err(ClearSignError::InvalidVoteMessage)
        );

        let missing_profile = V3_SEND_DOCUMENT
            .split(|byte| *byte == b'\n')
            .filter(|line| !line.starts_with(b"Display profile:"))
            .collect::<Vec<_>>()
            .join(&b'\n');
        assert_eq!(
            validate_v3_document(&missing_profile),
            Err(ClearSignError::InvalidVoteMessage)
        );

        let unknown_profile = replace_once(
            V3_SEND_DOCUMENT,
            CLEARSIGN_V3_FULL_PROFILE,
            b"Display profile: browser-custom-v9@1",
        );
        assert_eq!(
            validate_v3_document(&unknown_profile),
            Err(ClearSignError::InvalidVoteMessage)
        );

        let duplicate_profile = replace_once(
            V3_SEND_DOCUMENT,
            CLEARSIGN_V3_FULL_PROFILE,
            b"Display profile: clearsig-full-v1@1\nDisplay profile: clearsig-ledger-solana-v1@1",
        );
        assert_eq!(
            validate_v3_document(&duplicate_profile),
            Err(ClearSignError::InvalidVoteMessage)
        );

        let mut oversized_compact = replace_once(
            V3_SEND_DOCUMENT,
            CLEARSIGN_V3_FULL_PROFILE,
            CLEARSIGN_V3_LEDGER_PROFILE,
        );
        oversized_compact.extend(core::iter::repeat(b'x').take(700));
        assert!(oversized_compact.len() > MAX_CLEARSIGN_LEDGER_DOCUMENT_BYTES);
        assert_eq!(
            validate_v3_document(&oversized_compact),
            Err(ClearSignError::InvalidVoteMessage)
        );
    }

    #[test]
    fn v3_vote_message_round_trips_and_binds_expiry() {
        let envelope_hash = [0xabu8; 32];
        let mut message = [0u8; MAX_CLEARSIGN_VOTE_MESSAGE_BYTES];
        let len = write_vote_message_for_clear_text(
            &mut message,
            ClearSignVoteKind::Approve,
            b"Team",
            &[1u8; 32],
            7,
            envelope_hash,
            1_800_000_000,
            2,
            1,
            V3_SEND_DOCUMENT,
        )
        .unwrap();

        assert_eq!(
            extract_clear_text_from_vote_message(
                ClearSignVoteKind::Approve,
                b"Team",
                &[1u8; 32],
                7,
                envelope_hash,
                1_800_000_000,
                2,
                1,
                &message[..len],
            ),
            Ok(V3_SEND_DOCUMENT)
        );
        assert_eq!(
            extract_clear_text_from_vote_message(
                ClearSignVoteKind::Approve,
                b"Team",
                &[1u8; 32],
                7,
                envelope_hash,
                1_800_000_001,
                2,
                1,
                &message[..len],
            ),
            Err(ClearSignError::InvalidVoteMessage)
        );
    }

    #[test]
    fn legacy_v2_vote_messages_remain_verifiable_for_existing_proposals() {
        let envelope_hash = [0x11u8; 32];
        let clear_text = b"Send 2.5 SOL to Sarah";
        let mut message = [0u8; MAX_CLEARSIGN_VOTE_MESSAGE_BYTES];
        let len = write_vote_message(
            &mut message,
            ClearSignVoteKind::Approve,
            b"Team",
            3,
            envelope_hash,
            clear_text,
        )
        .unwrap();

        assert_eq!(
            extract_clear_text_from_vote_message(
                ClearSignVoteKind::Approve,
                b"Team",
                &[1u8; 32],
                3,
                envelope_hash,
                1_800_000_000,
                1,
                1,
                &message[..len],
            ),
            Ok(clear_text.as_slice())
        );
    }

    #[test]
    fn intent_governance_payload_binds_final_membership() {
        let alice = [1u8; 32];
        let bob = [2u8; 32];
        let h1 = hash_intent_governance_payload(
            ClearSignActionKind::AddMember,
            3,
            2,
            1,
            0,
            &[alice, bob],
            &[alice, bob],
        );
        let h2 = hash_intent_governance_payload(
            ClearSignActionKind::AddMember,
            3,
            2,
            1,
            0,
            &[alice, bob],
            &[alice, bob],
        );
        let h3 = hash_intent_governance_payload(
            ClearSignActionKind::RemoveMember,
            3,
            2,
            1,
            0,
            &[alice, bob],
            &[alice, bob],
        );
        let h4 = hash_intent_governance_payload(
            ClearSignActionKind::AddMember,
            3,
            1,
            1,
            0,
            &[alice, bob],
            &[alice, bob],
        );
        assert_eq!(h1, h2);
        assert_ne!(h1, h3);
        assert_ne!(h1, h4);
    }

    #[test]
    fn clear_headlines_stay_human() {
        assert_eq!(ClearSignActionKind::Send.clear_headline(), "Send funds");
        assert_eq!(
            ClearSignActionKind::ReturnEscrowFunds.clear_headline(),
            "Return escrow funds"
        );
    }

    #[test]
    fn replay_fields_are_required_and_bounded() {
        let payload = hash_send_payload(b"Sarah", &amount(b"SOL", 2_500_000_000));
        assert_eq!(
            test_envelope(&id32(b"action-1"), &id32(b"nonce-1"), payload)
                .validate_replay_fields(1_799_999_000),
            Ok(())
        );
        assert_eq!(
            test_envelope(b"", b"nonce-1", payload).validate_replay_fields(1_799_999_000),
            Err(ClearSignError::MissingActionId)
        );
        assert_eq!(
            test_envelope(&id32(b"action-1"), b"", payload).validate_replay_fields(1_799_999_000),
            Err(ClearSignError::MissingNonce)
        );
        assert_eq!(
            test_envelope(&id32(b"action-1"), &id32(b"nonce-1"), payload)
                .validate_replay_fields(1_800_000_000),
            Err(ClearSignError::Expired)
        );
        assert_eq!(
            test_envelope(&id32(b"action-1"), &id32(b"nonce-1"), payload).validate_replay_fields(1),
            Err(ClearSignError::ExpiryTooFar)
        );
    }

    #[test]
    fn envelope_hash_binds_replay_and_payload() {
        let send_payload = hash_send_payload(b"Sarah", &amount(b"SOL", 2_500_000_000));
        let changed_payload = hash_send_payload(b"Sarah", &amount(b"SOL", 2_400_000_000));
        let base = hash_envelope(&test_envelope(
            &id32(b"action-1"),
            &id32(b"nonce-1"),
            send_payload,
        ));
        assert_ne!(
            base,
            hash_envelope(&test_envelope(
                &id32(b"action-1"),
                &id32(b"nonce-2"),
                send_payload
            ))
        );
        assert_ne!(
            base,
            hash_envelope(&test_envelope(
                &id32(b"action-1"),
                &id32(b"nonce-1"),
                changed_payload
            ))
        );
    }

    #[test]
    fn escrow_return_hash_binds_each_funder_return() {
        let returns = [
            ClearSignRecipientAmount {
                recipient: b"Alice",
                amount: amount(b"SOL", 4_500_000_000),
            },
            ClearSignRecipientAmount {
                recipient: b"Bob",
                amount: amount(b"SOL", 3_000_000_000),
            },
        ];
        let changed = [
            ClearSignRecipientAmount {
                recipient: b"Alice",
                amount: amount(b"SOL", 4_000_000_000),
            },
            ClearSignRecipientAmount {
                recipient: b"Bob",
                amount: amount(b"SOL", 3_500_000_000),
            },
        ];
        assert_ne!(
            hash_return_escrow_funds_payload(b"escrow-1", &returns),
            hash_return_escrow_funds_payload(b"escrow-1", &changed)
        );
        assert_ne!(
            hash_return_escrow_funds_payload(b"escrow-1", &returns),
            hash_return_escrow_funds_payload(b"escrow-2", &returns)
        );
        assert_eq!(
            hash_return_escrow_funds_payload(b"escrow-1", &returns),
            hash_return_escrow_sol_payload_iter(
                b"escrow-1",
                [
                    (b"Alice".as_slice(), 4_500_000_000),
                    (b"Bob".as_slice(), 3_000_000_000),
                ]
                .into_iter(),
            )
        );
    }

    #[test]
    fn escrow_release_and_return_hashes_are_not_interchangeable() {
        let release = hash_release_milestone_payload(
            b"escrow-1",
            b"milestone-1",
            b"Builder",
            &amount(b"SOL", 2_000_000_000),
        );
        let returns = [ClearSignRecipientAmount {
            recipient: b"Builder",
            amount: amount(b"SOL", 2_000_000_000),
        }];
        let unwind = hash_return_escrow_funds_payload(b"escrow-1", &returns);

        assert_ne!(release, unwind);

        let release_envelope = ClearSignEnvelope {
            kind: ClearSignActionKind::ReleaseMilestone,
            wallet_name: b"Team",
            wallet_id: b"wallet-pda",
            action_id: &id32(b"escrow-action"),
            nonce: &id32(b"nonce-1"),
            expires_at: 1_800_000_000,
            policy_commitment: hash_policy_commitment(&[b"escrow:escrow-1"]),
            payload_hash: release,
            clear_text_hash: hash_clear_text(b"Release escrow milestone").unwrap(),
        };
        let return_envelope = ClearSignEnvelope {
            kind: ClearSignActionKind::ReturnEscrowFunds,
            payload_hash: unwind,
            ..release_envelope
        };

        assert_ne!(
            hash_envelope(&release_envelope),
            hash_envelope(&return_envelope)
        );
    }
}
