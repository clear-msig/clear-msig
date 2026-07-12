use crate::commands::proposal::ProposalAction;
use crate::config::CliGlobals;
use crate::{Command, ExecutionRequest};
use clear_msig_command_contract::{TypedExecutionContext, TypedProposalLifecycle};

impl From<TypedProposalLifecycle> for ProposalAction {
    fn from(value: TypedProposalLifecycle) -> Self {
        match value {
            TypedProposalLifecycle::Create {
                wallet,
                intent_index,
                action_kind,
                policy_commitment,
                payload_hash,
                envelope_hash,
                action_id,
                nonce,
                policy_bytes_hex,
                signable_text,
                expiry,
            } => Self::TypedCreate {
                wallet,
                intent_index,
                action_kind,
                policy_commitment,
                payload_hash,
                envelope_hash,
                action_id,
                nonce,
                policy_bytes_hex,
                signable_text,
                expiry,
            },
            TypedProposalLifecycle::Approve { wallet, proposal } => {
                Self::TypedApprove { wallet, proposal }
            }
            TypedProposalLifecycle::Cancel { wallet, proposal } => {
                Self::TypedCancel { wallet, proposal }
            }
            TypedProposalLifecycle::Execute { wallet, proposal } => {
                Self::TypedExecute { wallet, proposal }
            }
        }
    }
}

pub fn prepare_typed_proposal_lifecycle(
    mut globals: CliGlobals,
    context: TypedExecutionContext,
    lifecycle: TypedProposalLifecycle,
) -> Result<ExecutionRequest, String> {
    lifecycle.validate_boundary()?;
    context.validate_boundary()?;
    apply_context(&mut globals, context)?;
    Ok(ExecutionRequest {
        globals,
        command: Command::Proposal {
            action: lifecycle.into(),
        },
        control: Default::default(),
    })
}

fn apply_context(globals: &mut CliGlobals, context: TypedExecutionContext) -> Result<(), String> {
    if globals.dry_run
        || globals.signer_pubkey.is_some()
        || globals.signature.is_some()
        || globals.message_flavor.is_some()
        || globals.signed_message.is_some()
    {
        return Err("base execution globals already contain signer context".into());
    }
    match context {
        TypedExecutionContext::Backend => {}
        TypedExecutionContext::DryRun { actor_pubkey } => {
            globals.dry_run = true;
            globals.signer_pubkey = actor_pubkey;
        }
        TypedExecutionContext::PreSigned {
            signer_pubkey,
            signature,
            message_flavor,
            signed_message,
        } => {
            globals.signer_pubkey = Some(signer_pubkey);
            globals.signature = Some(signature);
            globals.message_flavor = message_flavor;
            globals.signed_message = Some(signed_message);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{apply_context, prepare_typed_proposal_lifecycle};
    use crate::commands::proposal::ProposalAction;
    use crate::config::CliGlobals;
    use clear_msig_command_contract::{TypedExecutionContext, TypedProposalLifecycle};

    #[test]
    fn contexts_are_mutually_exclusive() {
        let globals = CliGlobals {
            signer_pubkey: Some("existing".into()),
            ..Default::default()
        };
        let result = prepare_typed_proposal_lifecycle(
            globals,
            TypedExecutionContext::DryRun { actor_pubkey: None },
            TypedProposalLifecycle::Execute {
                wallet: "team".into(),
                proposal: "proposal".into(),
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn presigned_context_projects_every_signature_field() {
        let mut globals = CliGlobals::default();
        apply_context(
            &mut globals,
            TypedExecutionContext::PreSigned {
                signer_pubkey: "signer".into(),
                signature: "signature".into(),
                message_flavor: Some("clearsign_v2_text".into()),
                signed_message: "message".into(),
            },
        )
        .unwrap();
        assert_eq!(globals.signer_pubkey.as_deref(), Some("signer"));
        assert_eq!(globals.signature.as_deref(), Some("signature"));
        assert_eq!(globals.message_flavor.as_deref(), Some("clearsign_v2_text"));
        assert_eq!(globals.signed_message.as_deref(), Some("message"));
        assert!(!globals.dry_run);
    }

    #[test]
    fn dry_run_context_carries_actor_without_a_signature() {
        let mut globals = CliGlobals::default();
        apply_context(
            &mut globals,
            TypedExecutionContext::DryRun {
                actor_pubkey: Some("actor".into()),
            },
        )
        .unwrap();
        assert_eq!(globals.signer_pubkey.as_deref(), Some("actor"));
        assert!(globals.signature.is_none());
        assert!(globals.dry_run);
    }

    #[test]
    fn lifecycle_create_maps_every_committed_field() {
        let action: ProposalAction = TypedProposalLifecycle::Create {
            wallet: "team".into(),
            intent_index: 3,
            action_kind: 2,
            policy_commitment: "policy".into(),
            payload_hash: "payload".into(),
            envelope_hash: "envelope".into(),
            action_id: "action".into(),
            nonce: "nonce".into(),
            policy_bytes_hex: Some("00".into()),
            signable_text: Some("readable".into()),
            expiry: Some("expiry".into()),
        }
        .into();
        assert!(matches!(
            action,
            ProposalAction::TypedCreate {
                intent_index: 3,
                action_kind: 2,
                policy_bytes_hex: Some(policy),
                signable_text: Some(text),
                expiry: Some(expiry),
                ..
            } if policy == "00" && text == "readable" && expiry == "expiry"
        ));
    }

    #[test]
    fn lifecycle_boundary_rejects_oversized_readable_text() {
        let result = prepare_typed_proposal_lifecycle(
            CliGlobals::default(),
            TypedExecutionContext::Backend,
            TypedProposalLifecycle::Create {
                wallet: "team".into(),
                intent_index: 3,
                action_kind: 2,
                policy_commitment: "policy".into(),
                payload_hash: "payload".into(),
                envelope_hash: "envelope".into(),
                action_id: "action".into(),
                nonce: "nonce".into(),
                policy_bytes_hex: None,
                signable_text: Some("x".repeat(16 * 1024 + 1)),
                expiry: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn lifecycle_boundary_preserves_multiline_readable_text() {
        let result = prepare_typed_proposal_lifecycle(
            CliGlobals::default(),
            TypedExecutionContext::DryRun { actor_pubkey: None },
            TypedProposalLifecycle::Create {
                wallet: "team".into(),
                intent_index: 3,
                action_kind: 2,
                policy_commitment: "policy".into(),
                payload_hash: "payload".into(),
                envelope_hash: "envelope".into(),
                action_id: "action".into(),
                nonce: "nonce".into(),
                policy_bytes_hex: None,
                signable_text: Some("ClearSign v2\nWallet Team\nSend 1 SOL".into()),
                expiry: None,
            },
        );
        assert!(result.is_ok());
    }
}
