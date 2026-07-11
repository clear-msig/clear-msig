use sha2::{Digest, Sha256};

pub const CLEARSIGN_V2_VERSION: u8 = 2;
pub const CLEARSIGN_V2_DOMAIN: &[u8] = b"clearsig:policy-engine:v2";
pub const CLEARSIGN_V2_PAYLOAD_DOMAIN: &[u8] = b"clearsig:policy-engine:v2:payload";
pub const CLEARSIGN_V2_POLICY_DOMAIN: &[u8] = b"clearsig:policy-engine:v2:policy";
pub const MAX_ACTION_TTL_SECONDS: i64 = 30 * 24 * 60 * 60;

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
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClearSignV2Error {
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
    pub fn validate_replay_fields(&self, now: i64) -> Result<(), ClearSignV2Error> {
        if self.wallet_name.is_empty() {
            return Err(ClearSignV2Error::MissingWalletName);
        }
        if self.action_id.is_empty() {
            return Err(ClearSignV2Error::MissingActionId);
        }
        if self.nonce.is_empty() {
            return Err(ClearSignV2Error::MissingNonce);
        }
        if self.action_id.len() != 32 || self.nonce.len() != 32 {
            return Err(ClearSignV2Error::InvalidReplayCommitment);
        }
        if self.expires_at <= now {
            return Err(ClearSignV2Error::Expired);
        }
        if self.expires_at - now > MAX_ACTION_TTL_SECONDS {
            return Err(ClearSignV2Error::ExpiryTooFar);
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
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, CLEARSIGN_V2_DOMAIN);
    hasher.update([CLEARSIGN_V2_VERSION]);
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

pub fn hash_clear_text(clear_text: &[u8]) -> Result<[u8; 32], ClearSignV2Error> {
    if clear_text.is_empty() {
        return Err(ClearSignV2Error::MissingClearText);
    }
    if clear_text.len() > MAX_CLEARSIGN_TEXT_BYTES {
        return Err(ClearSignV2Error::MessageTooLong);
    }
    let mut hasher = Sha256::new();
    hasher.update(clear_text);
    Ok(finish_hash(hasher))
}

pub const MAX_CLEARSIGN_TEXT_BYTES: usize = 2048;

pub fn extract_clear_text_from_vote_message<'a>(
    vote_kind: ClearSignVoteKind,
    wallet_name: &[u8],
    proposal_index: u64,
    envelope_hash: [u8; 32],
    vote_message: &'a [u8],
) -> Result<&'a [u8], ClearSignV2Error> {
    if vote_message.len() > MAX_CLEARSIGN_TEXT_BYTES + 160 {
        return Err(ClearSignV2Error::MessageTooLong);
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
        return Err(ClearSignV2Error::MissingClearText);
    }
    if cursor.len() > MAX_CLEARSIGN_TEXT_BYTES {
        return Err(ClearSignV2Error::MessageTooLong);
    }
    Ok(cursor)
}

pub fn write_vote_message(
    out: &mut [u8],
    vote_kind: ClearSignVoteKind,
    wallet_name: &[u8],
    proposal_index: u64,
    envelope_hash: [u8; 32],
    clear_text: &[u8],
) -> Result<usize, ClearSignV2Error> {
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

#[allow(clippy::too_many_arguments)]
pub fn hash_agent_trade_approval_payload(
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

fn strip_prefix<'a>(input: &'a [u8], prefix: &[u8]) -> Result<&'a [u8], ClearSignV2Error> {
    input
        .strip_prefix(prefix)
        .ok_or(ClearSignV2Error::InvalidVoteMessage)
}

fn push_bytes(out: &mut [u8], len: &mut usize, value: &[u8]) -> Result<(), ClearSignV2Error> {
    let end = len
        .checked_add(value.len())
        .ok_or(ClearSignV2Error::MessageTooLong)?;
    if end > out.len() {
        return Err(ClearSignV2Error::MessageTooLong);
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
    use super::*;

    fn amount(asset: &'static [u8], raw_amount: u128) -> ClearSignAmount<'static> {
        ClearSignAmount { asset, raw_amount }
    }

    fn id32(label: &[u8]) -> [u8; 32] {
        let mut hasher = sha2::Sha256::new();
        hasher.update(label);
        finish_hash(hasher)
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
        assert_eq!(
            ClearSignActionKind::from_code(9),
            Some(ClearSignActionKind::AgentTradeApproval)
        );
        assert_eq!(ClearSignActionKind::from_code(99), None);
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
            Err(ClearSignV2Error::MissingActionId)
        );
        assert_eq!(
            test_envelope(&id32(b"action-1"), b"", payload).validate_replay_fields(1_799_999_000),
            Err(ClearSignV2Error::MissingNonce)
        );
        assert_eq!(
            test_envelope(&id32(b"action-1"), &id32(b"nonce-1"), payload)
                .validate_replay_fields(1_800_000_000),
            Err(ClearSignV2Error::Expired)
        );
        assert_eq!(
            test_envelope(&id32(b"action-1"), &id32(b"nonce-1"), payload).validate_replay_fields(1),
            Err(ClearSignV2Error::ExpiryTooFar)
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
