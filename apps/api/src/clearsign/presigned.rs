use serde::Deserialize;

use crate::{
    current_unix_timestamp, ensure_base58_pubkey, ensure_hex, ensure_hex_exact_len,
    ensure_non_empty, ApiError,
};

/// Bundle of pre-signed flags that the browser produces. `params_data_hex`
/// is optional because approve/cancel read params_data from the on-chain
/// Proposal account instead of taking it from the caller.
#[derive(Debug, Deserialize)]
pub(crate) struct PreSigned {
    /// Base58-encoded ed25519 public key of the signer.
    pub(crate) signer_pubkey: String,
    /// Hex-encoded 64-byte ed25519 signature.
    pub(crate) signature: String,
    /// Exact byte layout the browser signed. Optional for older clients;
    /// when present it is forwarded to the CLI so verification does not
    /// guess the format via fallback.
    #[serde(default)]
    pub(crate) message_flavor: Option<String>,
    /// Hex-encoded bytes the caller serialized into the message. Optional
    /// for approve/cancel; required for propose / intent add / update.
    #[serde(default)]
    pub(crate) params_data_hex: Option<String>,
    /// Hex-encoded exact readable ClearSign typed approval document the
    /// browser wallet signed. Required by typed proposal submit paths.
    #[serde(default)]
    pub(crate) signed_message_hex: Option<String>,
    /// Unix timestamp at which the signed message expires. MUST match the
    /// `expiry` the CLI builds into the message, or the PreSignedMessageSigner
    /// verification step fails.
    pub(crate) expiry: i64,
}

impl PreSigned {
    pub(crate) fn ensure_valid(&self) -> Result<(), ApiError> {
        ensure_non_empty(&self.signer_pubkey, "signer_pubkey")?;
        ensure_base58_pubkey(&self.signer_pubkey, "signer_pubkey")?;
        ensure_non_empty(&self.signature, "signature")?;
        ensure_hex_exact_len(&self.signature, "signature", 64)?;
        if let Some(flavor) = &self.message_flavor {
            match flavor.as_str() {
                "offchain_v1"
                | "plain_v2"
                | "clearsign_v2_text"
                | "clearsign_v3_document"
                | "clearsign_v4_document" => {}
                other => {
                    return Err(ApiError::BadRequest(format!(
                        "message_flavor must be offchain_v1, plain_v2, clearsign_v2_text, clearsign_v3_document, or clearsign_v4_document, got {other}"
                    )));
                }
            }
        }
        if let Some(p) = &self.params_data_hex {
            ensure_non_empty(p, "params_data_hex")?;
            ensure_hex(p, "params_data_hex")?;
        }
        if let Some(m) = &self.signed_message_hex {
            ensure_non_empty(m, "signed_message_hex")?;
            ensure_hex(m, "signed_message_hex")?;
        }
        if self.expiry <= 0 {
            return Err(ApiError::BadRequest(
                "expiry must be a positive unix timestamp".into(),
            ));
        }
        let now = current_unix_timestamp()?;
        if self.expiry <= now + 15 {
            return Err(ApiError::BadRequest(
                "signed request has expired or is too close to expiry; prepare a fresh request"
                    .into(),
            ));
        }
        Ok(())
    }
}
