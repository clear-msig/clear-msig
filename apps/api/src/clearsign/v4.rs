use axum::{extract::State, Json};
use clear_msig_signing::{
    document_hash, encode_agent_risk_policy, encode_agent_session, encode_agent_settlement,
    encode_agent_trade_approval, encode_batch_transfer, encode_escrow_release,
    encode_escrow_return, encode_governance, encode_policy_update, encode_recurring_schedule,
    encode_transfer, envelope_hash, execution_commitment, parse_intent, policy_commitment,
    render_document, replay_hash, wallet_policy_commitment, ActionKind, AgentRiskPolicyInput,
    AgentSessionInput, AgentSettlementInput, AgentTradeApprovalInput, BatchTransferInput,
    CommonFields, DeviceProfile, EscrowReleaseInput, EscrowReturnInput, FiatEstimateInput,
    GovernanceInput, IdentityEncoding, Network, PolicyUpdateInput, RecurringScheduleInput,
    TransferInput, TransferRowInput, MAX_CANONICAL_INTENT_BYTES, MAX_DOCUMENT_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

mod escrow_binding;

use escrow_binding::{
    escrow_execution_commitment, resolve_trusted_escrow_binding, TrustedEscrowBinding,
};

use super::v4_input::{
    asset_encoding, decode_base58_32, decode_bounded_hex, decode_hex_32, decode_payload_hash,
    payload_i64, payload_pubkeys, payload_status, payload_u128, payload_u64_strict, payload_u8,
    signing_error, strict_optional_text, strict_required_text, to_hex, validate_replay_label,
    value_pubkeys, value_string, value_u64, value_u8,
};
use super::v4_validation::validate_payload_shape;
use super::{
    device_profiles::{resolve_device_profile, DeviceProfileRequest, RenderMode},
    kinds::ClearSignActionKind,
    payload::{
        decimal_to_raw, leverage_to_x100, normalize_text, payload_u32, recipient_amount,
        RecipientEncoding,
    },
};
use crate::{current_unix_timestamp, ApiError, AppState};

const CLEARSIGN_V4_VERSION: u8 = 4;
const MAX_ACTION_TTL_SECONDS: i64 = 30 * 24 * 60 * 60;
const MAX_FIAT_ESTIMATE_AGE_SECONDS: i64 = 5 * 60;
const MAX_FIAT_ESTIMATE_FUTURE_SKEW_SECONDS: i64 = 30;
const SOLANA_DEVNET_USDC_MINT: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ClearSignV4PrepareRequest {
    envelope: ClearSignV4EnvelopeRequest,
    intent_index: u8,
    actor_pubkey: String,
    #[serde(default)]
    policy_bytes_hex: Option<String>,
    #[serde(default)]
    device_profile: Option<DeviceProfileRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClearSignV4EnvelopeRequest {
    version: u8,
    kind: String,
    network: String,
    wallet_name: String,
    #[serde(default)]
    wallet_id: Option<String>,
    action_id: String,
    nonce: String,
    expires_at: i64,
    #[serde(default)]
    policy_commitment: Option<String>,
    payload: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ClearSignV4PrepareResponse {
    version: u8,
    kind: String,
    action_kind_code: u8,
    headline: String,
    lines: Vec<String>,
    payload_hash: String,
    envelope_hash: String,
    canonical_intent_hash: String,
    canonical_intent_hex: String,
    policy_commitment: String,
    signable_text: String,
    device_profile: V4DeviceProfileResponse,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct V4DeviceProfileResponse {
    id: &'static str,
    version: u8,
    mode: &'static str,
    max_document_bytes: usize,
}

#[derive(Clone, Debug)]
struct TrustedIntentContext {
    wallet_id: [u8; 32],
    wallet_name: String,
    proposal_index: u64,
    chain_kind: u8,
    approval_threshold: u8,
    approved: bool,
    proposers: Vec<[u8; 32]>,
    execution_commitment: [u8; 32],
    current_policy_commitment: Option<[u8; 32]>,
    escrow_binding: TrustedEscrowBinding,
}

struct OwnedTransferRow {
    recipient_encoding: IdentityEncoding,
    recipient: Vec<u8>,
    asset_encoding: IdentityEncoding,
    asset: Vec<u8>,
    raw_amount: u128,
    decimals: u8,
    display_asset: String,
}

struct OwnedFiatEstimate {
    amount: String,
    currency: String,
    source: String,
    observed_at: i64,
}

pub(super) async fn prepare_clearsign_v4(
    State(state): State<AppState>,
    Json(req): Json<ClearSignV4PrepareRequest>,
) -> Result<Json<ClearSignV4PrepareResponse>, ApiError> {
    let trusted = resolve_trusted_context(&state, &req).await?;
    prepare_clearsign_v4_response(req, trusted).map(Json)
}

async fn resolve_trusted_context(
    state: &AppState,
    req: &ClearSignV4PrepareRequest,
) -> Result<TrustedIntentContext, ApiError> {
    let requested_name = normalize_text(&req.envelope.wallet_name);
    if requested_name.is_empty() {
        return Err(ApiError::BadRequest("wallet_name must not be empty".into()));
    }
    let wallet = state
        .runner
        .run_direct(
            clear_msig_command_contract::DirectExecutionContext::Backend,
            clear_msig_command_contract::DirectCommand::WalletShow {
                name: requested_name,
            },
        )
        .await?;
    let wallet_id = decode_base58_32(value_string(&wallet, "address")?, "wallet.address")?;
    let wallet_name = value_string(&wallet, "name")?.to_string();
    let proposal_index = value_u64(&wallet, "proposal_index")?;

    let intents = state
        .runner
        .run_direct(
            clear_msig_command_contract::DirectExecutionContext::Backend,
            clear_msig_command_contract::DirectCommand::IntentList {
                wallet: wallet_name.clone(),
            },
        )
        .await?;
    let rows = intents
        .as_array()
        .ok_or_else(|| ApiError::InvalidOutput("intent list did not return an array".into()))?;
    let intent = rows
        .iter()
        .find(|row| row.get("index").and_then(Value::as_u64) == Some(req.intent_index as u64))
        .ok_or_else(|| ApiError::BadRequest("intent_index does not exist on this wallet".into()))?;
    let approved = intent
        .get("approved")
        .and_then(Value::as_bool)
        .ok_or_else(|| ApiError::InvalidOutput("intent list did not return approved".into()))?;
    let chain_kind = value_u8(intent, "chain_kind")?;
    let approval_threshold = value_u8(intent, "approval_threshold")?;
    let proposers = value_pubkeys(intent, "proposers")?;
    let execution_commitment = if chain_kind == 0 {
        [0u8; 32]
    } else {
        decode_hex_32(
            value_string(intent, "tx_template_hash")?,
            "intent.tx_template_hash",
        )?
    };
    let current_policy_commitment = if normalize_text(&req.envelope.kind) == "set_protection" {
        let policy = state
            .runner
            .run_direct(
                clear_msig_command_contract::DirectExecutionContext::Backend,
                clear_msig_command_contract::DirectCommand::WalletPolicyCommitment {
                    wallet: wallet_name.clone(),
                    chain_kind,
                },
            )
            .await?;
        Some(decode_hex_32(
            value_string(&policy, "commitment")?,
            "trusted policy commitment",
        )?)
    } else {
        None
    };
    let escrow_binding =
        resolve_trusted_escrow_binding(state, req, intent, &wallet_name, chain_kind).await?;

    Ok(TrustedIntentContext {
        wallet_id,
        wallet_name,
        proposal_index,
        chain_kind,
        approval_threshold,
        approved,
        proposers,
        execution_commitment,
        current_policy_commitment,
        escrow_binding,
    })
}

fn prepare_clearsign_v4_response(
    req: ClearSignV4PrepareRequest,
    trusted: TrustedIntentContext,
) -> Result<ClearSignV4PrepareResponse, ApiError> {
    if req.envelope.version != CLEARSIGN_V4_VERSION {
        return Err(ApiError::BadRequest(format!(
            "clearsign version must be {CLEARSIGN_V4_VERSION}"
        )));
    }
    if !trusted.approved {
        return Err(ApiError::BadRequest(
            "intent is not approved for proposal creation".into(),
        ));
    }
    if normalize_text(&req.envelope.wallet_name) != trusted.wallet_name {
        return Err(ApiError::BadRequest(
            "wallet_name does not match current onchain wallet state".into(),
        ));
    }
    if trusted.approval_threshold == 0 || trusted.approval_threshold > 16 {
        return Err(ApiError::InvalidOutput(
            "intent returned an invalid approval threshold".into(),
        ));
    }

    let actor = decode_base58_32(&req.actor_pubkey, "actor_pubkey")?;
    if !trusted.proposers.contains(&actor) {
        return Err(ApiError::BadRequest(
            "actor_pubkey is not a proposer on the selected intent".into(),
        ));
    }
    if let Some(asserted_wallet) = req.envelope.wallet_id.as_deref() {
        if decode_base58_32(asserted_wallet, "wallet_id")? != trusted.wallet_id {
            return Err(ApiError::BadRequest(
                "wallet_id does not match current onchain wallet state".into(),
            ));
        }
    }

    validate_replay_label(&req.envelope.action_id, "action_id")?;
    validate_replay_label(&req.envelope.nonce, "nonce")?;
    let now = current_unix_timestamp()?;
    if req.envelope.expires_at <= now {
        return Err(ApiError::BadRequest("clearsign action has expired".into()));
    }
    if req.envelope.expires_at - now > MAX_ACTION_TTL_SECONDS {
        return Err(ApiError::BadRequest(
            "clearsign action expiry is too far in the future".into(),
        ));
    }

    let kind = ClearSignActionKind::parse(&req.envelope.kind)?;
    validate_payload_shape(kind, &req.envelope.payload)?;
    let network = parse_network(&req.envelope.network, trusted.chain_kind)?;
    if network.chain_kind() != trusted.chain_kind {
        return Err(ApiError::BadRequest(
            "network does not match the selected onchain intent".into(),
        ));
    }
    let (profile, profile_response) = parse_device_profile(req.device_profile.as_ref())?;
    let policy_bytes = decode_bounded_hex(
        req.policy_bytes_hex.as_deref().unwrap_or(""),
        "policyBytesHex",
    )?;
    let submitted_policy_commitment = policy_commitment(&policy_bytes);
    let replacement_policy_commitment = wallet_policy_commitment(&policy_bytes);
    let trusted_policy_commitment = if kind == ClearSignActionKind::SetProtection {
        trusted.current_policy_commitment.ok_or_else(|| {
            ApiError::InvalidOutput("current wallet policy commitment was not resolved".into())
        })?
    } else {
        submitted_policy_commitment
    };
    if let Some(asserted) = req.envelope.policy_commitment.as_deref() {
        if decode_hex_32(asserted, "policy_commitment")? != trusted_policy_commitment {
            return Err(ApiError::BadRequest(
                "policy_commitment does not match the submitted policy bytes".into(),
            ));
        }
    }

    let common = CommonFields {
        profile,
        network,
        proposal_index: trusted.proposal_index,
        wallet_id: trusted.wallet_id,
        actor,
        action_id: replay_hash(req.envelope.action_id.as_bytes()),
        nonce: replay_hash(req.envelope.nonce.as_bytes()),
        expires_at: req.envelope.expires_at,
        policy_commitment: trusted_policy_commitment,
        approval_required: trusted.approval_threshold,
    };

    let mut canonical_bytes = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = match kind {
        ClearSignActionKind::Send => {
            let row = owned_transfer_row(&req.envelope.payload)?;
            let fiat = owned_fiat_estimate(&req.envelope.payload, now)?;
            let reason = strict_optional_text(&req.envelope.payload, "note", 160)?;
            encode_transfer(
                &TransferInput {
                    common,
                    recipient_encoding: row.recipient_encoding,
                    recipient: &row.recipient,
                    asset_encoding: row.asset_encoding,
                    asset: &row.asset,
                    raw_amount: row.raw_amount,
                    decimals: row.decimals,
                    display_asset: row.display_asset.as_bytes(),
                    execution_commitment: trusted.execution_commitment,
                    fiat_estimate: fiat.as_ref().map(|estimate| FiatEstimateInput {
                        amount: estimate.amount.as_bytes(),
                        currency: estimate.currency.as_bytes(),
                        source: estimate.source.as_bytes(),
                        observed_at: estimate.observed_at,
                    }),
                    reason: reason.as_bytes(),
                },
                &mut canonical_bytes,
            )
            .map_err(signing_error)?
        }
        ClearSignActionKind::BatchSend => {
            let values = req
                .envelope
                .payload
                .get("recipients")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    ApiError::BadRequest("payload.recipients must be an array".into())
                })?;
            let owned = values
                .iter()
                .map(owned_transfer_row)
                .collect::<Result<Vec<_>, _>>()?;
            let rows = owned
                .iter()
                .map(|row| TransferRowInput {
                    recipient_encoding: row.recipient_encoding,
                    recipient: &row.recipient,
                    asset_encoding: row.asset_encoding,
                    asset: &row.asset,
                    raw_amount: row.raw_amount,
                    decimals: row.decimals,
                    display_asset: row.display_asset.as_bytes(),
                })
                .collect::<Vec<_>>();
            let reason = strict_optional_text(&req.envelope.payload, "note", 160)?;
            encode_batch_transfer(
                &BatchTransferInput {
                    common,
                    rows: &rows,
                    reason: reason.as_bytes(),
                },
                &mut canonical_bytes,
            )
            .map_err(signing_error)?
        }
        ClearSignActionKind::AddMember
        | ClearSignActionKind::RemoveMember
        | ClearSignActionKind::ChangeThreshold => {
            let target_intent_index = payload_u8(&req.envelope.payload, "targetIntentIndex")?;
            let approval_threshold = match kind {
                ClearSignActionKind::ChangeThreshold => {
                    payload_u8(&req.envelope.payload, "approvalsRequired")?
                }
                _ => payload_u8(&req.envelope.payload, "approvalThreshold")?,
            };
            let cancellation_threshold =
                payload_u8(&req.envelope.payload, "cancellationThreshold")?;
            let timelock_seconds = payload_u32(&req.envelope.payload, "timelockSeconds")?;
            let proposers = payload_pubkeys(&req.envelope.payload, "proposers")?;
            let approvers = payload_pubkeys(&req.envelope.payload, "approvers")?;
            let reason = strict_optional_text(&req.envelope.payload, "reason", 160)?;
            encode_governance(
                &GovernanceInput {
                    common,
                    kind: action_kind(kind),
                    target_intent_index,
                    approval_threshold,
                    cancellation_threshold,
                    timelock_seconds,
                    proposers: &proposers,
                    approvers: &approvers,
                    reason: reason.as_bytes(),
                },
                &mut canonical_bytes,
            )
            .map_err(signing_error)?
        }
        ClearSignActionKind::SetProtection => {
            let chain_kind = payload_u8(&req.envelope.payload, "chainKind")?;
            if chain_kind != trusted.chain_kind {
                return Err(ApiError::BadRequest(
                    "payload.chainKind does not match the selected onchain intent".into(),
                ));
            }
            let asserted_new = strict_required_text(&req.envelope.payload, "policyCommitment", 64)?;
            if decode_hex_32(&asserted_new, "payload.policyCommitment")?
                != replacement_policy_commitment
            {
                return Err(ApiError::BadRequest(
                    "payload.policyCommitment does not match the replacement policy bytes".into(),
                ));
            }
            let reason = strict_optional_text(&req.envelope.payload, "summary", 160)?;
            encode_policy_update(
                &PolicyUpdateInput {
                    common,
                    chain_kind,
                    new_policy_commitment: replacement_policy_commitment,
                    reason: reason.as_bytes(),
                },
                &mut canonical_bytes,
            )
            .map_err(signing_error)?
        }
        ClearSignActionKind::ReleaseMilestone => {
            let row = owned_transfer_row(&req.envelope.payload)?;
            let escrow_execution_commitment = escrow_execution_commitment(
                &req.envelope.payload,
                &trusted,
                true,
                core::slice::from_ref(&row),
            )?;
            let escrow_id = strict_required_text(&req.envelope.payload, "escrowId", 96)?;
            let escrow_title = strict_required_text(&req.envelope.payload, "escrowTitle", 96)?;
            let milestone_id = strict_required_text(&req.envelope.payload, "milestoneId", 96)?;
            let milestone_title =
                strict_required_text(&req.envelope.payload, "milestoneTitle", 96)?;
            let reason = strict_optional_text(&req.envelope.payload, "reason", 160)?;
            let payment = TransferRowInput {
                recipient_encoding: row.recipient_encoding,
                recipient: &row.recipient,
                asset_encoding: row.asset_encoding,
                asset: &row.asset,
                raw_amount: row.raw_amount,
                decimals: row.decimals,
                display_asset: row.display_asset.as_bytes(),
            };
            encode_escrow_release(
                &EscrowReleaseInput {
                    common,
                    escrow_id: escrow_id.as_bytes(),
                    escrow_title: escrow_title.as_bytes(),
                    milestone_id: milestone_id.as_bytes(),
                    milestone_title: milestone_title.as_bytes(),
                    payment,
                    execution_commitment: escrow_execution_commitment,
                    reason: reason.as_bytes(),
                },
                &mut canonical_bytes,
            )
            .map_err(signing_error)?
        }
        ClearSignActionKind::ReturnEscrowFunds => {
            let escrow_id = strict_required_text(&req.envelope.payload, "escrowId", 96)?;
            let escrow_title = strict_required_text(&req.envelope.payload, "escrowTitle", 96)?;
            let values = req
                .envelope
                .payload
                .get("returns")
                .and_then(Value::as_array)
                .ok_or_else(|| ApiError::BadRequest("payload.returns must be an array".into()))?;
            let owned = values
                .iter()
                .map(owned_transfer_row)
                .collect::<Result<Vec<_>, _>>()?;
            let escrow_execution_commitment =
                escrow_execution_commitment(&req.envelope.payload, &trusted, false, &owned)?;
            let rows = owned
                .iter()
                .map(|row| TransferRowInput {
                    recipient_encoding: row.recipient_encoding,
                    recipient: &row.recipient,
                    asset_encoding: row.asset_encoding,
                    asset: &row.asset,
                    raw_amount: row.raw_amount,
                    decimals: row.decimals,
                    display_asset: row.display_asset.as_bytes(),
                })
                .collect::<Vec<_>>();
            let reason = strict_optional_text(&req.envelope.payload, "reason", 160)?;
            encode_escrow_return(
                &EscrowReturnInput {
                    common,
                    escrow_id: escrow_id.as_bytes(),
                    escrow_title: escrow_title.as_bytes(),
                    rows: &rows,
                    execution_commitment: escrow_execution_commitment,
                    reason: reason.as_bytes(),
                },
                &mut canonical_bytes,
            )
            .map_err(signing_error)?
        }
        ClearSignActionKind::AgentTradeApproval => {
            let agent_id = strict_required_text(&req.envelope.payload, "agentId", 96)?;
            let venue = strict_required_text(&req.envelope.payload, "venue", 96)?;
            let market = strict_required_text(&req.envelope.payload, "market", 96)?;
            let side = strict_required_text(&req.envelope.payload, "side", 16)?;
            let asset_id = strict_required_text(&req.envelope.payload, "assetId", 96)?;
            let max_notional = strict_required_text(&req.envelope.payload, "maxNotionalUsd", 64)?;
            let max_notional_raw = decimal_to_raw(&max_notional, 6)?;
            let max_leverage = strict_required_text(&req.envelope.payload, "maxLeverage", 32)?;
            let max_leverage_x100 = leverage_to_x100(&max_leverage)?;
            let session_id = strict_required_text(&req.envelope.payload, "sessionId", 96)?;
            let route = strict_required_text(&req.envelope.payload, "route", 96)?;
            let risk_check_hash = decode_payload_hash(&req.envelope.payload, "riskCheckHash")?;
            let reason = strict_optional_text(&req.envelope.payload, "reason", 160)?;
            encode_agent_trade_approval(
                &AgentTradeApprovalInput {
                    common,
                    agent_id: agent_id.as_bytes(),
                    venue: venue.as_bytes(),
                    market: market.as_bytes(),
                    side: side.as_bytes(),
                    asset_id: asset_id.as_bytes(),
                    max_notional_raw,
                    max_leverage_x100,
                    session_id: session_id.as_bytes(),
                    route: route.as_bytes(),
                    risk_check_hash,
                    reason: reason.as_bytes(),
                },
                &mut canonical_bytes,
            )
            .map_err(signing_error)?
        }
        ClearSignActionKind::AgentSessionGrant => {
            let session_id = strict_required_text(&req.envelope.payload, "sessionId", 96)?;
            let agent_id = strict_required_text(&req.envelope.payload, "agentId", 96)?;
            let venue = strict_required_text(&req.envelope.payload, "venue", 96)?;
            let market = strict_required_text(&req.envelope.payload, "market", 96)?;
            let max_notional = strict_required_text(&req.envelope.payload, "maxNotionalUsd", 64)?;
            let max_notional_raw = decimal_to_raw(&max_notional, 6)?;
            let max_leverage = strict_required_text(&req.envelope.payload, "maxLeverage", 32)?;
            let max_leverage_x100 = leverage_to_x100(&max_leverage)?;
            let session_expires_at = payload_i64(&req.envelope.payload, "expiresAt")?;
            let status = payload_status(
                &req.envelope.payload,
                "status",
                &[("active", 1), ("revoked", 2)],
            )?;
            let reason = strict_optional_text(&req.envelope.payload, "reason", 160)?;
            encode_agent_session(
                &AgentSessionInput {
                    common,
                    session_id: session_id.as_bytes(),
                    agent_id: agent_id.as_bytes(),
                    venue: venue.as_bytes(),
                    market: market.as_bytes(),
                    max_notional_raw,
                    max_leverage_x100,
                    session_expires_at,
                    status,
                    reason: reason.as_bytes(),
                },
                &mut canonical_bytes,
            )
            .map_err(signing_error)?
        }
        ClearSignActionKind::AgentRiskPolicy => {
            let session_id = strict_required_text(&req.envelope.payload, "sessionId", 96)?;
            let oracle_policy_hash =
                decode_payload_hash(&req.envelope.payload, "oraclePolicyHash")?;
            let max_loss_raw = payload_u128(&req.envelope.payload, "maxLossRaw")?;
            let status = payload_status(
                &req.envelope.payload,
                "status",
                &[("active", 1), ("paused", 2)],
            )?;
            let reason = strict_optional_text(&req.envelope.payload, "reason", 160)?;
            encode_agent_risk_policy(
                &AgentRiskPolicyInput {
                    common,
                    session_id: session_id.as_bytes(),
                    oracle_policy_hash,
                    max_loss_raw,
                    status,
                    reason: reason.as_bytes(),
                },
                &mut canonical_bytes,
            )
            .map_err(signing_error)?
        }
        ClearSignActionKind::AgentTradeSettlement => {
            let session_id = strict_required_text(&req.envelope.payload, "sessionId", 96)?;
            let execution_id = strict_required_text(&req.envelope.payload, "executionId", 96)?;
            let settlement_artifact_hash =
                decode_payload_hash(&req.envelope.payload, "settlementArtifactHash")?;
            let oracle_policy_hash =
                decode_payload_hash(&req.envelope.payload, "oraclePolicyHash")?;
            let closed_notional_raw = payload_u128(&req.envelope.payload, "closedNotionalRaw")?;
            let outcome = payload_status(
                &req.envelope.payload,
                "outcome",
                &[("profit", 1), ("loss", 2), ("flat", 3)],
            )?;
            let pnl_abs_raw = payload_u128(&req.envelope.payload, "pnlAbsRaw")?;
            let settlement_sequence =
                payload_u64_strict(&req.envelope.payload, "settlementSequence")?;
            let reason = strict_optional_text(&req.envelope.payload, "reason", 160)?;
            encode_agent_settlement(
                &AgentSettlementInput {
                    common,
                    session_id: session_id.as_bytes(),
                    execution_id: execution_id.as_bytes(),
                    settlement_artifact_hash,
                    oracle_policy_hash,
                    closed_notional_raw,
                    outcome,
                    pnl_abs_raw,
                    settlement_sequence,
                    reason: reason.as_bytes(),
                },
                &mut canonical_bytes,
            )
            .map_err(signing_error)?
        }
        ClearSignActionKind::RecurringSchedule => {
            if trusted.chain_kind != 0 {
                return Err(ApiError::BadRequest(
                    "recurring schedules currently require a Solana intent".into(),
                ));
            }
            let row = owned_transfer_row(&req.envelope.payload)?;
            if row.recipient_encoding != IdentityEncoding::SolanaPubkey {
                return Err(ApiError::BadRequest(
                    "recurring schedules require a Solana recipient address".into(),
                ));
            }
            let native_sol = row.asset_encoding == IdentityEncoding::Text
                && row.asset == b"SOL"
                && row.decimals == 9
                && row.display_asset == "SOL";
            let usdc_mint = decode_base58_32(SOLANA_DEVNET_USDC_MINT, "USDC mint")?;
            let spl_usdc = row.asset_encoding == IdentityEncoding::SolanaPubkey
                && row.asset.as_slice() == usdc_mint
                && row.decimals == 6
                && row.display_asset == "USDC";
            if !native_sol && !spl_usdc {
                return Err(ApiError::BadRequest(
                    "recurring schedules support SOL or issuer-published Solana devnet USDC".into(),
                ));
            }
            let recurring_execution_commitment = if spl_usdc {
                let source = decode_base58_32(
                    &strict_required_text(&req.envelope.payload, "sourceToken", 64)?,
                    "payload.sourceToken",
                )?;
                let destination = decode_base58_32(
                    &strict_required_text(&req.envelope.payload, "destinationToken", 64)?,
                    "payload.destinationToken",
                )?;
                execution_commitment(&[b"spl_recurring_payment", &usdc_mint, &source, &destination])
            } else {
                [0u8; 32]
            };
            let schedule_id = strict_required_text(&req.envelope.payload, "scheduleId", 96)?;
            validate_replay_label(&schedule_id, "payload.scheduleId")?;
            let interval_seconds = payload_u32(&req.envelope.payload, "intervalSeconds")?;
            let first_execution_at = payload_i64(&req.envelope.payload, "firstExecutionAt")?;
            let payment_count = payload_u32(&req.envelope.payload, "paymentCount")?;
            let status = payload_status(
                &req.envelope.payload,
                "status",
                &[("active", 1), ("revoked", 2)],
            )?;
            let reason = strict_optional_text(&req.envelope.payload, "reason", 160)?;
            let payment = TransferRowInput {
                recipient_encoding: row.recipient_encoding,
                recipient: &row.recipient,
                asset_encoding: row.asset_encoding,
                asset: &row.asset,
                raw_amount: row.raw_amount,
                decimals: row.decimals,
                display_asset: row.display_asset.as_bytes(),
            };
            encode_recurring_schedule(
                &RecurringScheduleInput {
                    common,
                    schedule_id: schedule_id.as_bytes(),
                    payment,
                    execution_commitment: recurring_execution_commitment,
                    interval_seconds,
                    first_execution_at,
                    payment_count,
                    status,
                    reason: reason.as_bytes(),
                },
                &mut canonical_bytes,
            )
            .map_err(signing_error)?
        }
        _ => {
            return Err(ApiError::BadRequest(format!(
                "ClearSign v4 preparation is not yet available for {}",
                req.envelope.kind
            )))
        }
    };

    let canonical_slice = &canonical_bytes[..canonical_len];
    let canonical = parse_intent(canonical_slice).map_err(signing_error)?;
    let mut document = [0u8; MAX_DOCUMENT_BYTES];
    let document_len = render_document(&canonical, trusted.wallet_name.as_bytes(), &mut document)
        .map_err(signing_error)?;
    let document = &document[..document_len];
    let signable_text = core::str::from_utf8(document)
        .map_err(|_| ApiError::Internal("canonical signer document was not UTF-8".into()))?
        .to_string();
    let clear_text_hash = document_hash(document).map_err(signing_error)?;
    let payload_hash = canonical.payload_hash();
    let envelope_hash = envelope_hash(&canonical, trusted.wallet_name.as_bytes(), clear_text_hash)
        .map_err(signing_error)?;
    let headline = signable_text
        .split("\n\nACTION\n")
        .nth(1)
        .and_then(|section| section.lines().next())
        .unwrap_or("Review ClearSig action")
        .to_string();

    Ok(ClearSignV4PrepareResponse {
        version: CLEARSIGN_V4_VERSION,
        kind: req.envelope.kind,
        action_kind_code: kind.code(),
        headline,
        lines: signable_text.lines().map(str::to_string).collect(),
        payload_hash: to_hex(&payload_hash),
        envelope_hash: to_hex(&envelope_hash),
        canonical_intent_hash: to_hex(&canonical.canonical_hash()),
        canonical_intent_hex: to_hex(canonical_slice),
        policy_commitment: to_hex(&trusted_policy_commitment),
        signable_text,
        device_profile: profile_response,
    })
}

fn parse_device_profile(
    request: Option<&DeviceProfileRequest>,
) -> Result<(DeviceProfile, V4DeviceProfileResponse), ApiError> {
    let resolved = resolve_device_profile(request)?;
    Ok(match resolved.mode {
        RenderMode::Full => (
            DeviceProfile::Full,
            V4DeviceProfileResponse {
                id: "clearsig-full-v2",
                version: 1,
                mode: "full",
                max_document_bytes: DeviceProfile::Full.max_document_bytes(),
            },
        ),
        RenderMode::Compact => (
            DeviceProfile::LedgerSolana,
            V4DeviceProfileResponse {
                id: "clearsig-ledger-solana-v2",
                version: 1,
                mode: "compact",
                max_document_bytes: DeviceProfile::LedgerSolana.max_document_bytes(),
            },
        ),
    })
}

fn parse_network(value: &str, chain_kind: u8) -> Result<Network, ApiError> {
    match (normalize_text(value).as_str(), chain_kind) {
        ("Solana devnet" | "Solana Devnet", 0) => Ok(Network::SolanaDevnet),
        ("Ethereum Sepolia", 1) => Ok(Network::EthereumSepolia),
        ("Ethereum Sepolia" | "Ethereum Sepolia ERC-20", 4) => Ok(Network::EthereumSepoliaErc20),
        ("Bitcoin testnet" | "Bitcoin Testnet", 2) => Ok(Network::BitcoinTestnet),
        ("Bitcoin signet" | "Bitcoin Signet", 2) => Ok(Network::BitcoinSignet),
        ("Bitcoin testnet4" | "Bitcoin Testnet4", 2) => Ok(Network::BitcoinTestnet4),
        ("Zcash testnet" | "Zcash Testnet", 3) => Ok(Network::ZcashTestnet),
        ("Hyperliquid testnet" | "Hyperliquid Testnet", 5) => Ok(Network::HyperliquidTestnet),
        _ => Err(ApiError::BadRequest(
            "network must be registered for the selected onchain chain kind".into(),
        )),
    }
}

fn identity_encoding(value: RecipientEncoding) -> IdentityEncoding {
    match value {
        RecipientEncoding::Text => IdentityEncoding::Text,
        RecipientEncoding::SolanaPubkey => IdentityEncoding::SolanaPubkey,
        RecipientEncoding::Sha256Text => IdentityEncoding::Sha256Text,
    }
}

fn owned_transfer_row(payload: &Value) -> Result<OwnedTransferRow, ApiError> {
    let row = recipient_amount(payload)?;
    let recipient_encoding = identity_encoding(row.recipient_encoding);
    let recipient = match recipient_encoding {
        IdentityEncoding::SolanaPubkey => {
            decode_base58_32(&row.recipient, "payload.recipient")?.to_vec()
        }
        IdentityEncoding::Text | IdentityEncoding::Sha256Text => row.recipient.into_bytes(),
    };
    let asset_encoding = asset_encoding(row.money.asset_encoding);
    let asset = match asset_encoding {
        IdentityEncoding::SolanaPubkey => {
            decode_base58_32(&row.money.asset, "payload.asset")?.to_vec()
        }
        IdentityEncoding::Text | IdentityEncoding::Sha256Text => row.money.asset.into_bytes(),
    };
    Ok(OwnedTransferRow {
        recipient_encoding,
        recipient,
        asset_encoding,
        asset,
        raw_amount: row.money.raw_amount,
        decimals: u8::try_from(row.money.decimals)
            .map_err(|_| ApiError::BadRequest("payload.decimals must fit in one byte".into()))?,
        display_asset: row.money.display_asset,
    })
}

fn owned_fiat_estimate(payload: &Value, now: i64) -> Result<Option<OwnedFiatEstimate>, ApiError> {
    let Some(value) = payload.get("fiatEstimate") else {
        return Ok(None);
    };
    let object = value
        .as_object()
        .ok_or_else(|| ApiError::BadRequest("payload.fiatEstimate must be an object".into()))?;
    if object.get("informationalOnly").and_then(Value::as_bool) != Some(true) {
        return Err(ApiError::BadRequest(
            "payload.fiatEstimate.informationalOnly must be true".into(),
        ));
    }
    let amount = strict_required_text(value, "amount", 32)?;
    if decimal_to_raw(&amount, 2)? == 0 {
        return Err(ApiError::BadRequest(
            "payload.fiatEstimate.amount must be positive".into(),
        ));
    }
    let currency = strict_required_text(value, "currency", 8)?;
    if currency != "USD" {
        return Err(ApiError::BadRequest(
            "payload.fiatEstimate.currency must be USD".into(),
        ));
    }
    let source = strict_required_text(value, "source", 64)?;
    let observed_at = object
        .get("observedAt")
        .and_then(Value::as_i64)
        .ok_or_else(|| {
            ApiError::BadRequest("payload.fiatEstimate.observedAt must be Unix seconds".into())
        })?;
    if observed_at < now - MAX_FIAT_ESTIMATE_AGE_SECONDS
        || observed_at > now + MAX_FIAT_ESTIMATE_FUTURE_SKEW_SECONDS
    {
        return Err(ApiError::BadRequest(
            "payload.fiatEstimate is stale or from the future".into(),
        ));
    }
    Ok(Some(OwnedFiatEstimate {
        amount,
        currency,
        source,
        observed_at,
    }))
}

fn action_kind(kind: ClearSignActionKind) -> ActionKind {
    match kind {
        ClearSignActionKind::AddMember => ActionKind::AddMember,
        ClearSignActionKind::RemoveMember => ActionKind::RemoveMember,
        ClearSignActionKind::ChangeThreshold => ActionKind::ChangeThreshold,
        _ => unreachable!("caller restricts governance kinds"),
    }
}

#[cfg(test)]
#[path = "v4_tests.rs"]
mod tests;
