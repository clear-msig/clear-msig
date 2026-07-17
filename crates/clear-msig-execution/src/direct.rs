use crate::commands::{intent::IntentAction, proposal::ProposalAction, wallet::WalletAction};
use crate::config::CliGlobals;
use crate::{Command, ExecutionRequest};
use clear_msig_command_contract::{DirectCommand, DirectExecutionContext};

pub fn prepare_direct_command(
    mut globals: CliGlobals,
    context: DirectExecutionContext,
    command: DirectCommand,
) -> Result<ExecutionRequest, String> {
    context.validate_boundary()?;
    command.validate_boundary()?;
    apply_context(&mut globals, context)?;
    let command = match command {
        DirectCommand::WalletCreate {
            name,
            proposers,
            approvers,
            threshold,
            cancellation_threshold,
            timelock,
            policy_ciphertexts,
        } => Command::Wallet {
            action: WalletAction::Create {
                name,
                proposers,
                approvers,
                threshold,
                cancellation_threshold,
                timelock,
                policy_ciphertexts,
            },
        },
        DirectCommand::WalletShow { name } => Command::Wallet {
            action: WalletAction::Show { name },
        },
        DirectCommand::WalletPolicyCommitment { wallet, chain_kind } => Command::Wallet {
            action: WalletAction::PolicyCommitment { wallet, chain_kind },
        },
        DirectCommand::WalletAddChain {
            wallet,
            chain,
            dwallet_program,
            grpc_url,
            existing_dwallet_pubkey,
            existing_dwallet_addr,
        } => Command::Wallet {
            action: WalletAction::AddChain {
                wallet,
                chain,
                dwallet_program,
                grpc_url: grpc_url.unwrap_or_else(|| crate::ika::DEFAULT_GRPC_URL.to_string()),
                existing_dwallet_pubkey,
                existing_dwallet_addr,
            },
        },
        DirectCommand::WalletChains {
            wallet,
            dwallet_program,
        } => Command::Wallet {
            action: WalletAction::Chains {
                wallet,
                dwallet_program,
            },
        },
        DirectCommand::IntentAdd {
            wallet,
            file,
            proposers,
            approvers,
            threshold,
            cancellation_threshold,
            timelock,
            expiry,
            policy_ciphertexts,
        } => Command::Intent {
            action: IntentAction::Add {
                wallet,
                file,
                proposers,
                approvers,
                threshold,
                cancellation_threshold,
                timelock,
                expiry,
                policy_ciphertexts,
            },
        },
        DirectCommand::IntentRemove {
            wallet,
            index,
            expiry,
        } => Command::Intent {
            action: IntentAction::Remove {
                wallet,
                index,
                expiry,
            },
        },
        DirectCommand::IntentUpdate {
            wallet,
            index,
            file,
            proposers,
            approvers,
            threshold,
            cancellation_threshold,
            timelock,
            expiry,
            policy_ciphertexts,
        } => Command::Intent {
            action: IntentAction::Update {
                wallet,
                index,
                file,
                proposers,
                approvers,
                threshold,
                cancellation_threshold,
                timelock,
                expiry,
                policy_ciphertexts,
            },
        },
        DirectCommand::IntentList { wallet } => Command::Intent {
            action: IntentAction::List { wallet },
        },
        DirectCommand::ProposalCreate {
            wallet,
            intent_index,
            params,
            expiry,
        } => Command::Proposal {
            action: ProposalAction::Create {
                wallet,
                intent_index,
                params,
                expiry,
            },
        },
        DirectCommand::ProposalApprove {
            wallet,
            proposal,
            expiry,
        } => Command::Proposal {
            action: ProposalAction::Approve {
                wallet,
                proposal,
                expiry,
            },
        },
        DirectCommand::ProposalCancel {
            wallet,
            proposal,
            expiry,
        } => Command::Proposal {
            action: ProposalAction::Cancel {
                wallet,
                proposal,
                expiry,
            },
        },
        DirectCommand::ProposalExecute {
            wallet,
            proposal,
            dwallet_program,
            grpc_url,
            rpc_url,
            broadcast,
        } => Command::Proposal {
            action: ProposalAction::Execute {
                wallet,
                proposal,
                dwallet_program,
                grpc_url: grpc_url.unwrap_or_else(|| crate::ika::DEFAULT_GRPC_URL.to_string()),
                rpc_url,
                broadcast,
            },
        },
        DirectCommand::ProposalList { wallet } => Command::Proposal {
            action: ProposalAction::List { wallet },
        },
        DirectCommand::ProposalShow { proposal } => Command::Proposal {
            action: ProposalAction::Show { proposal },
        },
        DirectCommand::ProposalCleanup { proposal } => Command::Proposal {
            action: ProposalAction::Cleanup { proposal },
        },
    };
    Ok(ExecutionRequest::new(globals, command))
}

fn apply_context(globals: &mut CliGlobals, context: DirectExecutionContext) -> Result<(), String> {
    if globals.dry_run
        || globals.signer_pubkey.is_some()
        || globals.signature.is_some()
        || globals.params_data.is_some()
        || globals.message_flavor.is_some()
        || globals.signed_message.is_some()
    {
        return Err("base execution globals already contain request context".into());
    }
    match context {
        DirectExecutionContext::Backend => {}
        DirectExecutionContext::DryRun { actor_pubkey } => {
            globals.dry_run = true;
            globals.signer_pubkey = actor_pubkey;
        }
        DirectExecutionContext::PreSigned {
            signer_pubkey,
            signature,
            params_data,
            message_flavor,
            signed_message,
        } => {
            globals.signer_pubkey = Some(signer_pubkey);
            globals.signature = Some(signature);
            globals.params_data = params_data;
            globals.message_flavor = message_flavor;
            globals.signed_message = signed_message;
        }
    }
    Ok(())
}
