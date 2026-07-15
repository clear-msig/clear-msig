use crate::{
    error::{invalid, IntentSchemaError},
    AccountDefJson, AccountSourceJson, ChainKindJson, DataSegmentJson, InstructionDefJson,
    ParamDefJson, ParamTypeJson, SeedJson, TxTemplateJson, INTENT_SCHEMA_VERSION,
};
use std::collections::HashSet;

#[allow(clippy::too_many_arguments)]
pub(crate) fn validate_common(
    schema_version: u16,
    template_id: Option<&str>,
    chain: ChainKindJson,
    params: &[ParamDefJson],
    accounts: &[AccountDefJson],
    instructions: &[InstructionDefJson],
    tx_template: Option<&TxTemplateJson>,
    template: &str,
) -> Result<(), IntentSchemaError> {
    if schema_version != INTENT_SCHEMA_VERSION {
        return Err(invalid(format!(
            "unsupported intent schema_version {schema_version}; expected {INTENT_SCHEMA_VERSION}"
        )));
    }
    if let Some(id) = template_id {
        if id.is_empty()
            || !id.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
            })
        {
            return Err(invalid(
                "template_id must use lowercase ASCII letters, digits, '_' or '-'",
            ));
        }
    }
    match (chain.needs_tx_template(), tx_template) {
        (true, None) => return Err(invalid(format!("chain {chain:?} requires tx_template"))),
        (false, Some(_)) => {
            return Err(invalid(format!("chain {chain:?} cannot have tx_template")))
        }
        (_, Some(value)) if !value.matches_chain(chain) => {
            return Err(invalid(format!(
                "tx_template does not match chain {chain:?}"
            )))
        }
        _ => {}
    }
    if let Some(TxTemplateJson::Solana { nonce_account }) = tx_template {
        let bytes = bs58::decode(nonce_account)
            .into_vec()
            .map_err(|error| invalid(format!("invalid nonce_account base58: {error}")))?;
        if bytes.len() != 32 {
            return Err(invalid("nonce_account must decode to 32 bytes"));
        }
    }
    let mut names = HashSet::new();
    for param in params {
        if param.name.is_empty() || !names.insert(param.name.as_str()) {
            return Err(invalid("parameter names must be non-empty and unique"));
        }
    }
    for account in accounts {
        match &account.source {
            AccountSourceJson::Param(index) if *index as usize >= params.len() => {
                return Err(invalid(format!(
                    "account references missing parameter {index}"
                )))
            }
            AccountSourceJson::Pda(value) => {
                for seed in &value.seeds {
                    if let SeedJson::ParamRef(index) = seed {
                        if *index as usize >= params.len() {
                            return Err(invalid(format!(
                                "PDA seed references missing parameter {index}"
                            )));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    for instruction in instructions {
        if instruction.program_account_index as usize >= accounts.len() {
            return Err(invalid(
                "instruction program account index is out of bounds",
            ));
        }
        if instruction
            .account_indexes
            .iter()
            .any(|index| *index as usize >= accounts.len())
        {
            return Err(invalid("instruction account index is out of bounds"));
        }
        for segment in &instruction.data_segments {
            if let DataSegmentJson::Param(value) = segment {
                if value.param_index as usize >= params.len() {
                    return Err(invalid(
                        "instruction segment parameter index is out of bounds",
                    ));
                }
            }
        }
    }
    validate_template(template, params)
}

fn validate_template(template: &str, params: &[ParamDefJson]) -> Result<(), IntentSchemaError> {
    if !template.is_ascii() {
        return Err(invalid("intent template must be ASCII"));
    }
    let bytes = template.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        if bytes[cursor] != b'{' {
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
        let param = params
            .get(index)
            .ok_or_else(|| invalid(format!("template references missing parameter {index}")))?;
        if let Some(format) = format {
            let decimals = format
                .strip_prefix("10^")
                .ok_or_else(|| invalid(format!("unsupported template format '{format}'")))?
                .parse::<u8>()
                .map_err(|_| invalid(format!("invalid decimal template format '{format}'")))?;
            if decimals > 19 || param.param_type != ParamTypeJson::U64 {
                return Err(invalid(
                    "decimal template formats require u64 and at most 19 decimals",
                ));
            }
        }
        cursor = end + 1;
    }
    Ok(())
}
