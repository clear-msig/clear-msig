use serde_json::Value;
use sha2::{Digest, Sha256};

use super::hash::{update_amount, update_bytes};
use crate::ApiError;

#[derive(Debug)]
pub(super) struct Money {
    pub(super) amount: String,
    pub(super) asset: String,
    pub(super) display_asset: String,
    pub(super) asset_encoding: AssetEncoding,
    pub(super) raw_amount: u128,
    pub(super) decimals: usize,
}

#[derive(Debug)]
pub(super) struct RecipientAmount {
    pub(super) recipient: String,
    pub(super) recipient_encoding: RecipientEncoding,
    pub(super) money: Money,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum RecipientEncoding {
    Text,
    SolanaPubkey,
    Sha256Text,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum AssetEncoding {
    Text,
    Sha256Text,
}

impl Money {
    pub(super) fn new(
        amount: String,
        asset: String,
        asset_encoding: AssetEncoding,
    ) -> Result<Self, ApiError> {
        Self::new_with_display(amount, asset, asset_encoding, None, None)
    }

    fn new_with_display(
        amount: String,
        asset: String,
        asset_encoding: AssetEncoding,
        decimals: Option<usize>,
        display_asset: Option<String>,
    ) -> Result<Self, ApiError> {
        let asset = normalize_asset_identity(&asset);
        if asset.is_empty() {
            return Err(ApiError::BadRequest("asset must not be empty".into()));
        }
        let amount = normalize_decimal(&amount)?;
        let decimals = decimals.unwrap_or_else(|| asset_decimals(&asset));
        if decimals > 36 {
            return Err(ApiError::BadRequest(
                "payload.decimals must be between 0 and 36".into(),
            ));
        }
        let display_asset = display_asset
            .map(|value| normalize_text(&value).to_uppercase())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| asset.clone());
        let raw_amount = decimal_to_raw(&amount, decimals)?;
        Ok(Self {
            amount,
            asset,
            display_asset,
            asset_encoding,
            raw_amount,
            decimals,
        })
    }
}

pub(super) fn recipient_amount(value: &Value) -> Result<RecipientAmount, ApiError> {
    let row = RecipientAmount {
        recipient: payload_text(value, "recipient")?,
        recipient_encoding: recipient_encoding(value)?,
        money: Money::new_with_display(
            payload_text(value, "amount")?,
            payload_text(value, "asset")?,
            asset_encoding(value)?,
            optional_decimals(value)?,
            optional_payload_text(value, "displayAsset")?,
        )?,
    };
    validate_recipient_amount(&row)?;
    Ok(row)
}

pub(super) fn update_recipient_amount(hasher: &mut Sha256, row: &RecipientAmount) {
    match row.recipient_encoding {
        RecipientEncoding::Text => update_bytes(hasher, row.recipient.as_bytes()),
        RecipientEncoding::Sha256Text => update_bytes(hasher, &text_commitment(&row.recipient)),
        RecipientEncoding::SolanaPubkey => {
            let decoded = bs58::decode(&row.recipient)
                .into_vec()
                .expect("recipient_amount validates Solana pubkeys");
            update_bytes(hasher, &decoded);
        }
    }
    update_amount(hasher, &row.money);
}

pub(super) fn validate_recipient_amount(row: &RecipientAmount) -> Result<(), ApiError> {
    if row.recipient_encoding == RecipientEncoding::SolanaPubkey {
        let decoded = bs58::decode(&row.recipient)
            .into_vec()
            .map_err(|_| ApiError::BadRequest("recipient must be a Solana address".into()))?;
        if decoded.len() != 32 {
            return Err(ApiError::BadRequest(
                "recipient must be a Solana address".into(),
            ));
        }
    }
    Ok(())
}

pub(super) fn payload_text(payload: &Value, field: &str) -> Result<String, ApiError> {
    let value = payload
        .get(field)
        .and_then(Value::as_str)
        .map(normalize_text)
        .ok_or_else(|| ApiError::BadRequest(format!("payload.{field} must be a string")))?;
    if value.is_empty() {
        return Err(ApiError::BadRequest(format!(
            "payload.{field} must not be empty"
        )));
    }
    Ok(value)
}

pub(super) fn optional_payload_text(
    payload: &Value,
    field: &str,
) -> Result<Option<String>, ApiError> {
    let Some(value) = payload.get(field) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let value = value
        .as_str()
        .map(normalize_text)
        .ok_or_else(|| ApiError::BadRequest(format!("payload.{field} must be a string")))?;
    Ok((!value.is_empty()).then_some(value))
}

pub(super) fn payload_u32(payload: &Value, field: &str) -> Result<u32, ApiError> {
    let value = payload.get(field).ok_or_else(|| {
        ApiError::BadRequest(format!("payload.{field} must be a positive integer"))
    })?;
    let parsed = if let Some(n) = value.as_u64() {
        n
    } else if let Some(s) = value.as_str() {
        normalize_text(s).parse::<u64>().map_err(|_| {
            ApiError::BadRequest(format!("payload.{field} must be a positive integer"))
        })?
    } else {
        return Err(ApiError::BadRequest(format!(
            "payload.{field} must be a positive integer"
        )));
    };
    u32::try_from(parsed).map_err(|_| ApiError::BadRequest(format!("payload.{field} is too large")))
}

fn recipient_encoding(payload: &Value) -> Result<RecipientEncoding, ApiError> {
    let Some(value) = payload.get("recipientEncoding") else {
        return Ok(RecipientEncoding::Text);
    };
    let Some(raw) = value.as_str() else {
        return Err(ApiError::BadRequest(
            "payload.recipientEncoding must be a string".into(),
        ));
    };
    match normalize_text(raw).as_str() {
        "" | "text" => Ok(RecipientEncoding::Text),
        "solana_pubkey" => Ok(RecipientEncoding::SolanaPubkey),
        "sha256_text" => Ok(RecipientEncoding::Sha256Text),
        _ => Err(ApiError::BadRequest(
            "payload.recipientEncoding must be text, solana_pubkey, or sha256_text".into(),
        )),
    }
}

fn asset_encoding(payload: &Value) -> Result<AssetEncoding, ApiError> {
    let Some(value) = payload.get("assetEncoding") else {
        return Ok(AssetEncoding::Text);
    };
    let Some(raw) = value.as_str() else {
        return Err(ApiError::BadRequest(
            "payload.assetEncoding must be a string".into(),
        ));
    };
    match normalize_text(raw).as_str() {
        "" | "text" => Ok(AssetEncoding::Text),
        "sha256_text" => Ok(AssetEncoding::Sha256Text),
        _ => Err(ApiError::BadRequest(
            "payload.assetEncoding must be text or sha256_text".into(),
        )),
    }
}

fn text_commitment(value: &str) -> [u8; 32] {
    Sha256::digest(normalize_text(value).as_bytes()).into()
}

pub(super) fn leverage_to_x100(value: &str) -> Result<u32, ApiError> {
    let raw = normalize_text(value)
        .trim_end_matches('x')
        .trim_end_matches('X')
        .to_string();
    let normalized = normalize_decimal(&raw)?;
    let (whole, frac) = normalized
        .split_once('.')
        .map_or((normalized.as_str(), ""), |(whole, frac)| (whole, frac));
    if frac.len() > 2 {
        return Err(ApiError::BadRequest(
            "maxLeverage supports at most two decimal places".into(),
        ));
    }
    let whole = whole
        .parse::<u32>()
        .map_err(|_| ApiError::BadRequest("maxLeverage is too large".into()))?;
    let frac = format!("{frac:0<2}")
        .parse::<u32>()
        .map_err(|_| ApiError::BadRequest("maxLeverage is too large".into()))?;
    whole
        .checked_mul(100)
        .and_then(|v| v.checked_add(frac))
        .ok_or_else(|| ApiError::BadRequest("maxLeverage is too large".into()))
}

pub(super) fn normalize_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(super) fn normalize_decimal(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') || trimmed.starts_with('+') {
        return Err(ApiError::BadRequest(
            "amount must be a positive decimal".into(),
        ));
    }
    let (whole, frac) = trimmed
        .split_once('.')
        .map_or((trimmed, ""), |(whole, frac)| (whole, frac));
    if whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || !frac.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(ApiError::BadRequest(
            "amount must be a decimal number".into(),
        ));
    }
    let whole = whole.trim_start_matches('0');
    let whole = if whole.is_empty() { "0" } else { whole };
    let frac = frac.trim_end_matches('0');
    if frac.is_empty() {
        Ok(whole.to_string())
    } else {
        Ok(format!("{whole}.{frac}"))
    }
}

