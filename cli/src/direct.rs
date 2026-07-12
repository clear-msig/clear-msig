use crate::commands::{intent::IntentAction, proposal::ProposalAction, wallet::WalletAction};
use crate::config::CliGlobals;
use crate::{Command, ExecutionRequest};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectExecutionContext {
    Backend,
    DryRun {
        actor_pubkey: Option<String>,
    },
    PreSigned {
        signer_pubkey: String,
        signature: String,
        params_data: Option<String>,
        message_flavor: Option<String>,
        signed_message: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectCommand {
    WalletCreate {
        name: String,
        proposers: Vec<String>,
        approvers: Vec<String>,
        threshold: u8,
        cancellation_threshold: u8,
        timelock: u32,
        policy_ciphertexts: Vec<String>,
    },
    WalletShow {
        name: String,
    },
    WalletAddChain {
        wallet: String,
        chain: String,
        dwallet_program: String,
        grpc_url: Option<String>,
        existing_dwallet_pubkey: Option<String>,
        existing_dwallet_addr: Option<String>,
    },
    WalletChains {
        wallet: String,
        dwallet_program: Option<String>,
    },
    IntentAdd {
        wallet: String,
        file: Option<String>,
        proposers: Vec<String>,
        approvers: Vec<String>,
        threshold: Option<u8>,
        cancellation_threshold: u8,
        timelock: u32,
        expiry: Option<String>,
        policy_ciphertexts: Vec<String>,
    },
    IntentRemove {
        wallet: String,
        index: u8,
        expiry: Option<String>,
    },
    IntentUpdate {
        wallet: String,
        index: u8,
        file: Option<String>,
        proposers: Vec<String>,
        approvers: Vec<String>,
        threshold: Option<u8>,
        cancellation_threshold: u8,
        timelock: u32,
        expiry: Option<String>,
        policy_ciphertexts: Vec<String>,
    },
    IntentList {
        wallet: String,
    },
    ProposalCreate {
        wallet: String,
        intent_index: u8,
        params: Vec<String>,
        expiry: Option<String>,
    },
    ProposalApprove {
        wallet: String,
        proposal: String,
        expiry: Option<String>,
    },
    ProposalCancel {
        wallet: String,
        proposal: String,
        expiry: Option<String>,
    },
    ProposalExecute {
        wallet: String,
        proposal: String,
        dwallet_program: Option<String>,
        grpc_url: Option<String>,
        rpc_url: Option<String>,
        broadcast: bool,
    },
    ProposalList {
        wallet: String,
    },
    ProposalShow {
        proposal: String,
    },
    ProposalCleanup {
        proposal: String,
    },
}

impl DirectCommand {
    pub fn label(&self) -> &'static str {
        match self {
            Self::WalletCreate { .. } => "wallet create",
            Self::WalletShow { .. } => "wallet show",
            Self::WalletAddChain { .. } => "wallet add-chain",
            Self::WalletChains { .. } => "wallet chains",
            Self::IntentAdd { .. } => "intent add",
            Self::IntentRemove { .. } => "intent remove",
            Self::IntentUpdate { .. } => "intent update",
            Self::IntentList { .. } => "intent list",
            Self::ProposalCreate { .. } => "proposal create",
            Self::ProposalApprove { .. } => "proposal approve",
            Self::ProposalCancel { .. } => "proposal cancel",
            Self::ProposalExecute { .. } => "proposal execute",
            Self::ProposalList { .. } => "proposal list",
            Self::ProposalShow { .. } => "proposal show",
            Self::ProposalCleanup { .. } => "proposal cleanup",
        }
    }
}

pub fn prepare_direct_command(
    mut globals: CliGlobals,
    context: DirectExecutionContext,
    command: DirectCommand,
) -> Result<ExecutionRequest, String> {
    apply_context(&mut globals, context)?;
    validate_values(command_values(&command))?;
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
    Ok(ExecutionRequest { globals, command })
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
            validate_values(actor_pubkey.iter().map(String::as_str).collect())?;
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
            let mut values = vec![signer_pubkey.as_str(), signature.as_str()];
            values.extend(params_data.iter().map(String::as_str));
            values.extend(message_flavor.iter().map(String::as_str));
            values.extend(signed_message.iter().map(String::as_str));
            validate_values(values)?;
            globals.signer_pubkey = Some(signer_pubkey);
            globals.signature = Some(signature);
            globals.params_data = params_data;
            globals.message_flavor = message_flavor;
            globals.signed_message = signed_message;
        }
    }
    Ok(())
}

