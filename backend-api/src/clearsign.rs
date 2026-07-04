use axum::{routing::post, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    current_unix_timestamp, ensure_base58_pubkey, ensure_hex, ensure_hex_exact_len,
    ensure_non_empty, ApiError, AppState,
};

const CLEARSIGN_V2_VERSION: u8 = 2;
const CLEARSIGN_V2_DOMAIN: &[u8] = b"clearsig:policy-engine:v2";
const CLEARSIGN_V2_PAYLOAD_DOMAIN: &[u8] = b"clearsig:policy-engine:v2:payload";
const CLEARSIGN_V2_VOTE_DOMAIN: &[u8] = b"clearsig:policy-engine:v2:vote";
const MAX_ACTION_TTL_SECONDS: i64 = 30 * 24 * 60 * 60;

/// Bundle of pre-signed flags that the browser produces. `params_data_hex`
/// is optional because approve/cancel read params_data from the on-chain
/// Proposal account instead of taking it from the caller.
#[derive(Debug, Deserialize)]
pub(crate) struct PreSigned {
    /// Base58-encoded ed25519 public key of the signer.
    pub(crate) signer_pubkey: String,
    /// Hex-encoded 64-byte ed25519 signature.
    pub(crate) signature: String,
    /// Exact byte layout the browser signed. Optional for older clients;
    /// when present it is forwarded to the CLI so verification does not
    /// guess the format via fallback.
    #[serde(default)]
    pub(crate) message_flavor: Option<String>,
    /// Hex-encoded bytes the caller serialized into the message. Optional
    /// for approve/cancel; required for propose / intent add / update.
    #[serde(default)]
    pub(crate) params_data_hex: Option<String>,
    /// Unix timestamp at which the signed message expires. MUST match the
    /// `expiry` the CLI builds into the message, or the PreSignedMessageSigner
    /// verification step fails.
    pub(crate) expiry: i64,
}

impl PreSigned {
    pub(crate) fn ensure_valid(&self) -> Result<(), ApiError> {
        ensure_non_empty(&self.signer_pubkey, "signer_pubkey")?;
        ensure_base58_pubkey(&self.signer_pubkey, "signer_pubkey")?;
        ensure_non_empty(&self.signature, "signature")?;
        ensure_hex_exact_len(&self.signature, "signature", 64)?;
        if let Some(flavor) = &self.message_flavor {
            match flavor.as_str() {
                "offchain_v1" | "plain_v2" | "clearsign_v2_vote_hash" => {}
                other => {
                    return Err(ApiError::BadRequest(format!(
                        "message_flavor must be offchain_v1, plain_v2, or clearsign_v2_vote_hash, got {other}"
                    )));
                }
            }
        }
        if let Some(p) = &self.params_data_hex {
            ensure_non_empty(p, "params_data_hex")?;
            ensure_hex(p, "params_data_hex")?;
        }
        if self.expiry <= 0 {
            return Err(ApiError::BadRequest(
                "expiry must be a positive unix timestamp".into(),
            ));
        }
        let now = current_unix_timestamp()?;
        if self.expiry <= now + 15 {
            return Err(ApiError::BadRequest(
                "signed request has expired or is too close to expiry; prepare a fresh request"
                    .into(),
            ));
        }
        Ok(())
    }
}

/// Append global pre-signed flags to a CLI args vec. Called by every handler
/// that forwards a browser signature to the CLI.
pub(crate) fn push_pre_signed_flags(args: &mut Vec<String>, ps: &PreSigned) {
    args.push("--signer-pubkey".into());
    args.push(ps.signer_pubkey.clone());
    args.push("--signature".into());
    args.push(ps.signature.clone());
    if let Some(flavor) = &ps.message_flavor {
        args.push("--message-flavor".into());
        args.push(flavor.clone());
    }
    if let Some(hex) = &ps.params_data_hex {
        args.push("--params-data".into());
        args.push(hex.clone());
    }
}

