use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, time::Duration};

use crate::{ensure_non_empty, ApiError, AppState};

const RPC_PROGRAM_SCAN_ATTEMPTS: usize = 4;

#[derive(Deserialize)]
pub(super) struct MembershipQuery {
    pub(super) address: String,
}

#[derive(Serialize)]
pub(super) struct MembershipResponse {
    organizations: Vec<OrganizationMembership>,
}

#[derive(Serialize)]
struct OrganizationMembership {
    wallet: String,
    wallet_name: Option<String>,
    /// Pubkey (base58) of the address that created this wallet. Added
    /// 2026-05-03 with the creator-scoped PDA upgrade so the frontend
    /// can use the fast PDA-derivation path on subsequent reads.
    wallet_creator: Option<String>,
    roles: Vec<String>,
    intent_indexes: Vec<u8>,
}

#[derive(Deserialize)]
struct RpcProgramAccountsResponse {
    result: Vec<RpcProgramAccount>,
}

#[derive(Deserialize)]
struct RpcProgramAccount {
    pubkey: String,
    account: RpcProgramAccountData,
}

#[derive(Deserialize)]
struct RpcProgramAccountData {
    data: (String, String),
}

#[derive(Default)]
struct MembershipAccumulator {
    wallet_name: Option<String>,
    wallet_creator: Option<String>,
    has_proposer: bool,
    has_approver: bool,
    intent_indexes: HashSet<u8>,
}

pub(super) async fn lookup_memberships(
    state: &AppState,
    address: String,
) -> Result<MembershipResponse, ApiError> {
    ensure_non_empty(&address, "address")?;
    let target_address = address.trim().to_string();

    let mut rpc_url: Option<String> = None;
    let mut i = 0usize;
    while i + 1 < state.runner.base_args.len() {
        if state.runner.base_args[i] == "--url" {
            rpc_url = Some(state.runner.base_args[i + 1].clone());
            break;
        }
        i += 1;
    }

    let rpc_url = rpc_url.unwrap_or_else(|| {
        "https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH".to_string()
    });

    let program_id = state
        .runner
        .run_json(vec!["config".to_string(), "show".to_string()])
        .await
        .ok()
        .and_then(|cfg| {
            cfg.get("program_id")
                .and_then(|v| v.as_str())
                .map(ToString::to_string)
        })
        .or_else(|| std::env::var("CLEAR_MSIG_PROGRAM_ID").ok())
        .unwrap_or_else(|| "53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v".to_string());

    let wallet_accounts =
        fetch_program_accounts_by_disc(&rpc_url, &program_id, /* ClearWallet */ 1).await?;
    let intent_accounts =
        fetch_program_accounts_by_disc(&rpc_url, &program_id, /* Intent */ 2).await?;

    let mut wallets: std::collections::BTreeMap<String, MembershipAccumulator> =
        std::collections::BTreeMap::new();

    for account in wallet_accounts {
        let data = decode_base64_data(&account.account.data.0)?;
        if let Some((name, creator)) = parse_wallet_name(&data)? {
            let entry = wallets.entry(account.pubkey).or_default();
            entry.wallet_name = Some(name);
            entry.wallet_creator = Some(creator);
        }
    }

    for account in intent_accounts {
        let data = decode_base64_data(&account.account.data.0)?;
        if let Some((wallet, intent_index, proposers, approvers)) = parse_intent_membership(&data)?
        {
            let is_proposer = proposers.iter().any(|addr| addr == &target_address);
            let is_approver = approvers.iter().any(|addr| addr == &target_address);
            if is_proposer || is_approver {
                let entry = wallets.entry(wallet).or_default();
                entry.intent_indexes.insert(intent_index);
                if is_proposer {
                    entry.has_proposer = true;
                }
                if is_approver {
                    entry.has_approver = true;
                }
            }
        }
    }

    let organizations = wallets
        .into_iter()
        .filter_map(|(wallet, acc)| {
            if !acc.has_proposer && !acc.has_approver {
                return None;
            }
            acc.wallet_name.as_ref()?;
            let mut roles = Vec::new();
            if acc.has_proposer {
                roles.push("proposer".to_string());
            }
            if acc.has_approver {
                roles.push("approver".to_string());
            }
            let mut intent_indexes: Vec<u8> = acc.intent_indexes.into_iter().collect();
            intent_indexes.sort_unstable();
            Some(OrganizationMembership {
                wallet,
                wallet_name: acc.wallet_name,
                wallet_creator: acc.wallet_creator,
                roles,
                intent_indexes,
            })
        })
        .collect();

    Ok(MembershipResponse { organizations })
}

