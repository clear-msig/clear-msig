use super::*;

/// Drive a remote-chain proposal through Ika: build the destination-chain
/// preimage off-chain, send the on-chain `ika_sign` ix, then run the gRPC
/// presign + sign roundtrip and verify the signature lands in the
/// `MessageApproval` PDA. If `broadcast` is set, also assemble the
/// chain-native signed transaction and push it to `rpc_url`.
#[derive(Clone, Copy)]
pub(in crate::commands::proposal) enum IkaOnchainSignMode {
    LegacyProposal,
    TypedChainSend {
        policy_commitment: [u8; 32],
        envelope_hash: [u8; 32],
        amount_raw_le: [u8; 16],
        recipient_hash: [u8; 32],
        asset_id_hash: [u8; 32],
        tx_template_hash: [u8; 32],
    },
}

#[allow(clippy::too_many_arguments)]
pub(in crate::commands::proposal) fn execute_via_ika(
    config: &RuntimeConfig,
    client: &crate::rpc::Client,
    _wallet_name: &str,
    wallet_pubkey: Pubkey,
    intent_pubkey: Pubkey,
    intent_account: &accounts::IntentAccount,
    proposal_pubkey: Pubkey,
    params_data: &[u8],
    dwallet_program: Pubkey,
    grpc_url: &str,
    rpc_url: Option<&str>,
    broadcast: bool,
    sign_mode: IkaOnchainSignMode,
) -> Result<()> {
    use crate::ika;
    use std::time::Duration;

    let chain_kind = intent_account.chain_kind;
    crate::progress!("→ Remote-chain execution (chain_kind={chain_kind}) via Ika dWallet");

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
    crate::progress!("✓ IkaConfig: {ika_config_pk} → dWallet {dwallet_pk}");

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
            let dest = ika::read_param_bytes32(intent_account, params_data, 0)?;
            let amt = ika::read_param_u64(intent_account, params_data, 1)?;
            let nonce_val = ika::read_param_bytes32(intent_account, params_data, 2)?;
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
        3 => ika::build_zcash_zip243_preimage(intent_account, params_data)?,
        _ => ika::build_chain_preimage(intent_account, params_data)?,
    };
    let message_hash = ika::hash_preimage(chain_kind, &preimage);
    crate::progress!(
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
        ika::compute_zcash_blake2b_hashes(intent_account, params_data)?
    } else {
        [0u8; 96]
    };

    let payer_pubkey = solana_sdk::signer::Signer::pubkey(&config.payer);
    let ix = match sign_mode {
        IkaOnchainSignMode::LegacyProposal => crate::instructions::ika_sign(
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
        ),
        IkaOnchainSignMode::TypedChainSend {
            policy_commitment,
            envelope_hash,
            amount_raw_le,
            recipient_hash,
            asset_id_hash,
            tx_template_hash,
        } => crate::instructions::ika_sign_typed_chain_send(
            payer_pubkey,
            wallet_pubkey,
            wallet_policy_pubkey(wallet_pubkey),
            policy_spend_pubkey(wallet_pubkey, intent_pubkey),
            member_allowance_pubkey(wallet_pubkey, intent_pubkey),
            intent_pubkey,
            proposal_pubkey,
            ika_config_pk,
            dwallet_ownership_pk,
            dwallet_pk,
            message_approval_pk,
            coordinator_pk,
            cpi_authority_pk,
            dwallet_program,
            policy_commitment,
            envelope_hash,
            chain_kind,
            amount_raw_le,
            recipient_hash,
            asset_id_hash,
            tx_template_hash,
            message_approval_bump,
            cpi_authority_bump,
            blake2b_hashes,
            params_data,
        ),
    };
    let quorum_tx_sig =
        rpc::send_instruction(client, config, ix).with_context(|| "ika_sign failed")?;
    crate::progress!("✓ ika_sign tx: {quorum_tx_sig}");

    // 6. Wait for the MessageApproval PDA to materialize on-chain.
    let ma_data = ika::poll_until(
        client,
        &message_approval_pk,
        |d| d.len() > ika::MA_STATUS && d[0] == ika::DISC_MESSAGE_APPROVAL,
        Duration::from_secs(15),
    )
    .with_context(|| "MessageApproval PDA never appeared after ika_sign")?;
    crate::progress!("✓ MessageApproval present: {message_approval_pk}");

    // Build sign_message_for_broadcast unconditionally — needed for the
    // chain-native broadcast in step 9 regardless of whether we have to
    // run the gRPC sign roundtrip.
    let sign_message_for_broadcast: Vec<u8> = match chain_kind {
        0 => {
            // Solana: full transaction message with durable nonce.
            let destination = ika::read_param_bytes32(intent_account, params_data, 0)?;
            let amount = ika::read_param_u64(intent_account, params_data, 1)?;
            let nonce_value = ika::read_param_bytes32(intent_account, params_data, 2)?;
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
        3 => ika::build_zcash_zip243_preimage(intent_account, params_data)?,
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
    let already_signed = message_approval_is_signed(&ma_data);
    let ma_signed: Vec<u8> = if already_signed {
        crate::progress!("✓ MessageApproval already signed — reusing on-chain signature");
        ma_data
    } else {
        // Load the DKG attestation saved during `wallet add-chain` and use its
        // session_identifier as the dwallet_addr — this must match the value
        // the mock stored the key under during DKG. If the persistent volume does
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
                    crate::progress!(
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
                crate::progress!(
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
        crate::progress!("✓ Presign allocated ({} bytes)", presign_id.len());

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
        crate::progress!("✓ Signature received from Ika ({} bytes)", signature.len());

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

            let sol_client = rpc::client_for_url(config, rpc_url.to_string());
            let tx: solana_sdk::transaction::Transaction = bincode::deserialize(&wire_tx)
                .with_context(|| "failed to deserialize Solana transaction")?;
            let tx_sig = rpc::send_signed_transaction(&sol_client, &tx)
                .with_context(|| "failed to send Solana transaction")?;
            crate::progress!("✓ Broadcast solana: {tx_sig}");
            output["broadcast"] = serde_json::json!({
                "chain": "solana",
                "chain_kind": 0,
                "tx_id": tx_sig.to_string(),
                "raw_tx_hex": format!("0x{}", hex_lower(&wire_tx)),
            });
        } else {
            let inputs = build_broadcast_inputs(chain_kind, intent_account, params_data)?;
            let transport =
                crate::chains::transport::CancellableHttpTransport::new(config.control.clone())?;

            let result = crate::chains::broadcast_signed_tx(
                &transport,
                config.destination_receipt_store.as_ref(),
                crate::chains::BroadcastRequest {
                    chain_kind,
                    inputs,
                    preimage: &preimage,
                    signature: onchain_sig,
                    dwallet_pubkey_compressed: &dwallet_account.public_key,
                    rpc_url,
                    control: config.control.clone(),
                },
            )
            .with_context(|| format!("broadcast to {rpc_url} failed"))?;
            crate::progress!("✓ Broadcast {}: {}", result.chain, result.tx_id);
            if let Some(url) = &result.explorer_url {
                crate::progress!("  → {url}");
            }
            output["broadcast"] = serde_json::to_value(&result)?;
        }
    }

    print_json(&output);
    Ok(())
}