pub(crate) fn router() -> Router<AppState> {
    Router::new().route("/v2/prepare", post(prepare_clearsign_v2))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignPrepareRequest {
    envelope: ClearSignEnvelopeRequest,
    #[serde(default)]
    vote: Option<ClearSignVoteRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignEnvelopeRequest {
    version: u8,
    kind: String,
    wallet_name: String,
    #[serde(default)]
    wallet_id: Option<String>,
    action_id: String,
    nonce: String,
    expires_at: i64,
    policy_commitment: String,
    payload: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignVoteRequest {
    wallet_id: String,
    proposal_index: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignPrepareResponse {
    version: u8,
    kind: String,
    action_kind_code: u8,
    headline: String,
    lines: Vec<String>,
    payload_hash: String,
    envelope_hash: String,
    signable_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    vote_hashes: Option<ClearSignVoteHashes>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClearSignVoteHashes {
    propose: String,
    approve: String,
    cancel: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ClearSignActionKind {
    Send,
    BatchSend,
    AddMember,
    RemoveMember,
    ChangeThreshold,
    SetProtection,
    ReleaseMilestone,
    ReturnEscrowFunds,
    AgentTradeApproval,
    RecoveryAction,
    SwapIntent,
}

impl ClearSignActionKind {
    fn parse(value: &str) -> Result<Self, ApiError> {
        match value.trim() {
            "send" => Ok(Self::Send),
            "batch_send" => Ok(Self::BatchSend),
            "add_member" => Ok(Self::AddMember),
            "remove_member" => Ok(Self::RemoveMember),
            "change_threshold" => Ok(Self::ChangeThreshold),
            "set_protection" => Ok(Self::SetProtection),
            "release_milestone" => Ok(Self::ReleaseMilestone),
            "return_escrow_funds" => Ok(Self::ReturnEscrowFunds),
            "agent_trade_approval" => Ok(Self::AgentTradeApproval),
            "recovery_action" => Ok(Self::RecoveryAction),
            "swap_intent" => Ok(Self::SwapIntent),
            other => Err(ApiError::BadRequest(format!(
                "unsupported clearsign action kind: {other}"
            ))),
        }
    }

    fn code(self) -> u8 {
        match self {
            Self::Send => 1,
            Self::BatchSend => 2,
            Self::AddMember => 3,
            Self::RemoveMember => 4,
            Self::ChangeThreshold => 5,
            Self::SetProtection => 6,
            Self::ReleaseMilestone => 7,
            Self::ReturnEscrowFunds => 8,
            Self::AgentTradeApproval => 9,
            Self::RecoveryAction => 10,
            Self::SwapIntent => 11,
        }
    }
}

#[derive(Clone, Copy)]
enum ClearSignVoteKind {
    Propose,
    Approve,
    Cancel,
}

impl ClearSignVoteKind {
    fn code(self) -> u8 {
        match self {
            Self::Propose => 1,
            Self::Approve => 2,
            Self::Cancel => 3,
        }
    }
}

#[derive(Debug)]
struct Money {
    amount: String,
    asset: String,
    raw_amount: u128,
}

#[derive(Debug)]
struct RecipientAmount {
    recipient: String,
    money: Money,
}

async fn prepare_clearsign_v2(
    Json(req): Json<ClearSignPrepareRequest>,
) -> Result<Json<ClearSignPrepareResponse>, ApiError> {
    let envelope = req.envelope.normalized()?;
    let payload_hash = hash_payload(envelope.kind, &envelope.payload)?;
    let envelope_hash = hash_envelope(&envelope, payload_hash);
    let lines = action_lines(&envelope)?;
    let vote_hashes = req
        .vote
        .map(|vote| {
            let wallet_id = normalize_text(&vote.wallet_id);
            if wallet_id.is_empty() {
                return Err(ApiError::BadRequest(
                    "vote.wallet_id must not be empty".into(),
                ));
            }
            Ok(ClearSignVoteHashes {
                propose: to_hex(&hash_vote_message(
                    ClearSignVoteKind::Propose,
                    &wallet_id,
                    vote.proposal_index,
                    envelope_hash,
                )),
                approve: to_hex(&hash_vote_message(
                    ClearSignVoteKind::Approve,
                    &wallet_id,
                    vote.proposal_index,
                    envelope_hash,
                )),
                cancel: to_hex(&hash_vote_message(
                    ClearSignVoteKind::Cancel,
                    &wallet_id,
                    vote.proposal_index,
                    envelope_hash,
                )),
            })
        })
        .transpose()?;
    let payload_hex = to_hex(&payload_hash);
    let envelope_hex = to_hex(&envelope_hash);
    let context = [
        format!("Wallet {}", envelope.wallet_name),
        format!("Action {}", envelope.action_id),
        format!("Nonce {}", envelope.nonce),
        format!("Expires {}", envelope.expires_at),
        format!("Payload {}", payload_hex),
    ];
    let signable_text = lines
        .iter()
        .chain(context.iter())
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");

    Ok(Json(ClearSignPrepareResponse {
        version: CLEARSIGN_V2_VERSION,
        kind: req.envelope.kind,
        action_kind_code: envelope.kind.code(),
        headline: lines
            .first()
            .cloned()
            .unwrap_or_else(|| "Review ClearSig action".into()),
        lines,
        payload_hash: payload_hex,
        envelope_hash: envelope_hex,
        signable_text,
        vote_hashes,
    }))
}

struct NormalizedEnvelope {
    kind: ClearSignActionKind,
    wallet_name: String,
    wallet_id: String,
    action_id: String,
    nonce: String,
    expires_at: i64,
    policy_commitment: [u8; 32],
    payload: Value,
}

impl ClearSignEnvelopeRequest {
    fn normalized(&self) -> Result<NormalizedEnvelope, ApiError> {
        if self.version != CLEARSIGN_V2_VERSION {
            return Err(ApiError::BadRequest(format!(
                "clearsign version must be {CLEARSIGN_V2_VERSION}"
            )));
        }
        let kind = ClearSignActionKind::parse(&self.kind)?;
        let wallet_name = normalize_text(&self.wallet_name);
        let action_id = normalize_text(&self.action_id);
        let nonce = normalize_text(&self.nonce);
        if wallet_name.is_empty() {
            return Err(ApiError::BadRequest("wallet_name must not be empty".into()));
        }
        if action_id.is_empty() {
            return Err(ApiError::BadRequest("action_id must not be empty".into()));
        }
        if nonce.is_empty() {
            return Err(ApiError::BadRequest("nonce must not be empty".into()));
        }
        let now = current_unix_timestamp()?;
        if self.expires_at <= now {
            return Err(ApiError::BadRequest("clearsign action has expired".into()));
        }
        if self.expires_at - now > MAX_ACTION_TTL_SECONDS {
            return Err(ApiError::BadRequest(
                "clearsign action expiry is too far in the future".into(),
            ));
        }
        Ok(NormalizedEnvelope {
            kind,
            wallet_name,
            wallet_id: self
                .wallet_id
                .as_deref()
                .map(normalize_text)
                .unwrap_or_default(),
            action_id,
            nonce,
            expires_at: self.expires_at,
            policy_commitment: decode_hex_32(&self.policy_commitment, "policy_commitment")?,
            payload: self.payload.clone(),
        })
    }
}

fn hash_payload(kind: ClearSignActionKind, payload: &Value) -> Result<[u8; 32], ApiError> {
    let mut hasher = payload_hasher(kind);
    match kind {
        ClearSignActionKind::Send => {
            update_recipient_amount(&mut hasher, &recipient_amount(payload)?);
        }
        ClearSignActionKind::BatchSend => {
            let rows = payload
                .get("recipients")
                .and_then(Value::as_array)
                .ok_or_else(|| ApiError::BadRequest("payload.recipients must be an array".into()))?
                .iter()
                .map(recipient_amount)
                .collect::<Result<Vec<_>, _>>()?;
            update_u32(&mut hasher, rows.len() as u32);
            for row in &rows {
                update_recipient_amount(&mut hasher, row);
            }
        }
        ClearSignActionKind::ReleaseMilestone => {
            let row = recipient_amount(payload)?;
            update_bytes(
                &mut hasher,
                payload_text(payload, "escrowId")
                    .or_else(|_| payload_text(payload, "escrowTitle"))?
                    .as_bytes(),
            );
            update_bytes(
                &mut hasher,
                payload_text(payload, "milestoneId")
                    .or_else(|_| payload_text(payload, "milestoneTitle"))?
                    .as_bytes(),
            );
            update_recipient_amount(&mut hasher, &row);
        }
        ClearSignActionKind::ReturnEscrowFunds => {
            update_bytes(
                &mut hasher,
                payload_text(payload, "escrowId")
                    .or_else(|_| payload_text(payload, "escrowTitle"))?
                    .as_bytes(),
            );
            let rows = payload
                .get("returns")
                .and_then(Value::as_array)
                .ok_or_else(|| ApiError::BadRequest("payload.returns must be an array".into()))?
                .iter()
                .map(recipient_amount)
                .collect::<Result<Vec<_>, _>>()?;
            update_u32(&mut hasher, rows.len() as u32);
            for row in &rows {
                update_recipient_amount(&mut hasher, row);
            }
        }
        ClearSignActionKind::AgentTradeApproval => {
            let market = payload_text(payload, "market")?.to_uppercase();
            let side = payload_text(payload, "side")?.to_lowercase();
            if side != "long" && side != "short" {
                return Err(ApiError::BadRequest(
                    "payload.side must be long or short".into(),
                ));
            }
            let amount = Money::new(payload_text(payload, "maxNotionalUsd")?, "USD".into())?;
            update_bytes(&mut hasher, market.as_bytes());
            update_bytes(&mut hasher, side.as_bytes());
            update_amount(&mut hasher, &amount);
            update_u32(
                &mut hasher,
                leverage_to_x100(&payload_text(payload, "maxLeverage")?)?,
            );
        }
        ClearSignActionKind::AddMember | ClearSignActionKind::RemoveMember => {
            let member = payload_text(payload, "member")?;
            let role = payload_text(payload, "role")?;
            update_bytes(
                &mut hasher,
                format!(
                    "{{\"member\":{},\"role\":{}}}",
                    json_string(&member)?,
                    json_string(&role)?
                )
                .as_bytes(),
            );
        }
        ClearSignActionKind::ChangeThreshold => {
            let approvals_required = payload_u32(payload, "approvalsRequired")?;
            update_bytes(
                &mut hasher,
                format!("{{\"approvalsRequired\":{approvals_required}}}").as_bytes(),
            );
        }
        ClearSignActionKind::SetProtection => {
            let summary = payload_text(payload, "summary")?;
            update_bytes(
                &mut hasher,
                format!("{{\"summary\":{}}}", json_string(&summary)?).as_bytes(),
            );
        }
        ClearSignActionKind::RecoveryAction => {
            let recovery_action = payload_text(payload, "recoveryAction")?;
            update_bytes(
                &mut hasher,
                format!("{{\"recoveryAction\":{}}}", json_string(&recovery_action)?).as_bytes(),
            );
        }
        ClearSignActionKind::SwapIntent => {
            let from = payload
                .get("from")
                .ok_or_else(|| ApiError::BadRequest("payload.from must be an object".into()))?;
            let from_money =
                Money::new(payload_text(from, "amount")?, payload_text(from, "asset")?)?;
            let to_asset = payload_text(payload, "toAsset")?.to_uppercase();
            let min_receive = normalize_decimal(&payload_text(payload, "minReceive")?)?;
            update_bytes(
                &mut hasher,
                format!(
                    "{{\"from\":{{\"amount\":{},\"asset\":{}}},\"toAsset\":{},\"minReceive\":{}}}",
                    json_string(&from_money.amount)?,
                    json_string(&from_money.asset)?,
                    json_string(&to_asset)?,
                    json_string(&min_receive)?
                )
                .as_bytes(),
            );
        }
    }
    Ok(finish_hash(hasher))
}

fn hash_envelope(envelope: &NormalizedEnvelope, payload_hash: [u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, CLEARSIGN_V2_DOMAIN);
    hasher.update([CLEARSIGN_V2_VERSION]);
    hasher.update([envelope.kind.code()]);
    hasher.update(envelope.expires_at.to_le_bytes());
    update_bytes(&mut hasher, envelope.wallet_name.as_bytes());
    update_bytes(&mut hasher, envelope.wallet_id.as_bytes());
    hasher.update(Sha256::digest(envelope.action_id.as_bytes()));
    hasher.update(Sha256::digest(envelope.nonce.as_bytes()));
    hasher.update(envelope.policy_commitment);
    hasher.update(payload_hash);
    finish_hash(hasher)
}

fn hash_vote_message(
    vote_kind: ClearSignVoteKind,
    wallet_id: &str,
    proposal_index: u64,
    envelope_hash: [u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, CLEARSIGN_V2_VOTE_DOMAIN);
    hasher.update([CLEARSIGN_V2_VERSION]);
    hasher.update([vote_kind.code()]);
    update_bytes(&mut hasher, wallet_id.as_bytes());
    hasher.update(proposal_index.to_le_bytes());
    hasher.update(envelope_hash);
    finish_hash(hasher)
}

fn action_lines(envelope: &NormalizedEnvelope) -> Result<Vec<String>, ApiError> {
    match envelope.kind {
        ClearSignActionKind::Send => {
            let row = recipient_amount(&envelope.payload)?;
            Ok(vec![
                format!(
                    "Send {} from {} to {}",
                    format_money(&row.money),
                    envelope.wallet_name,
                    row.recipient
                ),
                "Requires wallet approval".into(),
            ])
        }
        ClearSignActionKind::BatchSend => {
            let rows = envelope
                .payload
                .get("recipients")
                .and_then(Value::as_array)
                .ok_or_else(|| ApiError::BadRequest("payload.recipients must be an array".into()))?
                .iter()
                .map(recipient_amount)
                .collect::<Result<Vec<_>, _>>()?;
            let mut lines = vec![format!(
                "Send {} payments from {}",
                rows.len(),
                envelope.wallet_name
            )];
            lines.extend(
                rows.iter()
                    .take(4)
                    .map(|row| format!("{} receives {}", row.recipient, format_money(&row.money))),
            );
            lines.push("Requires wallet approval".into());
            Ok(lines)
        }
        ClearSignActionKind::ReleaseMilestone => {
            let row = recipient_amount(&envelope.payload)?;
            Ok(vec![
                format!(
                    "Release {} from {}",
                    format_money(&row.money),
                    envelope.wallet_name
                ),
                format!(
                    "{} receives funds for {}",
                    row.recipient,
                    payload_text(&envelope.payload, "milestoneTitle")?
                ),
                format!("Escrow {}", payload_text(&envelope.payload, "escrowTitle")?),
            ])
        }
        ClearSignActionKind::ReturnEscrowFunds => {
            let rows = envelope
                .payload
                .get("returns")
                .and_then(Value::as_array)
                .ok_or_else(|| ApiError::BadRequest("payload.returns must be an array".into()))?
                .iter()
                .map(recipient_amount)
                .collect::<Result<Vec<_>, _>>()?;
            let mut lines = vec![format!(
                "Return remaining escrow funds from {}",
                envelope.wallet_name
            )];
            lines.extend(
                rows.iter()
                    .take(6)
                    .map(|row| format!("{} receives {}", row.recipient, format_money(&row.money))),
            );
            lines.push("Requires wallet approval".into());
            Ok(lines)
        }
        ClearSignActionKind::AgentTradeApproval => Ok(vec![
            format!(
                "Approve {} {} up to ${}",
                payload_text(&envelope.payload, "market")?.to_uppercase(),
                payload_text(&envelope.payload, "side")?.to_lowercase(),
                payload_text(&envelope.payload, "maxNotionalUsd")?
            ),
            format!(
                "Max leverage {}",
                payload_text(&envelope.payload, "maxLeverage")?
            ),
            if envelope
                .payload
                .get("stopLossRequired")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                "Stop loss required".into()
            } else {
                "Stop loss not required".into()
            },
        ]),
        ClearSignActionKind::AddMember => Ok(vec![format!(
            "Add {} as {} to {}",
            payload_text(&envelope.payload, "member")?,
            payload_text(&envelope.payload, "role")?,
            envelope.wallet_name
        )]),
        ClearSignActionKind::RemoveMember => Ok(vec![format!(
            "Remove {} from {}",
            payload_text(&envelope.payload, "member")?,
            envelope.wallet_name
        )]),
        ClearSignActionKind::ChangeThreshold => {
            let approvals_required = payload_u32(&envelope.payload, "approvalsRequired")?;
            Ok(vec![format!(
                "Require {} approval{} for {}",
                approvals_required,
                if approvals_required == 1 { "" } else { "s" },
                envelope.wallet_name
            )])
        }
        ClearSignActionKind::SetProtection => Ok(vec![
            format!("Set protection for {}", envelope.wallet_name),
            payload_text(&envelope.payload, "summary")?,
        ]),
        ClearSignActionKind::RecoveryAction => Ok(vec![
            format!("Approve recovery for {}", envelope.wallet_name),
            payload_text(&envelope.payload, "recoveryAction")?,
        ]),
        ClearSignActionKind::SwapIntent => {
            let from = envelope
                .payload
                .get("from")
                .ok_or_else(|| ApiError::BadRequest("payload.from must be an object".into()))?;
            let from_money =
                Money::new(payload_text(from, "amount")?, payload_text(from, "asset")?)?;
            Ok(vec![
                format!(
                    "Swap {} from {}",
                    format_money(&from_money),
                    envelope.wallet_name
                ),
                format!(
                    "Receive at least {} {}",
                    normalize_decimal(&payload_text(&envelope.payload, "minReceive")?)?,
                    payload_text(&envelope.payload, "toAsset")?.to_uppercase()
                ),
                "Requires wallet approval".into(),
            ])
        }
    }
}

fn recipient_amount(value: &Value) -> Result<RecipientAmount, ApiError> {
    Ok(RecipientAmount {
        recipient: payload_text(value, "recipient")?,
        money: Money::new(
            payload_text(value, "amount")?,
            payload_text(value, "asset")?,
        )?,
    })
}

impl Money {
    fn new(amount: String, asset: String) -> Result<Self, ApiError> {
        let asset = normalize_text(&asset).to_uppercase();
        if asset.is_empty() {
            return Err(ApiError::BadRequest("asset must not be empty".into()));
        }
        let amount = normalize_decimal(&amount)?;
        let raw_amount = decimal_to_raw(&amount, asset_decimals(&asset))?;
        Ok(Self {
            amount,
            asset,
            raw_amount,
        })
    }
}

fn payload_text(payload: &Value, field: &str) -> Result<String, ApiError> {
    let value = payload
        .get(field)
        .and_then(Value::as_str)
        .map(normalize_text)
        .ok_or_else(|| ApiError::BadRequest(format!("payload.{field} must be a string")))?;
    if value.is_empty() {
        return Err(ApiError::BadRequest(format!(
            "payload.{field} must not be empty"
        )));
    }
    Ok(value)
}

fn payload_u32(payload: &Value, field: &str) -> Result<u32, ApiError> {
    let value = payload.get(field).ok_or_else(|| {
        ApiError::BadRequest(format!("payload.{field} must be a positive integer"))
    })?;
    let parsed = if let Some(n) = value.as_u64() {
        n
    } else if let Some(s) = value.as_str() {
        normalize_text(s).parse::<u64>().map_err(|_| {
            ApiError::BadRequest(format!("payload.{field} must be a positive integer"))
        })?
    } else {
        return Err(ApiError::BadRequest(format!(
            "payload.{field} must be a positive integer"
        )));
    };
    u32::try_from(parsed).map_err(|_| ApiError::BadRequest(format!("payload.{field} is too large")))
}

fn payload_hasher(kind: ClearSignActionKind) -> Sha256 {
    let mut hasher = Sha256::new();
    update_bytes(&mut hasher, CLEARSIGN_V2_PAYLOAD_DOMAIN);
    hasher.update([kind.code()]);
    hasher
}

fn update_recipient_amount(hasher: &mut Sha256, row: &RecipientAmount) {
    update_bytes(hasher, row.recipient.as_bytes());
    update_amount(hasher, &row.money);
}

fn update_amount(hasher: &mut Sha256, money: &Money) {
    update_bytes(hasher, money.asset.as_bytes());
    hasher.update(money.raw_amount.to_le_bytes());
}

fn update_bytes(hasher: &mut Sha256, value: &[u8]) {
    update_u32(hasher, value.len() as u32);
    hasher.update(value);
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

fn decimal_to_raw(value: &str, decimals: usize) -> Result<u128, ApiError> {
    let (whole, frac) = value
        .split_once('.')
        .map_or((value, ""), |(whole, frac)| (whole, frac));
    if whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError::BadRequest(
            "amount must be a decimal number".into(),
        ));
    }
    if frac.len() > decimals || !frac.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError::BadRequest(format!(
            "amount supports at most {decimals} decimal places"
        )));
    }
    let whole_raw = whole
        .parse::<u128>()
        .map_err(|_| ApiError::BadRequest("amount is too large".into()))?
        .checked_mul(10u128.pow(decimals as u32))
        .ok_or_else(|| ApiError::BadRequest("amount is too large".into()))?;
    let frac_padded = format!("{frac:0<decimals$}");
    let frac_raw = if frac_padded.is_empty() {
        0
    } else {
        frac_padded
            .parse::<u128>()
            .map_err(|_| ApiError::BadRequest("amount is too large".into()))?
    };
    whole_raw
        .checked_add(frac_raw)
        .ok_or_else(|| ApiError::BadRequest("amount is too large".into()))
}

fn asset_decimals(asset: &str) -> usize {
    match asset {
        "BTC" => 8,
        "ETH" | "HYPE" => 18,
        "USDC" | "USDT" | "USD" => 6,
        _ => 9,
    }
}

fn leverage_to_x100(value: &str) -> Result<u32, ApiError> {
    let raw = normalize_text(value)
        .trim_end_matches('x')
        .trim_end_matches('X')
        .to_string();
    let normalized = normalize_decimal(&raw)?;
    let (whole, frac) = normalized
        .split_once('.')
        .map_or((normalized.as_str(), ""), |(whole, frac)| (whole, frac));
    if frac.len() > 2 {
        return Err(ApiError::BadRequest(
            "maxLeverage supports at most two decimal places".into(),
        ));
    }
    let whole = whole
        .parse::<u32>()
        .map_err(|_| ApiError::BadRequest("maxLeverage is too large".into()))?;
    let frac = format!("{frac:0<2}")
        .parse::<u32>()
        .map_err(|_| ApiError::BadRequest("maxLeverage is too large".into()))?;
    whole
        .checked_mul(100)
        .and_then(|v| v.checked_add(frac))
        .ok_or_else(|| ApiError::BadRequest("maxLeverage is too large".into()))
}

fn normalize_text(value: &str) -> String {
    value.trim().to_string()
}

fn normalize_decimal(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') || trimmed.starts_with('+') {
        return Err(ApiError::BadRequest(
            "amount must be a positive decimal".into(),
        ));
    }
    let (whole, frac) = trimmed
        .split_once('.')
        .map_or((trimmed, ""), |(whole, frac)| (whole, frac));
    if whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !frac.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(ApiError::BadRequest(
            "amount must be a decimal number".into(),
        ));
    }
    let whole = whole.trim_start_matches('0');
    let whole = if whole.is_empty() { "0" } else { whole };
    let frac = frac.trim_end_matches('0');
    if frac.is_empty() {
        Ok(whole.to_string())
    } else {
        Ok(format!("{whole}.{frac}"))
    }
}

