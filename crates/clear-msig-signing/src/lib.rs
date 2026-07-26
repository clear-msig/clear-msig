#![cfg_attr(not(feature = "std"), no_std)]

//! Canonical ClearSign approval intents shared by trusted Rust runtimes.
//!
//! The wire format is deliberately not JSON. It uses fixed-order little-endian
//! integers and u16-length-prefixed visible ASCII fields so the onchain program
//! can parse and render exactly the same authoritative values without an
//! allocator.

mod asset_policy;
mod authority_codec;
mod codec;
mod compact;
mod fiat;
mod full;
mod hashing;
mod io;
mod model;
mod templates;

use compact::render_compact_document;
use fiat::{read_fiat_estimate_bytes, write_fiat_estimate};
use full::render_full_document;
use io::{Reader, Writer};

pub use asset_policy::*;
pub use authority_codec::*;
pub use codec::*;
pub use hashing::*;
pub use model::*;

pub use templates::{
    template_definition, TemplateDefinition, TemplateKind, TemplateSupport, UnsupportedReviewInput,
    TEMPLATE_REGISTRY,
};

pub const INTENT_VERSION: u8 = 4;
pub const INTENT_MAGIC: &[u8; 8] = b"CSIGINT4";
pub const INTENT_DOMAIN: &[u8] = b"clearsig:canonical-intent:v4";
pub const ENVELOPE_DOMAIN: &[u8] = b"clearsig:policy-engine:v4";
pub const PAYLOAD_DOMAIN: &[u8] = b"clearsig:policy-engine:v2:payload";
pub const POLICY_DOMAIN: &[u8] = b"clearsig:policy-engine:v2:policy";
pub const TYPED_SEND_POLICY_DOMAIN: &[u8] = b"typed-sol-send-policy-v1";
pub const TYPED_ASSET_POLICY_DOMAIN: &[u8] = b"typed-asset-send-policy-v2";
pub const DOCUMENT_PROTOCOL_MARKER: &[u8] = b"Protocol: clearsig-intent-v4@1";
pub const MAX_CANONICAL_INTENT_BYTES: usize = 2_048;
pub const MAX_DOCUMENT_BYTES: usize = 1_792;
pub const MAX_COMPACT_DOCUMENT_BYTES: usize = 1_024;
pub const MAX_REASON_BYTES: usize = 160;
pub const MAX_IDENTITY_BYTES: usize = 192;
pub const MAX_ASSET_BYTES: usize = 96;

/// Render the canonical signer document for the profile encoded in the intent.
pub fn render_document(
    intent: &CanonicalIntent<'_>,
    wallet_name: &[u8],
    out: &mut [u8],
) -> Result<usize, Error> {
    match intent.common.profile {
        DeviceProfile::Full => render_full_document(intent, wallet_name, out),
        DeviceProfile::LedgerSolana => render_compact_document(intent, wallet_name, out),
    }
}

/// Render a non-authorizing warning for actions ClearSig cannot decode and
/// bind to an executable schema. This output is intentionally not accepted by
/// the v4 proposal parser and cannot be converted into an approval envelope.
pub fn render_unsupported_review(
    input: &UnsupportedReviewInput<'_>,
    profile: DeviceProfile,
    out: &mut [u8],
) -> Result<usize, Error> {
    validate_visible_ascii(input.action_label, 96, false)?;
    validate_visible_ascii(input.network_label, 64, false)?;
    validate_visible_ascii(input.program_or_contract, MAX_IDENTITY_BYTES, false)?;
    let mut writer = Writer::new(out);
    writer.push(b"ClearSig Review Required\n\nACTION\n")?;
    writer.push(input.action_label)?;
    writer.push(b"\n\nNETWORK\n")?;
    writer.push(input.network_label)?;
    writer.push(b"\n\nPROGRAM OR CONTRACT\n")?;
    writer.push(input.program_or_contract)?;
    writer.push(b"\n\nWARNING\nClearSig could not fully decode or authorize this action.")?;
    writer.push(b"\n\nTRANSACTION COMMITMENT\n")?;
    writer.hex(&input.transaction_commitment)?;
    writer.push(b"\n\nAPPROVAL\nManual expert review required. Approval is disabled.")?;
    writer.push(b"\n\nRISK\nUnknown")?;
    writer.push(b"\n\nPROFILE\n")?;
    writer.push(profile.display_label())?;
    if writer.len > profile.max_document_bytes() {
        return Err(Error::MessageTooLong);
    }
    Ok(writer.len)
}

