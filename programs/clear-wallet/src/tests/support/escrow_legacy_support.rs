#[allow(clippy::too_many_arguments)]
fn propose_typed_escrow_release_on_wallet(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &ed25519_dalek::SigningKey,
    network: V4Network,
    escrow_id: &[u8],
    milestone_id: &[u8],
    payment: V4TransferRowInput<'_>,
    execution_commitment: [u8; 32],
) -> (Pubkey, [u8; 32], [u8; 32]) {
    let policy_commitment = v4_policy_commitment(&[]);
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_escrow_release(
        &V4EscrowReleaseInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network,
                proposal_index,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(proposer),
                action_id: sha256_hash(
                    &[b"escrow-release:".as_slice(), &proposal_index.to_le_bytes()].concat(),
                ),
                nonce: sha256_hash(
                    &[
                        b"escrow-release-nonce:".as_slice(),
                        &proposal_index.to_le_bytes(),
                    ]
                    .concat(),
                ),
                expires_at: typed_test_expiry(),
                policy_commitment,
                approval_required: 1,
            },
            escrow_id,
            escrow_title: b"Program escrow",
            milestone_id,
            milestone_title: b"Program milestone",
            payment,
            execution_commitment,
            reason: b"Program escrow release test",
        },
        &mut canonical,
    )
    .expect("escrow release should encode as canonical v4 intent");
    submit_typed_v4_proposal(
        svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        proposer,
        &[],
        &canonical[..canonical_len],
        1,
    )
}

#[allow(clippy::too_many_arguments)]
fn propose_typed_escrow_return_on_wallet(
    svm: &mut QuasarSvm,
    payer: Pubkey,
    wallet_name: &str,
    wallet: Pubkey,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &ed25519_dalek::SigningKey,
    network: V4Network,
    escrow_id: &[u8],
    rows: &[V4TransferRowInput<'_>],
    execution_commitment: [u8; 32],
) -> (Pubkey, [u8; 32], [u8; 32]) {
    let policy_commitment = v4_policy_commitment(&[]);
    let mut canonical = [0u8; MAX_CANONICAL_INTENT_BYTES];
    let canonical_len = encode_v4_escrow_return(
        &V4EscrowReturnInput {
            common: V4CommonFields {
                profile: V4DeviceProfile::Full,
                network,
                proposal_index,
                wallet_id: wallet.to_bytes(),
                actor: pubkey_bytes(proposer),
                action_id: sha256_hash(
                    &[b"escrow-return:".as_slice(), &proposal_index.to_le_bytes()].concat(),
                ),
                nonce: sha256_hash(
                    &[
                        b"escrow-return-nonce:".as_slice(),
                        &proposal_index.to_le_bytes(),
                    ]
                    .concat(),
                ),
                expires_at: typed_test_expiry(),
                policy_commitment,
                approval_required: 1,
            },
            escrow_id,
            escrow_title: b"Program escrow",
            rows,
            execution_commitment,
            reason: b"Program escrow return test",
        },
        &mut canonical,
    )
    .expect("escrow return should encode as canonical v4 intent");
    submit_typed_v4_proposal(
        svm,
        payer,
        wallet_name,
        wallet,
        intent,
        proposal_index,
        proposer,
        &[],
        &canonical[..canonical_len],
        1,
    )
}



/// Full propose → approve → execute flow.
struct ProposeApproveExecuteArgs<'a> {
    svm: &'a mut QuasarSvm,
    payer: Pubkey,
    wallet: Pubkey,
    wallet_name: &'a str,
    intent: Pubkey,
    proposal_index: u64,
    proposer: &'a ed25519_dalek::SigningKey,
    approver: &'a ed25519_dalek::SigningKey,
    params_data: Vec<u8>,
    msg_fn: &'a MessageFn,
    execute_remaining: Vec<AccountMeta>,
    execute_extra_accounts: Vec<Account>,
}

fn propose_approve_execute(args: ProposeApproveExecuteArgs<'_>) -> Pubkey {
    let proposal_address = get_proposal_address(args.intent, args.proposal_index);

    // Propose
    let msg = (args.msg_fn)(
        "propose",
        DEFAULT_EXPIRY,
        args.wallet_name,
        args.proposal_index,
        &args.params_data,
    );
    let instruction = build_propose_ix(ProposeArgs {
        payer: args.payer,
        wallet: args.wallet,
        intent: args.intent,
        proposal_index: args.proposal_index,
        expiry: DEFAULT_EXPIRY,
        proposer_pubkey: pubkey_bytes(args.proposer),
        signature: sign_message(args.proposer, &msg),
        params_data: args.params_data.clone(),
    });
    let result = args.svm.process_instruction(
        &instruction,
        &[funded_account(args.payer), empty_account(proposal_address)],
    );
    assert!(result.is_ok(), "propose failed: {:?}", result.raw_result);

    // Approve (approver is always at index 0)
    let msg = (args.msg_fn)(
        "approve",
        DEFAULT_EXPIRY,
        args.wallet_name,
        args.proposal_index,
        &args.params_data,
    );
    let instruction = build_approve_ix(
        args.wallet,
        args.intent,
        proposal_address,
        DEFAULT_EXPIRY,
        0,
        sign_message(args.approver, &msg),
    );
    let result = args.svm.process_instruction(&instruction, &[]);
    assert!(result.is_ok(), "approve failed: {:?}", result.raw_result);

    // Execute — vault is already in SVM state, don't overwrite it with empty
    let (instruction, _vault) = build_execute_ix(
        args.wallet,
        args.intent,
        proposal_address,
        args.execute_remaining,
    );
    let all_accounts = args.execute_extra_accounts;
    let result = args.svm.process_instruction(&instruction, &all_accounts);
    assert!(result.is_ok(), "execute failed: {:?}", result.raw_result);
    println!("  EXECUTE CU: {}", result.compute_units_consumed);

    proposal_address
}
