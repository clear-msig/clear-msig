use clear_msig_command_contract::{TypedExecutionContext, TypedProposalLifecycle};
use clear_msig_signing::{
    document_hash as v4_document_hash, envelope_hash as v4_envelope_hash,
    parse_intent as parse_v4_intent, policy_commitment as v4_policy_commitment,
    render_document as render_v4_document, replay_hash,
    wallet_policy_commitment as v4_wallet_policy_commitment, Action as V4Action,
    MAX_CANONICAL_INTENT_BYTES, MAX_DOCUMENT_BYTES,
};

use crate::{ensure_base58, ensure_hex, ensure_non_empty, ensure_wallet_name, ApiError};

use super::types::{
    PrepareApproveCancelRequest, PrepareTypedProposalCreateRequest, SignedApproveCancelRequest,
    SignedTypedProposalCreateRequest,
};
use super::validation::validate_typed_create_fields;

pub(super) struct LifecycleInvocation {
    pub(super) context: TypedExecutionContext,
    pub(super) lifecycle: TypedProposalLifecycle,
    pub(super) rate_limit_key: Option<String>,
}

#[derive(Clone, Copy)]
pub(super) enum VoteKind {
    Approve,
    Cancel,
}

pub(super) fn signed_create(
    wallet: String,
    body: SignedTypedProposalCreateRequest,
) -> Result<LifecycleInvocation, ApiError> {
    ensure_wallet_name(&wallet, "name")?;
    validate_typed_create_fields(
        body.action_kind,
        &body.policy_commitment,
        &body.payload_hash,
        &body.envelope_hash,
        &body.action_id,
        &body.nonce,
    )?;
    body.pre_signed.ensure_valid()?;
    if body.canonical_intent_hex.is_none() {
        return Err(ApiError::BadRequest(
            "new typed proposals require canonical ClearSign v4 intent bytes".into(),
        ));
    }
    let expected_flavor = "clearsign_v4_document";
    if body.pre_signed.message_flavor.as_deref() != Some(expected_flavor) {
        return Err(ApiError::BadRequest(format!(
            "typed proposal requires message flavor {expected_flavor}"
        )));
    }
    let signed_message = body.pre_signed.signed_message_hex.clone().ok_or_else(|| {
        ApiError::BadRequest("signed_message_hex is required for typed proposal create".into())
    })?;
    ensure_bounded_value(&signed_message, "signed_message_hex")?;
    validate_optional_hex(body.policy_bytes_hex.as_deref(), "policyBytesHex")?;
    if let Some(canonical) = body.canonical_intent_hex.as_deref() {
        validate_v4_assertions(
            &wallet,
            canonical,
            body.action_kind,
            &body.policy_commitment,
            &body.payload_hash,
            &body.envelope_hash,
            &body.action_id,
            &body.nonce,
            body.policy_bytes_hex.as_deref(),
        )?;
    }
    let rate_limit_key = body.pre_signed.signer_pubkey.clone();
    Ok(LifecycleInvocation {
        context: TypedExecutionContext::PreSigned {
            signer_pubkey: body.pre_signed.signer_pubkey,
            signature: body.pre_signed.signature,
            message_flavor: body.pre_signed.message_flavor,
            signed_message,
        },
        lifecycle: TypedProposalLifecycle::Create {
            wallet,
            intent_index: body.intent_index,
            action_kind: body.action_kind,
            policy_commitment: body.policy_commitment,
            payload_hash: body.payload_hash,
            envelope_hash: body.envelope_hash,
            action_id: body.action_id,
            nonce: body.nonce,
            policy_bytes_hex: body.policy_bytes_hex,
            signable_text: None,
            canonical_intent_hex: body.canonical_intent_hex,
            expiry: Some(crate::clearsign::format_expiry(body.pre_signed.expiry)?),
        },
        rate_limit_key: Some(rate_limit_key),
    })
}