fn decode_base64_data(encoded: &str) -> Result<Vec<u8>, ApiError> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|e| ApiError::InvalidOutput(format!("invalid base64 account data: {e}")))
}

fn read_u8(data: &[u8], offset: &mut usize) -> Result<u8, ApiError> {
    let value = *data
        .get(*offset)
        .ok_or_else(|| ApiError::InvalidOutput(format!("unexpected EOF at {offset}")))?;
    *offset += 1;
    Ok(value)
}

fn read_u16_le(data: &[u8], offset: &mut usize) -> Result<u16, ApiError> {
    let bytes: [u8; 2] = data
        .get(*offset..*offset + 2)
        .ok_or_else(|| ApiError::InvalidOutput("unexpected EOF reading u16".into()))?
        .try_into()
        .map_err(|_| ApiError::InvalidOutput("invalid u16 slice".into()))?;
    *offset += 2;
    Ok(u16::from_le_bytes(bytes))
}

fn read_u32_le(data: &[u8], offset: &mut usize) -> Result<u32, ApiError> {
    let bytes: [u8; 4] = data
        .get(*offset..*offset + 4)
        .ok_or_else(|| ApiError::InvalidOutput("unexpected EOF reading u32".into()))?
        .try_into()
        .map_err(|_| ApiError::InvalidOutput("invalid u32 slice".into()))?;
    *offset += 4;
    Ok(u32::from_le_bytes(bytes))
}

fn read_address_bs58(data: &[u8], offset: &mut usize) -> Result<String, ApiError> {
    let bytes = data
        .get(*offset..*offset + 32)
        .ok_or_else(|| ApiError::InvalidOutput("unexpected EOF reading address".into()))?;
    *offset += 32;
    Ok(bs58::encode(bytes).into_string())
}

fn read_vec_addresses(data: &[u8], offset: &mut usize) -> Result<Vec<String>, ApiError> {
    let len = read_u32_le(data, offset)? as usize;
    let mut out = Vec::with_capacity(len);
    for _ in 0..len {
        out.push(read_address_bs58(data, offset)?);
    }
    Ok(out)
}

fn skip_raw_vec(data: &[u8], offset: &mut usize, element_size: usize) -> Result<(), ApiError> {
    let len = read_u32_le(data, offset)? as usize;
    let bytes = len
        .checked_mul(element_size)
        .ok_or_else(|| ApiError::InvalidOutput("vector length overflow".into()))?;
    let end = offset
        .checked_add(bytes)
        .ok_or_else(|| ApiError::InvalidOutput("vector offset overflow".into()))?;
    if end > data.len() {
        return Err(ApiError::InvalidOutput(
            "unexpected EOF skipping vec".into(),
        ));
    }
    *offset = end;
    Ok(())
}

fn skip_u8_vec(data: &[u8], offset: &mut usize) -> Result<(), ApiError> {
    skip_raw_vec(data, offset, 1)
}

fn parse_wallet_name(data: &[u8]) -> Result<Option<(String, String)>, ApiError> {
    if data.first().copied() != Some(1) {
        return Ok(None);
    }

    let mut offset = 1;
    let _bump = read_u8(data, &mut offset)?;
    offset += 8; // proposal_index
    let _intent_index = read_u8(data, &mut offset)?;
    let creator = read_address_bs58(data, &mut offset)?;
    let name_len = read_u32_le(data, &mut offset)? as usize;
    let name_bytes = data
        .get(offset..offset + name_len)
        .ok_or_else(|| ApiError::InvalidOutput("unexpected EOF reading wallet name".into()))?;
    let name = String::from_utf8_lossy(name_bytes).to_string();
    Ok(Some((name, creator)))
}

type ParsedIntentMembership = (String, u8, Vec<String>, Vec<String>);

