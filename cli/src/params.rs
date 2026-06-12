use crate::accounts::IntentAccount;
use crate::error::*;
use clear_wallet::utils::definition::ParamType;
use std::collections::HashMap;

/// Encode --param key=value pairs into params_data bytes,
/// ordered by the intent's param definitions.
pub fn encode_params(intent: &IntentAccount, raw_params: &[String]) -> Result<Vec<u8>> {
    // Parse key=value pairs
    let mut param_map: HashMap<String, String> = HashMap::new();
    for raw in raw_params {
        let (key, value) = raw
            .split_once('=')
            .ok_or(anyhow!("invalid param format: '{raw}', expected key=value"))?;
        param_map.insert(key.to_string(), value.to_string());
    }

    let mut data = Vec::new();
    let pool = &intent.byte_pool;

    for param in &intent.params {
        let name = read_param_name(
            pool,
            param.name_offset.get() as usize,
            param.name_len.get() as usize,
        )?;

        let value = param_map
            .get(name)
            .ok_or(anyhow!("missing required param: {name}"))?;

        match param.param_type {
            ParamType::Address => {
                let bytes = bs58::decode(value)
                    .into_vec()
                    .with_context(|| format!("invalid address for param {name}: {value}"))?;
                if bytes.len() != 32 {
                    return Err(anyhow!(
                        "address for {name} must be 32 bytes, got {}",
                        bytes.len()
                    ));
                }
                data.extend_from_slice(&bytes);
            }
            ParamType::U64 => {
                let val: u64 = value
                    .parse()
                    .with_context(|| format!("invalid u64 for param {name}: {value}"))?;
                data.extend_from_slice(&val.to_le_bytes());
            }
            ParamType::I64 => {
                let val: i64 = value
                    .parse()
                    .with_context(|| format!("invalid i64 for param {name}: {value}"))?;
                data.extend_from_slice(&val.to_le_bytes());
            }
            ParamType::String => {
                let bytes = value.as_bytes();
                if bytes.len() > 255 {
                    return Err(anyhow!("string param {name} too long (max 255 bytes)"));
                }
                data.push(bytes.len() as u8);
                data.extend_from_slice(bytes);
            }
            ParamType::Bool => {
                let val = match value.as_str() {
                    "true" | "1" => 1u8,
                    "false" | "0" => 0u8,
                    _ => {
                        return Err(anyhow!(
                            "invalid bool for param {name}: {value} (expected true/false)"
                        ))
                    }
                };
                data.push(val);
            }
            ParamType::U8 => {
                let val: u8 = value
                    .parse()
                    .with_context(|| format!("invalid u8 for param {name}: {value}"))?;
                data.push(val);
            }
            ParamType::U16 => {
                let val: u16 = value
                    .parse()
                    .with_context(|| format!("invalid u16 for param {name}: {value}"))?;
                data.extend_from_slice(&val.to_le_bytes());
            }
            ParamType::U32 => {
                let val: u32 = value
                    .parse()
                    .with_context(|| format!("invalid u32 for param {name}: {value}"))?;
                data.extend_from_slice(&val.to_le_bytes());
            }
            ParamType::U128 => {
                let val: u128 = value
                    .parse()
                    .with_context(|| format!("invalid u128 for param {name}: {value}"))?;
                data.extend_from_slice(&val.to_le_bytes());
            }
            ParamType::Bytes20 => {
                let bytes = parse_hex(value)
                    .with_context(|| format!("invalid bytes20 for param {name}: {value}"))?;
                if bytes.len() != 20 {
                    return Err(anyhow!(
                        "bytes20 for {name} must be 20 bytes, got {}",
                        bytes.len()
                    ));
                }
                data.extend_from_slice(&bytes);
            }
            ParamType::Bytes32 => {
                let bytes = parse_hex(value)
                    .with_context(|| format!("invalid bytes32 for param {name}: {value}"))?;
                if bytes.len() != 32 {
                    return Err(anyhow!(
                        "bytes32 for {name} must be 32 bytes, got {}",
                        bytes.len()
                    ));
                }
                data.extend_from_slice(&bytes);
            }
            ParamType::Bytes => {
                let bytes = parse_hex(value)
                    .with_context(|| format!("invalid bytes for param {name}: {value}"))?;
                if bytes.len() > u16::MAX as usize {
                    return Err(anyhow!(
                        "bytes for {name} too long (max {} bytes)",
                        u16::MAX
                    ));
                }
                data.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
                data.extend_from_slice(&bytes);
            }
        }
    }

    // Warn about extra params
    for key in param_map.keys() {
        let name_bytes = key.as_bytes();
        let found = intent.params.iter().any(|p| {
            let start = p.name_offset.get() as usize;
            let end = start + p.name_len.get() as usize;
            pool.get(start..end) == Some(name_bytes)
        });
        if !found {
            eprintln!("warning: unknown param '{key}' (not defined in intent)");
        }
    }

    Ok(data)
}

