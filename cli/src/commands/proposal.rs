use std::borrow::Cow;

use crate::config::RuntimeConfig;
use crate::error::*;
use crate::output::{print_json, print_typed_dry_run};
use crate::signing::sign_message_with_flavor;
use crate::{accounts, message, params, resolve, rpc};
use clap::Subcommand;
use clear_wallet::utils::clearsign::{
    extract_clear_text_from_vote_message, ClearSignActionKind, ClearSignVoteKind,
};
use ika_dwallet_types::{NetworkSignedAttestation, VersionedDWalletDataAttestation};
use solana_client::rpc_client::RpcClient;
use solana_sdk::instruction::AccountMeta;
use solana_sdk::pubkey::Pubkey;

#[derive(Subcommand)]
pub enum ProposalAction {
    /// Create a new proposal for a custom intent
    Create {
        #[arg(long)]
        wallet: String,
        /// Intent index to propose against
        #[arg(long)]
        intent_index: u8,
        /// Parameters as key=value pairs
        #[arg(long = "param")]
        params: Vec<String>,
        /// Message expiry (YYYY-MM-DD HH:MM:SS). Defaults to now + configured expiry_seconds.
        #[arg(long)]
        expiry: Option<String>,
    },
    /// Create a ClearSign v2 typed proposal
    TypedCreate {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        intent_index: u8,
        #[arg(long)]
        action_kind: u8,
        #[arg(long)]
        policy_commitment: String,
        #[arg(long)]
        payload_hash: String,
        #[arg(long)]
        envelope_hash: String,
        #[arg(long)]
        action_id: String,
        #[arg(long)]
        nonce: String,
        /// Human-readable ClearSign v2 action text produced by /clearsign/v2/prepare.
        ///
        /// Required for dry-run and local signing. Browser pre-signed submits
        /// pass the exact signed readable vote bytes via global --signed-message.
        #[arg(long)]
        signable_text: Option<String>,
        #[arg(long)]
        expiry: Option<String>,
    },
    /// Approve a ClearSign v2 typed proposal
    TypedApprove {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
    },
    /// Cancel a ClearSign v2 typed proposal
    TypedCancel {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
    },
    /// Mark an approved ClearSign v2 typed proposal executed
    TypedExecute {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
    },
    /// Execute an approved typed escrow milestone release.
    TypedEscrowRelease {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        recipient: String,
        #[arg(long)]
        amount_lamports: u64,
        #[arg(long)]
        escrow_id: String,
        #[arg(long)]
        milestone_id: String,
    },
    /// Execute an approved typed SPL-token escrow milestone release.
    TypedSplEscrowRelease {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        mint: String,
        #[arg(long)]
        source_token: String,
        #[arg(long)]
        destination_token: String,
        #[arg(long)]
        recipient_owner: String,
        #[arg(long)]
        amount_tokens: u64,
        #[arg(long)]
        escrow_id: String,
        #[arg(long)]
        milestone_id: String,
    },
    /// Execute an approved typed SPL-token escrow unwind / return.
    ///
    /// Pass one `--return destination_token:funder_owner:tokens` per funder.
    TypedSplEscrowReturn {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        mint: String,
        #[arg(long)]
        source_token: String,
        #[arg(long)]
        escrow_id: String,
        #[arg(long = "return")]
        returns: Vec<String>,
    },
    /// Finalize an approved typed cross-chain escrow milestone release.
    TypedCrossChainEscrowRelease {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        chain_kind: u8,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        escrow_id: String,
        #[arg(long)]
        milestone_id: String,
        #[arg(long)]
        recipient_hash: String,
        #[arg(long)]
        asset_id_hash: String,
        #[arg(long)]
        route_hash: String,
        #[arg(long)]
        settlement_artifact_hash: String,
    },
    /// Finalize an approved typed cross-chain escrow unwind / return.
    TypedCrossChainEscrowReturn {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        chain_kind: u8,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        escrow_id: String,
        #[arg(long)]
        refund_recipient_hash: String,
        #[arg(long)]
        asset_id_hash: String,
        #[arg(long)]
        route_hash: String,
        #[arg(long)]
        settlement_artifact_hash: String,
    },
    /// Finalize an approved typed encrypted/private escrow milestone release.
    TypedPrivateEscrowRelease {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        escrow_id: String,
        #[arg(long)]
        milestone_id: String,
        #[arg(long)]
        recipient_hash: String,
        #[arg(long)]
        asset_id_hash: String,
        #[arg(long)]
        private_evaluation_hash: String,
        #[arg(long)]
        settlement_artifact_hash: String,
    },
    /// Finalize an approved typed encrypted/private escrow unwind / return.
    TypedPrivateEscrowReturn {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        escrow_id: String,
        #[arg(long)]
        refund_recipient_hash: String,
        #[arg(long)]
        asset_id_hash: String,
        #[arg(long)]
        private_evaluation_hash: String,
        #[arg(long)]
        settlement_artifact_hash: String,
    },
    /// Execute an approved typed escrow unwind / return.
    ///
    /// Pass one `--return recipient:lamports` per funder.
    TypedEscrowReturn {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        escrow_id: String,
        #[arg(long = "return")]
        returns: Vec<String>,
    },
    /// Execute an approved typed SOL send.
    TypedSolSend {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        recipient: String,
        #[arg(long)]
        amount_lamports: u64,
    },
    /// Execute an approved typed SOL batch send.
    ///
    /// Pass one `--payment recipient:lamports` per recipient.
    TypedSolBatchSend {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long = "payment")]
        payments: Vec<String>,
    },
    /// Approve an existing proposal
    Approve {
        #[arg(long)]
        wallet: String,
        /// Proposal account address
        #[arg(long)]
        proposal: String,
        /// Message expiry (YYYY-MM-DD HH:MM:SS). Defaults to now + configured expiry_seconds.
        #[arg(long)]
        expiry: Option<String>,
    },
    /// Cancel / reject a proposal
    Cancel {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        /// Message expiry (YYYY-MM-DD HH:MM:SS). Defaults to now + configured expiry_seconds.
        #[arg(long)]
        expiry: Option<String>,
    },
    /// Execute an approved proposal.
    ///
    /// Chain-aware: for `chain = solana` intents, runs the local CPI executor
    /// (vault PDA signs). For any remote chain (EVM, BTC, ZEC, ERC-20),
    /// drives the on-chain `ika_sign` instruction and then completes the
    /// gRPC presign+sign roundtrip with the bound dWallet.
    Execute {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        /// Required for remote-chain execution: the dWallet program ID on
        /// the current cluster. Ignored for local Solana intents.
        #[arg(long)]
        dwallet_program: Option<String>,
        /// Ika gRPC endpoint (default: pre-alpha-dev-1).
        #[arg(long, default_value = crate::ika::DEFAULT_GRPC_URL)]
        grpc_url: String,
        /// Destination-chain RPC URL. If set together with `--broadcast`,
        /// the CLI assembles the chain-native signed transaction (recovers
        /// `v`, splices the signature into the EIP-1559 RLP envelope for
        /// EVM, builds the witness for Bitcoin, etc.) and broadcasts it
        /// via this endpoint after the dwallet network returns the
        /// signature. Chain-native protocol is selected automatically from
        /// the intent's `chain_kind` — JSON-RPC `eth_sendRawTransaction`
        /// for EVM, Bitcoin Core RPC `sendrawtransaction` / Esplora REST
        /// `POST /tx` for BTC, etc.
        ///
        /// Examples:
        ///   - Sepolia (public):           `https://ethereum-sepolia-rpc.publicnode.com`
        ///   - Ethereum mainnet (Alchemy): `https://eth-mainnet.g.alchemy.com/v2/<key>`
        ///   - Base mainnet:               `https://mainnet.base.org`
        ///   - Bitcoin testnet (Esplora):  `https://blockstream.info/testnet/api`
        #[arg(long)]
        rpc_url: Option<String>,
        /// Broadcast the signed transaction to the chain after signing.
        /// Requires `--rpc-url <URL>`. Without this flag the CLI just
        /// returns the raw signed bytes in the JSON output and the caller
        /// is responsible for broadcasting them.
        #[arg(long, default_value = "false")]
        broadcast: bool,
    },
    /// List proposals for a wallet
    List {
        #[arg(long)]
        wallet: String,
    },
    /// Show details of a specific proposal
    Show {
        /// Proposal account address
        #[arg(long)]
        proposal: String,
    },
    /// Close an executed/cancelled proposal and reclaim rent
    Cleanup {
        #[arg(long)]
        proposal: String,
    },
}