fn write_review_footer(writer: &mut Writer<'_>, intent: &CanonicalIntent<'_>) -> Result<(), Error> {
    writer.push(b"\n\nPOLICY\nApproval: ")?;
    writer.decimal_u128(intent.common.approval_required as u128)?;
    if intent.common.approval_required == 1 {
        writer.push(b" signature required")?;
    } else {
        writer.push(b" signatures required")?;
    }
    writer.push(b"\nExecution: Exact canonical payload, policy, and timelock enforced onchain")?;
    writer.push(b"\nPolicy commitment: ")?;
    writer.hex(&intent.common.policy_commitment)?;
    writer.push(b"\nDisplay profile: ")?;
    writer.push(intent.common.profile.display_label())?;
    writer.push(b"\n")?;
    writer.push(DOCUMENT_PROTOCOL_MARKER)?;
    let (category, check) = match intent.kind() {
        ActionKind::Send => (
            b"Funds movement".as_slice(),
            b"Verify amount, asset, network, and full destination".as_slice(),
        ),
        ActionKind::BatchSend => (
            b"Multiple funds movements".as_slice(),
            b"Verify every amount, asset, and full destination".as_slice(),
        ),
        ActionKind::AddMember | ActionKind::RemoveMember | ActionKind::ChangeThreshold => (
            b"Authorization change".as_slice(),
            b"Verify the complete final signer sets and thresholds".as_slice(),
        ),
        ActionKind::SetProtection => (
            b"Policy change".as_slice(),
            b"Verify the target network and replacement policy commitment".as_slice(),
        ),
        ActionKind::SetAssetProtection => (
            b"Asset policy change".as_slice(),
            b"Verify asset mint, decimals, and replacement policy commitment".as_slice(),
        ),
        ActionKind::ReleaseMilestone | ActionKind::ReturnEscrowFunds => (
            b"Escrow funds movement".as_slice(),
            b"Verify escrow ID, amount, asset, and every full destination".as_slice(),
        ),
        ActionKind::AgentTradeApproval
        | ActionKind::AgentSessionGrant
        | ActionKind::AgentRiskPolicy => (
            b"Agent authority".as_slice(),
            b"Verify agent, venue, scope, limits, expiry, and policy evidence".as_slice(),
        ),
        ActionKind::AgentTradeSettlement => (
            b"Agent execution".as_slice(),
            b"Verify execution identity, amounts, sequence, and immutable evidence".as_slice(),
        ),
        ActionKind::RecurringSchedule => (
            b"Recurring funds movement".as_slice(),
            b"Verify recipient, amount, cadence, first run, and payment count".as_slice(),
        ),
        _ => return Err(Error::UnsupportedAction),
    };
    writer.push(b"\n\nRISK\nCategory: ")?;
    writer.push(category)?;
    writer.push(b"\nSigner check: ")?;
    writer.push(check)?;
    writer.push(b"\n\nPURPOSE\n")?;
    if intent.reason.is_empty() {
        writer.push(b"Not provided")?;
    } else {
        writer.push(intent.reason)?;
    }
    Ok(())
}

fn display_asset(transfer: Transfer<'_>) -> &[u8] {
    if transfer.display_asset.is_empty() {
        transfer.asset
    } else {
        transfer.display_asset
    }
}

impl BatchTransfer<'_> {
    pub fn rows(&self) -> BatchRows<'_> {
        BatchRows {
            reader: Reader::new(self.encoded_rows),
            remaining: self.row_count,
        }
    }
}

impl EscrowReturn<'_> {
    pub fn rows(&self) -> BatchRows<'_> {
        BatchRows {
            reader: Reader::new(self.encoded_rows),
            remaining: self.row_count,
        }
    }
}

pub struct BatchRows<'a> {
    reader: Reader<'a>,
    remaining: u8,
}

impl<'a> Iterator for BatchRows<'a> {
    type Item = Transfer<'a>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        self.remaining -= 1;
        read_transfer_row(&mut self.reader).ok()
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let len = self.remaining as usize;
        (len, Some(len))
    }
}

impl ExactSizeIterator for BatchRows<'_> {}

fn write_common(
    writer: &mut Writer<'_>,
    common: &CommonFields,
    kind: ActionKind,
) -> Result<(), Error> {
    if common.approval_required == 0 || common.approval_required > 16 {
        return Err(Error::InvalidContext);
    }
    writer.push(INTENT_MAGIC)?;
    writer.u8(INTENT_VERSION)?;
    writer.u8(common.profile as u8)?;
    writer.u8(kind.code())?;
    writer.u8(common.network as u8)?;
    writer.u64(common.proposal_index)?;
    writer.push(&common.wallet_id)?;
    writer.push(&common.actor)?;
    writer.push(&common.action_id)?;
    writer.push(&common.nonce)?;
    writer.i64(common.expires_at)?;
    writer.push(&common.policy_commitment)?;
    writer.u8(common.approval_required)
}

fn write_transfer_row(writer: &mut Writer<'_>, row: &TransferRowInput<'_>) -> Result<(), Error> {
    writer.u8(row.recipient_encoding as u8)?;
    writer.bytes(row.recipient)?;
    writer.u8(row.asset_encoding as u8)?;
    writer.bytes(row.asset)?;
    writer.u128(row.raw_amount)?;
    writer.u8(row.decimals)?;
    writer.bytes(row.display_asset)
}

