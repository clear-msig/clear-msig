use super::*;
use sha2::{Digest, Sha256};

pub fn replay_hash(label: &[u8]) -> [u8; 32] {
    Sha256::digest(label).into()
}

pub fn document_hash(document: &[u8]) -> Result<[u8; 32], Error> {
    if document.is_empty() || document.len() > MAX_DOCUMENT_BYTES {
        return Err(Error::InvalidLength);
    }
    Ok(Sha256::digest(document).into())
}

/// Commit to the exact policy bytes using the deployed v2 policy encoding.
/// Empty policy bytes intentionally produce a non-zero commitment so an empty
/// policy cannot be confused with an unchecked caller assertion.
pub fn policy_commitment(policy_bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, POLICY_DOMAIN);
    hasher.update(2u32.to_le_bytes());
    update_bytes(&mut hasher, TYPED_SEND_POLICY_DOMAIN);
    update_bytes(&mut hasher, policy_bytes);
    hasher.finalize().into()
}

/// Commitment stored by the wallet-policy account for replacement bytes.
/// The empty replacement removes the policy and is represented onchain by
/// zero; non-empty replacements use the typed policy commitment.
pub fn wallet_policy_commitment(policy_bytes: &[u8]) -> [u8; 32] {
    if policy_bytes.is_empty() {
        [0u8; 32]
    } else {
        policy_commitment(policy_bytes)
    }
}