pub(super) fn prepare_create(
    wallet: String,
    body: PrepareTypedProposalCreateRequest,
) -> Result<LifecycleInvocation, ApiError> {
    ensure_wallet_name(&wallet, "name")?;
    if body.canonical_intent_hex.is_none() {
        return Err(ApiError::BadRequest(
            "new typed proposals require canonical ClearSign v4 intent bytes".into(),
        ));
    }
    validate_typed_create_fields(
        body.action_kind,
        &body.policy_commitment,
        &body.payload_hash,
        &body.envelope_hash,
        &body.action_id,
        &body.nonce,
    )?;
    if let Some(canonical) = body.canonical_intent_hex.as_deref() {
        validate_v4_assertions(
            &wallet,
            canonical,
            body.action_kind,
            &body.policy_commitment,
            &body.payload_hash,
            &body.envelope_hash,
            &body.action_id,
            &body.nonce,
            body.policy_bytes_hex.as_deref(),
        )?;
        validate_v4_signable_text(&wallet, canonical, &body.signable_text)?;
    }
    validate_optional_hex(body.policy_bytes_hex.as_deref(), "policyBytesHex")?;
    let actor_pubkey = validate_actor(body.actor_pubkey)?;
    Ok(LifecycleInvocation {
        context: TypedExecutionContext::DryRun { actor_pubkey },
        lifecycle: TypedProposalLifecycle::Create {
            wallet,
            intent_index: body.intent_index,
            action_kind: body.action_kind,
            policy_commitment: body.policy_commitment,
            payload_hash: body.payload_hash,
            envelope_hash: body.envelope_hash,
            action_id: body.action_id,
            nonce: body.nonce,
            policy_bytes_hex: body.policy_bytes_hex,
            signable_text: Some(body.signable_text),
            canonical_intent_hex: body.canonical_intent_hex,
            expiry: body
                .expiry
                .map(|value| crate::clearsign::normalize_expiry_arg(&value))
                .transpose()?,
        },
        rate_limit_key: None,
    })
}

pub(super) fn signed_vote(
    wallet: String,
    proposal: String,
    body: SignedApproveCancelRequest,
    vote: VoteKind,
) -> Result<LifecycleInvocation, ApiError> {
    ensure_wallet_proposal(&wallet, &proposal)?;
    body.pre_signed.ensure_valid()?;
    let signed_message = body.pre_signed.signed_message_hex.clone().ok_or_else(|| {
        ApiError::BadRequest("signed_message_hex is required for typed proposal vote".into())
    })?;
    ensure_bounded_value(&signed_message, "signed_message_hex")?;
    let rate_limit_key = body.pre_signed.signer_pubkey.clone();
    Ok(LifecycleInvocation {
        context: TypedExecutionContext::PreSigned {
            signer_pubkey: body.pre_signed.signer_pubkey,
            signature: body.pre_signed.signature,
            message_flavor: body.pre_signed.message_flavor,
            signed_message,
        },
        lifecycle: vote_lifecycle(wallet, proposal, vote),
        rate_limit_key: Some(rate_limit_key),
    })
}

pub(super) fn prepare_vote(
    wallet: String,
    proposal: String,
    body: PrepareApproveCancelRequest,
    vote: VoteKind,
) -> Result<LifecycleInvocation, ApiError> {
    ensure_wallet_proposal(&wallet, &proposal)?;
    let actor_pubkey = validate_actor(body.actor_pubkey)?;
    Ok(LifecycleInvocation {
        context: TypedExecutionContext::DryRun { actor_pubkey },
        lifecycle: vote_lifecycle(wallet, proposal, vote),
        rate_limit_key: None,
    })
}

pub(super) fn execute(wallet: String, proposal: String) -> Result<LifecycleInvocation, ApiError> {
    ensure_wallet_proposal(&wallet, &proposal)?;
    Ok(LifecycleInvocation {
        context: TypedExecutionContext::Backend,
        lifecycle: TypedProposalLifecycle::Execute { wallet, proposal },
        rate_limit_key: None,
    })
}

fn vote_lifecycle(wallet: String, proposal: String, vote: VoteKind) -> TypedProposalLifecycle {
    match vote {
        VoteKind::Approve => TypedProposalLifecycle::Approve { wallet, proposal },
        VoteKind::Cancel => TypedProposalLifecycle::Cancel { wallet, proposal },
    }
}

fn ensure_wallet_proposal(wallet: &str, proposal: &str) -> Result<(), ApiError> {
    ensure_wallet_name(wallet, "name")?;
    ensure_base58(proposal, "proposal", 32, 88)
}

fn validate_actor(actor_pubkey: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(actor_pubkey) = actor_pubkey else {
        return Ok(None);
    };
    let actor_pubkey = actor_pubkey.trim().to_string();
    if actor_pubkey.is_empty() {
        return Ok(None);
    }
    ensure_base58(&actor_pubkey, "actor_pubkey", 32, 44)?;
    Ok(Some(actor_pubkey))
}

