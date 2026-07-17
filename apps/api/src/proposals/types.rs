use serde::Deserialize;

use crate::clearsign::PreSigned;

#[derive(Deserialize)]
pub(super) struct SignedProposalCreateRequest {
    pub(super) intent_index: u8,
    #[serde(flatten)]
    pub(super) pre_signed: PreSigned,
}

#[derive(Deserialize)]
pub(super) struct SignedTypedProposalCreateRequest {
    pub(super) intent_index: u8,
    pub(super) action_kind: u8,
    pub(super) policy_commitment: String,
    pub(super) payload_hash: String,
    pub(super) envelope_hash: String,
    pub(super) action_id: String,
    pub(super) nonce: String,
    pub(super) policy_bytes_hex: Option<String>,
    pub(super) canonical_intent_hex: Option<String>,
    #[serde(flatten)]
    pub(super) pre_signed: PreSigned,
}

#[derive(Deserialize)]
pub(super) struct SignedApproveCancelRequest {
    #[serde(flatten)]
    pub(super) pre_signed: PreSigned,
}

#[derive(Deserialize)]
pub(super) struct PrepareProposalCreateRequest {
    pub(super) intent_index: u8,
    pub(super) params: Vec<String>,
    pub(super) expiry: Option<String>,
    /// Connected wallet's pubkey. Forwarded to the CLI as
    /// `--signer-pubkey` so proposer / approver validation runs
    /// against the user's identity, not the relayer's filesystem keypair.
    pub(super) actor_pubkey: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct PrepareTypedProposalCreateRequest {
    pub(super) intent_index: u8,
    pub(super) action_kind: u8,
    pub(super) policy_commitment: String,
    pub(super) payload_hash: String,
    pub(super) envelope_hash: String,
    pub(super) action_id: String,
    pub(super) nonce: String,
    pub(super) policy_bytes_hex: Option<String>,
    pub(super) signable_text: String,
    pub(super) canonical_intent_hex: Option<String>,
    pub(super) expiry: Option<String>,
    pub(super) actor_pubkey: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct PrepareApproveCancelRequest {
    pub(super) expiry: Option<String>,
    /// See `PrepareProposalCreateRequest::actor_pubkey`.
    pub(super) actor_pubkey: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct ExecuteProposalRequest {
    pub(super) dwallet_program: Option<String>,
    pub(super) grpc_url: Option<String>,
    pub(super) rpc_url: Option<String>,
    pub(super) broadcast: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedEscrowReleaseRequest {
    pub(super) recipient: String,
    pub(super) amount_lamports: u64,
    pub(super) escrow_id: String,
    pub(super) milestone_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedEscrowReturnRequest {
    pub(super) escrow_id: String,
    pub(super) returns: Vec<ExecuteTypedEscrowReturnRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedEscrowReturnRow {
    pub(super) recipient: String,
    pub(super) amount_lamports: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedSolSendRequest {
    pub(super) recipient: String,
    pub(super) amount_lamports: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedWalletPolicyUpdateRequest {
    pub(super) policy_bytes_hex: String,
    pub(super) chain_kind: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedIntentGovernanceRequest {
    /// ClearSign action kind: 3=add_member, 4=remove_member, 5=change_threshold.
    pub(super) action_kind: Option<u8>,
    pub(super) target_index: Option<u8>,
    /// Preferred: pre-built intent body (no discriminator) as hex.
    pub(super) new_intent_body_hex: Option<String>,
    pub(super) file: Option<String>,
    pub(super) proposers: Option<Vec<String>>,
    pub(super) approvers: Option<Vec<String>>,
    pub(super) threshold: Option<u8>,
    pub(super) cancellation_threshold: Option<u8>,
    pub(super) timelock: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedChainSendRequest {
    pub(super) chain_kind: u8,
    pub(super) amount_raw: String,
    pub(super) recipient_hash: String,
    pub(super) asset_id_hash: String,
    pub(super) params_data_hex: Option<String>,
    pub(super) dwallet_program: Option<String>,
    pub(super) grpc_url: Option<String>,
    pub(super) rpc_url: Option<String>,
    pub(super) broadcast: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedSolBatchSendRequest {
    pub(super) payments: Vec<ExecuteTypedSolBatchSendRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedSolBatchSendRow {
    pub(super) recipient: String,
    pub(super) amount_lamports: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedAgentTradeApprovalRequest {
    pub(super) amount_raw: String,
    pub(super) agent_id_hash: String,
    pub(super) venue_hash: String,
    pub(super) market_hash: String,
    pub(super) side_hash: String,
    pub(super) asset_id_hash: String,
    pub(super) max_leverage_x100: u32,
    pub(super) session_id_hash: String,
    pub(super) route_hash: String,
    pub(super) risk_check_hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedAgentSessionGrantRequest {
    pub(super) session_id_hash: String,
    pub(super) agent_id_hash: String,
    pub(super) venue_hash: String,
    pub(super) market_hash: String,
    pub(super) max_notional_raw: String,
    pub(super) max_leverage_x100: u32,
    pub(super) expires_at: i64,
    pub(super) status: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedAgentRiskPolicyRequest {
    pub(super) session_id_hash: String,
    pub(super) oracle_policy_hash: String,
    pub(super) max_loss_raw: String,
    pub(super) status: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteTypedAgentTradeSettlementRequest {
    pub(super) session_id_hash: String,
    pub(super) execution_id_hash: String,
    pub(super) settlement_artifact_hash: String,
    pub(super) oracle_policy_hash: String,
    pub(super) closed_notional_raw: String,
    pub(super) outcome: u8,
    pub(super) pnl_abs_raw: String,
    pub(super) settlement_sequence: u64,
}
