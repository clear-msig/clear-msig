use std::borrow::Cow;

use crate::config::RuntimeConfig;
use crate::error::*;
use crate::output::{print_json, print_typed_dry_run};
use crate::signing::sign_message_with_flavor;
use crate::{accounts, ika, message, params, resolve, rpc};
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

mod action;
mod agent_risk;
mod execution;
mod handlers;

#[cfg(test)]
mod tests;

pub use action::ProposalAction;
use execution::*;

pub fn handle(action: ProposalAction, config: &RuntimeConfig) -> Result<()> {
    handlers::handle(action, config)
}