impl CanonicalIntent<'_> {
    pub fn kind(&self) -> ActionKind {
        match self.action {
            Action::Transfer(_) => ActionKind::Send,
            Action::BatchTransfer(_) => ActionKind::BatchSend,
            Action::Governance(governance) => governance.kind,
            Action::PolicyUpdate(_) => ActionKind::SetProtection,
            Action::EscrowRelease(_) => ActionKind::ReleaseMilestone,
            Action::EscrowReturn(_) => ActionKind::ReturnEscrowFunds,
            Action::AgentTradeApproval(_) => ActionKind::AgentTradeApproval,
            Action::AgentSession(_) => ActionKind::AgentSessionGrant,
            Action::AgentRiskPolicy(_) => ActionKind::AgentRiskPolicy,
            Action::AgentSettlement(_) => ActionKind::AgentTradeSettlement,
            Action::RecurringSchedule(_) => ActionKind::RecurringSchedule,
        }
    }

    pub fn canonical_hash(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        update_bytes(&mut hasher, INTENT_DOMAIN);
        update_bytes(&mut hasher, self.encoded);
        hasher.finalize().into()
    }

    pub fn payload_hash(&self) -> [u8; 32] {
        let mut hasher = payload_hasher(self.kind());
        match self.action {
            Action::Transfer(transfer) => {
                update_identity(&mut hasher, transfer.recipient_encoding, transfer.recipient);
                update_identity(&mut hasher, transfer.asset_encoding, transfer.asset);
                hasher.update(transfer.raw_amount.to_le_bytes());
                update_execution_commitment(&mut hasher, &transfer.execution_commitment);
            }
            Action::BatchTransfer(batch) => {
                hasher.update((batch.row_count as u32).to_le_bytes());
                for row in batch.rows() {
                    update_identity(&mut hasher, row.recipient_encoding, row.recipient);
                    update_identity(&mut hasher, row.asset_encoding, row.asset);
                    hasher.update(row.raw_amount.to_le_bytes());
                }
            }
            Action::Governance(governance) => {
                update_bytes(&mut hasher, b"intent_governance");
                hasher.update([governance.target_intent_index]);
                hasher.update([governance.approval_threshold]);
                hasher.update([governance.cancellation_threshold]);
                hasher.update(governance.timelock_seconds.to_le_bytes());
                hasher.update((governance.proposer_count as u32).to_le_bytes());
                hasher.update(governance.proposers);
                hasher.update((governance.approver_count as u32).to_le_bytes());
                hasher.update(governance.approvers);
            }
            Action::PolicyUpdate(policy) => {
                update_bytes(&mut hasher, b"wallet_policy");
                hasher.update([policy.chain_kind]);
                hasher.update(policy.new_policy_commitment);
            }
            Action::EscrowRelease(escrow) => {
                update_bytes(&mut hasher, &text_hash(escrow.escrow_id));
                update_bytes(&mut hasher, &text_hash(escrow.milestone_id));
                update_identity(
                    &mut hasher,
                    escrow.payment.recipient_encoding,
                    escrow.payment.recipient,
                );
                update_identity(
                    &mut hasher,
                    escrow.payment.asset_encoding,
                    escrow.payment.asset,
                );
                hasher.update(escrow.payment.raw_amount.to_le_bytes());
                update_execution_commitment(&mut hasher, &escrow.execution_commitment);
            }
            Action::EscrowReturn(escrow) => {
                update_bytes(&mut hasher, &text_hash(escrow.escrow_id));
                hasher.update((escrow.row_count as u32).to_le_bytes());
                for row in escrow.rows() {
                    update_identity(&mut hasher, row.recipient_encoding, row.recipient);
                    update_identity(&mut hasher, row.asset_encoding, row.asset);
                    hasher.update(row.raw_amount.to_le_bytes());
                }
                update_execution_commitment(&mut hasher, &escrow.execution_commitment);
            }
            Action::AgentTradeApproval(agent) => {
                update_bytes(&mut hasher, &text_hash(agent.agent_id));
                update_bytes(&mut hasher, &text_hash(agent.venue));
                update_bytes(&mut hasher, &text_hash(agent.market));
                update_bytes(&mut hasher, &text_hash(agent.side));
                update_bytes(&mut hasher, &text_hash(agent.asset_id));
                hasher.update(agent.max_notional_raw.to_le_bytes());
                hasher.update(agent.max_leverage_x100.to_le_bytes());
                update_bytes(&mut hasher, &text_hash(agent.session_id));
                update_bytes(&mut hasher, &text_hash(agent.route));
                update_bytes(&mut hasher, &agent.risk_check_hash);
            }
            Action::AgentSession(agent) => {
                update_bytes(&mut hasher, b"agent_session");
                hasher.update(text_hash(agent.session_id));
                hasher.update(text_hash(agent.agent_id));
                hasher.update(text_hash(agent.venue));
                hasher.update(text_hash(agent.market));
                hasher.update(agent.max_notional_raw.to_le_bytes());
                hasher.update(agent.max_leverage_x100.to_le_bytes());
                hasher.update(agent.session_expires_at.to_le_bytes());
                hasher.update([agent.status]);
            }
            Action::AgentRiskPolicy(agent) => {
                update_bytes(&mut hasher, b"agent_risk_policy");
                hasher.update(text_hash(agent.session_id));
                hasher.update(agent.oracle_policy_hash);
                hasher.update(agent.max_loss_raw.to_le_bytes());
                hasher.update([agent.status]);
            }
            Action::AgentSettlement(agent) => {
                update_bytes(&mut hasher, b"agent_trade_settlement");
                hasher.update(text_hash(agent.session_id));
                hasher.update(text_hash(agent.execution_id));
                hasher.update(agent.settlement_artifact_hash);
                hasher.update(agent.oracle_policy_hash);
                hasher.update(agent.closed_notional_raw.to_le_bytes());
                hasher.update([agent.outcome]);
                hasher.update(agent.pnl_abs_raw.to_le_bytes());
                hasher.update(agent.settlement_sequence.to_le_bytes());
            }
            Action::RecurringSchedule(schedule) => {
                update_bytes(&mut hasher, &text_hash(schedule.schedule_id));
                update_identity(
                    &mut hasher,
                    schedule.payment.recipient_encoding,
                    schedule.payment.recipient,
                );
                update_identity(
                    &mut hasher,
                    schedule.payment.asset_encoding,
                    schedule.payment.asset,
                );
                hasher.update(schedule.payment.raw_amount.to_le_bytes());
                hasher.update(schedule.interval_seconds.to_le_bytes());
                hasher.update(schedule.first_execution_at.to_le_bytes());
                hasher.update(schedule.payment_count.to_le_bytes());
                hasher.update([schedule.status]);
            }
        }
        hasher.finalize().into()
    }
}

