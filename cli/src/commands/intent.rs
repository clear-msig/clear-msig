use crate::config::RuntimeConfig;
use crate::error::*;
use crate::output::{print_dry_run, print_json, DryRunDescriptor};
use crate::signing::sign_message_with_fallback;
use crate::{accounts, message, rpc};
use clap::Subcommand;
use clear_wallet_client::intent_builder::BuiltIntent;
use clear_wallet_client::intent_json::IntentTransactionJson;
use solana_address::Address;
use solana_pubkey::Pubkey;

#[derive(Subcommand)]
pub enum IntentAction {
    /// Add a new intent to a wallet (proposes via AddIntent).
    ///
    /// Two modes:
    /// - Classic: supply `--file` + `--proposers` + `--approvers` + `--threshold`.
    ///   The CLI builds the intent body and signs locally.
    /// - Pre-signed: supply the global `--params-data <hex>` (= serialized
    ///   intent body built by the caller) + `--signer-pubkey` + `--signature`.
    ///   `--file` and governance flags are ignored.
    Add {
        /// Wallet name
        #[arg(long)]
        wallet: String,
        /// Path to intent JSON file (transaction definition only). Required
        /// in classic mode; ignored in pre-signed mode.
        #[arg(long)]
        file: Option<String>,
        /// Comma-separated proposer addresses for this intent.
        #[arg(long, value_delimiter = ',')]
        proposers: Vec<String>,
        /// Comma-separated approver addresses for this intent.
        #[arg(long, value_delimiter = ',')]
        approvers: Vec<String>,
        /// Approval threshold for this intent.
        #[arg(long)]
        threshold: Option<u8>,
        /// Cancellation threshold
        #[arg(long, default_value = "1")]
        cancellation_threshold: u8,
        /// Timelock in seconds
        #[arg(long, default_value = "0")]
        timelock: u32,
        /// Message expiry (YYYY-MM-DD HH:MM:SS). Defaults to now + configured expiry_seconds.
        #[arg(long)]
        expiry: Option<String>,
        /// Encrypt ciphertext identifiers covering the policy fields
        /// (proposers / approvers / threshold / timelock). Stored in the
        /// intent payload for future Encrypt-aware execution paths; the
        /// program still needs `#[encrypt_fn]` handlers before these IDs
        /// become an enforcement boundary.
        #[arg(long, value_delimiter = ',')]
        policy_ciphertexts: Vec<String>,
    },
    /// Remove an intent from a wallet (proposes via RemoveIntent).
    Remove {
        #[arg(long)]
        wallet: String,
        /// Intent index to remove.
        #[arg(long)]
        index: u8,
        /// Message expiry (YYYY-MM-DD HH:MM:SS). Defaults to now + configured expiry_seconds.
        #[arg(long)]
        expiry: Option<String>,
    },
    /// Update an intent's definition (proposes via UpdateIntent).
    Update {
        #[arg(long)]
        wallet: String,
        /// Intent index to update.
        #[arg(long)]
        index: u8,
        /// Path to new intent JSON file. Required in classic mode; ignored
        /// when pre-signed `--params-data` is supplied.
        #[arg(long)]
        file: Option<String>,
        #[arg(long, value_delimiter = ',')]
        proposers: Vec<String>,
        #[arg(long, value_delimiter = ',')]
        approvers: Vec<String>,
        #[arg(long)]
        threshold: Option<u8>,
        #[arg(long, default_value = "1")]
        cancellation_threshold: u8,
        #[arg(long, default_value = "0")]
        timelock: u32,
        /// Message expiry (YYYY-MM-DD HH:MM:SS). Defaults to now + configured expiry_seconds.
        #[arg(long)]
        expiry: Option<String>,
        /// Encrypt ciphertext identifiers for the new policy fields.
        /// Stored in the intent payload for future Encrypt-aware execution
        /// paths. See `Add::policy_ciphertexts`.
        #[arg(long, value_delimiter = ',')]
        policy_ciphertexts: Vec<String>,
    },
    /// Rewrite only the human-readable template string on an existing
    /// Custom intent. Governance + params + accounts + instructions
    /// stay byte-identical; only the wallet-popup label changes.
    ///
    /// Implementation: fetch the existing intent on chain, splice the
    /// new template into the byte pool (template lives at the end of
    /// the pool, immediately before tx_template, so the splice is
    /// contiguous), reserialize, then run the standard UpdateIntent
    /// proposal flow. Approval threshold and the rest of the multisig
    /// machinery applies — this is not a unilateral edit.
    UpdateTemplate {
        #[arg(long)]
        wallet: String,
        /// Intent index whose template to rewrite. Must be a Custom
        /// intent (index >= 3); meta-intents 0/1/2 don't have a
        /// user-visible template.
        #[arg(long)]
        index: u8,
        /// New template string. Same syntax as the original — `{N}`
        /// references param N, `{N:10^D}` scales a u64 by 10^D.
        #[arg(long)]
        template: String,
        /// Message expiry (YYYY-MM-DD HH:MM:SS). Defaults to now + configured expiry_seconds.
        #[arg(long)]
        expiry: Option<String>,
    },
    /// List all intents on a wallet.
    List {
        #[arg(long)]
        wallet: String,
    },
}

