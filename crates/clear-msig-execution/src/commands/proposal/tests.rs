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