pub(super) fn format_money(money: &Money) -> String {
    format!("{} {}", money.amount, money.display_asset)
}

pub(super) fn json_string(value: &str) -> Result<String, ApiError> {
    serde_json::to_string(value)
        .map_err(|e| ApiError::Internal(format!("failed to encode clearsign payload: {e}")))
}

pub(super) fn decimal_to_raw(value: &str, decimals: usize) -> Result<u128, ApiError> {
    let (whole, frac) = value
        .split_once('.')
        .map_or((value, ""), |(whole, frac)| (whole, frac));
    if whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError::BadRequest(
            "amount must be a decimal number".into(),
        ));
    }
    if frac.len() > decimals || !frac.bytes().all(|b| b.is_ascii_digit()) {
        return Err(ApiError::BadRequest(format!(
            "amount supports at most {decimals} decimal places"
        )));
    }
    let whole_raw = whole
        .parse::<u128>()
        .map_err(|_| ApiError::BadRequest("amount is too large".into()))?
        .checked_mul(10u128.pow(decimals as u32))
        .ok_or_else(|| ApiError::BadRequest("amount is too large".into()))?;
    let frac_padded = format!("{frac:0<decimals$}");
    let frac_raw = if frac_padded.is_empty() {
        0
    } else {
        frac_padded
            .parse::<u128>()
            .map_err(|_| ApiError::BadRequest("amount is too large".into()))?
    };
    whole_raw
        .checked_add(frac_raw)
        .ok_or_else(|| ApiError::BadRequest("amount is too large".into()))
}

