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
