use clear_msig_signing::{
    execution_commitment, spl_escrow_return_execution_commitment, IdentityEncoding,
};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{ClearSignV4PrepareRequest, OwnedTransferRow, TrustedIntentContext};
use crate::clearsign::{
    payload::normalize_text,
    v4_input::{decode_base58_32, decode_payload_hash, strict_required_text, value_string},
};
use crate::{ApiError, AppState};

#[derive(Clone, Debug, Default)]
pub(super) struct TrustedEscrowBinding {
    pub(super) ika_config: Option<[u8; 32]>,
    pub(super) dwallet: Option<[u8; 32]>,
    pub(super) policy_ciphertexts_hash: Option<[u8; 32]>,
}

pub(super) async fn resolve_trusted_escrow_binding(
    state: &AppState,
    req: &ClearSignV4PrepareRequest,
    intent: &Value,
    wallet_name: &str,
    chain_kind: u8,
) -> Result<TrustedEscrowBinding, ApiError> {
    let Some(mode) = req
        .envelope
        .payload
        .get("execution")
        .and_then(|value| value.get("mode"))
        .and_then(Value::as_str)
        .map(normalize_text)
    else {
        return Ok(TrustedEscrowBinding::default());
    };

    match mode.as_str() {
        "spl" => Ok(TrustedEscrowBinding::default()),
        "cross_chain" => {
            if chain_kind == 0 {
                return Err(ApiError::BadRequest(
                    "cross-chain escrow requires a remote-chain intent".into(),
                ));
            }
            let chains = state
                .runner
                .run_direct(
                    clear_msig_command_contract::DirectExecutionContext::Backend,
                    clear_msig_command_contract::DirectCommand::WalletChains {
                        wallet: wallet_name.to_string(),
                        dwallet_program: None,
                    },
                )
                .await?;
            let rows = chains
                .get("chains")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    ApiError::InvalidOutput("wallet chains did not return chains".into())
                })?;
            let binding = rows
                .iter()
                .find(|row| {
                    row.get("chain_kind").and_then(Value::as_u64) == Some(chain_kind as u64)
                })
                .ok_or_else(|| {
                    ApiError::BadRequest("selected chain is not bound to an Ika dWallet".into())
                })?;
            Ok(TrustedEscrowBinding {
                ika_config: Some(decode_base58_32(
                    value_string(binding, "ika_config")?,
                    "wallet chain ika_config",
                )?),
                dwallet: Some(decode_base58_32(
                    value_string(binding, "dwallet")?,
                    "wallet chain dwallet",
                )?),
                policy_ciphertexts_hash: None,
            })
        }
        "private" => {
            let ids = intent
                .get("policy_ciphertexts")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    ApiError::InvalidOutput("intent did not return policy ciphertexts".into())
                })?;
            if ids.is_empty() {
                return Err(ApiError::BadRequest(
                    "private escrow requires encrypted policy ciphertexts on the intent".into(),
                ));
            }
            let mut encoded = Vec::new();
            let count = u16::try_from(ids.len())
                .map_err(|_| ApiError::InvalidOutput("too many policy ciphertexts".into()))?;
            encoded.extend_from_slice(&count.to_le_bytes());
            for id in ids {
                let id = id.as_str().ok_or_else(|| {
                    ApiError::InvalidOutput("policy ciphertext identifier was not text".into())
                })?;
                let len = u16::try_from(id.len()).map_err(|_| {
                    ApiError::InvalidOutput("policy ciphertext identifier is too long".into())
                })?;
                encoded.extend_from_slice(&len.to_le_bytes());
                encoded.extend_from_slice(id.as_bytes());
            }
            Ok(TrustedEscrowBinding {
                policy_ciphertexts_hash: Some(Sha256::digest(&encoded).into()),
                ..TrustedEscrowBinding::default()
            })
        }
        _ => Err(ApiError::BadRequest(
            "payload.execution.mode must be spl, cross_chain, or private".into(),
        )),
    }
}

pub(super) fn escrow_execution_commitment(
    payload: &Value,
    trusted: &TrustedIntentContext,
    release: bool,
    rows: &[OwnedTransferRow],
) -> Result<[u8; 32], ApiError> {
    let Some(binding) = payload.get("execution") else {
        if trusted.chain_kind != 0 {
            return Err(ApiError::BadRequest(
                "remote-chain escrow requires an execution binding".into(),
            ));
        }
        return Ok([0u8; 32]);
    };
    let mode = strict_required_text(binding, "mode", 32)?;
    match mode.as_str() {
        "spl" => spl_execution_commitment(binding, trusted, release, rows),
        "cross_chain" => cross_chain_execution_commitment(binding, trusted, release, rows),
        "private" => private_execution_commitment(binding, trusted, release, rows),
        _ => Err(ApiError::BadRequest(
            "payload.execution.mode must be spl, cross_chain, or private".into(),
        )),
    }
}