pub fn handle(action: IntentAction, config: &RuntimeConfig) -> Result<()> {
    match action {
        IntentAction::Add {
            wallet: wallet_name,
            file,
            proposers,
            approvers,
            threshold,
            cancellation_threshold,
            timelock,
            expiry,
            policy_ciphertexts,
        } => {
            let policy_ciphertext_bytes = accounts::encode_policy_ciphertexts(&policy_ciphertexts)?;
            if !policy_ciphertexts.is_empty() {
                eprintln!(
                    "[encrypt] intent-add storing {} policy ciphertext id(s): {}",
                    policy_ciphertexts.len(),
                    policy_ciphertexts.join(", ")
                );
            }
            let expiry_ts = message::resolve_expiry(&expiry, config)?;
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());

            // Resolve wallet by name. Creator-scoped PDA: the seeds
            // include the creator pubkey, which we don't know from the
            // command line, so scan instead. resolve_wallet_by_name
            // returns the parsed account so we don't need the
            // separate fetch + parse the old PDA-derive path used.
            let client = rpc::client(config);
            let (wallet_pubkey, wallet_account) =
                rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            // params_data for AddIntent = the serialized intent body. In
            // pre-signed mode the browser built and signed over a specific
            // byte sequence — we MUST use those bytes verbatim. In classic
            // mode we load JSON + governance and build the body locally.
            let params_data: Vec<u8> = match &config.params_data_override {
                Some(bytes) => bytes.clone(),
                None => {
                    let file = file.ok_or_else(|| {
                        anyhow!(
                            "intent add requires --file (intent JSON path) \
                             OR --params-data (pre-built intent body in hex)"
                        )
                    })?;
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
                    let mut built = full_json.to_built().map_err(|e| anyhow!("{e}"))?;
                    built.policy_ciphertexts = policy_ciphertext_bytes.clone();
                    let next_index = wallet_account.intent_index + 1;
                    built.serialize_body(
                        &wallet_addr,
                        0, // bump will be computed on-chain
                        next_index,
                        3, // Custom intent type
                    )
                }
            };

            // AddIntent is at index 0 — read it for the message builder.
            let (add_intent_addr, _) =
                clear_wallet_client::pda::find_intent_address(&wallet_addr, 0, &pid);
            let add_intent_pubkey = Pubkey::new_from_array(add_intent_addr.to_bytes());
            let intent_data = rpc::fetch_account(&client, &add_intent_pubkey)?;
            let intent_account = accounts::parse_intent(&intent_data)?;

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

            let (proposal_addr, _) = clear_wallet_client::pda::find_proposal_address(
                &add_intent_addr,
                proposal_index,
                &pid,
            );

            if config.dry_run {
                print_dry_run(&DryRunDescriptor {
                    action: "intent_add",
                    wallet_name: &wallet_account.name,
                    wallet_pubkey: wallet_pubkey.to_string(),
                    intent_index: 0,
                    intent_pubkey: add_intent_pubkey.to_string(),
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
            let signature = sign_message_with_fallback(&*config.signer, &msg, &msg_plain)?;
            let proposer_pubkey = config.signer.pubkey();

            let payer_pubkey = solana_signer::Signer::pubkey(&config.payer);
            let ix = crate::instructions::propose(crate::instructions::ProposeArgs {
                payer: payer_pubkey,
                wallet: wallet_pubkey,
                intent: add_intent_pubkey,
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
                "intent_index": 0,
                "action": "add_intent",
            }));
        }
        IntentAction::Remove {
            wallet: wallet_name,
            index,
            expiry,
        } => {
            let expiry_ts = message::resolve_expiry(&expiry, config)?;
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());

            // Resolve wallet by name. Creator-scoped PDA: the seeds
            // include the creator pubkey, which we don't know from the
            // command line, so scan instead. resolve_wallet_by_name
            // returns the parsed account so we don't need the
            // separate fetch + parse the old PDA-derive path used.
            let client = rpc::client(config);
            let (wallet_pubkey, wallet_account) =
                rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            // RemoveIntent params_data = [target_index]. Pre-signed mode
            // can override the whole byte buffer for symmetry with the
            // other intent commands, but the default is always `[index]`.
            let params_data: Vec<u8> = config
                .params_data_override
                .clone()
                .unwrap_or_else(|| vec![index]);

            let (remove_intent_addr, _) =
                clear_wallet_client::pda::find_intent_address(&wallet_addr, 1, &pid);
            let remove_intent_pubkey = Pubkey::new_from_array(remove_intent_addr.to_bytes());
            let intent_data = rpc::fetch_account(&client, &remove_intent_pubkey)?;
            let intent_account = accounts::parse_intent(&intent_data)?;

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

            let (proposal_addr, _) = clear_wallet_client::pda::find_proposal_address(
                &remove_intent_addr,
                proposal_index,
                &pid,
            );

            if config.dry_run {
                print_dry_run(&DryRunDescriptor {
                    action: "intent_remove",
                    wallet_name: &wallet_account.name,
                    wallet_pubkey: wallet_pubkey.to_string(),
                    intent_index: 1,
                    intent_pubkey: remove_intent_pubkey.to_string(),
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
            let signature = sign_message_with_fallback(&*config.signer, &msg, &msg_plain)?;
            let proposer_pubkey = config.signer.pubkey();

            let payer_pubkey = solana_signer::Signer::pubkey(&config.payer);
            let ix = crate::instructions::propose(crate::instructions::ProposeArgs {
                payer: payer_pubkey,
                wallet: wallet_pubkey,
                intent: remove_intent_pubkey,
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
                "intent_index": 1,
                "action": "remove_intent",
                "target_index": index,
            }));
        }
        IntentAction::Update {
            wallet: wallet_name,
            index,
            file,
            proposers,
            approvers,
            threshold,
            cancellation_threshold,
            timelock,
            expiry,
            policy_ciphertexts,
        } => {
            let policy_ciphertext_bytes = accounts::encode_policy_ciphertexts(&policy_ciphertexts)?;
            if !policy_ciphertexts.is_empty() {
                eprintln!(
                    "[encrypt] intent-update storing {} policy ciphertext id(s): {}",
                    policy_ciphertexts.len(),
                    policy_ciphertexts.join(", ")
                );
            }
            let expiry_ts = message::resolve_expiry(&expiry, config)?;
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());

            // Resolve wallet by name. Creator-scoped PDA: the seeds
            // include the creator pubkey, which we don't know from the
            // command line, so scan instead. resolve_wallet_by_name
            // returns the parsed account so we don't need the
            // separate fetch + parse the old PDA-derive path used.
            let client = rpc::client(config);
            let (wallet_pubkey, wallet_account) =
                rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            // UpdateIntent params_data = [target_index, ...new_intent_body].
            // Pre-signed: override supplies the full buffer — caller is
            // responsible for including the leading target_index byte.
            let params_data: Vec<u8> = match &config.params_data_override {
                Some(bytes) => {
                    if bytes.is_empty() {
                        return Err(anyhow!(
                            "intent update --params-data must be non-empty \
                             (first byte is the target intent index)"
                        ));
                    }
                    if bytes[0] != index {
                        return Err(anyhow!(
                            "intent update --index {index} does not match \
                             the first byte of --params-data ({})",
                            bytes[0]
                        ));
                    }
                    bytes.clone()
                }
                None => {
                    let file = file.ok_or_else(|| {
                        anyhow!(
                            "intent update requires --file OR --params-data \
                             (pre-built [target_index, ...body] buffer)"
                        )
                    })?;
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
                    let mut built = full_json.to_built().map_err(|e| anyhow!("{e}"))?;
                    built.policy_ciphertexts = policy_ciphertext_bytes.clone();
                    let intent_body = built.serialize_body(&wallet_addr, 0, index, 3);
                    let mut buf = Vec::with_capacity(1 + intent_body.len());
                    buf.push(index);
                    buf.extend_from_slice(&intent_body);
                    buf
                }
            };

            let (update_intent_addr, _) =
                clear_wallet_client::pda::find_intent_address(&wallet_addr, 2, &pid);
            let update_intent_pubkey = Pubkey::new_from_array(update_intent_addr.to_bytes());
            let intent_data = rpc::fetch_account(&client, &update_intent_pubkey)?;
            let intent_account = accounts::parse_intent(&intent_data)?;

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

            let (proposal_addr, _) = clear_wallet_client::pda::find_proposal_address(
                &update_intent_addr,
                proposal_index,
                &pid,
            );

            if config.dry_run {
                print_dry_run(&DryRunDescriptor {
                    action: "intent_update",
                    wallet_name: &wallet_account.name,
                    wallet_pubkey: wallet_pubkey.to_string(),
                    intent_index: 2,
                    intent_pubkey: update_intent_pubkey.to_string(),
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
            let signature = sign_message_with_fallback(&*config.signer, &msg, &msg_plain)?;
            let proposer_pubkey = config.signer.pubkey();

            let payer_pubkey = solana_signer::Signer::pubkey(&config.payer);
            let ix = crate::instructions::propose(crate::instructions::ProposeArgs {
                payer: payer_pubkey,
                wallet: wallet_pubkey,
                intent: update_intent_pubkey,
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
                "intent_index": 2,
                "action": "update_intent",
                "target_index": index,
            }));
        }
        IntentAction::UpdateTemplate {
            wallet: wallet_name,
            index,
            template: new_template,
            expiry,
        } => {
            let expiry_ts = message::resolve_expiry(&expiry, config)?;
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());

            let client = rpc::client(config);
            let (wallet_pubkey, wallet_account) =
                rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            // Load the existing intent at `index` and reproject it as a
            // BuiltIntent with the template swapped. We touch only the
            // template bytes in the pool and the two template-related
            // offsets — every other byte the on-chain intent currently
            // holds is preserved verbatim.
            let (target_intent_addr, _) =
                clear_wallet_client::pda::find_intent_address(&wallet_addr, index, &pid);
            let target_intent_pk = Pubkey::new_from_array(target_intent_addr.to_bytes());
            let target_data =
                rpc::fetch_account(&client, &target_intent_pk).with_context(|| {
                    format!("no intent found at index {index} on wallet `{wallet_name}`")
                })?;
            let target = accounts::parse_intent(&target_data)?;
            if target.intent_type != 3 {
                return Err(anyhow!(
                    "intent at index {index} is a meta-intent (type {}); only \
                     Custom intents (type 3) have a user-visible template",
                    target.intent_type
                ));
            }

            // Template lives at [template_offset .. template_offset+template_len]
            // and tx_template lives at [tx_template_offset .. +tx_template_len],
            // contiguous with the former. Splice: keep everything before the
            // template, write the new template bytes, then append the
            // unchanged tx_template tail. Earlier-in-pool data (param names,
            // account_indexes, segments, seeds) is unaffected because every
            // pool reference except tx_template_offset targets bytes BEFORE
            // template_offset.
            let template_offset_old = target.template_offset as usize;
            let template_len_old = target.template_len as usize;
            let tx_template_offset_old = target.tx_template_offset as usize;
            let tx_template_len = target.tx_template_len as usize;
            if tx_template_offset_old != template_offset_old + template_len_old {
                return Err(anyhow!(
                    "unexpected pool layout: tx_template_offset ({}) is not \
                     immediately after template (template_offset {} + len {}). \
                     This intent wasn't produced by the standard builder; \
                     update-template can't safely splice it.",
                    tx_template_offset_old,
                    template_offset_old,
                    template_len_old
                ));
            }
            let new_template_bytes = new_template.as_bytes();
            let new_template_len = new_template_bytes.len();
            // u16 ceiling on pool offsets: the rest-of-pool offsets are all
            // < template_offset, so they stay valid. We only need to check
            // that the new pool length still fits in u16 (tx_template_offset
            // is u16) and that template_len itself fits.
            if new_template_len > u16::MAX as usize {
                return Err(anyhow!(
                    "template too long: {} bytes (max {})",
                    new_template_len,
                    u16::MAX
                ));
            }
            let new_pool_len = template_offset_old + new_template_len + tx_template_len;
            if new_pool_len > u16::MAX as usize {
                return Err(anyhow!(
                    "new template would push pool past u16 ({} bytes); shorten the template",
                    new_pool_len
                ));
            }

            let mut new_pool = Vec::with_capacity(new_pool_len);
            new_pool.extend_from_slice(&target.byte_pool[..template_offset_old]);
            new_pool.extend_from_slice(new_template_bytes);
            new_pool.extend_from_slice(
                &target.byte_pool[tx_template_offset_old..tx_template_offset_old + tx_template_len],
            );

            // Re-encode the parsed base58 address strings as `Address`
            // (32-byte raw form) for serialize_body. Decoding failure on
            // bytes we just read off chain would be a bug in our own
            // parser, but we surface the error rather than panicking.
            fn decode_addr(s: &str) -> Result<Address> {
                let bytes = bs58::decode(s)
                    .into_vec()
                    .map_err(|e| anyhow!("invalid base58 address {s}: {e}"))?;
                let arr: [u8; 32] = bytes
                    .try_into()
                    .map_err(|v: Vec<u8>| anyhow!("address must be 32 bytes, got {}", v.len()))?;
                Ok(Address::new_from_array(arr))
            }
            let proposers = target
                .proposers
                .iter()
                .map(|s| decode_addr(s))
                .collect::<Result<Vec<Address>>>()?;
            let approvers = target
                .approvers
                .iter()
                .map(|s| decode_addr(s))
                .collect::<Result<Vec<Address>>>()?;

            let built = BuiltIntent {
                chain_kind: target.chain_kind,
                approval_threshold: target.approval_threshold,
                cancellation_threshold: target.cancellation_threshold,
                timelock_seconds: target.timelock_seconds,
                template_offset: target.template_offset,
                template_len: new_template_len as u16,
                tx_template_offset: (template_offset_old + new_template_len) as u16,
                tx_template_len: target.tx_template_len,
                proposers,
                approvers,
                params: target.params,
                accounts: target.accounts,
                instructions: target.instructions,
                data_segments: target.data_segments,
                seeds: target.seeds,
                policy_ciphertexts: target.policy_ciphertexts,
                byte_pool: new_pool,
            };

            // Same shape as the existing IntentAction::Update params_data:
            // [target_index, ...new_intent_body]. The on-chain
            // execute_update_intent (programs/clear-wallet/src/instructions/
            // execute.rs:180) reads the leading byte as the target index,
            // verifies the intent PDA, and overwrites the account body
            // with the rest.
            let intent_body = built.serialize_body(&wallet_addr, 0, index, 3);
            let mut params_data = Vec::with_capacity(1 + intent_body.len());
            params_data.push(index);
            params_data.extend_from_slice(&intent_body);

            // From here on, the flow is identical to IntentAction::Update:
            // propose against the wallet's UpdateIntent (index 2) meta-intent.
            let (update_intent_addr, _) =
                clear_wallet_client::pda::find_intent_address(&wallet_addr, 2, &pid);
            let update_intent_pubkey = Pubkey::new_from_array(update_intent_addr.to_bytes());
            let intent_data = rpc::fetch_account(&client, &update_intent_pubkey)?;
            let intent_account = accounts::parse_intent(&intent_data)?;

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

            let (proposal_addr, _) = clear_wallet_client::pda::find_proposal_address(
                &update_intent_addr,
                proposal_index,
                &pid,
            );

            if config.dry_run {
                print_dry_run(&DryRunDescriptor {
                    action: "intent_update",
                    wallet_name: &wallet_account.name,
                    wallet_pubkey: wallet_pubkey.to_string(),
                    intent_index: 2,
                    intent_pubkey: update_intent_pubkey.to_string(),
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
            let signature = sign_message_with_fallback(&*config.signer, &msg, &msg_plain)?;
            let proposer_pubkey = config.signer.pubkey();

            let payer_pubkey = solana_signer::Signer::pubkey(&config.payer);
            let ix = crate::instructions::propose(crate::instructions::ProposeArgs {
                payer: payer_pubkey,
                wallet: wallet_pubkey,
                intent: update_intent_pubkey,
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
                "intent_index": 2,
                "action": "update_intent_template",
                "target_index": index,
                "new_template": new_template,
            }));
        }
        IntentAction::List {
            wallet: wallet_name,
        } => {
            let program_id = crate::instructions::program_id();
            let pid = solana_address::Address::new_from_array(program_id.to_bytes());

            // Resolve wallet by name. Creator-scoped PDA: the seeds
            // include the creator pubkey, which we don't know from the
            // command line, so scan instead. resolve_wallet_by_name
            // returns the parsed account so we don't need the
            // separate fetch + parse the old PDA-derive path used.
            let client = rpc::client(config);
            let (wallet_pubkey, wallet_account) =
                rpc::resolve_wallet_by_name(&client, &wallet_name)?;
            let wallet_addr = solana_address::Address::new_from_array(wallet_pubkey.to_bytes());

            let mut intents = Vec::new();
            for i in 0..=wallet_account.intent_index {
                let (intent_addr, _) =
                    clear_wallet_client::pda::find_intent_address(&wallet_addr, i, &pid);
                let intent_pubkey = Pubkey::new_from_array(intent_addr.to_bytes());
                match rpc::fetch_account_optional(&client, &intent_pubkey)? {
                    Some(data) => {
                        let intent = accounts::parse_intent(&data)?;
                        intents.push(serde_json::json!({
                            "index": i,
                            "address": intent_pubkey.to_string(),
                            "type": intent.intent_type_name(),
                            "approved": intent.approved,
                            "approval_threshold": intent.approval_threshold,
                            "cancellation_threshold": intent.cancellation_threshold,
                            "timelock_seconds": intent.timelock_seconds,
                            "template": intent.template(),
                            "proposers": intent.proposers,
                            "approvers": intent.approvers,
                            "policy_ciphertexts": intent.policy_ciphertext_ids(),
                            "active_proposals": intent.active_proposal_count,
                        }));
                    }
                    None => {
                        intents.push(serde_json::json!({
                            "index": i,
                            "status": "not found (possibly removed)",
                        }));
                    }
                }
            }

            print_json(&intents);
        }
    }
    Ok(())
}