fn asset_decimals(asset: &str) -> usize {
    match asset {
        "BTC" | "ZEC" => 8,
        "ETH" | "HYPE" => 18,
        "USDC" | "USDT" | "USD" => 6,
        _ => 9,
    }
}

fn normalize_asset_identity(value: &str) -> String {
    let asset = normalize_text(value);
    if asset.len() == 42
        && asset.starts_with("0x")
        && asset[2..].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        asset.to_lowercase()
    } else {
        asset.to_uppercase()
    }
}

fn optional_decimals(payload: &Value) -> Result<Option<usize>, ApiError> {
    let Some(value) = payload.get("decimals") else {
        return Ok(None);
    };
    let raw = value
        .as_u64()
        .ok_or_else(|| ApiError::BadRequest("payload.decimals must be an integer".into()))?;
    let decimals = usize::try_from(raw)
        .map_err(|_| ApiError::BadRequest("payload.decimals is too large".into()))?;
    if decimals > 36 {
        return Err(ApiError::BadRequest(
            "payload.decimals must be between 0 and 36".into(),
        ));
    }
    Ok(Some(decimals))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_human_amounts_become_destination_base_units() {
        let eth = recipient_amount(&serde_json::json!({
            "recipient": "0xabc",
            "amount": "2",
            "asset": "ETH"
        }))
        .unwrap();
        let btc = recipient_amount(&serde_json::json!({
            "recipient": "tb1qexample",
            "amount": "0.003",
            "asset": "BTC"
        }))
        .unwrap();

        assert_eq!(eth.money.raw_amount, 2_000_000_000_000_000_000);
        assert_eq!(btc.money.raw_amount, 300_000);
    }

    #[test]
    fn token_human_amount_uses_contract_decimals_and_readable_symbol() {
        let token = recipient_amount(&serde_json::json!({
            "recipient": "0xabc",
            "amount": "1.5",
            "asset": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            "assetEncoding": "sha256_text",
            "decimals": 6,
            "displayAsset": "USDC"
        }))
        .unwrap();

        assert_eq!(token.money.raw_amount, 1_500_000);
        assert_eq!(format_money(&token.money), "1.5 USDC");
        assert_eq!(
            token.money.asset,
            "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
        );
    }
}