fn validate_optional_hex(value: Option<&str>, field: &str) -> Result<(), ApiError> {
    if let Some(value) = value {
        ensure_bounded_value(value, field)?;
        ensure_hex(value, field)?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_v4_assertions(
    wallet_name: &str,
    canonical_hex: &str,
    action_kind: u8,
    policy_commitment: &str,
    payload_hash: &str,
    envelope_hash: &str,
    action_id: &str,
    nonce: &str,
    policy_bytes_hex: Option<&str>,
) -> Result<(), ApiError> {
    let canonical_bytes = decode_hex(canonical_hex, "canonicalIntentHex")?;
    if canonical_bytes.len() > MAX_CANONICAL_INTENT_BYTES {
        return Err(ApiError::BadRequest(format!(
            "canonicalIntentHex must encode at most {MAX_CANONICAL_INTENT_BYTES} bytes"
        )));
    }
    let canonical = parse_v4_intent(&canonical_bytes).map_err(|_| {
        ApiError::BadRequest("canonicalIntentHex is malformed or unsupported".into())
    })?;
    let asserted_policy = decode_hex_32(policy_commitment, "policy_commitment")?;
    let asserted_payload = decode_hex_32(payload_hash, "payload_hash")?;
    let asserted_envelope = decode_hex_32(envelope_hash, "envelope_hash")?;
    let policy_bytes = decode_hex(policy_bytes_hex.unwrap_or(""), "policyBytesHex")?;
    let submitted_policy_commitment = v4_policy_commitment(&policy_bytes);
    let policy_bytes_match = match canonical.action {
        V4Action::PolicyUpdate(policy) => {
            policy.new_policy_commitment == v4_wallet_policy_commitment(&policy_bytes)
        }
        V4Action::AssetPolicyUpdate(policy) => {
            policy.new_policy_commitment == v4_wallet_policy_commitment(&policy_bytes)
        }
        _ => canonical.common.policy_commitment == submitted_policy_commitment,
    };
    let mut rendered = [0u8; MAX_DOCUMENT_BYTES];
    let rendered_len = render_v4_document(&canonical, wallet_name.as_bytes(), &mut rendered)
        .map_err(|_| ApiError::BadRequest("canonical intent cannot be rendered safely".into()))?;
    let clear_text_hash = v4_document_hash(&rendered[..rendered_len])
        .map_err(|_| ApiError::BadRequest("canonical intent document is invalid".into()))?;
    let derived_envelope = v4_envelope_hash(&canonical, wallet_name.as_bytes(), clear_text_hash)
        .map_err(|_| ApiError::BadRequest("canonical intent envelope is invalid".into()))?;

    if canonical.kind().code() != action_kind
        || canonical.common.policy_commitment != asserted_policy
        || !policy_bytes_match
        || canonical.payload_hash() != asserted_payload
        || derived_envelope != asserted_envelope
        || canonical.common.action_id != replay_hash(action_id.as_bytes())
        || canonical.common.nonce != replay_hash(nonce.as_bytes())
    {
        return Err(ApiError::BadRequest(
            "canonical intent does not match typed proposal assertions".into(),
        ));
    }
    Ok(())
}

fn validate_v4_signable_text(
    wallet_name: &str,
    canonical_hex: &str,
    signable_text: &str,
) -> Result<(), ApiError> {
    let canonical_bytes = decode_hex(canonical_hex, "canonicalIntentHex")?;
    let canonical = parse_v4_intent(&canonical_bytes).map_err(|_| {
        ApiError::BadRequest("canonicalIntentHex is malformed or unsupported".into())
    })?;
    let mut rendered = [0u8; MAX_DOCUMENT_BYTES];
    let rendered_len = render_v4_document(&canonical, wallet_name.as_bytes(), &mut rendered)
        .map_err(|_| ApiError::BadRequest("canonical intent cannot be rendered safely".into()))?;
    if signable_text.as_bytes() != &rendered[..rendered_len] {
        return Err(ApiError::BadRequest(
            "signable_text does not match the canonical v4 intent".into(),
        ));
    }
    Ok(())
}

fn decode_hex(value: &str, field: &str) -> Result<Vec<u8>, ApiError> {
    let value = value.trim().strip_prefix("0x").unwrap_or(value.trim());
    if !value.len().is_multiple_of(2) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ApiError::BadRequest(format!("{field} must be hex encoded")));
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|chunk| {
            let pair = core::str::from_utf8(chunk)
                .map_err(|_| ApiError::BadRequest(format!("{field} must be hex encoded")))?;
            u8::from_str_radix(pair, 16)
                .map_err(|_| ApiError::BadRequest(format!("{field} must be hex encoded")))
        })
        .collect()
}

