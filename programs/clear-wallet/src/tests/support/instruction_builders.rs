// =========================================================================
// Message builders (must match on-chain format exactly)
// =========================================================================

fn add_intent_msg(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    data: &[u8],
) -> Vec<u8> {
    let body = format!(
        "expires {}: {action} add intent definition_hash: {}{}",
        format_timestamp(expiry),
        hex_encode(&sha256_hash(data)),
        message_suffix(wallet_name, proposal_index),
    );
    wrap_offchain(body.as_bytes())
}

fn remove_intent_msg(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    intent_index: u8,
) -> Vec<u8> {
    let body = format!(
        "expires {}: {action} remove intent {intent_index}{}",
        format_timestamp(expiry),
        message_suffix(wallet_name, proposal_index),
    );
    wrap_offchain(body.as_bytes())
}

// =========================================================================
// Instruction builder helpers
// =========================================================================

fn create_wallet_ix(
    payer: Pubkey,
    name: &str,
    proposers: &[Pubkey],
    approvers: &[Pubkey],
    threshold: u8,
) -> (Instruction, Vec<Account>) {
    let name_hash = Pubkey::from(compute_name_hash(name));
    let creator = solana_address::Address::new_from_array(payer.to_bytes());
    let (wallet, _) = find_wallet_address(name, &creator, &crate::ID);
    let (add_intent, _) = find_intent_address(&wallet, 0, &crate::ID);
    let (remove_intent, _) = find_intent_address(&wallet, 1, &crate::ID);
    let (update_intent, _) = find_intent_address(&wallet, 2, &crate::ID);

    let instruction: Instruction = CreateWalletInstruction {
        payer,
        name_hash,
        wallet,
        add_intent,
        remove_intent,
        update_intent,
        system_program: quasar_svm::system_program::ID,
        name: DynBytes::new(name.as_bytes().to_vec()),
        approval_threshold: threshold,
        cancellation_threshold: 1,
        timelock_seconds: 0,
        proposers: DynVec::new(proposers.iter().map(|p| p.to_bytes()).collect()),
        approvers: DynVec::new(approvers.iter().map(|a| a.to_bytes()).collect()),
        policy_ciphertexts: TailBytes(Vec::new()),
    }
    .into();

    let accounts = vec![
        funded_account(payer),
        empty_account(name_hash),
        empty_account(wallet),
        empty_account(add_intent),
        empty_account(remove_intent),
        empty_account(update_intent),
    ];
    (instruction, accounts)
}

struct ProposeArgs {
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    expiry: i64,
    proposer_pubkey: [u8; 32],
    signature: [u8; 64],
    params_data: Vec<u8>,
}

fn build_propose_ix(args: ProposeArgs) -> Instruction {
    let (proposal, _) = find_proposal_address(&args.intent, args.proposal_index, &crate::ID);
    ProposeInstruction {
        payer: args.payer,
        wallet: args.wallet,
        intent: args.intent,
        proposal,
        system_program: quasar_svm::system_program::ID,
        proposal_index: args.proposal_index,
        expiry: args.expiry,
        proposer_pubkey: args.proposer_pubkey,
        signature: args.signature,
        params_data: TailBytes(args.params_data),
    }
    .into()
}

fn build_approve_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    expiry: i64,
    approver_index: u8,
    signature: [u8; 64],
) -> Instruction {
    ApproveInstruction {
        wallet,
        intent,
        proposal,
        expiry,
        approver_index,
        signature,
    }
    .into()
}

fn build_cancel_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    expiry: i64,
    canceller_index: u8,
    signature: [u8; 64],
) -> Instruction {
    CancelInstruction {
        wallet,
        intent,
        proposal,
        expiry,
        canceller_index,
        signature,
    }
    .into()
}

fn build_execute_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    remaining: Vec<AccountMeta>,
) -> (Instruction, Pubkey) {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let instruction: Instruction = ExecuteInstruction {
        wallet,
        vault,
        intent,
        proposal,
        system_program: quasar_svm::system_program::ID,
        remaining_accounts: remaining,
    }
    .into();
    (instruction, vault)
}

struct TypedProposalArgs {
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    expiry: i64,
    action_kind: u8,
    policy_commitment: [u8; 32],
    payload_hash: [u8; 32],
    envelope_hash: [u8; 32],
    proposer_pubkey: [u8; 32],
    signature: [u8; 64],
    policy_bytes: Vec<u8>,
    clear_text: Vec<u8>,
    action_id: [u8; 32],
    nonce: [u8; 32],
}