#[allow(clippy::too_many_arguments)]
pub fn envelope_hash(
    intent: &CanonicalIntent<'_>,
    wallet_name: &[u8],
    clear_text_hash: [u8; 32],
) -> Result<[u8; 32], Error> {
    let payload_hash = intent.payload_hash();
    envelope_hash_fields(&EnvelopeFields {
        kind: intent.kind(),
        network: intent.common.network,
        proposal_index: intent.common.proposal_index,
        wallet_name,
        wallet_id: &intent.common.wallet_id,
        actor: &intent.common.actor,
        action_id: &intent.common.action_id,
        nonce: &intent.common.nonce,
        expires_at: intent.common.expires_at,
        approval_required: intent.common.approval_required,
        policy_commitment: &intent.common.policy_commitment,
        payload_hash: &payload_hash,
        clear_text_hash: &clear_text_hash,
    })
}

pub fn envelope_hash_fields(fields: &EnvelopeFields<'_>) -> Result<[u8; 32], Error> {
    validate_visible_ascii(fields.wallet_name, 64, false)?;
    if fields.approval_required == 0 || fields.approval_required > 16 {
        return Err(Error::InvalidContext);
    }
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, ENVELOPE_DOMAIN);
    hasher.update([INTENT_VERSION]);
    hasher.update([fields.kind.code()]);
    hasher.update([fields.network as u8]);
    hasher.update(fields.proposal_index.to_le_bytes());
    update_bytes(&mut hasher, fields.wallet_name);
    update_bytes(&mut hasher, fields.wallet_id);
    update_bytes(&mut hasher, fields.actor);
    update_bytes(&mut hasher, fields.action_id);
    update_bytes(&mut hasher, fields.nonce);
    hasher.update(fields.expires_at.to_le_bytes());
    hasher.update([fields.approval_required]);
    hasher.update(fields.policy_commitment);
    hasher.update(fields.payload_hash);
    hasher.update(fields.clear_text_hash);
    Ok(hasher.finalize().into())
}

fn payload_hasher(kind: ActionKind) -> Sha256 {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, PAYLOAD_DOMAIN);
    hasher.update([kind.code()]);
    hasher
}

/// Compute the transfer payload hash from the exact identity bytes enforced by
/// an executor. For `Sha256Text` canonical identities these are the 32-byte
/// digests; for local identities they are the original bytes.
pub fn committed_transfer_payload_hash(
    recipient: &[u8],
    asset: &[u8],
    raw_amount: u128,
    execution_commitment: [u8; 32],
) -> [u8; 32] {
    let mut hasher = payload_hasher(ActionKind::Send);
    update_bytes(&mut hasher, recipient);
    update_bytes(&mut hasher, asset);
    hasher.update(raw_amount.to_le_bytes());
    update_execution_commitment(&mut hasher, &execution_commitment);
    hasher.finalize().into()
}

/// Commit to executor-only escrow evidence that is not useful as primary
/// signer-facing copy, such as token accounts, Ika bindings, ciphertext
/// evaluations, transaction templates, and settlement artifacts.
pub fn execution_commitment(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, b"clearsig:execution-evidence:v1");
    hasher.update((parts.len() as u32).to_le_bytes());
    for part in parts {
        update_bytes(&mut hasher, part);
    }
    hasher.finalize().into()
}