fn decode_hex_32(value: &str, field: &str) -> Result<[u8; 32], ApiError> {
    decode_hex(value, field)?
        .try_into()
        .map_err(|_| ApiError::BadRequest(format!("{field} must encode exactly 32 bytes")))
}

fn ensure_bounded_value(value: &str, field: &str) -> Result<(), ApiError> {
    ensure_non_empty(value, field)?;
    if value.len() > 16 * 1024 {
        return Err(ApiError::BadRequest(format!(
            "{field} must be 16384 bytes or fewer"
        )));
    }
    if value.contains('\0') {
        return Err(ApiError::BadRequest(format!(
            "{field} must not contain NUL bytes"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clearsign::PreSigned;
    use clear_msig_signing::{
        encode_transfer, CommonFields, DeviceProfile, IdentityEncoding, Network, TransferInput,
    };

    fn hex_bytes(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn canonical_transfer_assertions(wallet_name: &str) -> (String, u8, String, String, String) {
        let policy = v4_policy_commitment(&[]);
        let mut encoded = [0u8; MAX_CANONICAL_INTENT_BYTES];
        let encoded_len = encode_transfer(
            &TransferInput {
                common: CommonFields {
                    profile: DeviceProfile::Full,
                    network: Network::SolanaDevnet,
                    proposal_index: 7,
                    wallet_id: [1; 32],
                    actor: [2; 32],
                    action_id: replay_hash(b"action"),
                    nonce: replay_hash(b"nonce"),
                    expires_at: crate::current_unix_timestamp().unwrap() + 300,
                    policy_commitment: policy,
                    approval_required: 2,
                },
                recipient_encoding: IdentityEncoding::SolanaPubkey,
                recipient: &[3; 32],
                asset_encoding: IdentityEncoding::Text,
                asset: b"SOL",
                raw_amount: 300_000_000,
                decimals: 9,
                display_asset: b"SOL",
                execution_commitment: [0; 32],
                fiat_estimate: None,
                reason: b"Treasury payment",
            },
            &mut encoded,
        )
        .unwrap();
        let canonical = parse_v4_intent(&encoded[..encoded_len]).unwrap();
        let mut rendered = [0u8; MAX_DOCUMENT_BYTES];
        let rendered_len =
            render_v4_document(&canonical, wallet_name.as_bytes(), &mut rendered).unwrap();
        let clear_text_hash = v4_document_hash(&rendered[..rendered_len]).unwrap();
        let envelope =
            v4_envelope_hash(&canonical, wallet_name.as_bytes(), clear_text_hash).unwrap();
        (
            hex_bytes(&encoded[..encoded_len]),
            canonical.kind().code(),
            hex_bytes(&policy),
            hex_bytes(&canonical.payload_hash()),
            hex_bytes(&envelope),
        )
    }

    #[test]
    fn prepare_vote_rejects_invalid_actor_before_execution() {
        let result = prepare_vote(
            "team".into(),
            "11111111111111111111111111111111".into(),
            PrepareApproveCancelRequest {
                expiry: None,
                actor_pubkey: Some("not-a-pubkey".into()),
            },
            VoteKind::Approve,
        );
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn prepare_create_rejects_missing_canonical_v4_bytes() {
        let result = prepare_create(
            "team".into(),
            PrepareTypedProposalCreateRequest {
                intent_index: 1,
                action_kind: 1,
                policy_commitment: "00".repeat(32),
                payload_hash: "00".repeat(32),
                envelope_hash: "00".repeat(32),
                action_id: "action".into(),
                nonce: "nonce".into(),
                policy_bytes_hex: None,
                canonical_intent_hex: None,
                signable_text: "ClearSig Approval".into(),
                expiry: None,
                actor_pubkey: None,
            },
        );
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn prepare_create_rejects_legacy_v2_and_v3_documents() {
        let legacy = prepare_create(
            "team".into(),
            PrepareTypedProposalCreateRequest {
                intent_index: 1,
                action_kind: 1,
                policy_commitment: "00".repeat(32),
                payload_hash: "00".repeat(32),
                envelope_hash: "00".repeat(32),
                action_id: "action".into(),
                nonce: "nonce".into(),
                policy_bytes_hex: None,
                canonical_intent_hex: None,
                signable_text: "ClearSign v2\nWallet Team\nSend 1 SOL".into(),
                expiry: None,
                actor_pubkey: None,
            },
        );
        assert!(matches!(legacy, Err(ApiError::BadRequest(_))));

        let v3 = prepare_create(
            "team".into(),
            PrepareTypedProposalCreateRequest {
                intent_index: 1,
                action_kind: 1,
                policy_commitment: "00".repeat(32),
                payload_hash: "00".repeat(32),
                envelope_hash: "00".repeat(32),
                action_id: "action".into(),
                nonce: "nonce".into(),
                policy_bytes_hex: None,
                canonical_intent_hex: None,
                signable_text: "ClearSig Proposal\n\nACTION\nSend 1 SOL".into(),
                expiry: None,
                actor_pubkey: None,
            },
        );
        assert!(matches!(v3, Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn signed_create_rejects_v3_even_with_a_valid_signature_shape() {
        let expiry = crate::current_unix_timestamp().unwrap() + 300;
        let result = signed_create(
            "team".into(),
            SignedTypedProposalCreateRequest {
                intent_index: 1,
                action_kind: 1,
                policy_commitment: "00".repeat(32),
                payload_hash: "00".repeat(32),
                envelope_hash: "00".repeat(32),
                action_id: "action".into(),
                nonce: "nonce".into(),
                policy_bytes_hex: None,
                canonical_intent_hex: None,
                pre_signed: PreSigned {
                    signer_pubkey: "11111111111111111111111111111111".into(),
                    signature: "00".repeat(64),
                    message_flavor: Some("clearsign_v3_document".into()),
                    params_data_hex: None,
                    signed_message_hex: Some("00".into()),
                    expiry,
                },
            },
        );
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn signed_create_accepts_the_canonical_v4_message_flavor() {
        let (canonical, action_kind, policy, payload, envelope) =
            canonical_transfer_assertions("team");
        let canonical_bytes = decode_hex(&canonical, "canonicalIntentHex").unwrap();
        let expiry = parse_v4_intent(&canonical_bytes).unwrap().common.expires_at;
        let result = signed_create(
            "team".into(),
            SignedTypedProposalCreateRequest {
                intent_index: 1,
                action_kind,
                policy_commitment: policy,
                payload_hash: payload,
                envelope_hash: envelope,
                action_id: "action".into(),
                nonce: "nonce".into(),
                policy_bytes_hex: None,
                canonical_intent_hex: Some(canonical),
                pre_signed: PreSigned {
                    signer_pubkey: "11111111111111111111111111111111".into(),
                    signature: "00".repeat(64),
                    message_flavor: Some("clearsign_v4_document".into()),
                    params_data_hex: None,
                    signed_message_hex: Some("00".into()),
                    expiry,
                },
            },
        );

        assert!(result.is_ok());
    }

    #[test]
    fn signed_create_rejects_a_legacy_v2_message_flavor() {
        let expiry = crate::current_unix_timestamp().unwrap() + 300;
        let result = signed_create(
            "team".into(),
            SignedTypedProposalCreateRequest {
                intent_index: 1,
                action_kind: 1,
                policy_commitment: "00".repeat(32),
                payload_hash: "00".repeat(32),
                envelope_hash: "00".repeat(32),
                action_id: "action".into(),
                nonce: "nonce".into(),
                policy_bytes_hex: None,
                canonical_intent_hex: None,
                pre_signed: PreSigned {
                    signer_pubkey: "11111111111111111111111111111111".into(),
                    signature: "00".repeat(64),
                    message_flavor: Some("clearsign_v2_text".into()),
                    params_data_hex: None,
                    signed_message_hex: Some("00".into()),
                    expiry,
                },
            },
        );

        assert!(matches!(
            result,
            Err(ApiError::BadRequest(message)) if message.contains("canonical ClearSign v4")
        ));
    }

    #[test]
    fn v4_assertions_recompute_and_bind_the_envelope() {
        let (canonical, kind, policy, payload, envelope) = canonical_transfer_assertions("team");
        validate_v4_assertions(
            "team", &canonical, kind, &policy, &payload, &envelope, "action", "nonce", None,
        )
        .unwrap();

        let result = validate_v4_assertions(
            "team",
            &canonical,
            kind,
            &policy,
            &payload,
            &"00".repeat(32),
            "action",
            "nonce",
            None,
        );
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }
}
