use clear_msig_command_contract::{TypedExecutionContext, TypedProposalLifecycle};

use crate::{ensure_base58, ensure_hex, ensure_non_empty, ensure_wallet_name, ApiError};

use super::types::{
    PrepareApproveCancelRequest, PrepareTypedProposalCreateRequest, SignedApproveCancelRequest,
    SignedTypedProposalCreateRequest,
};
use super::validation::validate_typed_create_fields;

const CLEARSIGN_V3_DOCUMENT_PREFIX: &str = "ClearSig Proposal\n\nACTION\n";
const MAX_CLEARSIGN_DOCUMENT_BYTES: usize = 2048;
const MAX_CLEARSIGN_LEDGER_DOCUMENT_BYTES: usize = 1024;
const CLEARSIGN_V3_PROFILES: [&str; 2] = [
    "Display profile: clearsig-full-v1@1",
    "Display profile: clearsig-ledger-solana-v1@1",
];

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
    if body.pre_signed.message_flavor.as_deref() != Some("clearsign_v3_document") {
        return Err(ApiError::BadRequest(
            "new typed proposals require a ClearSign v3 document".into(),
        ));
    }
    let signed_message = body.pre_signed.signed_message_hex.clone().ok_or_else(|| {
        ApiError::BadRequest("signed_message_hex is required for typed proposal create".into())
    })?;
    ensure_bounded_value(&signed_message, "signed_message_hex")?;
    validate_optional_hex(body.policy_bytes_hex.as_deref(), "policyBytesHex")?;
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
    validate_typed_create_fields(
        body.action_kind,
        &body.policy_commitment,
        &body.payload_hash,
        &body.envelope_hash,
        &body.action_id,
        &body.nonce,
    )?;
    validate_v3_signable_text(&body.signable_text)?;
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

fn validate_v3_signable_text(value: &str) -> Result<(), ApiError> {
    ensure_non_empty(value, "signable_text")?;
    if value.len() > MAX_CLEARSIGN_DOCUMENT_BYTES {
        return Err(ApiError::BadRequest(
            "signable_text must be 2048 bytes or fewer".into(),
        ));
    }
    if value
        .bytes()
        .any(|byte| (byte < 0x20 && byte != b'\n') || byte == 0x7f)
    {
        return Err(ApiError::BadRequest(
            "signable_text contains unsafe control characters".into(),
        ));
    }
    if !value.starts_with(CLEARSIGN_V3_DOCUMENT_PREFIX) {
        return Err(ApiError::BadRequest(
            "new typed proposals require a ClearSign v3 document".into(),
        ));
    }
    let sections = value.split("\n\n").collect::<Vec<_>>();
    let expected = [
        "ClearSig Proposal",
        "ACTION",
        "DETAILS",
        "POLICY",
        "RISK",
        "PURPOSE",
    ];
    if sections.len() != expected.len()
        || sections.iter().enumerate().any(|(index, section)| {
            if index == 0 {
                *section != expected[index]
            } else {
                !section.starts_with(&format!("{}\n", expected[index]))
                    || section.len() == expected[index].len() + 1
            }
        })
    {
        return Err(ApiError::BadRequest(
            "signable_text has invalid or duplicate ClearSign v3 sections".into(),
        ));
    }
    let policy = sections[3];
    let profile_count = CLEARSIGN_V3_PROFILES
        .iter()
        .map(|profile| value.matches(profile).count())
        .sum::<usize>();
    if profile_count != 1
        || !CLEARSIGN_V3_PROFILES
            .iter()
            .any(|profile| policy.lines().any(|line| line == *profile))
    {
        return Err(ApiError::BadRequest(
            "signable_text must contain exactly one registered ClearSign display profile".into(),
        ));
    }
    if policy.lines().any(|line| line == CLEARSIGN_V3_PROFILES[1])
        && value.len() > MAX_CLEARSIGN_LEDGER_DOCUMENT_BYTES
    {
        return Err(ApiError::BadRequest(
            "Ledger compact signable_text must be 1024 bytes or fewer".into(),
        ));
    }
    Ok(())
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

    const V3_DOCUMENT: &str = "ClearSig Proposal\n\nACTION\nSend 1 SOL\n\nDETAILS\nFrom wallet: Team\nNetwork: Solana devnet\nAmount: 1 SOL\nTo: Sarah\nPayload: 000000000000...000000000000\n\nPOLICY\nApproval: Wallet's onchain threshold must be met\nExecution: Onchain policy and timelock must pass\nCommitment: 000000000000...000000000000\nEnforcement: Exact payload and policy must match onchain\nDisplay profile: clearsig-full-v1@1\n\nRISK\nCategory: Funds movement\nSigner check: Verify amount, asset, network, and every destination\n\nPURPOSE\nPayroll";

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
    fn prepare_create_rejects_oversized_readable_text() {
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
                signable_text: "x".repeat(MAX_CLEARSIGN_DOCUMENT_BYTES + 1),
                expiry: None,
                actor_pubkey: None,
            },
        );
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn prepare_create_rejects_legacy_text_and_accepts_a_v3_document() {
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
                signable_text: "ClearSign v2\nWallet Team\nSend 1 SOL".into(),
                expiry: None,
                actor_pubkey: None,
            },
        );
        assert!(matches!(legacy, Err(ApiError::BadRequest(_))));

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
                signable_text: V3_DOCUMENT.into(),
                expiry: None,
                actor_pubkey: None,
            },
        );
        assert!(result.is_ok());
    }

    #[test]
    fn signed_create_preserves_browser_signature_context_and_expiry() {
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
                pre_signed: PreSigned {
                    signer_pubkey: "11111111111111111111111111111111".into(),
                    signature: "00".repeat(64),
                    message_flavor: Some("clearsign_v3_document".into()),
                    params_data_hex: None,
                    signed_message_hex: Some("00".into()),
                    expiry,
                },
            },
        )
        .unwrap();
        assert!(matches!(
            result.context,
            TypedExecutionContext::PreSigned { signed_message, .. }
                if signed_message == "00"
        ));
        assert!(matches!(
            result.lifecycle,
            TypedProposalLifecycle::Create {
                expiry: Some(value),
                ..
            } if !value.is_empty()
        ));
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
            Err(ApiError::BadRequest(message)) if message.contains("ClearSign v3")
        ));
    }
}