pub fn handle(action: ProposalAction, config: &RuntimeConfig) -> Result<()> {
    match action {
        ProposalAction::Create {
            wallet: wallet_name,
            intent_index,
            params: raw_params,
            expiry,
        } => {
            let expiry_ts = message::resolve_expiry(&expiry, config)?;
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());

            // Resolve wallet by name. Creator-scoped PDA upgrade —
            // see comment in intent.rs:120 for context.
            let client = rpc::client(config);
            let (wallet_pubkey, wallet_account) =
                rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            let (intent_addr, _) =
                clear_wallet_client::pda::find_intent_address(&wallet_addr, intent_index, &pid);
            let intent_pubkey = Pubkey::new_from_array(intent_addr.to_bytes());
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)?;
            let intent_account = accounts::parse_intent(&intent_data)?;

            if !intent_account.approved {
                return Err(anyhow!("intent {} is not approved", intent_index));
            }

            // Check signer is a proposer. `config.signer.pubkey()` is
            // the pre-signed pubkey in pre-signed mode, the filesystem
            // keypair's pubkey otherwise — either way this check catches
            // a caller who submits with the wrong identity.
            let signer_pubkey_b58 = bs58::encode(config.signer.pubkey()).into_string();
            if !intent_account.proposers.contains(&signer_pubkey_b58) {
                return Err(anyhow!(
                    "signer {} is not a proposer on intent {}",
                    signer_pubkey_b58,
                    intent_index
                ));
            }

            // Prefer the caller-supplied params_data in pre-signed mode;
            // fall back to encoding `--param key=value` pairs locally.
            let params_data: Vec<u8> = match &config.params_data_override {
                Some(bytes) => bytes.clone(),
                None => params::encode_params(&intent_account, &raw_params)?,
            };

            let proposal_index = wallet_account.proposal_index;
            let msg = message::build_message(
                "propose",
                expiry_ts,
                &wallet_account.name,
                proposal_index,
                &intent_account,
                &params_data,
            )?;
            let msg_plain = message::build_plain_message(
                "propose",
                expiry_ts,
                &wallet_account.name,
                proposal_index,
                &intent_account,
                &params_data,
            )?;

            let (proposal_addr, _) =
                clear_wallet_client::pda::find_proposal_address(&intent_addr, proposal_index, &pid);

            if config.dry_run {
                crate::output::print_dry_run(&crate::output::DryRunDescriptor {
                    action: "proposal_create",
                    wallet_name: &wallet_account.name,
                    wallet_pubkey: wallet_pubkey.to_string(),
                    intent_index,
                    intent_pubkey: intent_pubkey.to_string(),
                    message_hex: crate::output::hex_of(&msg),
                    params_data_hex: crate::output::hex_of(&params_data),
                    expiry: expiry_ts,
                    proposal_pubkey: Some(
                        Pubkey::new_from_array(proposal_addr.to_bytes()).to_string(),
                    ),
                    proposal_index: Some(proposal_index),
                });
                return Ok(());
            }

            eprintln!("Signing message:\n{}", String::from_utf8_lossy(&msg[20..]));
            let signature =
                sign_message_with_flavor(&*config.signer, &msg, &msg_plain, config.message_flavor)?;
            let proposer_pubkey = config.signer.pubkey();

            let payer_pubkey = solana_sdk::signer::Signer::pubkey(&config.payer);
            let ix = crate::instructions::propose(crate::instructions::ProposeArgs {
                payer: payer_pubkey,
                wallet: wallet_pubkey,
                intent: intent_pubkey,
                proposal: Pubkey::new_from_array(proposal_addr.to_bytes()),
                proposal_index,
                expiry: expiry_ts,
                proposer_pubkey,
                signature,
                params_data: &params_data,
            });

            let sig = rpc::send_instruction(&client, config, ix)?;

            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": Pubkey::new_from_array(proposal_addr.to_bytes()).to_string(),
                "proposal_index": proposal_index,
            }));
        }

        ProposalAction::TypedCreate {
            wallet: wallet_name,
            intent_index,
            action_kind,
            policy_commitment,
            payload_hash,
            envelope_hash,
            action_id,
            nonce,
            signable_text,
            expiry,
        } => {
            let expiry_ts = message::resolve_expiry(&expiry, config)?;
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());
            let client = rpc::client(config);
            let (wallet_pubkey, wallet_account) =
                rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            let (intent_addr, _) =
                clear_wallet_client::pda::find_intent_address(&wallet_addr, intent_index, &pid);
            let intent_pubkey = Pubkey::new_from_array(intent_addr.to_bytes());
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)?;
            let intent_account = accounts::parse_intent(&intent_data)?;
            if !intent_account.approved {
                return Err(anyhow!("intent {} is not approved", intent_index));
            }

            let signer_pubkey_b58 = bs58::encode(config.signer.pubkey()).into_string();
            if !intent_account.proposers.contains(&signer_pubkey_b58) {
                return Err(anyhow!(
                    "signer {} is not a proposer on intent {}",
                    signer_pubkey_b58,
                    intent_index
                ));
            }

            let policy_commitment = decode_hex_32(&policy_commitment, "policy_commitment")?;
            let payload_hash = decode_hex_32(&payload_hash, "payload_hash")?;
            let envelope_hash = decode_hex_32(&envelope_hash, "envelope_hash")?;
            ensure_typed_text(&action_id, "action_id")?;
            ensure_typed_text(&nonce, "nonce")?;

            let proposal_index = wallet_account.proposal_index;
            let (proposal_addr, _) = clear_wallet_client::pda::find_typed_proposal_address(
                &intent_addr,
                proposal_index,
                &pid,
            );
            let proposal_pubkey = Pubkey::new_from_array(proposal_addr.to_bytes());
            let vote_message = signable_text.as_deref().map(|text| {
                typed_vote_message(
                    ClearSignVoteKind::Propose,
                    &wallet_account.name,
                    proposal_index,
                    envelope_hash,
                    text.as_bytes(),
                )
            });

            if config.dry_run {
                let vote_message = vote_message.as_ref().ok_or_else(|| {
                    anyhow!("--signable-text is required for typed-create dry-run")
                })?;
                print_typed_dry_run(&crate::output::TypedDryRunDescriptor {
                    action: "proposal_typed_create",
                    wallet_name: &wallet_account.name,
                    wallet_pubkey: wallet_pubkey.to_string(),
                    intent_index,
                    intent_pubkey: intent_pubkey.to_string(),
                    proposal_pubkey: proposal_pubkey.to_string(),
                    proposal_index,
                    action_kind,
                    policy_commitment_hex: crate::output::hex_of(&policy_commitment),
                    payload_hash_hex: crate::output::hex_of(&payload_hash),
                    envelope_hash_hex: crate::output::hex_of(&envelope_hash),
                    action_id: action_id.clone(),
                    nonce: nonce.clone(),
                    message_hex: crate::output::hex_of(vote_message),
                    message_flavor: "clearsign_v2_text",
                    expiry: expiry_ts,
                });
                return Ok(());
            }

            eprintln!(
                "Signing ClearSign v2 proposal message:\n{}",
                String::from_utf8_lossy(vote_message.as_deref().unwrap_or_else(|| {
                    config
                        .signed_message_override
                        .as_deref()
                        .unwrap_or_default()
                }))
            );
            let signed_message = config
                .signed_message_override
                .as_deref()
                .or(vote_message.as_deref())
                .ok_or_else(|| {
                    anyhow!(
                        "--signable-text or global --signed-message is required for typed-create"
                    )
                })?;
            let clear_text: Cow<'_, [u8]> = if let Some(text) = signable_text.as_deref() {
                if config.signed_message_override.is_some() {
                    let signed_clear_text = extract_clear_text_from_vote_message(
                        ClearSignVoteKind::Propose,
                        wallet_account.name.as_bytes(),
                        proposal_index,
                        envelope_hash,
                        signed_message,
                    )
                    .map_err(|_| {
                        anyhow!("--signed-message is not a valid ClearSign v2 propose message")
                    })?;
                    if signed_clear_text != text.as_bytes() {
                        return Err(anyhow!(
                            "--signed-message clear text does not match --signable-text"
                        ));
                    }
                }
                Cow::Borrowed(text.as_bytes())
            } else {
                Cow::Owned(
                    extract_clear_text_from_vote_message(
                        ClearSignVoteKind::Propose,
                        wallet_account.name.as_bytes(),
                        proposal_index,
                        envelope_hash,
                        signed_message,
                    )
                    .map_err(|_| {
                        anyhow!("--signed-message is not a valid ClearSign v2 propose message")
                    })?
                    .to_vec(),
                )
            };
            let signature = config.signer.sign_message(signed_message)?;
            let payer_pubkey = solana_sdk::signer::Signer::pubkey(&config.payer);
            let action_id_hash = crate::message::sha256_hash(action_id.as_bytes());
            let nonce_hash = crate::message::sha256_hash(nonce.as_bytes());
            let ix = crate::instructions::propose_typed(crate::instructions::ProposeTypedArgs {
                payer: payer_pubkey,
                wallet: wallet_pubkey,
                intent: intent_pubkey,
                proposal: proposal_pubkey,
                proposal_index,
                expiry: expiry_ts,
                action_kind,
                policy_commitment,
                payload_hash,
                envelope_hash,
                proposer_pubkey: config.signer.pubkey(),
                signature,
                action_id: action_id_hash,
                nonce: nonce_hash,
                clear_text: clear_text.as_ref(),
            });
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "proposal_index": proposal_index,
                "typed": true,
            }));
        }

        ProposalAction::TypedApprove {
            wallet: wallet_name,
            proposal: proposal_addr_str,
        } => {
            typed_approve_or_cancel(config, &wallet_name, &proposal_addr_str, true)?;
        }

        ProposalAction::TypedCancel {
            wallet: wallet_name,
            proposal: proposal_addr_str,
        } => {
            typed_approve_or_cancel(config, &wallet_name, &proposal_addr_str, false)?;
        }

        ProposalAction::TypedExecute {
            wallet: wallet_name,
            proposal: proposal_addr_str,
        } => {
            let client = rpc::client(config);
            let (wallet_pubkey, _) = rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let proposal_pubkey: Pubkey = proposal_addr_str
                .parse()
                .with_context(|| "invalid proposal address")?;
            let proposal_data = rpc::fetch_account(&client, &proposal_pubkey)?;
            let proposal_account = accounts::parse_typed_proposal(&proposal_data)?;
            if proposal_account.wallet != wallet_pubkey.to_string() {
                return Err(anyhow!(
                    "typed proposal does not belong to wallet {wallet_name}"
                ));
            }
            if proposal_account.status != "Approved" {
                return Err(anyhow!(
                    "typed proposal status is '{}', must be 'Approved' to execute",
                    proposal_account.status
                ));
            }
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let ix = crate::instructions::execute_typed(
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                proposal_account.action_kind,
                proposal_account.policy_commitment,
                proposal_account.payload_hash,
                proposal_account.envelope_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed",
                "status": "executed",
            }));
        }

        ProposalAction::TypedEscrowRelease {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            recipient,
            amount_lamports,
            escrow_id,
            milestone_id,
        } => {
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReleaseMilestone,
                "typed escrow release",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let recipient_pubkey: Pubkey = recipient
                .parse()
                .with_context(|| "invalid recipient address")?;
            let ix = crate::instructions::execute_typed_escrow_release(
                wallet_pubkey,
                vault_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                recipient_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                amount_lamports,
                crate::message::sha256_hash(escrow_id.as_bytes()),
                crate::message::sha256_hash(milestone_id.as_bytes()),
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_escrow_release",
                "status": "executed",
                "recipient": recipient_pubkey.to_string(),
                "amount_lamports": amount_lamports,
            }));
        }

        ProposalAction::TypedSplEscrowRelease {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            mint,
            source_token,
            destination_token,
            recipient_owner,
            amount_tokens,
            escrow_id,
            milestone_id,
        } => {
            if amount_tokens == 0 {
                return Err(anyhow!("amount-tokens must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReleaseMilestone,
                "typed SPL escrow release",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let mint_pubkey: Pubkey = mint.parse().with_context(|| "invalid mint address")?;
            let source_token_pubkey: Pubkey = source_token
                .parse()
                .with_context(|| "invalid source token account address")?;
            let destination_token_pubkey: Pubkey = destination_token
                .parse()
                .with_context(|| "invalid destination token account address")?;
            let recipient_owner_pubkey: Pubkey = recipient_owner
                .parse()
                .with_context(|| "invalid recipient owner address")?;
            let ix = crate::instructions::execute_typed_spl_escrow_release(
                wallet_pubkey,
                vault_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                mint_pubkey,
                source_token_pubkey,
                destination_token_pubkey,
                recipient_owner_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                amount_tokens,
                crate::message::sha256_hash(escrow_id.as_bytes()),
                crate::message::sha256_hash(milestone_id.as_bytes()),
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_spl_escrow_release",
                "status": "executed",
                "mint": mint_pubkey.to_string(),
                "source_token": source_token_pubkey.to_string(),
                "destination_token": destination_token_pubkey.to_string(),
                "recipient_owner": recipient_owner_pubkey.to_string(),
                "amount_tokens": amount_tokens,
            }));
        }

        ProposalAction::TypedSplEscrowReturn {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            mint,
            source_token,
            escrow_id,
            returns,
        } => {
            if returns.is_empty() {
                return Err(anyhow!(
                    "at least one --return destination_token:funder_owner:tokens is required"
                ));
            }
            if returns.len() > 16 {
                return Err(anyhow!(
                    "typed SPL escrow return supports at most 16 recipients"
                ));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReturnEscrowFunds,
                "typed SPL escrow return",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let mint_pubkey: Pubkey = mint.parse().with_context(|| "invalid mint address")?;
            let source_token_pubkey: Pubkey = source_token
                .parse()
                .with_context(|| "invalid source token account address")?;
            let parsed_returns = returns
                .iter()
                .map(|row| parse_token_return_row(row))
                .collect::<Result<Vec<_>>>()?;
            let mut amount_bytes = Vec::with_capacity(parsed_returns.len() * 8);
            let mut return_accounts = Vec::with_capacity(parsed_returns.len() * 2);
            for (destination_token, funder_owner, amount_tokens) in &parsed_returns {
                amount_bytes.extend_from_slice(&amount_tokens.to_le_bytes());
                return_accounts.push(AccountMeta::new(*destination_token, false));
                return_accounts.push(AccountMeta::new_readonly(*funder_owner, false));
            }
            let ix = crate::instructions::execute_typed_spl_escrow_return(
                wallet_pubkey,
                vault_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                mint_pubkey,
                source_token_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                crate::message::sha256_hash(escrow_id.as_bytes()),
                &amount_bytes,
                return_accounts,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_spl_escrow_return",
                "status": "executed",
                "mint": mint_pubkey.to_string(),
                "source_token": source_token_pubkey.to_string(),
                "returns": parsed_returns
                    .iter()
                    .map(|(destination_token, funder_owner, amount_tokens)| serde_json::json!({
                        "destination_token": destination_token.to_string(),
                        "funder_owner": funder_owner.to_string(),
                        "amount_tokens": amount_tokens,
                    }))
                    .collect::<Vec<_>>(),
            }));
        }

        ProposalAction::TypedCrossChainEscrowRelease {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            chain_kind,
            amount_raw,
            escrow_id,
            milestone_id,
            recipient_hash,
            asset_id_hash,
            route_hash,
            settlement_artifact_hash,
        } => {
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReleaseMilestone,
                "typed cross-chain escrow release",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)
                .with_context(|| "failed to fetch typed proposal intent")?;
            let intent_account = accounts::parse_intent(&intent_data)?;
            if intent_account.chain_kind != chain_kind {
                return Err(anyhow!(
                    "typed cross-chain escrow release chain_kind mismatch: intent has {}, command got {}",
                    intent_account.chain_kind,
                    chain_kind
                ));
            }

            let program_id = crate::instructions::program_id();
            let (ika_config_pubkey, _) =
                crate::ika::ika_config_pda(&program_id, &wallet_pubkey, chain_kind);
            let ika_config_data =
                rpc::fetch_account(&client, &ika_config_pubkey).with_context(|| {
                    format!(
                        "wallet has no IkaConfig for chain_kind={chain_kind}; bind the chain first"
                    )
                })?;
            let ika_config = accounts::parse_ika_config(&ika_config_data)?;
            let dwallet_pubkey: Pubkey = ika_config
                .dwallet
                .parse()
                .with_context(|| "invalid dwallet address in IkaConfig")?;

            let recipient_hash = decode_hex_32(&recipient_hash, "recipient_hash")?;
            let asset_id_hash = decode_hex_32(&asset_id_hash, "asset_id_hash")?;
            let route_hash = decode_hex_32(&route_hash, "route_hash")?;
            let settlement_artifact_hash =
                decode_hex_32(&settlement_artifact_hash, "settlement_artifact_hash")?;
            let tx_template_hash = intent_tx_template_hash(&intent_account)?;
            let ix = crate::instructions::execute_typed_cross_chain_escrow_release(
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                ika_config_pubkey,
                dwallet_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                chain_kind,
                amount_raw.to_le_bytes(),
                crate::message::sha256_hash(escrow_id.as_bytes()),
                crate::message::sha256_hash(milestone_id.as_bytes()),
                recipient_hash,
                asset_id_hash,
                route_hash,
                tx_template_hash,
                settlement_artifact_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_cross_chain_escrow_release",
                "status": "executed",
                "chain_kind": chain_kind,
                "ika_config": ika_config_pubkey.to_string(),
                "dwallet": dwallet_pubkey.to_string(),
                "amount_raw": amount_raw.to_string(),
                "escrow_id": escrow_id,
                "milestone_id": milestone_id,
                "recipient_hash": crate::output::hex_of(&recipient_hash),
                "asset_id_hash": crate::output::hex_of(&asset_id_hash),
                "route_hash": crate::output::hex_of(&route_hash),
                "tx_template_hash": crate::output::hex_of(&tx_template_hash),
                "settlement_artifact_hash": crate::output::hex_of(&settlement_artifact_hash),
            }));
        }

        ProposalAction::TypedCrossChainEscrowReturn {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            chain_kind,
            amount_raw,
            escrow_id,
            refund_recipient_hash,
            asset_id_hash,
            route_hash,
            settlement_artifact_hash,
        } => {
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReturnEscrowFunds,
                "typed cross-chain escrow return",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)
                .with_context(|| "failed to fetch typed proposal intent")?;
            let intent_account = accounts::parse_intent(&intent_data)?;
            if intent_account.chain_kind != chain_kind {
                return Err(anyhow!(
                    "typed cross-chain escrow return chain_kind mismatch: intent has {}, command got {}",
                    intent_account.chain_kind,
                    chain_kind
                ));
            }

            let program_id = crate::instructions::program_id();
            let (ika_config_pubkey, _) =
                crate::ika::ika_config_pda(&program_id, &wallet_pubkey, chain_kind);
            let ika_config_data =
                rpc::fetch_account(&client, &ika_config_pubkey).with_context(|| {
                    format!(
                        "wallet has no IkaConfig for chain_kind={chain_kind}; bind the chain first"
                    )
                })?;
            let ika_config = accounts::parse_ika_config(&ika_config_data)?;
            let dwallet_pubkey: Pubkey = ika_config
                .dwallet
                .parse()
                .with_context(|| "invalid dwallet address in IkaConfig")?;

            let refund_recipient_hash =
                decode_hex_32(&refund_recipient_hash, "refund_recipient_hash")?;
            let asset_id_hash = decode_hex_32(&asset_id_hash, "asset_id_hash")?;
            let route_hash = decode_hex_32(&route_hash, "route_hash")?;
            let settlement_artifact_hash =
                decode_hex_32(&settlement_artifact_hash, "settlement_artifact_hash")?;
            let tx_template_hash = intent_tx_template_hash(&intent_account)?;
            let ix = crate::instructions::execute_typed_cross_chain_escrow_return(
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                ika_config_pubkey,
                dwallet_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                chain_kind,
                amount_raw.to_le_bytes(),
                crate::message::sha256_hash(escrow_id.as_bytes()),
                refund_recipient_hash,
                asset_id_hash,
                route_hash,
                tx_template_hash,
                settlement_artifact_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_cross_chain_escrow_return",
                "status": "executed",
                "chain_kind": chain_kind,
                "ika_config": ika_config_pubkey.to_string(),
                "dwallet": dwallet_pubkey.to_string(),
                "amount_raw": amount_raw.to_string(),
                "escrow_id": escrow_id,
                "refund_recipient_hash": crate::output::hex_of(&refund_recipient_hash),
                "asset_id_hash": crate::output::hex_of(&asset_id_hash),
                "route_hash": crate::output::hex_of(&route_hash),
                "tx_template_hash": crate::output::hex_of(&tx_template_hash),
                "settlement_artifact_hash": crate::output::hex_of(&settlement_artifact_hash),
            }));
        }

        ProposalAction::TypedPrivateEscrowRelease {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            amount_raw,
            escrow_id,
            milestone_id,
            recipient_hash,
            asset_id_hash,
            private_evaluation_hash,
            settlement_artifact_hash,
        } => {
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReleaseMilestone,
                "typed private escrow release",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)
                .with_context(|| "failed to fetch typed proposal intent")?;
            let intent_account = accounts::parse_intent(&intent_data)?;

            let recipient_hash = decode_hex_32(&recipient_hash, "recipient_hash")?;
            let asset_id_hash = decode_hex_32(&asset_id_hash, "asset_id_hash")?;
            let private_evaluation_hash =
                decode_hex_32(&private_evaluation_hash, "private_evaluation_hash")?;
            let settlement_artifact_hash =
                decode_hex_32(&settlement_artifact_hash, "settlement_artifact_hash")?;
            let policy_ciphertexts_hash = intent_policy_ciphertexts_hash(&intent_account)?;
            let ix = crate::instructions::execute_typed_private_escrow_release(
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                amount_raw.to_le_bytes(),
                crate::message::sha256_hash(escrow_id.as_bytes()),
                crate::message::sha256_hash(milestone_id.as_bytes()),
                recipient_hash,
                asset_id_hash,
                policy_ciphertexts_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_private_escrow_release",
                "status": "executed",
                "amount_raw": amount_raw.to_string(),
                "escrow_id": escrow_id,
                "milestone_id": milestone_id,
                "recipient_hash": crate::output::hex_of(&recipient_hash),
                "asset_id_hash": crate::output::hex_of(&asset_id_hash),
                "policy_ciphertexts_hash": crate::output::hex_of(&policy_ciphertexts_hash),
                "private_evaluation_hash": crate::output::hex_of(&private_evaluation_hash),
                "settlement_artifact_hash": crate::output::hex_of(&settlement_artifact_hash),
            }));
        }

        ProposalAction::TypedPrivateEscrowReturn {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            amount_raw,
            escrow_id,
            refund_recipient_hash,
            asset_id_hash,
            private_evaluation_hash,
            settlement_artifact_hash,
        } => {
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReturnEscrowFunds,
                "typed private escrow return",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)
                .with_context(|| "failed to fetch typed proposal intent")?;
            let intent_account = accounts::parse_intent(&intent_data)?;

            let refund_recipient_hash =
                decode_hex_32(&refund_recipient_hash, "refund_recipient_hash")?;
            let asset_id_hash = decode_hex_32(&asset_id_hash, "asset_id_hash")?;
            let private_evaluation_hash =
                decode_hex_32(&private_evaluation_hash, "private_evaluation_hash")?;
            let settlement_artifact_hash =
                decode_hex_32(&settlement_artifact_hash, "settlement_artifact_hash")?;
            let policy_ciphertexts_hash = intent_policy_ciphertexts_hash(&intent_account)?;
            let ix = crate::instructions::execute_typed_private_escrow_return(
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                amount_raw.to_le_bytes(),
                crate::message::sha256_hash(escrow_id.as_bytes()),
                refund_recipient_hash,
                asset_id_hash,
                policy_ciphertexts_hash,
                private_evaluation_hash,
                settlement_artifact_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_private_escrow_return",
                "status": "executed",
                "amount_raw": amount_raw.to_string(),
                "escrow_id": escrow_id,
                "refund_recipient_hash": crate::output::hex_of(&refund_recipient_hash),
                "asset_id_hash": crate::output::hex_of(&asset_id_hash),
                "policy_ciphertexts_hash": crate::output::hex_of(&policy_ciphertexts_hash),
                "private_evaluation_hash": crate::output::hex_of(&private_evaluation_hash),
                "settlement_artifact_hash": crate::output::hex_of(&settlement_artifact_hash),
            }));
        }

        ProposalAction::TypedEscrowReturn {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            escrow_id,
            returns,
        } => {
            if returns.is_empty() {
                return Err(anyhow!(
                    "at least one --return recipient:lamports is required"
                ));
            }
            if returns.len() > 16 {
                return Err(anyhow!(
                    "typed escrow return supports at most 16 recipients"
                ));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::ReturnEscrowFunds,
                "typed escrow return",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let parsed_returns = returns
                .iter()
                .map(|row| parse_return_row(row))
                .collect::<Result<Vec<_>>>()?;
            let mut amount_bytes = Vec::with_capacity(parsed_returns.len() * 8);
            let mut funder_accounts = Vec::with_capacity(parsed_returns.len());
            for (recipient, lamports) in &parsed_returns {
                amount_bytes.extend_from_slice(&lamports.to_le_bytes());
                funder_accounts.push(AccountMeta::new(*recipient, false));
            }
            let ix = crate::instructions::execute_typed_escrow_return(
                wallet_pubkey,
                vault_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                crate::message::sha256_hash(escrow_id.as_bytes()),
                &amount_bytes,
                funder_accounts,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_escrow_return",
                "status": "executed",
                "returns": parsed_returns
                    .iter()
                    .map(|(recipient, lamports)| serde_json::json!({
                        "recipient": recipient.to_string(),
                        "amount_lamports": lamports,
                    }))
                    .collect::<Vec<_>>(),
            }));
        }

        ProposalAction::TypedSolSend {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            recipient,
            amount_lamports,
        } => {
            if amount_lamports == 0 {
                return Err(anyhow!("amount-lamports must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::Send,
                "typed SOL send",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let recipient_pubkey: Pubkey = recipient
                .parse()
                .with_context(|| "invalid recipient address")?;
            let ix = crate::instructions::execute_typed_sol_send(
                wallet_pubkey,
                vault_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                recipient_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                amount_lamports,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_sol_send",
                "status": "executed",
                "recipient": recipient_pubkey.to_string(),
                "amount_lamports": amount_lamports,
            }));
        }

        ProposalAction::TypedSolBatchSend {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            payments,
        } => {
            if payments.is_empty() {
                return Err(anyhow!(
                    "at least one --payment recipient:lamports is required"
                ));
            }
            if payments.len() > 16 {
                return Err(anyhow!(
                    "typed SOL batch send supports at most 16 recipients"
                ));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::BatchSend,
                "typed SOL batch send",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let parsed_payments = payments
                .iter()
                .map(|row| parse_recipient_lamports_row(row, "payment"))
                .collect::<Result<Vec<_>>>()?;
            let mut amount_bytes = Vec::with_capacity(parsed_payments.len() * 8);
            let mut recipient_accounts = Vec::with_capacity(parsed_payments.len());
            for (recipient, lamports) in &parsed_payments {
                amount_bytes.extend_from_slice(&lamports.to_le_bytes());
                recipient_accounts.push(AccountMeta::new(*recipient, false));
            }
            let ix = crate::instructions::execute_typed_sol_batch_send(
                wallet_pubkey,
                vault_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                &amount_bytes,
                recipient_accounts,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_sol_batch_send",
                "status": "executed",
                "payments": parsed_payments
                    .iter()
                    .map(|(recipient, lamports)| serde_json::json!({
                        "recipient": recipient.to_string(),
                        "amount_lamports": lamports,
                    }))
                    .collect::<Vec<_>>(),
            }));
        }

        ProposalAction::Approve {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            expiry,
        } => {
            approve_or_cancel(config, &wallet_name, &proposal_addr_str, &expiry, true)?;
        }

        ProposalAction::Cancel {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            expiry,
        } => {
            approve_or_cancel(config, &wallet_name, &proposal_addr_str, &expiry, false)?;
        }

        ProposalAction::Execute {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            dwallet_program,
            grpc_url,
            rpc_url,
            broadcast,
        } => {
            if broadcast && rpc_url.is_none() {
                return Err(anyhow!(
                    "--broadcast requires --rpc-url <URL> for the destination chain"
                ));
            }
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());

            // Resolve wallet by name. Creator-scoped PDA — see
            // intent.rs:120 for context.
            let client = rpc::client(config);
            let (wallet_pubkey, _) = rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            let (vault_addr, _) = clear_wallet_client::pda::find_vault_address(&wallet_addr, &pid);
            let vault_pubkey = Pubkey::new_from_array(vault_addr.to_bytes());

            let proposal_pubkey: Pubkey = proposal_addr_str
                .parse()
                .with_context(|| "invalid proposal address")?;

            let client = rpc::client(config);
            let proposal_data = rpc::fetch_account(&client, &proposal_pubkey)?;
            let proposal_account = accounts::parse_proposal(&proposal_data)?;

            if proposal_account.status != "Approved" {
                return Err(anyhow!(
                    "proposal status is '{}', must be 'Approved' to execute",
                    proposal_account.status
                ));
            }

            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in proposal")?;
            let intent_data = rpc::fetch_account(&client, &intent_pubkey)?;
            let intent_account = accounts::parse_intent(&intent_data)?;

            // Routing:
            // - Meta-intents (AddIntent=0, RemoveIntent=1, UpdateIntent=2)
            //   always run locally — they mutate program state, no remote
            //   chain involved.
            // - Custom intents (3) on chain_kind=0 (Solana) also run via
            //   the local execute path — the program's `execute_custom`
            //   handler does the CPI directly. SOL transfers fall here.
            // - Custom intents on any other chain go through Ika dWallet
            //   signing.
            let is_local = intent_account.intent_type <= 2 || intent_account.chain_kind == 0;
            if is_local {
                let payer_pubkey = solana_sdk::signer::Signer::pubkey(&config.payer);
                let remaining = resolve::resolve_remaining_accounts(
                    &client,
                    &intent_account,
                    &wallet_pubkey,
                    &vault_pubkey,
                    &proposal_account.params_data,
                    &payer_pubkey,
                )?;
                let ix = crate::instructions::execute(
                    wallet_pubkey,
                    vault_pubkey,
                    intent_pubkey,
                    proposal_pubkey,
                    remaining,
                );
                let sig = rpc::send_instruction(&client, config, ix)?;
                let path = if intent_account.intent_type <= 2 {
                    "meta-intent"
                } else {
                    "custom-local"
                };
                print_json(&serde_json::json!({
                    "txid": sig.to_string(),
                    "path": path,
                    "status": "executed",
                }));
            } else {
                let dwallet_program_pk: Pubkey = dwallet_program
                    .ok_or(anyhow!("proposal execution requires --dwallet-program",))?
                    .parse()
                    .with_context(|| "invalid dWallet program ID")?;

                execute_via_ika(
                    config,
                    &client,
                    &wallet_name,
                    wallet_pubkey,
                    intent_pubkey,
                    &intent_account,
                    proposal_pubkey,
                    &proposal_account,
                    dwallet_program_pk,
                    &grpc_url,
                    rpc_url.as_deref(),
                    broadcast,
                )?;
            }
        }

        ProposalAction::List {
            wallet: wallet_name,
        } => {
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());

            // Resolve wallet by name. Creator-scoped PDA upgrade —
            // see comment in intent.rs:120 for context.
            let client = rpc::client(config);
            let (wallet_pubkey, wallet_account) =
                rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            // Iterate all intents, then all proposals for each
            let mut proposals = Vec::new();
            for intent_idx in 0..=wallet_account.intent_index {
                let (intent_addr, _) =
                    clear_wallet_client::pda::find_intent_address(&wallet_addr, intent_idx, &pid);

                // Try fetching proposals for this intent
                // We don't know the exact count, so scan from 0 up to wallet.proposal_index
                for prop_idx in 0..wallet_account.proposal_index {
                    let (proposal_addr, _) = clear_wallet_client::pda::find_proposal_address(
                        &intent_addr,
                        prop_idx,
                        &pid,
                    );
                    let proposal_pubkey = Pubkey::new_from_array(proposal_addr.to_bytes());
                    if let Some(data) = rpc::fetch_account_optional(&client, &proposal_pubkey)? {
                        if let Ok(p) = accounts::parse_proposal(&data) {
                            proposals.push(serde_json::json!({
                                "address": proposal_pubkey.to_string(),
                                "intent_index": intent_idx,
                                "proposal_index": p.proposal_index,
                                "proposer": p.proposer,
                                "status": p.status,
                                "proposed_at": p.proposed_at,
                                "approved_at": p.approved_at,
                                "approval_bitmap": p.approval_bitmap,
                                "cancellation_bitmap": p.cancellation_bitmap,
                            }));
                        }
                    }
                }
            }

            print_json(&proposals);
        }

        ProposalAction::Show {
            proposal: proposal_addr_str,
        } => {
            let proposal_pubkey: Pubkey = proposal_addr_str
                .parse()
                .with_context(|| "invalid proposal address")?;

            let client = rpc::client(config);
            let data = rpc::fetch_account(&client, &proposal_pubkey)?;
            let proposal = accounts::parse_proposal(&data)?;

            print_json(&serde_json::json!({
                "address": proposal_pubkey.to_string(),
                "wallet": proposal.wallet,
                "intent": proposal.intent,
                "proposal_index": proposal.proposal_index,
                "proposer": proposal.proposer,
                "status": proposal.status,
                "proposed_at": proposal.proposed_at,
                "approved_at": proposal.approved_at,
                "approval_bitmap": proposal.approval_bitmap,
                "cancellation_bitmap": proposal.cancellation_bitmap,
                "rent_refund": proposal.rent_refund,
                "params_data": bs58::encode(&proposal.params_data).into_string(),
            }));
        }

        ProposalAction::Cleanup {
            proposal: proposal_addr_str,
        } => {
            let proposal_pubkey: Pubkey = proposal_addr_str
                .parse()
                .with_context(|| "invalid proposal address")?;

            let client = rpc::client(config);
            let data = rpc::fetch_account(&client, &proposal_pubkey)?;
            let (proposal_kind, rent_refund, ix) = match data.first().copied() {
                Some(3) => {
                    let proposal = accounts::parse_proposal(&data)?;
                    let rent_refund: Pubkey = proposal
                        .rent_refund
                        .parse()
                        .with_context(|| "invalid rent_refund address in proposal")?;
                    (
                        "legacy",
                        rent_refund,
                        crate::instructions::cleanup(proposal_pubkey, rent_refund),
                    )
                }
                Some(6) => {
                    let proposal = accounts::parse_typed_proposal(&data)?;
                    let rent_refund: Pubkey = proposal
                        .rent_refund
                        .parse()
                        .with_context(|| "invalid rent_refund address in typed proposal")?;
                    (
                        "typed",
                        rent_refund,
                        crate::instructions::cleanup_typed(proposal_pubkey, rent_refund),
                    )
                }
                Some(discriminator) => {
                    return Err(anyhow!(
                        "account {} is not a proposal account (discriminator={})",
                        proposal_pubkey,
                        discriminator
                    ));
                }
                None => return Err(anyhow!("proposal account data is empty")),
            };
            let sig = rpc::send_instruction(&client, config, ix)?;

            print_json(&serde_json::json!({
                "kind": proposal_kind,
                "rent_refund": rent_refund.to_string(),
                "txid": sig.to_string(),
                "status": "cleaned up",
            }));
        }
    }
    Ok(())
}