fn build_propose_typed_ix(args: TypedProposalArgs) -> Instruction {
    let (proposal, _) = find_typed_proposal_address(&args.intent, args.proposal_index, &crate::ID);
    let mut data = vec![8u8];
    wincode::serialize_into(&mut data, &args.proposal_index).unwrap();
    wincode::serialize_into(&mut data, &args.expiry).unwrap();
    wincode::serialize_into(&mut data, &args.action_kind).unwrap();
    wincode::serialize_into(&mut data, &args.policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &args.payload_hash).unwrap();
    wincode::serialize_into(&mut data, &args.envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &args.proposer_pubkey).unwrap();
    wincode::serialize_into(&mut data, &args.signature).unwrap();
    wincode::serialize_into(&mut data, &args.action_id).unwrap();
    wincode::serialize_into(&mut data, &args.nonce).unwrap();
    wincode::serialize_into(&mut data, &DynBytes::<u32>::new(args.policy_bytes)).unwrap();
    wincode::serialize_into(&mut data, &TailBytes(args.clear_text)).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(args.payer, true),
            AccountMeta::new(args.wallet, false),
            AccountMeta::new(args.intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

struct TypedProposalV4Args {
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    signature: [u8; 64],
    policy_bytes: Vec<u8>,
    canonical_intent: Vec<u8>,
}

fn build_propose_typed_v4_ix(args: TypedProposalV4Args) -> Instruction {
    let (proposal, _) = find_typed_proposal_address(&args.intent, args.proposal_index, &crate::ID);
    let mut data = vec![31u8];
    wincode::serialize_into(&mut data, &args.proposal_index).unwrap();
    wincode::serialize_into(&mut data, &args.signature).unwrap();
    wincode::serialize_into(&mut data, &DynBytes::<u32>::new(args.policy_bytes)).unwrap();
    wincode::serialize_into(&mut data, &TailBytes(args.canonical_intent)).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(args.payer, true),
            AccountMeta::new(args.wallet, false),
            AccountMeta::new(args.intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

fn submit_typed_v4_proposal(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &ed25519_dalek::SigningKey,
    policy_bytes: &[u8],
    canonical_intent: &[u8],
    approvals_after: u8,
) -> (Pubkey, [u8; 32], [u8; 32]) {
    let proposal = get_typed_proposal_address(intent, proposal_index);
    let canonical = parse_v4_intent(canonical_intent).expect("valid canonical v4 test intent");
    assert_eq!(canonical.common.wallet_id, wallet.to_bytes());
    assert_eq!(canonical.common.actor, pubkey_bytes(proposer));
    assert_eq!(canonical.common.proposal_index, proposal_index);

    let mut clear_text = [0u8; MAX_DOCUMENT_BYTES];
    let clear_text_len = render_v4_document(&canonical, wallet_name.as_bytes(), &mut clear_text)
        .expect("canonical v4 test intent should render");
    let clear_text = &clear_text[..clear_text_len];
    let envelope_hash = hash_v4_envelope(
        &canonical,
        wallet_name.as_bytes(),
        hash_clear_text(clear_text).expect("rendered v4 document should hash"),
    )
    .expect("canonical v4 test envelope should hash");
    let signature = sign_typed_vote_for_text(
        proposer,
        ClearSignVoteKind::Propose,
        wallet_name,
        proposal_index,
        envelope_hash,
        canonical.common.approval_required,
        approvals_after,
        clear_text,
    );
    let instruction = build_propose_typed_v4_ix(TypedProposalV4Args {
        payer,
        wallet,
        intent,
        proposal_index,
        signature,
        policy_bytes: policy_bytes.to_vec(),
        canonical_intent: canonical_intent.to_vec(),
    });
    let result = svm.process_instruction(
        &instruction,
        &[funded_account(payer), empty_account(proposal)],
    );
    assert!(
        result.is_ok(),
        "canonical v4 proposal failed: {:?}",
        result.raw_result
    );

    (proposal, canonical.common.policy_commitment, envelope_hash)
}

fn build_execute_typed_escrow_release_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    recipient: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_lamports: u64,
    escrow_id_hash: [u8; 32],
    milestone_id_hash: [u8; 32],
) -> Instruction {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let mut data = vec![12u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_lamports).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &milestone_id_hash).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(vault, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new(recipient, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

fn build_execute_typed_spl_escrow_release_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    mint: Pubkey,
    source_token: Pubkey,
    destination_token: Pubkey,
    recipient_owner: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_tokens: u64,
    escrow_id_hash: [u8; 32],
    milestone_id_hash: [u8; 32],
) -> Instruction {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let mut data = vec![17u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_tokens).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &milestone_id_hash).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new_readonly(vault, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(source_token, false),
            AccountMeta::new(destination_token, false),
            AccountMeta::new_readonly(recipient_owner, false),
            AccountMeta::new_readonly(quasar_svm::SPL_TOKEN_PROGRAM_ID, false),
        ],
        data,
    }
}

fn build_execute_typed_spl_escrow_return_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    mint: Pubkey,
    source_token: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    escrow_id_hash: [u8; 32],
    amount_tokens_le: Vec<u8>,
    remaining_accounts: Vec<AccountMeta>,
) -> Instruction {
    let (vault, _) = find_vault_address(&wallet, &crate::ID);
    let mut data = vec![18u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    data.extend_from_slice(&amount_tokens_le);

    let mut accounts = vec![
        AccountMeta::new_readonly(wallet, false),
        AccountMeta::new_readonly(vault, false),
        AccountMeta::new(intent, false),
        AccountMeta::new(proposal, false),
        AccountMeta::new_readonly(mint, false),
        AccountMeta::new(source_token, false),
        AccountMeta::new_readonly(quasar_svm::SPL_TOKEN_PROGRAM_ID, false),
    ];
    accounts.extend(remaining_accounts);

    Instruction {
        program_id: crate::ID,
        accounts,
        data,
    }
}
fn build_execute_typed_cross_chain_escrow_release_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    ika_config: Pubkey,
    dwallet: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    chain_kind: u8,
    amount_raw_le: [u8; 16],
    escrow_id_hash: [u8; 32],
    milestone_id_hash: [u8; 32],
    recipient_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    route_hash: [u8; 32],
    tx_template_hash: [u8; 32],
    settlement_artifact_hash: [u8; 32],
) -> Instruction {
    let mut data = vec![19u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &chain_kind).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &milestone_id_hash).unwrap();
    wincode::serialize_into(&mut data, &recipient_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &route_hash).unwrap();
    wincode::serialize_into(&mut data, &tx_template_hash).unwrap();
    wincode::serialize_into(&mut data, &settlement_artifact_hash).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(ika_config, false),
            AccountMeta::new_readonly(dwallet, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_cross_chain_escrow_return_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    ika_config: Pubkey,
    dwallet: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    chain_kind: u8,
    amount_raw_le: [u8; 16],
    escrow_id_hash: [u8; 32],
    refund_recipient_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    route_hash: [u8; 32],
    tx_template_hash: [u8; 32],
    settlement_artifact_hash: [u8; 32],
) -> Instruction {
    let mut data = vec![20u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &chain_kind).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &refund_recipient_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &route_hash).unwrap();
    wincode::serialize_into(&mut data, &tx_template_hash).unwrap();
    wincode::serialize_into(&mut data, &settlement_artifact_hash).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(ika_config, false),
            AccountMeta::new_readonly(dwallet, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_chain_send_ix(
    payer: Pubkey,
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    ika_config: Pubkey,
    dwallet: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    chain_kind: u8,
    amount_raw_le: [u8; 16],
    recipient_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    tx_template_hash: [u8; 32],
) -> Instruction {
    let mut data = vec![24u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &chain_kind).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &recipient_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &tx_template_hash).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(find_wallet_policy_address(&wallet, &crate::ID).0, false),
            AccountMeta::new(
                find_policy_spend_address(&wallet, &intent, &crate::ID).0,
                false,
            ),
            AccountMeta::new(
                clear_wallet_client::pda::find_member_allowance_address(
                    &wallet,
                    &intent,
                    &crate::ID,
                )
                .0,
                false,
            ),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(ika_config, false),
            AccountMeta::new_readonly(dwallet, false),
            AccountMeta::new_readonly(quasar_svm::system_program::ID, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_private_escrow_release_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_raw_le: [u8; 16],
    escrow_id_hash: [u8; 32],
    milestone_id_hash: [u8; 32],
    recipient_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    policy_ciphertexts_hash: [u8; 32],
    private_evaluation_hash: [u8; 32],
    settlement_artifact_hash: [u8; 32],
) -> Instruction {
    let mut data = vec![21u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &milestone_id_hash).unwrap();
    wincode::serialize_into(&mut data, &recipient_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &policy_ciphertexts_hash).unwrap();
    wincode::serialize_into(&mut data, &private_evaluation_hash).unwrap();
    wincode::serialize_into(&mut data, &settlement_artifact_hash).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
        ],
        data,
    }
}