fn spl_execution_commitment(
    binding: &Value,
    trusted: &TrustedIntentContext,
    release: bool,
    rows: &[OwnedTransferRow],
) -> Result<[u8; 32], ApiError> {
    if trusted.chain_kind != 0 {
        return Err(ApiError::BadRequest(
            "SPL escrow requires a Solana intent".into(),
        ));
    }
    let mint = decode_base58_32(
        &strict_required_text(binding, "mint", 44)?,
        "payload.execution.mint",
    )?;
    let source = decode_base58_32(
        &strict_required_text(binding, "sourceToken", 44)?,
        "payload.execution.sourceToken",
    )?;
    if rows
        .iter()
        .any(|row| row.asset_encoding != IdentityEncoding::SolanaPubkey || row.asset != mint)
    {
        return Err(ApiError::BadRequest(
            "each signed asset must be the execution mint address".into(),
        ));
    }
    if release {
        let row = rows
            .first()
            .ok_or_else(|| ApiError::BadRequest("escrow release requires one payment".into()))?;
        let destination = decode_base58_32(
            &strict_required_text(binding, "destinationToken", 44)?,
            "payload.execution.destinationToken",
        )?;
        let owner = decode_base58_32(
            &strict_required_text(binding, "recipientOwner", 44)?,
            "payload.execution.recipientOwner",
        )?;
        if row.recipient_encoding != IdentityEncoding::SolanaPubkey || row.recipient != owner {
            return Err(ApiError::BadRequest(
                "signed recipient must match the destination token owner".into(),
            ));
        }
        return Ok(execution_commitment(&[
            b"spl_escrow_release",
            &mint,
            &source,
            &destination,
        ]));
    }

    let token_returns = binding
        .get("tokenReturns")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ApiError::BadRequest("payload.execution.tokenReturns must be an array".into())
        })?;
    if token_returns.len() != rows.len() || rows.is_empty() {
        return Err(ApiError::BadRequest(
            "tokenReturns must match the signed return rows".into(),
        ));
    }
    let mut destinations = Vec::with_capacity(rows.len());
    for (index, (binding_row, signed_row)) in token_returns.iter().zip(rows).enumerate() {
        let destination = decode_base58_32(
            &strict_required_text(binding_row, "destinationToken", 44)?,
            &format!("payload.execution.tokenReturns[{index}].destinationToken"),
        )?;
        let owner = decode_base58_32(
            &strict_required_text(binding_row, "funderOwner", 44)?,
            &format!("payload.execution.tokenReturns[{index}].funderOwner"),
        )?;
        if signed_row.recipient_encoding != IdentityEncoding::SolanaPubkey
            || signed_row.recipient != owner
        {
            return Err(ApiError::BadRequest(
                "each signed return recipient must match its token-account owner".into(),
            ));
        }
        destinations.push(destination);
    }
    Ok(spl_escrow_return_execution_commitment(
        &mint,
        &source,
        destinations.iter().map(|value| value.as_slice()),
    ))
}

fn cross_chain_execution_commitment(
    binding: &Value,
    trusted: &TrustedIntentContext,
    release: bool,
    rows: &[OwnedTransferRow],
) -> Result<[u8; 32], ApiError> {
    if trusted.chain_kind == 0 {
        return Err(ApiError::BadRequest(
            "cross-chain escrow requires a remote-chain intent".into(),
        ));
    }
    require_hashed_remote_rows(rows, "cross-chain")?;
    let ika_config = trusted
        .escrow_binding
        .ika_config
        .ok_or_else(|| ApiError::InvalidOutput("trusted Ika config was not resolved".into()))?;
    let dwallet = trusted
        .escrow_binding
        .dwallet
        .ok_or_else(|| ApiError::InvalidOutput("trusted dWallet was not resolved".into()))?;
    let route = decode_payload_hash(binding, "routeHash")?;
    let artifact = decode_payload_hash(binding, "settlementArtifactHash")?;
    let chain = [trusted.chain_kind];
    Ok(execution_commitment(&[
        if release {
            b"cross_chain_escrow_release"
        } else {
            b"cross_chain_escrow_return"
        },
        &chain,
        &ika_config,
        &dwallet,
        &route,
        &trusted.execution_commitment,
        &artifact,
    ]))
}

fn private_execution_commitment(
    binding: &Value,
    trusted: &TrustedIntentContext,
    release: bool,
    rows: &[OwnedTransferRow],
) -> Result<[u8; 32], ApiError> {
    require_hashed_remote_rows(rows, "private")?;
    let policy = trusted
        .escrow_binding
        .policy_ciphertexts_hash
        .ok_or_else(|| {
            ApiError::InvalidOutput("trusted policy ciphertext commitment was not resolved".into())
        })?;
    let evaluation = decode_payload_hash(binding, "privateEvaluationHash")?;
    let artifact = decode_payload_hash(binding, "settlementArtifactHash")?;
    Ok(execution_commitment(&[
        if release {
            b"private_escrow_release"
        } else {
            b"private_escrow_return"
        },
        &policy,
        &evaluation,
        &artifact,
    ]))
}

fn require_hashed_remote_rows(rows: &[OwnedTransferRow], label: &str) -> Result<(), ApiError> {
    if rows.iter().any(|row| {
        row.recipient_encoding != IdentityEncoding::Sha256Text
            || row.asset_encoding != IdentityEncoding::Sha256Text
    }) {
        return Err(ApiError::BadRequest(format!(
            "{label} escrow recipient and asset must use sha256_text encoding"
        )));
    }
    Ok(())
}