fn parse_intent_membership(data: &[u8]) -> Result<Option<ParsedIntentMembership>, ApiError> {
    if data.first().copied() != Some(2) {
        return Ok(None);
    }

    let mut offset = 1;
    let wallet = read_address_bs58(data, &mut offset)?;
    let _bump = read_u8(data, &mut offset)?;
    let intent_index = read_u8(data, &mut offset)?;
    let _intent_type = read_u8(data, &mut offset)?;
    let _chain_kind = read_u8(data, &mut offset)?;
    let _approved = read_u8(data, &mut offset)?;
    let _approval_threshold = read_u8(data, &mut offset)?;
    let _cancellation_threshold = read_u8(data, &mut offset)?;
    offset += 4; // timelock_seconds
    let _template_offset = read_u16_le(data, &mut offset)?;
    let _template_len = read_u16_le(data, &mut offset)?;
    let _tx_template_offset = read_u16_le(data, &mut offset)?;
    let _tx_template_len = read_u16_le(data, &mut offset)?;
    let _active_proposal_count = read_u16_le(data, &mut offset)?;

    let proposers = read_vec_addresses(data, &mut offset)?;
    let approvers = read_vec_addresses(data, &mut offset)?;

    skip_raw_vec(data, &mut offset, 14)?;
    skip_raw_vec(data, &mut offset, 7)?;
    skip_raw_vec(data, &mut offset, 9)?;
    skip_raw_vec(data, &mut offset, 5)?;
    skip_raw_vec(data, &mut offset, 5)?;
    skip_u8_vec(data, &mut offset)?;

    Ok(Some((wallet, intent_index, proposers, approvers)))
}

async fn fetch_program_accounts_by_disc(
    rpc_url: &str,
    program_id: &str,
    discriminator: u8,
) -> Result<Vec<RpcProgramAccount>, ApiError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| ApiError::Internal(format!("failed to build rpc client: {e}")))?;
    let disc_bytes_b58 = bs58::encode([discriminator]).into_string();
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getProgramAccounts",
        "params": [
            program_id,
            {
                "encoding": "base64",
                "commitment": "confirmed",
                "filters": [
                    { "memcmp": { "offset": 0, "bytes": disc_bytes_b58 } }
                ]
            }
        ]
    });

    for attempt in 1..=RPC_PROGRAM_SCAN_ATTEMPTS {
        let response = match client.post(rpc_url).json(&payload).send().await {
            Ok(response) => response,
            Err(error) => {
                if attempt < RPC_PROGRAM_SCAN_ATTEMPTS && is_retryable_rpc_transport(&error) {
                    tracing::warn!(
                        attempt,
                        max_attempts = RPC_PROGRAM_SCAN_ATTEMPTS,
                        discriminator,
                        error = %error,
                        "retrying Solana program-account scan after transport failure"
                    );
                    tokio::time::sleep(rpc_retry_delay(attempt)).await;
                    continue;
                }
                return Err(ApiError::Internal(format!("rpc request failed: {error}")));
            }
        };

        let status = response.status();
        let value: serde_json::Value = response
            .json()
            .await
            .map_err(|e| ApiError::InvalidOutput(format!("invalid rpc json response: {e}")))?;

        if !status.is_success() {
            if attempt < RPC_PROGRAM_SCAN_ATTEMPTS && is_retryable_rpc_status(status) {
                tracing::warn!(
                    attempt,
                    max_attempts = RPC_PROGRAM_SCAN_ATTEMPTS,
                    discriminator,
                    status = %status,
                    "retrying Solana program-account scan after rpc status"
                );
                tokio::time::sleep(rpc_retry_delay(attempt)).await;
                continue;
            }
            return Err(ApiError::Internal(format!(
                "rpc request failed with status {status}: {value}"
            )));
        }

        if value.get("error").is_some() {
            if attempt < RPC_PROGRAM_SCAN_ATTEMPTS && is_retryable_rpc_json_error(&value) {
                tracing::warn!(
                    attempt,
                    max_attempts = RPC_PROGRAM_SCAN_ATTEMPTS,
                    discriminator,
                    error = %value,
                    "retrying Solana program-account scan after rpc error"
                );
                tokio::time::sleep(rpc_retry_delay(attempt)).await;
                continue;
            }
            return Err(ApiError::Internal(format!("rpc returned error: {value}")));
        }

        return serde_json::from_value::<RpcProgramAccountsResponse>(value)
            .map(|v| v.result)
            .map_err(|e| {
                ApiError::InvalidOutput(format!("failed to parse rpc program accounts: {e}"))
            });
    }

    Err(ApiError::Internal(
        "rpc request failed after retrying program-account scan".to_string(),
    ))
}

fn rpc_retry_delay(attempt: usize) -> Duration {
    Duration::from_millis(350 * attempt as u64)
}

fn is_retryable_rpc_transport(error: &reqwest::Error) -> bool {
    error.is_timeout() || error.is_connect() || error.is_request() || error.is_body()
}

fn is_retryable_rpc_status(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

fn is_retryable_rpc_json_error(value: &serde_json::Value) -> bool {
    let text = value.to_string().to_lowercase();
    [
        "timeout",
        "too many requests",
        "rate limit",
        "temporarily unavailable",
        "node is behind",
        "429",
        "500",
        "502",
        "503",
        "504",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}