fn read_param_name(pool: &[u8], name_start: usize, name_len: usize) -> Result<&str> {
    let name_end = name_start
        .checked_add(name_len)
        .ok_or_else(|| anyhow!("invalid param name range {name_start}..{name_start}+{name_len}"))?;
    let bytes = pool.get(name_start..name_end).ok_or_else(|| {
        anyhow!(
            "invalid param name range {name_start}..{name_end} for byte pool of length {}",
            pool.len()
        )
    })?;
    std::str::from_utf8(bytes).with_context(|| "invalid param name in intent")
}

/// Parse a hex string (with optional 0x prefix) into raw bytes.
fn parse_hex(s: &str) -> Result<Vec<u8>> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.len() % 2 != 0 {
        return Err(anyhow!("hex string has odd length"));
    }
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(Into::into))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use clear_wallet::utils::definition::{
        AccountEntry, AccountSourceType, ConstraintType, DataSegmentEntry, InstructionEntry,
        ParamEntry, SeedEntry, SeedType, SegmentType,
    };

    fn empty_intent_with_param() -> IntentAccount {
        IntentAccount {
            wallet: "wallet".to_string(),
            bump: 0,
            intent_index: 0,
            intent_type: 3,
            chain_kind: 0,
            approved: true,
            approval_threshold: 1,
            cancellation_threshold: 1,
            timelock_seconds: 0,
            template_offset: 0,
            template_len: 0,
            tx_template_offset: 0,
            tx_template_len: 0,
            active_proposal_count: 0,
            proposers: vec![],
            approvers: vec![],
            params: vec![ParamEntry {
                param_type: ParamType::U8,
                name_offset: 0u16.into(),
                name_len: 1u16.into(),
                constraint_type: ConstraintType::None,
                constraint_value: 0u64.into(),
            }],
            accounts: vec![AccountEntry {
                is_signer: false,
                is_writable: false,
                source_type: AccountSourceType::Static,
                pool_offset: 0u16.into(),
                pool_len: 0u16.into(),
            }],
            instructions: vec![InstructionEntry {
                program_account_index: 0,
                account_indexes_offset: 0u16.into(),
                account_indexes_len: 0u16.into(),
                segments_start: 0u16.into(),
                segments_count: 0u16.into(),
            }],
            data_segments: vec![DataSegmentEntry {
                segment_type: SegmentType::Literal,
                pool_offset: 0u16.into(),
                pool_len: 0u16.into(),
            }],
            seeds: vec![SeedEntry {
                seed_type: SeedType::Literal,
                pool_offset: 0u16.into(),
                pool_len: 0u16.into(),
            }],
            policy_ciphertexts: vec![],
            byte_pool: vec![],
        }
    }

    #[test]
    fn encode_params_returns_error_for_out_of_bounds_param_name() {
        let intent = empty_intent_with_param();
        let err = encode_params(&intent, &["amount=1".to_string()]).unwrap_err();
        assert!(
            err.to_string().contains("invalid param name range"),
            "unexpected error: {err}"
        );
    }
}
