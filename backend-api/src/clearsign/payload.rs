use serde_json::Value;
use sha2::Sha256;

use super::hash::{update_amount, update_bytes};
use crate::ApiError;

#[derive(Debug)]
pub(super) struct Money {
    pub(super) amount: String,
    pub(super) asset: String,
    pub(super) raw_amount: u128,
}

#[derive(Debug)]
pub(super) struct RecipientAmount {
    pub(super) recipient: String,
    pub(super) money: Money,
}

impl Money {
    pub(super) fn new(amount: String, asset: String) -> Result<Self, ApiError> {
        let asset = normalize_text(&asset).to_uppercase();
        if asset.is_empty() {
            return Err(ApiError::BadRequest("asset must not be empty".into()));
        }
        let amount = normalize_decimal(&amount)?;
        let raw_amount = decimal_to_raw(&amount, asset_decimals(&asset))?;
        Ok(Self {
            amount,
            asset,
            raw_amount,
        })
    }
}

pub(super) fn recipient_amount(value: &Value) -> Result<RecipientAmount, ApiError> {
    Ok(RecipientAmount {
        recipient: payload_text(value, "recipient")?,
        money: Money::new(
            payload_text(value, "amount")?,
            payload_text(value, "asset")?,
        )?,
    })
}

pub(super) fn update_recipient_amount(hasher: &mut Sha256, row: &RecipientAmount) {
    update_bytes(hasher, row.recipient.as_bytes());
    update_amount(hasher, &row.money);
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
    value.trim().to_string()
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
    format!("{} {}", money.amount, money.asset)
}

pub(super) fn json_string(value: &str) -> Result<String, ApiError> {
    serde_json::to_string(value)
        .map_err(|e| ApiError::Internal(format!("failed to encode clearsign payload: {e}")))
}

fn decimal_to_raw(value: &str, decimals: usize) -> Result<u128, ApiError> {
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
        "BTC" => 8,
        "ETH" | "HYPE" => 18,
        "USDC" | "USDT" | "USD" => 6,
        _ => 9,
    }
}
