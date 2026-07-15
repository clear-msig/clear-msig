use crate::accounts::IntentAccount;
use crate::error::*;
use clear_wallet::utils::definition::*;
use sha2::{Digest, Sha256};

/// Format timestamp identically to the on-chain code (Howard Hinnant algorithm).
pub fn format_timestamp(ts: i64) -> String {
    let secs_per_day: i64 = 86400;
    let mut days = ts / secs_per_day;
    let day_secs = ((ts % secs_per_day) + secs_per_day) % secs_per_day;
    if ts < 0 && day_secs > 0 {
        days -= 1;
    }
    let (hour, min, sec) = (day_secs / 3600, (day_secs % 3600) / 60, day_secs % 60);
    let adj = days + 719468;
    let era = if adj >= 0 { adj } else { adj - 146096 } / 146097;
    let doe = adj - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02} {hour:02}:{min:02}:{sec:02}")
}

pub fn sha256_hash(data: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(data);
    h.finalize().into()
}

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{b:02x}")).collect()
}

fn suffix(wallet_name: &str, proposal_index: u64) -> String {
    format!(" | wallet: {wallet_name} proposal: {proposal_index}")
}

/// Build the human-readable message body for any intent type.
pub fn build_message_body(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    intent: &IntentAccount,
    params_data: &[u8],
) -> Result<Vec<u8>> {
    let raw = match intent.intent_type {
        0 => build_add_intent_message(action, expiry, wallet_name, proposal_index, params_data),
        1 => {
            if params_data.len() != 1 {
                return Err(anyhow!("RemoveIntent params must be 1 byte"));
            }
            build_remove_intent_message(action, expiry, wallet_name, proposal_index, params_data[0])
        }
        2 => {
            if params_data.len() < 2 {
                return Err(anyhow!("UpdateIntent params must be >1 byte"));
            }
            build_update_intent_message(
                action,
                expiry,
                wallet_name,
                proposal_index,
                params_data[0],
                &params_data[1..],
            )
        }
        3 => build_custom_intent_message(
            action,
            expiry,
            wallet_name,
            proposal_index,
            intent,
            params_data,
        )?,
        _ => return Err(anyhow!("unknown intent type {}", intent.intent_type)),
    };
    Ok(raw)
}

/// Build a message for a meta-intent (AddIntent).
pub fn build_add_intent_message(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    params_data: &[u8],
) -> Vec<u8> {
    format!(
        "expires {}: {action} add intent definition_hash: {}{}",
        format_timestamp(expiry),
        hex_encode(&sha256_hash(params_data)),
        suffix(wallet_name, proposal_index),
    )
    .into_bytes()
}

/// Build a message for RemoveIntent.
pub fn build_remove_intent_message(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    intent_index: u8,
) -> Vec<u8> {
    format!(
        "expires {}: {action} remove intent {intent_index}{}",
        format_timestamp(expiry),
        suffix(wallet_name, proposal_index),
    )
    .into_bytes()
}

/// Build a message for UpdateIntent.
pub fn build_update_intent_message(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    intent_index: u8,
    new_def_data: &[u8],
) -> Vec<u8> {
    format!(
        "expires {}: {action} update intent {intent_index} definition_hash: {}{}",
        format_timestamp(expiry),
        hex_encode(&sha256_hash(new_def_data)),
        suffix(wallet_name, proposal_index),
    )
    .into_bytes()
}

/// Build a message for a custom intent using its template.
pub fn build_custom_intent_message(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    intent: &IntentAccount,
    params_data: &[u8],
) -> Result<Vec<u8>> {
    let template = intent.template();
    let rendered = render_template(template, intent, params_data)?;
    Ok(format!(
        "expires {}: {action} {rendered}{}",
        format_timestamp(expiry),
        suffix(wallet_name, proposal_index),
    )
    .into_bytes())
}

/// Wrap a human-readable message in Solana offchain message format.
/// This enables Ledger hardware wallets to display the message clearly.
/// Format: `\xffsolana offchain` (16) + version 0 (1) + format 0/ASCII (1) + length LE u16 (2) + message
fn wrap_offchain(message: Vec<u8>) -> Vec<u8> {
    let len = message.len() as u16;
    let mut out = Vec::with_capacity(20 + message.len());
    out.extend_from_slice(b"\xffsolana offchain");
    out.push(0); // version 0
    out.push(0); // format 0 = restricted ASCII
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&message);
    out
}

/// Build the plain human-readable bytes without the offchain envelope.
pub fn build_plain_message(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    intent: &IntentAccount,
    params_data: &[u8],
) -> Result<Vec<u8>> {
    build_message_body(
        action,
        expiry,
        wallet_name,
        proposal_index,
        intent,
        params_data,
    )
}

/// Build message for any intent type, wrapped in Solana offchain message format.
pub fn build_message(
    action: &str,
    expiry: i64,
    wallet_name: &str,
    proposal_index: u64,
    intent: &IntentAccount,
    params_data: &[u8],
) -> Result<Vec<u8>> {
    let raw = build_message_body(
        action,
        expiry,
        wallet_name,
        proposal_index,
        intent,
        params_data,
    )?;
    Ok(wrap_offchain(raw))
}

/// Render through the shared, versioned intent library.
fn render_template(template: &str, intent: &IntentAccount, params_data: &[u8]) -> Result<String> {
    let params = intent
        .params
        .iter()
        .map(|param| match param.param_type {
            ParamType::Address => clear_msig_intent::ParamTypeJson::Address,
            ParamType::U64 => clear_msig_intent::ParamTypeJson::U64,
            ParamType::I64 => clear_msig_intent::ParamTypeJson::I64,
            ParamType::String => clear_msig_intent::ParamTypeJson::String,
            ParamType::Bool => clear_msig_intent::ParamTypeJson::Bool,
            ParamType::U8 => clear_msig_intent::ParamTypeJson::U8,
            ParamType::U16 => clear_msig_intent::ParamTypeJson::U16,
            ParamType::U32 => clear_msig_intent::ParamTypeJson::U32,
            ParamType::U128 => clear_msig_intent::ParamTypeJson::U128,
            ParamType::Bytes20 => clear_msig_intent::ParamTypeJson::Bytes20,
            ParamType::Bytes32 => clear_msig_intent::ParamTypeJson::Bytes32,
        })
        .collect::<Vec<_>>();
    clear_msig_intent::render_template(template, &params, params_data)
        .map_err(|error| anyhow!("{error}"))
}

/// Parse an expiry string like "2030-01-01 00:00:00" into unix timestamp.
pub fn parse_expiry(s: &str) -> Result<i64> {
    let dt = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .with_context(|| format!("invalid expiry format: {s}"))?;
    Ok(dt.and_utc().timestamp())
}

/// Resolve expiry: use explicit value if provided, otherwise compute from config default.
pub fn resolve_expiry(
    explicit: &Option<String>,
    config: &crate::config::RuntimeConfig,
) -> Result<i64> {
    match explicit {
        Some(s) => parse_expiry(s),
        None => Ok(config.default_expiry()),
    }
}
