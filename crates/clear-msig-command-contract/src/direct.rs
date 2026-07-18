use crate::validate_values;

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

impl DirectExecutionContext {
    pub fn validate_boundary(&self) -> Result<(), String> {
        match self {
            Self::Backend => Ok(()),
            Self::DryRun { actor_pubkey } => validate_values(
                "direct command context",
                actor_pubkey.iter().map(String::as_str).collect(),
            ),
            Self::PreSigned {
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
                validate_values("direct command context", values)
            }
        }
    }
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
    WalletPolicyCommitment {
        wallet: String,
        chain_kind: u8,
    },
    AssetPolicyCommitment {
        wallet: String,
        asset_id: String,
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
            Self::WalletPolicyCommitment { .. } => "wallet policy-commitment",
            Self::AssetPolicyCommitment { .. } => "wallet asset-policy-commitment",
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

    pub fn validate_boundary(&self) -> Result<(), String> {
        let mut values = Vec::new();
        match self {
            Self::WalletCreate {
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
            Self::WalletShow { name } => values.push(name),
            Self::WalletPolicyCommitment { wallet, .. } => values.push(wallet),
            Self::AssetPolicyCommitment { wallet, asset_id } => {
                values.extend([wallet.as_str(), asset_id.as_str()]);
            }
            Self::WalletAddChain {
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
            Self::WalletChains {
                wallet,
                dwallet_program,
            } => {
                values.push(wallet);
                values.extend(dwallet_program.iter().map(String::as_str));
            }
            Self::IntentAdd {
                wallet,
                file,
                proposers,
                approvers,
                expiry,
                policy_ciphertexts,
                ..
            }
            | Self::IntentUpdate {
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
            Self::IntentRemove { wallet, expiry, .. } => {
                values.push(wallet);
                values.extend(expiry.iter().map(String::as_str));
            }
            Self::IntentList { wallet } | Self::ProposalList { wallet } => values.push(wallet),
            Self::ProposalCreate {
                wallet,
                params,
                expiry,
                ..
            } => {
                values.push(wallet);
                values.extend(params.iter().map(String::as_str));
                values.extend(expiry.iter().map(String::as_str));
            }
            Self::ProposalApprove {
                wallet,
                proposal,
                expiry,
            }
            | Self::ProposalCancel {
                wallet,
                proposal,
                expiry,
            } => {
                values.extend([wallet.as_str(), proposal.as_str()]);
                values.extend(expiry.iter().map(String::as_str));
            }
            Self::ProposalExecute {
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
            Self::ProposalShow { proposal } | Self::ProposalCleanup { proposal } => {
                values.push(proposal)
            }
        }
        validate_values("direct command", values)
    }
}

#[cfg(test)]
mod tests {
    use super::DirectCommand;

    #[test]
    fn rejects_oversized_command_values() {
        let command = DirectCommand::ProposalCreate {
            wallet: "team".into(),
            intent_index: 1,
            params: vec!["x".repeat(16 * 1024 + 1)],
            expiry: None,
        };
        assert!(command.validate_boundary().is_err());
    }
}
