use std::borrow::Cow;

use crate::config::RuntimeConfig;
use crate::error::*;
use crate::output::{print_json, print_typed_dry_run};
use crate::signing::sign_message_with_flavor;
use crate::{accounts, ika, message, params, resolve, rpc};
use clap::Subcommand;
use clear_msig_intent::IntentTransactionJson;
use clear_msig_signing::{
    envelope_hash as hash_v4_envelope, parse_intent as parse_v4_intent,
    render_document as render_v4_document, MAX_DOCUMENT_BYTES as MAX_V4_DOCUMENT_BYTES,
};
use clear_wallet::utils::clearsign::{
    extract_clear_text_from_vote_message, is_v3_document, is_v4_document, validate_v3_document,
    ClearSignActionKind, ClearSignVoteKind,
};
use clear_wallet_client::intent_json::IntentDefinitionBuildExt;
use ika_dwallet_types::{NetworkSignedAttestation, VersionedDWalletDataAttestation};
use solana_sdk::instruction::AccountMeta;
use solana_sdk::pubkey::Pubkey;

mod agent_risk;

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
    /// Create a ClearSign typed proposal
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
        #[arg(long)]
        policy_bytes_hex: Option<String>,
        /// Human-readable ClearSign document derived from the canonical v4 intent.
        ///
        /// Required for dry-run and local signing. Browser pre-signed submits
        /// pass the exact signed readable vote bytes via global --signed-message.
        #[arg(long)]
        signable_text: Option<String>,
        /// Canonical ClearSign v4 intent bytes. When present, payload hash,
        /// readable text, and envelope are derived and legacy inputs are only
        /// accepted as matching assertions.
        #[arg(long)]
        canonical_intent_hex: Option<String>,
        #[arg(long)]
        expiry: Option<String>,
    },
    /// Approve a ClearSign typed proposal
    TypedApprove {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
    },
    /// Cancel a ClearSign typed proposal
    TypedCancel {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
    },
    /// Mark an approved ClearSign typed proposal executed
    TypedExecute {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
    },
    /// Execute an approved typed wallet policy update.
    TypedWalletPolicyUpdate {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        /// New typed policy bytes as hex. Must match the approved SetProtection payload.
        #[arg(long)]
        policy_bytes_hex: String,
        /// Chain kind whose active policy should be replaced (0 SOL, 1 EVM, 2 BTC, 3 ZEC, 4 ERC-20, 5 HyperEVM).
        #[arg(long, default_value_t = 0)]
        chain_kind: u8,
    },
    /// Execute an approved typed membership / threshold / timelock update.
    TypedIntentGovernance {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        /// ClearSign action kind: 3=add_member, 4=remove_member, 5=change_threshold.
        #[arg(long)]
        action_kind: Option<u8>,
        /// Intent index being rewritten (Custom spend intent, not the meta UpdateIntent).
        #[arg(long)]
        target_index: Option<u8>,
        /// New intent body as hex (no discriminator). Preferred when the browser
        /// already built the body via prepare.updateIntent.
        #[arg(long)]
        new_intent_body_hex: Option<String>,
        /// Template file used when building the body server-side.
        #[arg(long)]
        file: Option<String>,
        #[arg(long, value_delimiter = ',')]
        proposers: Option<Vec<String>>,
        #[arg(long, value_delimiter = ',')]
        approvers: Option<Vec<String>>,
        #[arg(long)]
        threshold: Option<u8>,
        #[arg(long, default_value_t = 1)]
        cancellation_threshold: u8,
        #[arg(long, default_value_t = 0)]
        timelock: u32,
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
    /// Finalize an approved typed agent trade decision.
    TypedAgentTradeApproval {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        agent_id_hash: String,
        #[arg(long)]
        venue_hash: String,
        #[arg(long)]
        market_hash: String,
        #[arg(long)]
        side_hash: String,
        #[arg(long)]
        asset_id_hash: String,
        #[arg(long)]
        max_leverage_x100: u32,
        #[arg(long)]
        session_id_hash: String,
        #[arg(long)]
        route_hash: String,
        #[arg(long)]
        risk_check_hash: String,
    },
    /// Grant or revoke a bounded on-chain agent session.
    TypedAgentSessionGrant {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        session_id_hash: String,
        #[arg(long)]
        agent_id_hash: String,
        #[arg(long)]
        venue_hash: String,
        #[arg(long)]
        market_hash: String,
        #[arg(long)]
        max_notional_raw: u128,
        #[arg(long)]
        max_leverage_x100: u32,
        #[arg(long)]
        expires_at: i64,
        #[arg(long)]
        status: u8,
    },
    /// Configure or pause the on-chain loss/oracle policy for an agent session.
    TypedAgentRiskPolicy {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        session_id_hash: String,
        #[arg(long)]
        oracle_policy_hash: String,
        #[arg(long)]
        max_loss_raw: u128,
        #[arg(long)]
        status: u8,
    },
    /// Apply an owner-approved, artifact-bound settlement to agent accounting.
    TypedAgentTradeSettlement {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        session_id_hash: String,
        #[arg(long)]
        execution_id_hash: String,
        #[arg(long)]
        settlement_artifact_hash: String,
        #[arg(long)]
        oracle_policy_hash: String,
        #[arg(long)]
        closed_notional_raw: u128,
        #[arg(long)]
        outcome: u8,
        #[arg(long)]
        pnl_abs_raw: u128,
        #[arg(long)]
        settlement_sequence: u64,
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
    /// Verify and finalize an approved typed BTC/EVM/Zcash/HYPE send.
    TypedChainSend {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        chain_kind: u8,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        recipient_hash: String,
        #[arg(long)]
        asset_id_hash: String,
    },
    /// Sign and optionally broadcast an approved typed remote send via Ika.
    TypedChainSendIka {
        #[arg(long)]
        wallet: String,
        #[arg(long)]
        proposal: String,
        #[arg(long)]
        chain_kind: u8,
        #[arg(long)]
        amount_raw: u128,
        #[arg(long)]
        recipient_hash: String,
        #[arg(long)]
        asset_id_hash: String,
        /// Destination-chain params_data bytes as hex. Must match the signed ClearSign action.
        #[arg(long)]
        params_data_hex: String,
        /// Ika dWallet program ID on the current cluster.
        #[arg(long)]
        dwallet_program: String,
        /// Ika gRPC endpoint.
        #[arg(long, default_value = crate::ika::DEFAULT_GRPC_URL)]
        grpc_url: String,
        /// Destination-chain RPC URL for broadcast.
        #[arg(long)]
        rpc_url: Option<String>,
        /// Broadcast the signed transaction after Ika signing.
        #[arg(long, default_value = "false")]
        broadcast: bool,
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

            crate::progress!("Signing message:\n{}", String::from_utf8_lossy(&msg[20..]));
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
            policy_bytes_hex,
            signable_text,
            canonical_intent_hex,
            expiry,
        } => {
            if canonical_intent_hex.is_none() {
                return Err(anyhow!(
                    "new typed proposals require canonical ClearSign v4 intent bytes"
                ));
            }
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
            let asserted_payload_hash = decode_hex_32(&payload_hash, "payload_hash")?;
            let asserted_envelope_hash = decode_hex_32(&envelope_hash, "envelope_hash")?;
            let policy_bytes = policy_bytes_hex
                .as_deref()
                .map(parse_hex_local)
                .transpose()
                .with_context(|| "invalid policy-bytes-hex")?
                .unwrap_or_default();
            let canonical_intent_bytes = canonical_intent_hex
                .as_deref()
                .map(parse_hex_local)
                .transpose()
                .with_context(|| "invalid canonical-intent-hex")?;
            ensure_typed_text(&action_id, "action_id")?;
            ensure_typed_text(&nonce, "nonce")?;

            let proposal_index = wallet_account.proposal_index;
            let (proposal_addr, _) = clear_wallet_client::pda::find_typed_proposal_address(
                &intent_addr,
                proposal_index,
                &pid,
            );
            let proposal_pubkey = Pubkey::new_from_array(proposal_addr.to_bytes());
            let approval_count_after =
                u8::from(intent_account.approvers.contains(&signer_pubkey_b58));
            let (effective_text, payload_hash, envelope_hash, is_v4) = if let Some(
                canonical_bytes,
            ) =
                canonical_intent_bytes.as_deref()
            {
                let canonical = parse_v4_intent(canonical_bytes)
                    .map_err(|_| anyhow!("canonical intent is malformed or unsupported"))?;
                if canonical.common.proposal_index != proposal_index
                    || canonical.common.wallet_id != wallet_pubkey.to_bytes()
                    || canonical.common.actor != config.signer.pubkey()
                    || canonical.common.expires_at != expiry_ts
                    || canonical.common.approval_required != intent_account.approval_threshold
                    || canonical.common.network.chain_kind() != intent_account.chain_kind
                    || canonical.common.policy_commitment != policy_commitment
                    || canonical.kind().code() != action_kind
                    || canonical.common.action_id
                        != crate::message::sha256_hash(action_id.as_bytes())
                    || canonical.common.nonce != crate::message::sha256_hash(nonce.as_bytes())
                {
                    return Err(anyhow!(
                            "canonical intent does not match current wallet, actor, intent, replay, or policy context"
                        ));
                }
                let submitted_policy_commitment =
                    clear_msig_signing::policy_commitment(&policy_bytes);
                let policy_bytes_match = match canonical.action {
                    clear_msig_signing::Action::PolicyUpdate(policy) => {
                        policy.new_policy_commitment
                            == clear_msig_signing::wallet_policy_commitment(&policy_bytes)
                    }
                    _ => canonical.common.policy_commitment == submitted_policy_commitment,
                };
                if !policy_bytes_match {
                    return Err(anyhow!(
                        "submitted policy bytes do not match the canonical v4 policy action"
                    ));
                }
                let mut rendered = [0u8; MAX_V4_DOCUMENT_BYTES];
                let rendered_len =
                    render_v4_document(&canonical, wallet_account.name.as_bytes(), &mut rendered)
                        .map_err(|_| anyhow!("canonical intent cannot be rendered safely"))?;
                let rendered = rendered[..rendered_len].to_vec();
                if let Some(asserted) = signable_text.as_deref() {
                    if asserted.as_bytes() != rendered {
                        return Err(anyhow!(
                            "--signable-text does not match the program-derived v4 document"
                        ));
                    }
                }
                let derived_payload_hash = canonical.payload_hash();
                let derived_envelope_hash = hash_v4_envelope(
                    &canonical,
                    wallet_account.name.as_bytes(),
                    crate::message::sha256_hash(&rendered),
                )
                .map_err(|_| anyhow!("canonical v4 envelope is invalid"))?;
                if asserted_payload_hash != derived_payload_hash
                    || asserted_envelope_hash != derived_envelope_hash
                {
                    return Err(anyhow!(
                        "legacy hash assertions do not match the canonical v4 intent"
                    ));
                }
                (
                    Cow::Owned(rendered),
                    derived_payload_hash,
                    derived_envelope_hash,
                    true,
                )
            } else {
                let text = signable_text
                    .as_deref()
                    .map(|value| Cow::Borrowed(value.as_bytes()))
                    .ok_or_else(|| anyhow!("--signable-text is required for v3 typed-create"))?;
                (text, asserted_payload_hash, asserted_envelope_hash, false)
            };
            let vote_message = Some(typed_vote_message(
                ClearSignVoteKind::Propose,
                &wallet_account.name,
                &config.signer.pubkey(),
                proposal_index,
                envelope_hash,
                expiry_ts,
                intent_account.approval_threshold,
                approval_count_after,
                effective_text.as_ref(),
            ));

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
                    signer_pubkey: signer_pubkey_b58.clone(),
                    approval_requirement: intent_account.approval_threshold,
                    approval_count_after,
                    approval_kind: "approvals",
                    action_kind,
                    policy_commitment_hex: crate::output::hex_of(&policy_commitment),
                    payload_hash_hex: crate::output::hex_of(&payload_hash),
                    envelope_hash_hex: crate::output::hex_of(&envelope_hash),
                    action_id: action_id.clone(),
                    nonce: nonce.clone(),
                    canonical_intent_hex: canonical_intent_bytes
                        .as_deref()
                        .map(crate::output::hex_of),
                    message_hex: crate::output::hex_of(vote_message),
                    message_flavor: typed_message_flavor(effective_text.as_ref()),
                    expiry: expiry_ts,
                });
                return Ok(());
            }

            crate::progress!(
                "Signing ClearSign proposal document:\n{}",
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
            let signed_clear_text = extract_clear_text_from_vote_message(
                ClearSignVoteKind::Propose,
                wallet_account.name.as_bytes(),
                &config.signer.pubkey(),
                proposal_index,
                envelope_hash,
                expiry_ts,
                intent_account.approval_threshold,
                approval_count_after,
                signed_message,
            )
            .map_err(|_| anyhow!("--signed-message is not a valid ClearSign proposal document"))?;
            if signed_clear_text != effective_text.as_ref() {
                return Err(anyhow!(
                    "signed readable text does not match the canonical dry-run document"
                ));
            }
            if !is_v4 {
                validate_v3_document(signed_clear_text).map_err(|_| {
                    anyhow!("legacy typed proposals require a canonical ClearSign v3 document")
                })?;
            }
            let signature = config.signer.sign_message(signed_message)?;
            let payer_pubkey = solana_sdk::signer::Signer::pubkey(&config.payer);
            let ix = if let Some(canonical_intent) = canonical_intent_bytes.as_deref() {
                crate::instructions::propose_typed_v4(crate::instructions::ProposeTypedV4Args {
                    payer: payer_pubkey,
                    wallet: wallet_pubkey,
                    intent: intent_pubkey,
                    proposal: proposal_pubkey,
                    proposal_index,
                    signature,
                    policy_bytes: &policy_bytes,
                    canonical_intent,
                })
            } else {
                crate::instructions::propose_typed(crate::instructions::ProposeTypedArgs {
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
                    action_id: crate::message::sha256_hash(action_id.as_bytes()),
                    nonce: crate::message::sha256_hash(nonce.as_bytes()),
                    policy_bytes: &policy_bytes,
                    clear_text: signed_clear_text,
                })
            };
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
            ensure_generic_typed_execute_allowed(&proposal_account)?;
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

        ProposalAction::TypedWalletPolicyUpdate {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            policy_bytes_hex,
            chain_kind,
        } => {
            let policy_bytes =
                parse_hex_local(&policy_bytes_hex).with_context(|| "invalid policy-bytes-hex")?;
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::SetProtection,
                "typed wallet policy update",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let ix = crate::instructions::execute_typed_wallet_policy_update(
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet_pubkey,
                wallet_policy_pubkey(wallet_pubkey),
                intent_pubkey,
                proposal_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                chain_kind,
                &policy_bytes,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_wallet_policy_update",
                "status": "executed",
            }));
        }

        ProposalAction::TypedIntentGovernance {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            action_kind,
            target_index,
            new_intent_body_hex,
            file,
            proposers,
            approvers,
            threshold,
            cancellation_threshold,
            timelock,
        } => {
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            let action_kind = action_kind.unwrap_or(proposal_account.action_kind);
            let kind = ClearSignActionKind::from_code(action_kind).ok_or_else(|| {
                anyhow!("invalid action-kind {action_kind} (expected 3, 4, or 5)")
            })?;
            if !matches!(
                kind,
                ClearSignActionKind::AddMember
                    | ClearSignActionKind::RemoveMember
                    | ClearSignActionKind::ChangeThreshold
            ) {
                return Err(anyhow!(
                    "typed-intent-governance only supports action kinds 3/4/5, got {action_kind}"
                ));
            }
            ensure_typed_action(&proposal_account, kind, "typed intent governance")?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            let committed = &proposal_account.policy_bytes;
            let (target_index, new_intent_body) = if new_intent_body_hex.is_none() && file.is_none()
            {
                committed_governance_payload(committed, target_index)?
            } else {
                let target_index = target_index.ok_or_else(|| {
                    anyhow!("--target-index is required with an explicit intent body or file")
                })?;
                let body = if let Some(hex) = new_intent_body_hex {
                    parse_hex_local(&hex).with_context(|| "invalid new-intent-body-hex")?
                } else {
                    let file = file.ok_or_else(|| {
                        anyhow!("typed-intent-governance requires committed bytes or --file")
                    })?;
                    let proposers = proposers.ok_or_else(|| anyhow!("--proposers is required"))?;
                    let approvers = approvers.ok_or_else(|| anyhow!("--approvers is required"))?;
                    let threshold = threshold.ok_or_else(|| {
                        anyhow!("--threshold is required when building from --file")
                    })?;
                    let json_str = std::fs::read_to_string(&file)
                        .with_context(|| format!("reading intent file: {file}"))?;
                    let tx_json: IntentTransactionJson = serde_json::from_str(&json_str)
                        .with_context(|| "parsing intent transaction JSON")?;
                    let full_json = tx_json.with_governance(
                        proposers,
                        approvers,
                        threshold,
                        cancellation_threshold,
                        timelock,
                    );
                    let built = full_json.to_built().map_err(|e| anyhow!("{e}"))?;
                    built.serialize_body(&wallet_addr, 0, target_index, 3)
                };
                (target_index, body)
            };

            let mut expected_committed = Vec::with_capacity(new_intent_body.len() + 1);
            expected_committed.push(target_index);
            expected_committed.extend_from_slice(&new_intent_body);
            if committed != &expected_committed {
                return Err(anyhow!(
                    "execution payload does not match the bytes committed in the typed proposal"
                ));
            }
            let (target_addr, _) =
                clear_wallet_client::pda::find_intent_address(&wallet_addr, target_index, &pid);
            let target_pubkey = Pubkey::new_from_array(target_addr.to_bytes());

            let ix = crate::instructions::execute_typed_intent_governance(
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                target_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                action_kind,
                target_index,
                &new_intent_body,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_intent_governance",
                "target_index": target_index,
                "action_kind": action_kind,
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

        ProposalAction::TypedAgentTradeApproval {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            amount_raw,
            agent_id_hash,
            venue_hash,
            market_hash,
            side_hash,
            asset_id_hash,
            max_leverage_x100,
            session_id_hash,
            route_hash,
            risk_check_hash,
        } => {
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            if max_leverage_x100 == 0 {
                return Err(anyhow!("max-leverage-x100 must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::AgentTradeApproval,
                "typed agent trade approval",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let venue_hash = decode_hex_32(&venue_hash, "venue_hash")?;
            let agent_id_hash = decode_hex_32(&agent_id_hash, "agent_id_hash")?;
            let market_hash = decode_hex_32(&market_hash, "market_hash")?;
            let side_hash = decode_hex_32(&side_hash, "side_hash")?;
            let asset_id_hash = decode_hex_32(&asset_id_hash, "asset_id_hash")?;
            let session_id_hash = decode_hex_32(&session_id_hash, "session_id_hash")?;
            let route_hash = decode_hex_32(&route_hash, "route_hash")?;
            let risk_check_hash = decode_hex_32(&risk_check_hash, "risk_check_hash")?;
            let session_pubkey = agent_session_pubkey(wallet_pubkey, session_id_hash);
            let risk_ledger_pubkey = agent_risk::risk_pubkey(wallet_pubkey, session_id_hash);
            let ix = crate::instructions::execute_typed_agent_trade_approval(
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                session_pubkey,
                risk_ledger_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                amount_raw.to_le_bytes(),
                agent_id_hash,
                venue_hash,
                market_hash,
                side_hash,
                asset_id_hash,
                max_leverage_x100,
                session_id_hash,
                route_hash,
                risk_check_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_agent_trade_approval",
                "status": "executed",
                "amount_raw": amount_raw.to_string(),
                "agent_id_hash": crate::output::hex_of(&agent_id_hash),
                "venue_hash": crate::output::hex_of(&venue_hash),
                "market_hash": crate::output::hex_of(&market_hash),
                "side_hash": crate::output::hex_of(&side_hash),
                "asset_id_hash": crate::output::hex_of(&asset_id_hash),
                "max_leverage_x100": max_leverage_x100,
                "session_id_hash": crate::output::hex_of(&session_id_hash),
                "route_hash": crate::output::hex_of(&route_hash),
                "risk_check_hash": crate::output::hex_of(&risk_check_hash),
                "session": session_pubkey.to_string(),
                "risk_ledger": risk_ledger_pubkey.to_string(),
            }));
        }

        ProposalAction::TypedAgentSessionGrant {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            session_id_hash,
            agent_id_hash,
            venue_hash,
            market_hash,
            max_notional_raw,
            max_leverage_x100,
            expires_at,
            status,
        } => {
            if status != 1 && status != 2 {
                return Err(anyhow!("status must be 1 (active) or 2 (revoked)"));
            }
            if status == 1 && (max_notional_raw == 0 || max_leverage_x100 == 0) {
                return Err(anyhow!(
                    "active session requires positive notional and leverage"
                ));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::AgentSessionGrant,
                "typed agent session grant",
            )?;
            let intent_pubkey: Pubkey = proposal_account
                .intent
                .parse()
                .with_context(|| "invalid intent address in typed proposal")?;
            let session_id_hash = decode_hex_32(&session_id_hash, "session_id_hash")?;
            let agent_id_hash = decode_hex_32(&agent_id_hash, "agent_id_hash")?;
            let venue_hash = decode_hex_32(&venue_hash, "venue_hash")?;
            let market_hash = decode_hex_32(&market_hash, "market_hash")?;
            let session = agent_session_pubkey(wallet_pubkey, session_id_hash);
            let ix = crate::instructions::execute_typed_agent_session_grant(
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet_pubkey,
                intent_pubkey,
                proposal_pubkey,
                session,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                session_id_hash,
                agent_id_hash,
                venue_hash,
                market_hash,
                max_notional_raw.to_le_bytes(),
                max_leverage_x100,
                expires_at,
                status,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_agent_session_grant",
                "status": "executed",
                "session": session.to_string(),
            }));
        }

        ProposalAction::TypedAgentRiskPolicy {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            session_id_hash,
            oracle_policy_hash,
            max_loss_raw,
            status,
        } => agent_risk::execute_risk_policy(
            config,
            agent_risk::RiskPolicyExecution {
                wallet: wallet_name,
                proposal: proposal_addr_str,
                session_id_hash,
                oracle_policy_hash,
                max_loss_raw,
                status,
            },
        )?,

        ProposalAction::TypedAgentTradeSettlement {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            session_id_hash,
            execution_id_hash,
            settlement_artifact_hash,
            oracle_policy_hash,
            closed_notional_raw,
            outcome,
            pnl_abs_raw,
            settlement_sequence,
        } => agent_risk::execute_settlement(
            config,
            agent_risk::SettlementExecution {
                wallet: wallet_name,
                proposal: proposal_addr_str,
                session_id_hash,
                execution_id_hash,
                settlement_artifact_hash,
                oracle_policy_hash,
                closed_notional_raw,
                outcome,
                pnl_abs_raw,
                settlement_sequence,
            },
        )?,

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
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet_pubkey,
                wallet_policy_pubkey(wallet_pubkey),
                policy_spend_pubkey(wallet_pubkey, intent_pubkey),
                member_allowance_pubkey(wallet_pubkey, intent_pubkey),
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

        ProposalAction::TypedChainSend {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            chain_kind,
            amount_raw,
            recipient_hash,
            asset_id_hash,
        } => {
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::Send,
                "typed chain send",
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
                    "typed chain send chain_kind mismatch: intent has {}, command got {}",
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
            let tx_template_hash = intent_tx_template_hash(&intent_account)?;
            let ix = crate::instructions::execute_typed_chain_send(
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet_pubkey,
                wallet_policy_pubkey(wallet_pubkey),
                policy_spend_pubkey(wallet_pubkey, intent_pubkey),
                member_allowance_pubkey(wallet_pubkey, intent_pubkey),
                intent_pubkey,
                proposal_pubkey,
                ika_config_pubkey,
                dwallet_pubkey,
                proposal_account.policy_commitment,
                proposal_account.envelope_hash,
                chain_kind,
                amount_raw.to_le_bytes(),
                recipient_hash,
                asset_id_hash,
                tx_template_hash,
            );
            let sig = rpc::send_instruction(&client, config, ix)?;
            print_json(&serde_json::json!({
                "txid": sig.to_string(),
                "proposal": proposal_pubkey.to_string(),
                "path": "typed_chain_send",
                "status": "executed",
                "chain_kind": chain_kind,
                "amount_raw": amount_raw.to_string(),
                "recipient_hash": crate::output::hex_of(&recipient_hash),
                "asset_id_hash": crate::output::hex_of(&asset_id_hash),
                "ika_config": ika_config_pubkey.to_string(),
                "dwallet": dwallet_pubkey.to_string(),
                "tx_template_hash": crate::output::hex_of(&tx_template_hash),
            }));
        }

        ProposalAction::TypedChainSendIka {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            chain_kind,
            amount_raw,
            recipient_hash,
            asset_id_hash,
            params_data_hex,
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
            if amount_raw == 0 {
                return Err(anyhow!("amount-raw must be greater than zero"));
            }
            if !matches!(chain_kind, 1 | 2 | 3 | 4 | 5) {
                return Err(anyhow!(
                    "typed-chain-send-ika currently supports chain kinds 1 through 5"
                ));
            }

            let client = rpc::client(config);
            let (wallet_pubkey, proposal_pubkey, proposal_account) =
                resolve_approved_typed_proposal(config, &client, &wallet_name, &proposal_addr_str)?;
            ensure_typed_action(
                &proposal_account,
                ClearSignActionKind::Send,
                "typed chain send Ika",
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
                    "typed chain send Ika chain_kind mismatch: intent has {}, command got {}",
                    intent_account.chain_kind,
                    chain_kind
                ));
            }

            let params_data =
                parse_hex_local(&params_data_hex).with_context(|| "invalid params_data_hex")?;
            let recipient_hash = decode_hex_32(&recipient_hash, "recipient_hash")?;
            let asset_id_hash = decode_hex_32(&asset_id_hash, "asset_id_hash")?;
            let tx_template_hash = intent_tx_template_hash(&intent_account)?;
            let dwallet_program_pk: Pubkey = dwallet_program
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
                &params_data,
                dwallet_program_pk,
                &grpc_url,
                rpc_url.as_deref(),
                broadcast,
                IkaOnchainSignMode::TypedChainSend {
                    policy_commitment: proposal_account.policy_commitment,
                    envelope_hash: proposal_account.envelope_hash,
                    amount_raw_le: amount_raw.to_le_bytes(),
                    recipient_hash,
                    asset_id_hash,
                    tx_template_hash,
                },
            )?;
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
                solana_sdk::signer::Signer::pubkey(&config.payer),
                wallet_pubkey,
                wallet_policy_pubkey(wallet_pubkey),
                policy_spend_pubkey(wallet_pubkey, intent_pubkey),
                member_allowance_pubkey(wallet_pubkey, intent_pubkey),
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
                    &proposal_account.params_data,
                    dwallet_program_pk,
                    &grpc_url,
                    rpc_url.as_deref(),
                    broadcast,
                    IkaOnchainSignMode::LegacyProposal,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn typed_proposal(action_kind: ClearSignActionKind) -> accounts::TypedProposalAccount {
        accounts::TypedProposalAccount {
            wallet: "wallet".into(),
            intent: "intent".into(),
            proposal_index: 1,
            proposer: "proposer".into(),
            status: "Approved".into(),
            action_kind: action_kind.code(),
            proposed_at: 0,
            approved_at: 0,
            expires_at: 1,
            bump: 1,
            approval_bitmap: 1,
            cancellation_bitmap: 0,
            rent_refund: "payer".into(),
            policy_commitment: [0; 32],
            payload_hash: [0; 32],
            envelope_hash: [0; 32],
            action_id: Vec::new(),
            nonce: Vec::new(),
            policy_bytes: Vec::new(),
            clear_text: Vec::new(),
        }
    }

    #[test]
    fn generic_typed_execute_rejects_specialized_state_mutations() {
        for kind in [
            ClearSignActionKind::AddMember,
            ClearSignActionKind::RemoveMember,
            ClearSignActionKind::ChangeThreshold,
            ClearSignActionKind::SetProtection,
        ] {
            let proposal = typed_proposal(kind);
            let error = ensure_generic_typed_execute_allowed(&proposal)
                .expect_err("specialized action should not use generic typed-execute")
                .to_string();
            assert!(error.contains("generic typed-execute would not apply the state change"));
        }

        let proposal = typed_proposal(ClearSignActionKind::RecoveryAction);
        ensure_generic_typed_execute_allowed(&proposal).expect("generic action should be allowed");
    }

    #[test]
    fn governance_resume_uses_exact_committed_target_and_body() {
        let committed = [3u8, 2, 0, 9, 8];
        assert_eq!(
            committed_governance_payload(&committed, None).unwrap(),
            (3, vec![2, 0, 9, 8])
        );
        assert!(committed_governance_payload(&committed, Some(4))
            .unwrap_err()
            .to_string()
            .contains("does not match committed target"));
        assert!(committed_governance_payload(&[3], None).is_err());
    }

    #[test]
    fn interrupted_ika_execution_reuses_only_a_signed_message_approval() {
        let mut pending = vec![0u8; ika::MA_STATUS + 1];
        pending[ika::MA_STATUS] = 0;
        assert!(!message_approval_is_signed(&pending));

        let mut signed = pending.clone();
        signed[ika::MA_STATUS] = ika::MA_STATUS_SIGNED;
        assert!(message_approval_is_signed(&signed));
        assert!(!message_approval_is_signed(&[]));
    }
}

mod execution;
use execution::*;