fn decode_hex_32(value: &str, field: &str) -> Result<[u8; 32], ApiError> {
    ensure_hex_exact_len(value, field, 32)?;
    let hex = value.trim().strip_prefix("0x").unwrap_or(value.trim());
    let mut out = [0u8; 32];
    for (i, chunk) in hex.as_bytes().chunks_exact(2).enumerate() {
        let byte = std::str::from_utf8(chunk)
            .map_err(|_| ApiError::BadRequest(format!("{field} must be hex encoded")))?;
        out[i] = u8::from_str_radix(byte, 16)
            .map_err(|_| ApiError::BadRequest(format!("{field} must be hex encoded")))?;
    }
    Ok(out)
}

fn to_hex(bytes: &[u8; 32]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn format_money(money: &Money) -> String {
    format!("{} {}", money.amount, money.asset)
}

fn json_string(value: &str) -> Result<String, ApiError> {
    serde_json::to_string(value)
        .map_err(|e| ApiError::Internal(format!("failed to encode clearsign payload: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn send_envelope(amount: &str, nonce: &str) -> ClearSignEnvelopeRequest {
        ClearSignEnvelopeRequest {
            version: CLEARSIGN_V2_VERSION,
            kind: "send".into(),
            wallet_name: " Team ".into(),
            wallet_id: Some(" Team#abc ".into()),
            action_id: " action-1 ".into(),
            nonce: nonce.into(),
            expires_at: current_unix_timestamp().unwrap() + 600,
            policy_commitment: "11".repeat(32),
            payload: serde_json::json!({
                "recipient": " Sarah ",
                "amount": amount,
                "asset": " sol "
            }),
        }
    }

    #[test]
    fn send_payload_hash_normalizes_amount_asset_and_recipient() {
        let a = send_envelope("2.5000", "nonce-1").normalized().unwrap();
        let b = send_envelope("002.5", "nonce-1").normalized().unwrap();

        assert_eq!(
            to_hex(&hash_payload(a.kind, &a.payload).unwrap()),
            to_hex(&hash_payload(b.kind, &b.payload).unwrap())
        );
    }

    #[test]
    fn envelope_hash_binds_nonce() {
        let a = send_envelope("2.5", "nonce-1").normalized().unwrap();
        let b = send_envelope("2.5", "nonce-2").normalized().unwrap();
        let a_payload_hash = hash_payload(a.kind, &a.payload).unwrap();
        let b_payload_hash = hash_payload(b.kind, &b.payload).unwrap();

        assert_ne!(
            to_hex(&hash_envelope(&a, a_payload_hash)),
            to_hex(&hash_envelope(&b, b_payload_hash))
        );
    }

    #[test]
    fn vote_hashes_are_distinct_by_vote_kind() {
        let envelope = send_envelope("2.5", "nonce-1").normalized().unwrap();
        let payload_hash = hash_payload(envelope.kind, &envelope.payload).unwrap();
        let envelope_hash = hash_envelope(&envelope, payload_hash);

        let propose = hash_vote_message(ClearSignVoteKind::Propose, "Team#abc", 7, envelope_hash);
        let approve = hash_vote_message(ClearSignVoteKind::Approve, "Team#abc", 7, envelope_hash);
        let cancel = hash_vote_message(ClearSignVoteKind::Cancel, "Team#abc", 7, envelope_hash);

        assert_ne!(to_hex(&propose), to_hex(&approve));
        assert_ne!(to_hex(&approve), to_hex(&cancel));
    }

    #[test]
    fn rejects_bad_policy_commitment() {
        let mut envelope = send_envelope("2.5", "nonce-1");
        envelope.policy_commitment = "abc".into();

        assert!(matches!(
            envelope.normalized(),
            Err(ApiError::BadRequest(message)) if message.contains("policy_commitment")
        ));
    }
}

/// Convert a Unix expiry timestamp into the `YYYY-MM-DD HH:MM:SS` form the
/// CLI expects on `--expiry`. This mirrors the CLI's `message::parse_expiry`.
pub(crate) fn format_expiry(unix_ts: i64) -> Result<String, ApiError> {
    let secs_per_day: i64 = 86400;
    let mut days = unix_ts / secs_per_day;
    let day_secs = ((unix_ts % secs_per_day) + secs_per_day) % secs_per_day;
    if unix_ts < 0 && day_secs > 0 {
        days -= 1;
    }
    let hour = day_secs / 3600;
    let min = (day_secs % 3600) / 60;
    let sec = day_secs % 60;
    let adj = days + 719468;
    let era = if adj >= 0 { adj } else { adj - 146096 } / 146097;
    let doe = adj - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    if !(1970..=9999).contains(&year) {
        return Err(ApiError::BadRequest(format!(
            "expiry timestamp {unix_ts} resolves to year {year}, out of supported range"
        )));
    }
    Ok(format!(
        "{year:04}-{m:02}-{d:02} {hour:02}:{min:02}:{sec:02}"
    ))
}