fn read_transfer_row<'a>(reader: &mut Reader<'a>) -> Result<Transfer<'a>, Error> {
    let recipient_encoding = IdentityEncoding::from_code(reader.u8()?)?;
    let recipient = reader.bytes(MAX_IDENTITY_BYTES)?;
    let asset_encoding = IdentityEncoding::from_code(reader.u8()?)?;
    let asset = reader.bytes(MAX_ASSET_BYTES)?;
    let raw_amount = reader.u128()?;
    let decimals = reader.u8()?;
    let display_asset = reader.bytes(24)?;
    let row = Transfer {
        recipient_encoding,
        recipient,
        asset_encoding,
        asset,
        raw_amount,
        decimals,
        display_asset,
        execution_commitment: [0u8; 32],
        encoded_fiat_estimate: &[],
    };
    validate_transfer(row)?;
    Ok(row)
}

fn validate_transfer(row: Transfer<'_>) -> Result<(), Error> {
    validate_identity(row.recipient_encoding, row.recipient, MAX_IDENTITY_BYTES)?;
    validate_identity(row.asset_encoding, row.asset, MAX_ASSET_BYTES)?;
    validate_visible_ascii(row.display_asset, 24, false)?;
    if row.raw_amount == 0 || row.decimals > 36 {
        return Err(Error::InvalidAmount);
    }
    Ok(())
}

fn validate_transfer_row(row: &TransferRowInput<'_>) -> Result<(), Error> {
    validate_transfer(Transfer {
        recipient_encoding: row.recipient_encoding,
        recipient: row.recipient,
        asset_encoding: row.asset_encoding,
        asset: row.asset,
        raw_amount: row.raw_amount,
        decimals: row.decimals,
        display_asset: row.display_asset,
        execution_commitment: [0u8; 32],
        encoded_fiat_estimate: &[],
    })
}

fn validate_transfer_input(input: &TransferInput<'_>) -> Result<(), Error> {
    validate_transfer_row(&TransferRowInput {
        recipient_encoding: input.recipient_encoding,
        recipient: input.recipient,
        asset_encoding: input.asset_encoding,
        asset: input.asset,
        raw_amount: input.raw_amount,
        decimals: input.decimals,
        display_asset: input.display_asset,
    })?;
    validate_visible_ascii(input.reason, MAX_REASON_BYTES, true)?;
    if let Some(estimate) = input.fiat_estimate {
        validate_fiat_estimate(FiatEstimate {
            amount: estimate.amount,
            currency: estimate.currency,
            source: estimate.source,
            observed_at: estimate.observed_at,
        })?;
    }
    if input.common.approval_required == 0 || input.common.approval_required > 16 {
        return Err(Error::InvalidContext);
    }
    Ok(())
}

fn validate_fiat_estimate(estimate: FiatEstimate<'_>) -> Result<(), Error> {
    validate_visible_ascii(estimate.amount, 32, false)?;
    validate_visible_ascii(estimate.currency, 8, false)?;
    validate_visible_ascii(estimate.source, 64, false)?;
    if estimate.observed_at <= 0
        || !estimate
            .amount
            .iter()
            .all(|byte| byte.is_ascii_digit() || *byte == b'.')
        || estimate.amount.first() == Some(&b'.')
        || estimate.amount.last() == Some(&b'.')
        || estimate.amount.iter().filter(|byte| **byte == b'.').count() > 1
    {
        return Err(Error::InvalidAmount);
    }
    Ok(())
}

fn validate_identity(encoding: IdentityEncoding, value: &[u8], max: usize) -> Result<(), Error> {
    if value.is_empty() || value.len() > max {
        return Err(Error::InvalidLength);
    }
    match encoding {
        IdentityEncoding::SolanaPubkey if value.len() != 32 => Err(Error::InvalidLength),
        IdentityEncoding::SolanaPubkey => Ok(()),
        IdentityEncoding::Text | IdentityEncoding::Sha256Text => {
            validate_visible_ascii(value, max, false)
        }
    }
}

fn read_ascii<'a>(reader: &mut Reader<'a>, max: usize) -> Result<&'a [u8], Error> {
    let value = reader.bytes(max)?;
    validate_visible_ascii(value, max, false)?;
    Ok(value)
}

fn validate_visible_ascii(value: &[u8], max: usize, allow_empty: bool) -> Result<(), Error> {
    if value.len() > max || (!allow_empty && value.is_empty()) {
        return Err(Error::InvalidLength);
    }
    if value
        .iter()
        .any(|byte| !matches!(byte, 0x20..=0x7e) || *byte == b'\n' || *byte == b'\r')
    {
        return Err(Error::InvalidText);
    }
    Ok(())
}

#[cfg(test)]
mod tests;