/// Drive a remote-chain proposal through Ika: build the destination-chain
/// preimage off-chain, send the on-chain `ika_sign` ix, then run the gRPC
/// presign + sign roundtrip and verify the signature lands in the
/// `MessageApproval` PDA. If `broadcast` is set, also assemble the
/// chain-native signed transaction and push it to `rpc_url`.
#[allow(clippy::too_many_arguments)]
fn execute_via_ika(
    config: &RuntimeConfig,
    client: &solana_client::rpc_client::RpcClient,
    _wallet_name: &str,
    wallet_pubkey: Pubkey,
    intent_pubkey: Pubkey,
    intent_account: &accounts::IntentAccount,
    proposal_pubkey: Pubkey,
    proposal_account: &accounts::ProposalAccount,
    dwallet_program: Pubkey,
    grpc_url: &str,
    rpc_url: Option<&str>,
    broadcast: bool,
) -> Result<()> {
    use crate::ika;
    use std::time::Duration;

    let chain_kind = intent_account.chain_kind;
    eprintln!("→ Remote-chain execution (chain_kind={chain_kind}) via Ika dWallet");

    let program_id = crate::instructions::program_id();

    // 1. Locate the IkaConfig binding for (wallet, chain_kind).
    let (ika_config_pk, _) = ika::ika_config_pda(&program_id, &wallet_pubkey, chain_kind);
    let cfg_data = rpc::fetch_account(client, &ika_config_pk).with_context(|| {
        format!(
            "wallet has no binding for chain_kind={chain_kind}; \
             run `clear-msig wallet add-chain --wallet <name> --chain <name>` first"
        )
    })?;
    let cfg = accounts::parse_ika_config(&cfg_data)?;
    let dwallet_pk: Pubkey = cfg
        .dwallet
        .parse()
        .context("invalid dwallet in IkaConfig")?;
    eprintln!("✓ IkaConfig: {ika_config_pk} → dWallet {dwallet_pk}");

    // 2. Resolve signing params and fetch the dWallet pubkey.
    let (curve, scheme) = ika::signing_params(chain_kind)?;
    let algo = ika::algorithm_for_scheme(scheme);
    let curve_u16 = ika::curve_u16(curve);
    let scheme_u16 = scheme as u16;

    let dwallet_data = rpc::fetch_account(client, &dwallet_pk)
        .with_context(|| format!("failed to fetch dwallet account {dwallet_pk}"))?;
    let dwallet_account = accounts::parse_dwallet(&dwallet_data)?;

    // 3. Build the off-chain preimage and derive the message hash.
    //    For Solana: full tx message (needs dWallet pubkey).
    //    For Zcash: full ZIP-243 preimage.
    //    For others: chain-native preimage.
    let preimage = match chain_kind {
        0 => {
            let dest = ika::read_param_bytes32(intent_account, &proposal_account.params_data, 0)?;
            let amt = ika::read_param_u64(intent_account, &proposal_account.params_data, 1)?;
            let nonce_val =
                ika::read_param_bytes32(intent_account, &proposal_account.params_data, 2)?;
            let off = intent_account.tx_template_offset as usize;
            let nonce_acct: [u8; 32] = intent_account.byte_pool[off..off + 32]
                .try_into()
                .map_err(|_| anyhow!("nonce_account read failed"))?;
            ika::build_solana_tx_message(
                &dwallet_account.public_key[..32].try_into().unwrap(),
                &dest,
                amt,
                &nonce_acct,
                &nonce_val,
            )
        }
        3 => ika::build_zcash_zip243_preimage(intent_account, &proposal_account.params_data)?,
        _ => ika::build_chain_preimage(intent_account, &proposal_account.params_data)?,
    };
    let message_hash = ika::hash_preimage(chain_kind, &preimage);
    eprintln!(
        "✓ Built {}-byte preimage, hash {}",
        preimage.len(),
        hex_lower(&message_hash)
    );

    // 4. Resolve the MessageApproval PDA + bump using hierarchical seeds.
    let tt_off = intent_account.tx_template_offset as usize;
    let tt_len = intent_account.tx_template_len as usize;
    let tx_template = &intent_account.byte_pool[tt_off..tt_off + tt_len];
    let meta_digest = ika::metadata_digest(intent_account.chain_kind, tx_template);
    let (message_approval_pk, message_approval_bump) = ika::message_approval_pda(
        &dwallet_program,
        curve_u16,
        &dwallet_account.public_key,
        scheme_u16,
        &message_hash,
        &meta_digest,
    );
    let (coordinator_pk, _) = ika::coordinator_pda(&dwallet_program);
    let (cpi_authority_pk, cpi_authority_bump) = ika::cpi_authority_pda(&program_id);
    let (dwallet_ownership_pk, _) = ika::dwallet_ownership_pda(&program_id, &dwallet_pk);

    // 5. For Zcash, compute the BLAKE2b sub-hashes so the on-chain program
    //    can build the full ZIP-243 preimage for the MA PDA.
    let blake2b_hashes = if chain_kind == 3 {
        ika::compute_zcash_blake2b_hashes(intent_account, &proposal_account.params_data)?
    } else {
        [0u8; 96]
    };

    let payer_pubkey = solana_sdk::signer::Signer::pubkey(&config.payer);
    let ix = crate::instructions::ika_sign(
        payer_pubkey,
        wallet_pubkey,
        intent_pubkey,
        proposal_pubkey,
        ika_config_pk,
        dwallet_ownership_pk,
        dwallet_pk,
        message_approval_pk,
        coordinator_pk,
        cpi_authority_pk,
        dwallet_program,
        message_approval_bump,
        cpi_authority_bump,
        blake2b_hashes,
    );
    let quorum_tx_sig =
        rpc::send_instruction(client, config, ix).with_context(|| "ika_sign failed")?;
    eprintln!("✓ ika_sign tx: {quorum_tx_sig}");

    // 6. Wait for the MessageApproval PDA to materialize on-chain.
    let ma_data = ika::poll_until(
        client,
        &message_approval_pk,
        |d| d.len() > ika::MA_STATUS && d[0] == ika::DISC_MESSAGE_APPROVAL,
        Duration::from_secs(15),
    )
    .with_context(|| "MessageApproval PDA never appeared after ika_sign")?;
    eprintln!("✓ MessageApproval present: {message_approval_pk}");

    // Build sign_message_for_broadcast unconditionally — needed for the
    // chain-native broadcast in step 9 regardless of whether we have to
    // run the gRPC sign roundtrip.
    let sign_message_for_broadcast: Vec<u8> = match chain_kind {
        0 => {
            // Solana: full transaction message with durable nonce.
            let destination =
                ika::read_param_bytes32(intent_account, &proposal_account.params_data, 0)?;
            let amount = ika::read_param_u64(intent_account, &proposal_account.params_data, 1)?;
            let nonce_value =
                ika::read_param_bytes32(intent_account, &proposal_account.params_data, 2)?;
            let off = intent_account.tx_template_offset as usize;
            let nonce_account: [u8; 32] = intent_account.byte_pool[off..off + 32]
                .try_into()
                .map_err(|_| anyhow!("nonce_account read failed"))?;
            ika::build_solana_tx_message(
                &dwallet_account.public_key[..32].try_into().unwrap(),
                &destination,
                amount,
                &nonce_account,
                &nonce_value,
            )
        }
        3 => ika::build_zcash_zip243_preimage(intent_account, &proposal_account.params_data)?,
        _ => preimage.clone(),
    };

    // 7. gRPC presign+sign — but only when MessageApproval is still
    // pending. After the on-chain ika_sign instruction was made
    // idempotent (skips the Ika CPI when the PDA already exists),
    // retrying a send with identical destination-chain params (same
    // recipient, amount, nonce) lands on a MessageApproval that's
    // already in `signed` state from the prior successful execute.
    // Re-running gRPC presign+sign would either duplicate work or
    // get rejected by Ika; we just reuse the on-chain signature.
    let already_signed =
        ma_data.len() > ika::MA_STATUS && ma_data[ika::MA_STATUS] == ika::MA_STATUS_SIGNED;
    let ma_signed: Vec<u8> = if already_signed {
        eprintln!("✓ MessageApproval already signed — reusing on-chain signature");
        ma_data
    } else {
        // Load the DKG attestation saved during `wallet add-chain` and use its
        // session_identifier as the dwallet_addr — this must match the value
        // the mock stored the key under during DKG. If the Render disk does
        // not have the old file, fall back to the on-chain DWalletAttestation
        // PDA and reconstruct the same payload from chain state.
        let local_attestation = ika::load_attestation(_wallet_name, chain_kind);
        let (dwallet_attestation, dwallet_addr_bytes) = match local_attestation {
            Ok(att) => match attestation_session_for_binding(
                &att,
                &dwallet_account.public_key,
                &cfg.user_pubkey,
            ) {
                Ok(session) => (att, session),
                Err(err) => {
                    eprintln!(
                        "⚠ local attestation does not match the current chain binding: {err}. \
                         Trying on-chain DWalletAttestation PDA."
                    );
                    let chain_att =
                        ika::load_attestation_from_chain(client, &dwallet_program, &dwallet_pk)
                            .with_context(|| "failed to recover dWallet attestation from chain")?;
                    let session = attestation_session_for_binding(
                        &chain_att,
                        &dwallet_account.public_key,
                        &cfg.user_pubkey,
                    )
                    .with_context(|| {
                        "on-chain dWallet attestation does not match the current IkaConfig binding"
                    })?;
                    (chain_att, session)
                }
            },
            Err(err) => {
                eprintln!(
                    "⚠ local attestation load failed: {err}. Trying on-chain DWalletAttestation PDA."
                );
                let chain_att =
                    ika::load_attestation_from_chain(client, &dwallet_program, &dwallet_pk)
                        .with_context(|| "failed to recover dWallet attestation from chain")?;
                let session = attestation_session_for_binding(
                    &chain_att,
                    &dwallet_account.public_key,
                    &cfg.user_pubkey,
                )
                .with_context(|| {
                    "on-chain dWallet attestation does not match the current IkaConfig binding"
                })?;
                (chain_att, session)
            }
        };

        let presign_id = ika::presign(config, grpc_url, dwallet_addr_bytes, curve, algo)?;
        eprintln!("✓ Presign allocated ({} bytes)", presign_id.len());

        // Build the chain-specific (sign_message, message_metadata) pair
        // for the gRPC sign request. sign_message is the same bytes as
        // sign_message_for_broadcast above; message_metadata is empty
        // for non-Zcash, BCS-encoded BLAKE2b personalization for Zcash.
        let sign_message = sign_message_for_broadcast.clone();
        let message_metadata: Vec<u8> = if chain_kind == 3 {
            let off = intent_account.tx_template_offset as usize;
            let branch_id = u32::from_le_bytes(
                intent_account.byte_pool[off + 16..off + 20]
                    .try_into()
                    .unwrap(),
            );
            let personal = ika::zcash_sighash_personal(branch_id);
            let metadata = ika_dwallet_types::Blake2bMessageMetadata {
                personal,
                salt: vec![],
            };
            bcs::to_bytes(&metadata).unwrap_or_default()
        } else {
            vec![]
        };

        let signature = ika::sign(
            config,
            grpc_url,
            dwallet_addr_bytes,
            dwallet_attestation,
            presign_id,
            sign_message,
            message_metadata,
            quorum_tx_sig.as_ref().to_vec(),
        )?;
        eprintln!("✓ Signature received from Ika ({} bytes)", signature.len());

        // 8. Poll MessageApproval until the network commits the signature.
        ika::poll_until(
            client,
            &message_approval_pk,
            |d| d.len() > ika::MA_STATUS && d[ika::MA_STATUS] == ika::MA_STATUS_SIGNED,
            Duration::from_secs(15),
        )
        .with_context(|| "MessageApproval signature not committed on-chain")?
    };
    let onchain_sig_len = u16::from_le_bytes(
        ma_signed[ika::MA_SIGNATURE_LEN..ika::MA_SIGNATURE_LEN + 2]
            .try_into()
            .unwrap(),
    ) as usize;
    let onchain_sig = &ma_signed[ika::MA_SIGNATURE..ika::MA_SIGNATURE + onchain_sig_len];

    // Pre-broadcast verification for EVM. Catches the "stale
    // MessageApproval" case: a prior execute attempt under a
    // different attestation/binding cached an (r,s) that won't
    // ecrecover to the current dWallet pubkey, and the reuse path
    // (`MessageApproval already signed`) would otherwise ship it
    // straight to broadcast, where `recover_v` errors with the
    // cryptic "neither v=0 nor v=1 recovers" toast. Failing here
    // surfaces the same diagnostic dump 30+ seconds earlier and,
    // when the sig was reused, points the operator at the
    // fresh-proposal workaround (different params → different
    // digest → different MessageApproval PDA → fresh sign under
    // the current — validated — binding).
    if matches!(chain_kind, 1 | 4 | 5) && onchain_sig.len() == 64 {
        let mut r_arr = [0u8; 32];
        let mut s_arr = [0u8; 32];
        r_arr.copy_from_slice(&onchain_sig[..32]);
        s_arr.copy_from_slice(&onchain_sig[32..]);
        if let Err(rec_err) = crate::chains::evm::recover_v(
            &message_hash,
            &r_arr,
            &s_arr,
            &dwallet_account.public_key,
        ) {
            let hint = if already_signed {
                format!(
                    " This MessageApproval PDA ({message_approval_pk}) was \
                     signed by a prior execute attempt under a different \
                     dWallet binding and is now poisoned — the Ika program \
                     owns the PDA so clear-msig can't close it. To unblock: \
                     create a new proposal with at least one different \
                     parameter (e.g. bump the EVM nonce by 1). That yields a \
                     different keccak256(preimage), a different MessageApproval \
                     PDA, and a fresh Ika sign under the current binding."
                )
            } else {
                String::new()
            };
            return Err(rec_err.context(format!(
                "on-chain MessageApproval signature does not recover to the \
                 current dWallet pubkey 0x{}.{hint}",
                hex_lower(&dwallet_account.public_key),
            )));
        }
    }

    let mut output = serde_json::json!({
        "txid":             quorum_tx_sig.to_string(),
        "path":             "ika-dwallet",
        "status":           "signed",
        "chain_kind":       chain_kind,
        "preimage_hex":     hex_lower(&preimage),
        "message_hash_hex": hex_lower(&message_hash),
        "signature_hex":    hex_lower(onchain_sig),
        "message_approval": message_approval_pk.to_string(),
    });

    // 9. Optional: assemble the chain-native signed transaction and broadcast.
    if broadcast {
        let rpc_url = rpc_url.expect("--broadcast already validated to require --rpc-url");

        if chain_kind == 0 {
            // Solana: assemble wire tx from sign_message + signature directly.
            // Wire format: [1 (num_sigs compact-u16)] [64-byte sig] [message_bytes]
            // Use `onchain_sig` (read from the MessageApproval account)
            // rather than the gRPC return value — they're the same 64
            // bytes, and onchain_sig is in scope on both the
            // fresh-sign and reuse-existing-sign branches.
            let mut wire_tx = Vec::with_capacity(1 + 64 + sign_message_for_broadcast.len());
            wire_tx.push(1); // 1 signature (compact-u16)
            wire_tx.extend_from_slice(onchain_sig);
            wire_tx.extend_from_slice(&sign_message_for_broadcast);

            let sol_client = solana_client::rpc_client::RpcClient::new(rpc_url.to_string());
            let tx: solana_sdk::transaction::Transaction = bincode::deserialize(&wire_tx)
                .with_context(|| "failed to deserialize Solana transaction")?;
            let tx_sig = sol_client
                .send_and_confirm_transaction(&tx)
                .with_context(|| "failed to send Solana transaction")?;
            eprintln!("✓ Broadcast solana: {tx_sig}");
            output["broadcast"] = serde_json::json!({
                "chain": "solana",
                "chain_kind": 0,
                "tx_id": tx_sig.to_string(),
                "raw_tx_hex": format!("0x{}", hex_lower(&wire_tx)),
            });
        } else {
            let inputs =
                build_broadcast_inputs(chain_kind, intent_account, &proposal_account.params_data)?;

            let result = crate::chains::broadcast_signed_tx(
                chain_kind,
                inputs,
                &preimage,
                onchain_sig,
                &dwallet_account.public_key,
                rpc_url,
            )
            .with_context(|| format!("broadcast to {rpc_url} failed"))?;
            eprintln!("✓ Broadcast {}: {}", result.chain, result.tx_id);
            if let Some(url) = &result.explorer_url {
                eprintln!("  → {url}");
            }
            output["broadcast"] = serde_json::to_value(&result)?;
        }
    }

    print_json(&output);
    Ok(())
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn attestation_session_for_binding(
    attestation: &NetworkSignedAttestation,
    expected_public_key: &[u8],
    expected_session_hex: &str,
) -> Result<[u8; 32]> {
    let versioned: VersionedDWalletDataAttestation = bcs::from_bytes(&attestation.attestation_data)
        .with_context(|| "failed to decode dWallet attestation")?;
    let VersionedDWalletDataAttestation::V1(data) = versioned;

    if data.public_key != expected_public_key {
        return Err(anyhow!(
            "attestation public_key={} but current dWallet public_key={}",
            hex_lower(&data.public_key),
            hex_lower(expected_public_key),
        ));
    }

    let expected_session = parse_hex_local(expected_session_hex)
        .with_context(|| "failed to decode IkaConfig.user_pubkey session id")?;
    if expected_session.len() != 32 {
        return Err(anyhow!(
            "IkaConfig.user_pubkey must be 32 bytes, got {}",
            expected_session.len()
        ));
    }
    if data.session_identifier[..] != expected_session[..] {
        return Err(anyhow!(
            "attestation session_identifier={} but IkaConfig.user_pubkey={}",
            hex_lower(&data.session_identifier),
            expected_session_hex,
        ));
    }

    Ok(data.session_identifier)
}

/// Build the chain-specific [`crate::chains::BroadcastInputs`] payload from
/// the intent's params + tx_template. EVM-compatible chains do not need any
/// extras (the EIP-1559 RLP is fully self-describing), so chains 1, 4, and 5
/// short-circuit to `BroadcastInputs::Evm`. Bitcoin BIP143 commits to its
/// outputs as a hash, so we have to plumb the originals through.
fn build_broadcast_inputs(
    chain_kind: u8,
    intent: &accounts::IntentAccount,
    params_data: &[u8],
) -> Result<crate::chains::BroadcastInputs> {
    use crate::chains::BroadcastInputs;
    use crate::ika;

    match chain_kind {
        0 => {
            let destination = ika::read_param_bytes32(intent, params_data, 0)?;
            let amount_lamports = ika::read_param_u64(intent, params_data, 1)?;
            Ok(BroadcastInputs::Solana {
                destination,
                amount_lamports,
            })
        }
        1 | 4 | 5 => Ok(BroadcastInputs::Evm),
        2 => {
            // Param schema (must match `clear_wallet::chains::bitcoin`):
            //   [0] prev_txid       : Bytes32
            //   [1] prev_vout       : U64 (we use the low 32 bits)
            //   [2] prev_amount     : U64  (committed via BIP143 amount field)
            //   [3] sender_pkh      : Bytes20 (committed via scriptCode)
            //   [4] recipient_pkh   : Bytes20 ← needed for output assembly
            //   [5] send_amount_sats: U64    ← needed for output assembly
            //   [6] change_pkh      : Bytes20 ← v2 optional change output
            //   [7] fee_sats        : U64    ← v2 exact miner fee
            let prev_txid = ika::read_param_bytes32(intent, params_data, 0)?;
            let prev_vout = ika::read_param_u64(intent, params_data, 1)? as u32;
            let prev_amount_sats = ika::read_param_u64(intent, params_data, 2)?;
            // Skip sender_pkh (committed via scriptCode); we don't need it
            // again for the witness tx body.
            let recipient_pkh = ika::read_param_bytes20(intent, params_data, 4)?;
            let send_amount_sats = ika::read_param_u64(intent, params_data, 5)?;
            let (change_pkh, change_amount_sats) = if intent.params.len() >= 8 {
                let change_pkh = ika::read_param_bytes20(intent, params_data, 6)?;
                let fee_sats = ika::read_param_u64(intent, params_data, 7)?;
                let change_amount_sats = prev_amount_sats
                    .checked_sub(send_amount_sats)
                    .and_then(|remaining| remaining.checked_sub(fee_sats))
                    .ok_or_else(|| anyhow!("bitcoin change amount underflow"))?;
                (Some(change_pkh), change_amount_sats)
            } else {
                (None, 0)
            };

            // tx_template layout (16 bytes):
            //   version(4) || lock_time(4) || sequence(4) || sighash_type(4)
            // Pull out sequence + lock_time so the broadcast tx body matches
            // the BIP143 preimage byte-for-byte.
            let off = intent.tx_template_offset as usize;
            let len = intent.tx_template_len as usize;
            if len != 16 {
                return Err(anyhow!(
                    "bitcoin_p2wpkh tx_template must be 16 bytes, got {len}"
                ));
            }
            let tt = intent
                .byte_pool
                .get(off..off + len)
                .ok_or(anyhow!("tx_template OOB"))?;
            let lock_time = u32::from_le_bytes(tt[4..8].try_into().unwrap());
            let sequence = u32::from_le_bytes(tt[8..12].try_into().unwrap());

            Ok(BroadcastInputs::BitcoinP2wpkh {
                prev_txid,
                prev_vout,
                sequence,
                recipient_pkh,
                send_amount_sats,
                change_pkh,
                change_amount_sats,
                lock_time,
            })
        }
        3 => {
            let prev_txid = ika::read_param_bytes32(intent, params_data, 0)?;
            let prev_vout = ika::read_param_u64(intent, params_data, 1)? as u32;
            let sender_pkh = ika::read_param_bytes20(intent, params_data, 3)?;
            let recipient_pkh = ika::read_param_bytes20(intent, params_data, 4)?;
            let send_amount_zat = ika::read_param_u64(intent, params_data, 5)?;

            let off = intent.tx_template_offset as usize;
            let len = intent.tx_template_len as usize;
            if len != 20 {
                return Err(anyhow!(
                    "zcash_transparent tx_template must be 20 bytes, got {len}"
                ));
            }
            let tt = intent
                .byte_pool
                .get(off..off + len)
                .ok_or(anyhow!("tx_template OOB"))?;
            let header = u32::from_le_bytes(tt[0..4].try_into().unwrap());
            let version_group_id = u32::from_le_bytes(tt[4..8].try_into().unwrap());
            let lock_time = u32::from_le_bytes(tt[8..12].try_into().unwrap());
            let expiry_height = u32::from_le_bytes(tt[12..16].try_into().unwrap());

            Ok(BroadcastInputs::ZcashTransparent {
                header,
                version_group_id,
                prev_txid,
                prev_vout,
                sender_pkh,
                recipient_pkh,
                send_amount_zat,
                lock_time,
                expiry_height,
            })
        }
        n => Err(anyhow!("broadcast not supported for chain_kind {n}")),
    }
}

fn parse_hex_local(s: &str) -> Result<Vec<u8>> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.len() % 2 != 0 {
        return Err(anyhow!("hex string has odd length"));
    }
    (0..s.len() / 2)
        .map(|i| {
            u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|e| anyhow!("invalid hex: {e}"))
        })
        .collect()
}

