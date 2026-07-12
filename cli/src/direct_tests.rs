use crate::commands::{intent::IntentAction, proposal::ProposalAction};
use crate::config::CliGlobals;
use crate::{prepare_direct_command, Command, DirectCommand, DirectExecutionContext};

#[test]
fn presigned_context_projects_exact_signed_values() {
    let request = prepare_direct_command(
        CliGlobals::default(),
        DirectExecutionContext::PreSigned {
            signer_pubkey: "signer".into(),
            signature: "signature".into(),
            params_data: Some("params".into()),
            message_flavor: Some("clearsign_v2_text".into()),
            signed_message: Some("message".into()),
        },
        DirectCommand::ProposalApprove {
            wallet: "team".into(),
            proposal: "proposal".into(),
            expiry: Some("123".into()),
        },
    )
    .expect("direct command");

    assert_eq!(request.globals.signer_pubkey.as_deref(), Some("signer"));
    assert_eq!(request.globals.signature.as_deref(), Some("signature"));
    assert_eq!(request.globals.params_data.as_deref(), Some("params"));
    assert_eq!(
        request.globals.message_flavor.as_deref(),
        Some("clearsign_v2_text")
    );
    assert_eq!(request.globals.signed_message.as_deref(), Some("message"));
    match request.command {
        Command::Proposal {
            action:
                ProposalAction::Approve {
                    wallet,
                    proposal,
                    expiry,
                },
        } => {
            assert_eq!(wallet, "team");
            assert_eq!(proposal, "proposal");
            assert_eq!(expiry.as_deref(), Some("123"));
        }
        _ => panic!("expected proposal approve"),
    }
}

#[test]
fn intent_add_projects_policy_fields() {
    let request = prepare_direct_command(
        CliGlobals::default(),
        DirectExecutionContext::DryRun {
            actor_pubkey: Some("actor".into()),
        },
        DirectCommand::IntentAdd {
            wallet: "team".into(),
            file: Some("policy.json".into()),
            proposers: vec!["proposer".into()],
            approvers: vec!["approver".into()],
            threshold: Some(2),
            cancellation_threshold: 1,
            timelock: 30,
            expiry: Some("123".into()),
            policy_ciphertexts: vec!["ciphertext".into()],
        },
    )
    .expect("direct command");

    assert!(request.globals.dry_run);
    assert_eq!(request.globals.signer_pubkey.as_deref(), Some("actor"));
    match request.command {
        Command::Intent {
            action:
                IntentAction::Add {
                    threshold,
                    cancellation_threshold,
                    timelock,
                    policy_ciphertexts,
                    ..
                },
        } => {
            assert_eq!(threshold, Some(2));
            assert_eq!(cancellation_threshold, 1);
            assert_eq!(timelock, 30);
            assert_eq!(policy_ciphertexts, vec!["ciphertext"]);
        }
        _ => panic!("expected intent add"),
    }
}

#[test]
fn proposal_execute_uses_the_core_grpc_default() {
    let request = prepare_direct_command(
        CliGlobals::default(),
        DirectExecutionContext::Backend,
        DirectCommand::ProposalExecute {
            wallet: "team".into(),
            proposal: "proposal".into(),
            dwallet_program: None,
            grpc_url: None,
            rpc_url: Some("https://rpc.example".into()),
            broadcast: true,
        },
    )
    .expect("direct command");

    match request.command {
        Command::Proposal {
            action:
                ProposalAction::Execute {
                    grpc_url,
                    rpc_url,
                    broadcast,
                    ..
                },
        } => {
            assert_eq!(grpc_url, crate::ika::DEFAULT_GRPC_URL);
            assert_eq!(rpc_url.as_deref(), Some("https://rpc.example"));
            assert!(broadcast);
        }
        _ => panic!("expected proposal execute"),
    }
}

#[test]
fn direct_boundary_rejects_oversized_values() {
    let command = DirectCommand::ProposalCreate {
        wallet: "team".into(),
        intent_index: 3,
        params: vec!["x".repeat(16 * 1024 + 1)],
        expiry: None,
    };
    assert!(prepare_direct_command(
        CliGlobals::default(),
        DirectExecutionContext::Backend,
        command
    )
    .is_err());
}

#[test]
fn direct_context_rejects_conflicting_signer_state() {
    let globals = CliGlobals {
        dry_run: true,
        ..Default::default()
    };
    assert!(prepare_direct_command(
        globals,
        DirectExecutionContext::Backend,
        DirectCommand::WalletShow {
            name: "team".into()
        }
    )
    .is_err());
}
