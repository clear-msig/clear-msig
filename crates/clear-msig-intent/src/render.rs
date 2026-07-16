use crate::{
    error::{invalid, IntentSchemaError},
    ParamTypeJson,
};

pub fn render_template(
    template: &str,
    params: &[ParamTypeJson],
    params_data: &[u8],
) -> Result<String, IntentSchemaError> {
    if !template.is_ascii() {
        return Err(invalid("intent template must be ASCII"));
    }
    let mut result = String::new();
    let bytes = template.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        if bytes[cursor] != b'{' {
            result.push(bytes[cursor] as char);
            cursor += 1;
            continue;
        }
        let relative_end = bytes[cursor + 1..]
            .iter()
            .position(|byte| *byte == b'}')
            .ok_or_else(|| invalid("intent template has an unmatched '{'"))?;
        let end = cursor + 1 + relative_end;
        let expression = std::str::from_utf8(&bytes[cursor + 1..end])
            .map_err(|_| invalid("intent placeholder must be ASCII"))?;
        let (index_text, format) = expression
            .split_once(':')
            .map_or((expression, None), |(index, format)| (index, Some(format)));
        let index = index_text
            .parse::<usize>()
            .map_err(|_| invalid(format!("invalid template parameter index '{index_text}'")))?;
        result.push_str(&render_param(params, params_data, index, format)?);
        cursor = end + 1;
    }
    Ok(result)
}

fn render_param(
    params: &[ParamTypeJson],
    params_data: &[u8],
    index: usize,
    format: Option<&str>,
) -> Result<String, IntentSchemaError> {
    let param_type = *params
        .get(index)
        .ok_or_else(|| invalid(format!("parameter index {index} is out of bounds")))?;
    if format.is_some() && param_type != ParamTypeJson::U64 {
        return Err(invalid("decimal template formats require u64"));
    }
    let offset = param_offset(params, params_data, index)?;
    match param_type {
        ParamTypeJson::Address => {
            Ok(bs58::encode(param_bytes(params_data, offset, 32, "address")?).into_string())
        }
        ParamTypeJson::U64 => {
            let value = u64::from_le_bytes(
                param_bytes(params_data, offset, 8, "u64")?
                    .try_into()
                    .expect("validated u64 length"),
            );
            match format {
                Some(format) => Ok(format_decimal_u64(value, parse_decimal_spec(format)?)),
                None => Ok(value.to_string()),
            }
        }
        ParamTypeJson::I64 => Ok(i64::from_le_bytes(
            param_bytes(params_data, offset, 8, "i64")?
                .try_into()
                .expect("validated i64 length"),
        )
        .to_string()),
        ParamTypeJson::String => {
            let length = *params_data
                .get(offset)
                .ok_or_else(|| invalid("missing string length"))? as usize;
            let value = param_bytes(params_data, offset + 1, length, "string")?;
            Ok(std::str::from_utf8(value)
                .map_err(|error| invalid(format!("invalid UTF-8 string parameter: {error}")))?
                .to_owned())
        }
        ParamTypeJson::Bool => Ok(if *params_data
            .get(offset)
            .ok_or_else(|| invalid("missing bool parameter"))?
            != 0
        {
            "true"
        } else {
            "false"
        }
        .to_owned()),
        ParamTypeJson::U8 => Ok(params_data
            .get(offset)
            .ok_or_else(|| invalid("missing u8 parameter"))?
            .to_string()),
        ParamTypeJson::U16 => Ok(u16::from_le_bytes(
            param_bytes(params_data, offset, 2, "u16")?
                .try_into()
                .expect("validated u16 length"),
        )
        .to_string()),
        ParamTypeJson::U32 => Ok(u32::from_le_bytes(
            param_bytes(params_data, offset, 4, "u32")?
                .try_into()
                .expect("validated u32 length"),
        )
        .to_string()),
        ParamTypeJson::U128 => Ok(u128::from_le_bytes(
            param_bytes(params_data, offset, 16, "u128")?
                .try_into()
                .expect("validated u128 length"),
        )
        .to_string()),
        ParamTypeJson::Bytes20 => Ok(format!(
            "0x{}",
            encode_hex(param_bytes(params_data, offset, 20, "bytes20")?)
        )),
        ParamTypeJson::Bytes32 => Ok(format!(
            "0x{}",
            encode_hex(param_bytes(params_data, offset, 32, "bytes32")?)
        )),
    }
}

fn parse_decimal_spec(format: &str) -> Result<u8, IntentSchemaError> {
    let decimals = format
        .strip_prefix("10^")
        .ok_or_else(|| invalid(format!("unsupported template format '{format}'")))?
        .parse::<u8>()
        .map_err(|_| invalid(format!("invalid decimal template format '{format}'")))?;
    if decimals > 19 {
        return Err(invalid("decimal template format exceeds 19 digits"));
    }
    Ok(decimals)
}

fn format_decimal_u64(value: u64, decimals: u8) -> String {
    if decimals == 0 {
        return value.to_string();
    }
    let scale = (0..decimals).fold(1u128, |current, _| current * 10);
    let value = value as u128;
    let mut result = (value / scale).to_string();
    let fraction = value % scale;
    if fraction != 0 {
        let mut digits = format!("{:0width$}", fraction, width = decimals as usize);
        while digits.ends_with('0') {
            digits.pop();
        }
        result.push('.');
        result.push_str(&digits);
    }
    result
}

fn param_offset(
    params: &[ParamTypeJson],
    params_data: &[u8],
    target: usize,
) -> Result<usize, IntentSchemaError> {
    let mut offset = 0;
    for param_type in params.iter().take(target) {
        offset += param_size(*param_type, params_data, offset)?;
    }
    Ok(offset)
}

fn param_size(
    param_type: ParamTypeJson,
    params_data: &[u8],
    offset: usize,
) -> Result<usize, IntentSchemaError> {
    match param_type {
        ParamTypeJson::Address | ParamTypeJson::Bytes32 => Ok(32),
        ParamTypeJson::U64 | ParamTypeJson::I64 => Ok(8),
        ParamTypeJson::Bytes20 => Ok(20),
        ParamTypeJson::String => Ok(1 + *params_data
            .get(offset)
            .ok_or_else(|| invalid("missing string length"))?
            as usize),
        ParamTypeJson::Bool | ParamTypeJson::U8 => Ok(1),
        ParamTypeJson::U16 => Ok(2),
        ParamTypeJson::U32 => Ok(4),
        ParamTypeJson::U128 => Ok(16),
    }
}

fn param_bytes<'a>(
    data: &'a [u8],
    offset: usize,
    length: usize,
    label: &str,
) -> Result<&'a [u8], IntentSchemaError> {
    let end = offset
        .checked_add(length)
        .ok_or_else(|| invalid(format!("{label} parameter range overflow")))?;
    data.get(offset..end).ok_or_else(|| {
        invalid(format!(
            "not enough parameter data for {label}: need {offset}..{end}, have {}",
            data.len()
        ))
    })
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(HEX[(byte >> 4) as usize] as char);
        value.push(HEX[(byte & 0x0f) as usize] as char);
    }
    value
}