pub fn spl_escrow_return_execution_commitment<'a, I>(
    mint: &[u8],
    source_token: &[u8],
    destination_tokens: I,
) -> [u8; 32]
where
    I: ExactSizeIterator<Item = &'a [u8]>,
{
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, b"clearsig:execution-evidence:v1");
    hasher.update((3u32 + destination_tokens.len() as u32).to_le_bytes());
    update_bytes(&mut hasher, b"spl_escrow_return");
    update_bytes(&mut hasher, mint);
    update_bytes(&mut hasher, source_token);
    for destination in destination_tokens {
        update_bytes(&mut hasher, destination);
    }
    hasher.finalize().into()
}

pub fn committed_escrow_release_payload_hash(
    escrow_id: &[u8],
    milestone_id: &[u8],
    recipient: &[u8],
    asset: &[u8],
    raw_amount: u128,
    execution_commitment: [u8; 32],
) -> [u8; 32] {
    let mut hasher = payload_hasher(ActionKind::ReleaseMilestone);
    update_bytes(&mut hasher, escrow_id);
    update_bytes(&mut hasher, milestone_id);
    update_bytes(&mut hasher, recipient);
    update_bytes(&mut hasher, asset);
    hasher.update(raw_amount.to_le_bytes());
    update_execution_commitment(&mut hasher, &execution_commitment);
    hasher.finalize().into()
}

pub fn committed_escrow_return_payload_hash<'a, I>(
    escrow_id: &[u8],
    rows: I,
    execution_commitment: [u8; 32],
) -> [u8; 32]
where
    I: ExactSizeIterator<Item = (&'a [u8], &'a [u8], u128)>,
{
    let mut hasher = payload_hasher(ActionKind::ReturnEscrowFunds);
    update_bytes(&mut hasher, escrow_id);
    hasher.update((rows.len() as u32).to_le_bytes());
    for (recipient, asset, raw_amount) in rows {
        update_bytes(&mut hasher, recipient);
        update_bytes(&mut hasher, asset);
        hasher.update(raw_amount.to_le_bytes());
    }
    update_execution_commitment(&mut hasher, &execution_commitment);
    hasher.finalize().into()
}

pub struct RecurringSchedulePayloadParts<'a> {
    pub schedule_id_hash: &'a [u8; 32],
    pub recipient: &'a [u8],
    pub asset: &'a [u8],
    pub amount_raw: u128,
    pub interval_seconds: u32,
    pub first_execution_at: i64,
    pub payment_count: u32,
    pub status: u8,
}

pub fn committed_recurring_schedule_payload_hash(
    parts: RecurringSchedulePayloadParts<'_>,
) -> [u8; 32] {
    let mut hasher = payload_hasher(ActionKind::RecurringSchedule);
    update_bytes(&mut hasher, parts.schedule_id_hash);
    update_bytes(&mut hasher, parts.recipient);
    update_bytes(&mut hasher, parts.asset);
    hasher.update(parts.amount_raw.to_le_bytes());
    hasher.update(parts.interval_seconds.to_le_bytes());
    hasher.update(parts.first_execution_at.to_le_bytes());
    hasher.update(parts.payment_count.to_le_bytes());
    hasher.update([parts.status]);
    hasher.finalize().into()
}

fn update_execution_commitment(hasher: &mut Sha256, execution_commitment: &[u8; 32]) {
    if execution_commitment != &[0u8; 32] {
        update_bytes(hasher, b"execution_template");
        hasher.update(execution_commitment);
    }
}

fn update_identity(hasher: &mut Sha256, encoding: IdentityEncoding, value: &[u8]) {
    match encoding {
        IdentityEncoding::Text | IdentityEncoding::SolanaPubkey => update_bytes(hasher, value),
        IdentityEncoding::Sha256Text => {
            let digest: [u8; 32] = Sha256::digest(value).into();
            update_bytes(hasher, &digest);
        }
    }
}

fn update_bytes(hasher: &mut Sha256, value: &[u8]) {
    hasher.update((value.len() as u32).to_le_bytes());
    hasher.update(value);
}

fn text_hash(value: &[u8]) -> [u8; 32] {
    Sha256::digest(value).into()
}
