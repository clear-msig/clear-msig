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
    pub(super) venue_hash: String,
    pub(super) market_hash: String,
    pub(super) side_hash: String,
    pub(super) asset_id_hash: String,
    pub(super) max_leverage_x100: u32,
    pub(super) session_id_hash: String,
    pub(super) route_hash: String,
    pub(super) risk_check_hash: String,
}