fn decode_hex_32(value: &str, field: &str) -> Result<[u8; 32]> {
    let bytes = parse_hex_local(value).with_context(|| format!("invalid {field} hex"))?;
    if bytes.len() != 32 {
        return Err(anyhow!("{field} must be 32 bytes, got {}", bytes.len()));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn ensure_typed_text(value: &str, field: &str) -> Result<()> {
    if value.trim().is_empty() {
        return Err(anyhow!("{field} must not be empty"));
    }
    if value.as_bytes().len() > 128 {
        return Err(anyhow!("{field} must be 128 bytes or fewer"));
    }
    Ok(())
}

fn typed_vote_message(
    vote_kind: ClearSignVoteKind,
    wallet_name: &str,
    proposal_index: u64,
    envelope_hash: [u8; 32],
    clear_text: &[u8],
) -> Vec<u8> {
    let mut out = Vec::with_capacity(128 + clear_text.len());
    out.extend_from_slice(b"ClearSign v2 ");
    out.extend_from_slice(match vote_kind {
        ClearSignVoteKind::Propose => b"propose",
        ClearSignVoteKind::Approve => b"approve",
        ClearSignVoteKind::Cancel => b"cancel",
    });
    out.extend_from_slice(b"\nWallet ");
    out.extend_from_slice(wallet_name.as_bytes());
    out.extend_from_slice(b"\nProposal ");
    out.extend_from_slice(proposal_index.to_string().as_bytes());
    out.extend_from_slice(b"\nEnvelope ");
    out.extend_from_slice(crate::output::hex_of(&envelope_hash).as_bytes());
    out.extend_from_slice(b"\n\n");
    out.extend_from_slice(clear_text);
    out
}

fn resolve_approved_typed_proposal(
    _config: &RuntimeConfig,
    client: &RpcClient,
    wallet_name: &str,
    proposal_addr_str: &str,
) -> Result<(Pubkey, Pubkey, accounts::TypedProposalAccount)> {
    let (wallet_pubkey, _) = rpc::resolve_wallet_by_name(client, wallet_name)?;
    let proposal_pubkey: Pubkey = proposal_addr_str
        .parse()
        .with_context(|| "invalid proposal address")?;
    let proposal_data = rpc::fetch_account(client, &proposal_pubkey)?;
    let proposal_account = accounts::parse_typed_proposal(&proposal_data)?;
    if proposal_account.wallet != wallet_pubkey.to_string() {
        return Err(anyhow!(
            "typed proposal does not belong to wallet {wallet_name}"
        ));
    }
    if proposal_account.status != "Approved" {
        return Err(anyhow!(
            "typed proposal status is '{}', must be 'Approved' to execute",
            proposal_account.status
        ));
    }
    Ok((wallet_pubkey, proposal_pubkey, proposal_account))
}

fn ensure_typed_action(
    proposal: &accounts::TypedProposalAccount,
    expected: ClearSignActionKind,
    label: &str,
) -> Result<()> {
    if proposal.action_kind != expected.code() {
        return Err(anyhow!(
            "{label} requires action kind {}, got {}",
            expected.code(),
            proposal.action_kind
        ));
    }
    Ok(())
}

fn parse_return_row(row: &str) -> Result<(Pubkey, u64)> {
    parse_recipient_lamports_row(row, "return")
}

fn parse_token_return_row(row: &str) -> Result<(Pubkey, Pubkey, u64)> {
    let mut parts = row.split(':');
    let destination_token = parts
        .next()
        .ok_or_else(|| anyhow!("token return row must be destination_token:funder_owner:tokens"))?
        .parse::<Pubkey>()
        .with_context(|| "invalid token return destination token account address")?;
    let funder_owner = parts
        .next()
        .ok_or_else(|| anyhow!("token return row must be destination_token:funder_owner:tokens"))?
        .parse::<Pubkey>()
        .with_context(|| "invalid token return funder owner address")?;
    let amount_tokens = parts
        .next()
        .ok_or_else(|| anyhow!("token return row must be destination_token:funder_owner:tokens"))?
        .parse::<u64>()
        .with_context(|| "invalid token return token amount")?;
    if parts.next().is_some() {
        return Err(anyhow!(
            "token return row must be destination_token:funder_owner:tokens"
        ));
    }
    if amount_tokens == 0 {
        return Err(anyhow!(
            "token return token amount must be greater than zero"
        ));
    }
    Ok((destination_token, funder_owner, amount_tokens))
}

fn intent_tx_template_hash(intent: &accounts::IntentAccount) -> Result<[u8; 32]> {
    let start = intent.tx_template_offset as usize;
    let end = start
        .checked_add(intent.tx_template_len as usize)
        .ok_or_else(|| anyhow!("intent tx_template range overflow"))?;
    let bytes = intent
        .byte_pool
        .get(start..end)
        .ok_or_else(|| anyhow!("intent tx_template range is outside byte pool"))?;
    Ok(crate::message::sha256_hash(bytes))
}

fn intent_policy_ciphertexts_hash(intent: &accounts::IntentAccount) -> Result<[u8; 32]> {
    if intent.policy_ciphertexts.is_empty() {
        return Err(anyhow!(
            "typed private escrow requires intent policy ciphertext identifiers"
        ));
    }
    Ok(crate::message::sha256_hash(&intent.policy_ciphertexts))
}

fn parse_recipient_lamports_row(row: &str, label: &str) -> Result<(Pubkey, u64)> {
    let (recipient, amount) = row
        .split_once(':')
        .ok_or_else(|| anyhow!("{label} row must be recipient:lamports"))?;
    let recipient = recipient
        .parse::<Pubkey>()
        .with_context(|| format!("invalid {label} recipient address"))?;
    let amount = amount
        .parse::<u64>()
        .with_context(|| format!("invalid {label} lamports amount"))?;
    if amount == 0 {
        return Err(anyhow!("{label} lamports amount must be greater than zero"));
    }
    Ok((recipient, amount))
}

fn vault_pubkey(wallet_pubkey: Pubkey) -> Pubkey {
    let (vault, _) = clear_wallet_client::pda::find_vault_address(
        &solana_address::Address::new_from_array(wallet_pubkey.to_bytes()),
        &solana_address::Address::new_from_array(crate::instructions::program_id().to_bytes()),
    );
    Pubkey::new_from_array(vault.to_bytes())
}

fn typed_approve_or_cancel(
    config: &RuntimeConfig,
    wallet_name: &str,
    proposal_addr_str: &str,
    is_approve: bool,
) -> Result<()> {
    let client = rpc::client(config);
    let (wallet_pubkey, wallet_account) = rpc::resolve_wallet_by_name(&client, wallet_name)?;
    let proposal_pubkey: Pubkey = proposal_addr_str
        .parse()
        .with_context(|| "invalid proposal address")?;
    let proposal_data = rpc::fetch_account(&client, &proposal_pubkey)?;
    let proposal_account = accounts::parse_typed_proposal(&proposal_data)?;
    if proposal_account.wallet != wallet_pubkey.to_string() {
        return Err(anyhow!(
            "typed proposal does not belong to wallet {wallet_name}"
        ));
    }

    let intent_pubkey: Pubkey = proposal_account
        .intent
        .parse()
        .with_context(|| "invalid intent address in typed proposal")?;
    let intent_data = rpc::fetch_account(&client, &intent_pubkey)?;
    let intent_account = accounts::parse_intent(&intent_data)?;
    let signer_pubkey_b58 = bs58::encode(config.signer.pubkey()).into_string();
    let approver_index = intent_account
        .approvers
        .iter()
        .position(|a| a == &signer_pubkey_b58)
        .ok_or(anyhow!(
            "signer {} is not an approver on this intent",
            signer_pubkey_b58
        ))? as u8;

    let action = if is_approve { "approve" } else { "cancel" };
    let member_bit = 1u16
        .checked_shl(approver_index as u32)
        .ok_or_else(|| anyhow!("invalid approver index {approver_index}"))?;
    if is_approve && (proposal_account.approval_bitmap & member_bit) != 0 {
        print_json(&serde_json::json!({
            "txid": null,
            "action": "typed_approve",
            "approver_index": approver_index,
            "status": proposal_account.status,
            "already_recorded": true,
        }));
        return Ok(());
    }
    if !is_approve && (proposal_account.cancellation_bitmap & member_bit) != 0 {
        print_json(&serde_json::json!({
            "txid": null,
            "action": "typed_cancel",
            "approver_index": approver_index,
            "status": proposal_account.status,
            "already_recorded": true,
        }));
        return Ok(());
    }

    let vote_kind = if is_approve {
        ClearSignVoteKind::Approve
    } else {
        ClearSignVoteKind::Cancel
    };
    let vote_message = typed_vote_message(
        vote_kind,
        &wallet_account.name,
        proposal_account.proposal_index,
        proposal_account.envelope_hash,
        &proposal_account.clear_text,
    );

    if config.dry_run {
        print_typed_dry_run(&crate::output::TypedDryRunDescriptor {
            action: if is_approve {
                "proposal_typed_approve"
            } else {
                "proposal_typed_cancel"
            },
            wallet_name: &wallet_account.name,
            wallet_pubkey: wallet_pubkey.to_string(),
            intent_index: intent_account.intent_index,
            intent_pubkey: intent_pubkey.to_string(),
            proposal_pubkey: proposal_pubkey.to_string(),
            proposal_index: proposal_account.proposal_index,
            action_kind: proposal_account.action_kind,
            policy_commitment_hex: crate::output::hex_of(&proposal_account.policy_commitment),
            payload_hash_hex: crate::output::hex_of(&proposal_account.payload_hash),
            envelope_hash_hex: crate::output::hex_of(&proposal_account.envelope_hash),
            action_id: String::from_utf8_lossy(&proposal_account.action_id).to_string(),
            nonce: String::from_utf8_lossy(&proposal_account.nonce).to_string(),
            message_hex: crate::output::hex_of(&vote_message),
            message_flavor: "clearsign_v2_text",
            expiry: proposal_account.expires_at,
        });
        return Ok(());
    }

    eprintln!(
        "Signing ClearSign v2 {action} message:\n{}",
        String::from_utf8_lossy(&vote_message)
    );
    let signed_message = config
        .signed_message_override
        .as_deref()
        .unwrap_or(&vote_message);
    let signature = config.signer.sign_message(signed_message)?;
    let ix = if is_approve {
        crate::instructions::approve_typed(
            wallet_pubkey,
            intent_pubkey,
            proposal_pubkey,
            approver_index,
            signature,
        )
    } else {
        crate::instructions::cancel_typed(
            wallet_pubkey,
            intent_pubkey,
            proposal_pubkey,
            approver_index,
            signature,
        )
    };
    let sig = rpc::send_instruction(&client, config, ix)?;
    print_json(&serde_json::json!({
        "txid": sig.to_string(),
        "action": if is_approve { "typed_approve" } else { "typed_cancel" },
        "approver_index": approver_index,
    }));
    Ok(())
}

/// Shared logic for approve and cancel.
fn approve_or_cancel(
    config: &RuntimeConfig,
    wallet_name: &str,
    proposal_addr_str: &str,
    expiry: &Option<String>,
    is_approve: bool,
) -> Result<()> {
    let expiry_ts = message::resolve_expiry(expiry, config)?;
    let program_id = crate::instructions::program_id();
    let pid = solana_address::Address::new_from_array(program_id.to_bytes());

    // Resolve wallet by name. Creator-scoped PDA upgrade — see
    // intent.rs:120 for context.
    let client = rpc::client(config);
    let (wallet_pubkey, wallet_account) = rpc::resolve_wallet_by_name(&client, wallet_name)?;
    let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

    let proposal_pubkey: Pubkey = proposal_addr_str
        .parse()
        .with_context(|| "invalid proposal address")?;
    let proposal_data = rpc::fetch_account(&client, &proposal_pubkey)?;
    let proposal_account = accounts::parse_proposal(&proposal_data)?;

    let intent_pubkey: Pubkey = proposal_account
        .intent
        .parse()
        .with_context(|| "invalid intent address in proposal")?;
    let intent_data = rpc::fetch_account(&client, &intent_pubkey)?;
    let intent_account = accounts::parse_intent(&intent_data)?;

    // Find our index in the approvers list
    let signer_pubkey_b58 = bs58::encode(config.signer.pubkey()).into_string();
    let approver_index = intent_account
        .approvers
        .iter()
        .position(|a| a == &signer_pubkey_b58)
        .ok_or(anyhow!(
            "signer {} is not an approver on this intent",
            signer_pubkey_b58
        ))? as u8;

    let action = if is_approve { "approve" } else { "cancel" };
    let member_bit = 1u16
        .checked_shl(approver_index as u32)
        .ok_or_else(|| anyhow!("invalid approver index {approver_index}"))?;
    if is_approve && (proposal_account.approval_bitmap & member_bit) != 0 {
        print_json(&serde_json::json!({
            "txid": null,
            "action": action,
            "approver_index": approver_index,
            "status": proposal_account.status,
            "already_recorded": true,
        }));
        return Ok(());
    }
    if !is_approve && (proposal_account.cancellation_bitmap & member_bit) != 0 {
        print_json(&serde_json::json!({
            "txid": null,
            "action": action,
            "approver_index": approver_index,
            "status": proposal_account.status,
            "already_recorded": true,
        }));
        return Ok(());
    }

    let msg = message::build_message(
        action,
        expiry_ts,
        &wallet_account.name,
        proposal_account.proposal_index,
        &intent_account,
        &proposal_account.params_data,
    )?;
    let msg_plain = message::build_plain_message(
        action,
        expiry_ts,
        &wallet_account.name,
        proposal_account.proposal_index,
        &intent_account,
        &proposal_account.params_data,
    )?;

    if config.dry_run {
        crate::output::print_dry_run(&crate::output::DryRunDescriptor {
            action: if is_approve {
                "proposal_approve"
            } else {
                "proposal_cancel"
            },
            wallet_name: &wallet_account.name,
            wallet_pubkey: wallet_pubkey.to_string(),
            intent_index: intent_account.intent_index,
            intent_pubkey: intent_pubkey.to_string(),
            message_hex: crate::output::hex_of(&msg),
            params_data_hex: crate::output::hex_of(&proposal_account.params_data),
            expiry: expiry_ts,
            proposal_pubkey: Some(proposal_pubkey.to_string()),
            proposal_index: Some(proposal_account.proposal_index),
        });
        return Ok(());
    }

    eprintln!("Signing message:\n{}", String::from_utf8_lossy(&msg[20..]));
    let signature =
        sign_message_with_flavor(&*config.signer, &msg, &msg_plain, config.message_flavor)?;

    let ix = if is_approve {
        crate::instructions::approve(
            wallet_pubkey,
            intent_pubkey,
            proposal_pubkey,
            expiry_ts,
            approver_index,
            signature,
        )
    } else {
        crate::instructions::cancel(
            wallet_pubkey,
            intent_pubkey,
            proposal_pubkey,
            expiry_ts,
            approver_index,
            signature,
        )
    };

    let sig = rpc::send_instruction(&client, config, ix)?;

    print_json(&serde_json::json!({
        "txid": sig.to_string(),
        "action": action,
        "approver_index": approver_index,
    }));

    Ok(())
}