fn command_values(command: &DirectCommand) -> Vec<&str> {
    let mut values = Vec::new();
    match command {
        DirectCommand::WalletCreate {
            name,
            proposers,
            approvers,
            policy_ciphertexts,
            ..
        } => {
            values.push(name.as_str());
            values.extend(proposers.iter().map(String::as_str));
            values.extend(approvers.iter().map(String::as_str));
            values.extend(policy_ciphertexts.iter().map(String::as_str));
        }
        DirectCommand::WalletShow { name } => values.push(name),
        DirectCommand::WalletAddChain {
            wallet,
            chain,
            dwallet_program,
            grpc_url,
            existing_dwallet_pubkey,
            existing_dwallet_addr,
        } => {
            values.extend([wallet.as_str(), chain.as_str(), dwallet_program.as_str()]);
            values.extend(grpc_url.iter().map(String::as_str));
            values.extend(existing_dwallet_pubkey.iter().map(String::as_str));
            values.extend(existing_dwallet_addr.iter().map(String::as_str));
        }
        DirectCommand::WalletChains {
            wallet,
            dwallet_program,
        } => {
            values.push(wallet);
            values.extend(dwallet_program.iter().map(String::as_str));
        }
        DirectCommand::IntentAdd {
            wallet,
            file,
            proposers,
            approvers,
            expiry,
            policy_ciphertexts,
            ..
        }
        | DirectCommand::IntentUpdate {
            wallet,
            file,
            proposers,
            approvers,
            expiry,
            policy_ciphertexts,
            ..
        } => {
            values.push(wallet);
            values.extend(file.iter().map(String::as_str));
            values.extend(proposers.iter().map(String::as_str));
            values.extend(approvers.iter().map(String::as_str));
            values.extend(expiry.iter().map(String::as_str));
            values.extend(policy_ciphertexts.iter().map(String::as_str));
        }
        DirectCommand::IntentRemove { wallet, expiry, .. } => {
            values.push(wallet);
            values.extend(expiry.iter().map(String::as_str));
        }
        DirectCommand::IntentList { wallet } | DirectCommand::ProposalList { wallet } => {
            values.push(wallet)
        }
        DirectCommand::ProposalCreate {
            wallet,
            params,
            expiry,
            ..
        } => {
            values.push(wallet);
            values.extend(params.iter().map(String::as_str));
            values.extend(expiry.iter().map(String::as_str));
        }
        DirectCommand::ProposalApprove {
            wallet,
            proposal,
            expiry,
        }
        | DirectCommand::ProposalCancel {
            wallet,
            proposal,
            expiry,
        } => {
            values.extend([wallet.as_str(), proposal.as_str()]);
            values.extend(expiry.iter().map(String::as_str));
        }
        DirectCommand::ProposalExecute {
            wallet,
            proposal,
            dwallet_program,
            grpc_url,
            rpc_url,
            ..
        } => {
            values.extend([wallet.as_str(), proposal.as_str()]);
            values.extend(dwallet_program.iter().map(String::as_str));
            values.extend(grpc_url.iter().map(String::as_str));
            values.extend(rpc_url.iter().map(String::as_str));
        }
        DirectCommand::ProposalShow { proposal } | DirectCommand::ProposalCleanup { proposal } => {
            values.push(proposal)
        }
    }
    values
}

fn validate_values(values: Vec<&str>) -> Result<(), String> {
    if values.len() > 256 {
        return Err(format!(
            "direct command has too many values: {}",
            values.len()
        ));
    }
    for value in values {
        if value.len() > 16 * 1024 {
            return Err("direct command value exceeds the size limit".into());
        }
        if value.contains('\0') {
            return Err("direct command values cannot contain NUL bytes".into());
        }
    }
    Ok(())
}