#[allow(clippy::too_many_arguments)]
fn build_execute_typed_private_escrow_return_ix(
    wallet: Pubkey,
    intent: Pubkey,
    proposal: Pubkey,
    policy_commitment: [u8; 32],
    envelope_hash: [u8; 32],
    amount_raw_le: [u8; 16],
    escrow_id_hash: [u8; 32],
    refund_recipient_hash: [u8; 32],
    asset_id_hash: [u8; 32],
    policy_ciphertexts_hash: [u8; 32],
    private_evaluation_hash: [u8; 32],
    settlement_artifact_hash: [u8; 32],
) -> Instruction {
    let mut data = vec![22u8];
    wincode::serialize_into(&mut data, &policy_commitment).unwrap();
    wincode::serialize_into(&mut data, &envelope_hash).unwrap();
    wincode::serialize_into(&mut data, &amount_raw_le).unwrap();
    wincode::serialize_into(&mut data, &escrow_id_hash).unwrap();
    wincode::serialize_into(&mut data, &refund_recipient_hash).unwrap();
    wincode::serialize_into(&mut data, &asset_id_hash).unwrap();
    wincode::serialize_into(&mut data, &policy_ciphertexts_hash).unwrap();
    wincode::serialize_into(&mut data, &private_evaluation_hash).unwrap();
    wincode::serialize_into(&mut data, &settlement_artifact_hash).unwrap();

    Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(wallet, false),
            AccountMeta::new(intent, false),
            AccountMeta::new(proposal, false),
        ],
        data,
    }
}
