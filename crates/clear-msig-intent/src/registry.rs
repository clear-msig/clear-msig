use crate::{
    error::{invalid, IntentSchemaError},
    ChainKindJson, IntentTransactionJson, ParamTypeJson, INTENT_SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub struct RegisteredIntentTemplate {
    pub id: &'static str,
    pub schema_version: u16,
    pub file: &'static str,
    pub chain: ChainKindJson,
    pub template: &'static str,
    pub default_for_chain: bool,
}

pub const BUILTIN_INTENT_TEMPLATES: &[RegisteredIntentTemplate] = &[
    registered("cb_initialize_account_breaker_v1", "cb_initialize_account_breaker.json", ChainKindJson::Solana, "initialize circuit breaker for token account {0} with authority {1}: window_size_seconds={2} threshold_type={3} threshold={4}", false),
    registered("cb_update_account_config_v1", "cb_update_account_config.json", ChainKindJson::Solana, "update circuit breaker {0} config: window_size_seconds={1} threshold_type={2} threshold={3}", false),
    registered("solana_transfer_v1", "solana_transfer.json", ChainKindJson::Solana, "transfer {1:10^9} SOL to {0}", true),
    registered("solana_transfer_legacy_v1", "transfer_sol.json", ChainKindJson::Solana, "transfer {1:10^9} SOL to {0}", false),
    registered("spl_token_transfer_v1", "transfer_tokens.json", ChainKindJson::Solana, "transfer {2} of mint {1} to {0}", false),
    registered("evm_transfer_mainnet_v1", "evm_transfer.json", ChainKindJson::Evm1559, "send {2:10^18} ETH to {1} (nonce {0})", false),
    registered("evm_transfer_sepolia_v1", "evm_transfer_sepolia.json", ChainKindJson::Evm1559, "send {2:10^18} ETH to {1} (nonce {0})", true),
    registered("erc20_transfer_mainnet_v1", "erc20_transfer.json", ChainKindJson::Evm1559Erc20, "transfer {3} of token {1} to {2} (nonce {0})", false),
    registered("erc20_transfer_sepolia_v1", "erc20_transfer_sepolia.json", ChainKindJson::Evm1559Erc20, "transfer {3} of token {1} to {2} (nonce {0})", true),
    registered("bitcoin_p2wpkh_transfer_v1", "btc_transfer.json", ChainKindJson::BitcoinP2wpkh, "send {5:10^8} BTC to bc1q-pkh:0x{4} from utxo 0x{0}:{1}; return change to bc1q-pkh:0x{6}; fee {7} sats", true),
    registered("zcash_transparent_transfer_v1", "zcash_transfer.json", ChainKindJson::ZcashTransparent, "send {5:10^8} ZEC to pkh:{4} (input {0}:{1})", true),
    registered("hyperliquid_transfer_v1", "hyperliquid_transfer.json", ChainKindJson::HyperliquidEvm, "send {2:10^18} HYPE to {1} (nonce {0})", true),
];

const fn registered(
    id: &'static str,
    file: &'static str,
    chain: ChainKindJson,
    template: &'static str,
    default_for_chain: bool,
) -> RegisteredIntentTemplate {
    RegisteredIntentTemplate {
        id,
        schema_version: INTENT_SCHEMA_VERSION,
        file,
        chain,
        template,
        default_for_chain,
    }
}

pub fn registered_template(id: &str) -> Option<&'static RegisteredIntentTemplate> {
    BUILTIN_INTENT_TEMPLATES.iter().find(|entry| entry.id == id)
}

pub fn registered_template_for_chain(
    chain: ChainKindJson,
) -> Option<&'static RegisteredIntentTemplate> {
    BUILTIN_INTENT_TEMPLATES
        .iter()
        .find(|entry| entry.chain == chain && entry.default_for_chain)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IntentRegistryArtifact {
    pub schema_version: u16,
    pub templates: Vec<IntentTemplateArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IntentTemplateArtifact {
    pub id: String,
    pub file: String,
    pub chain_kind: u8,
    pub chain: ChainKindJson,
    pub template: String,
    pub default_for_chain: bool,
}

pub fn registry_artifact() -> IntentRegistryArtifact {
    IntentRegistryArtifact {
        schema_version: INTENT_SCHEMA_VERSION,
        templates: BUILTIN_INTENT_TEMPLATES
            .iter()
            .map(|entry| IntentTemplateArtifact {
                id: entry.id.to_owned(),
                file: format!("examples/intents/{}", entry.file),
                chain_kind: entry.chain.as_u8(),
                chain: entry.chain,
                template: entry.template.to_owned(),
                default_for_chain: entry.default_for_chain,
            })
            .collect(),
    }
}

pub fn registry_json_pretty() -> Result<String, IntentSchemaError> {
    Ok(format!(
        "{}\n",
        serde_json::to_string_pretty(&registry_artifact())?
    ))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenderVectorsArtifact {
    pub schema_version: u16,
    pub vectors: Vec<RenderVectorArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenderVectorArtifact {
    pub id: String,
    pub template: String,
    pub param_types: Vec<ParamTypeJson>,
    pub params_data_hex: String,
    pub expected: String,
}

pub fn render_vectors_artifact() -> RenderVectorsArtifact {
    RenderVectorsArtifact {
        schema_version: INTENT_SCHEMA_VERSION,
        vectors: vec![
            render_vector(
                "scaled_u64",
                "{0:10^9} SOL",
                &[ParamTypeJson::U64],
                "00ca9a3b00000000",
                "1 SOL",
            ),
            render_vector(
                "evm_transfer",
                "send {2:10^18} ETH to {1} (nonce {0})",
                &[
                    ParamTypeJson::U64,
                    ParamTypeJson::Bytes20,
                    ParamTypeJson::U64,
                ],
                "2a00000000000000000000000000000000000000000000000000dead00407a10f35a0000",
                "send 0.0001 ETH to 0x000000000000000000000000000000000000dead (nonce 42)",
            ),
            render_vector(
                "base58_address",
                "to {0}",
                &[ParamTypeJson::Address],
                "abababababababababababababababababababababababababababababababab",
                "to CZ8YUVdk7znjrUmnb5n7kgySk9yRAsQDYmyCxzfSky9t",
            ),
            render_vector(
                "all_scalar_types",
                "{0}|{1}|{2}|{3}|{4}|{5}|{6}|{7}",
                &[
                    ParamTypeJson::I64,
                    ParamTypeJson::String,
                    ParamTypeJson::Bool,
                    ParamTypeJson::U8,
                    ParamTypeJson::U16,
                    ParamTypeJson::U32,
                    ParamTypeJson::U128,
                    ParamTypeJson::Bytes32,
                ],
                "f9ffffffffffffff05436c65617201ff01020102030479dfe23d44a6360f6e05010000000000abababababababababababababababababababababababababababababababab",
                "-7|Clear|true|255|513|67305985|1234567890123456789012345|0xabababababababababababababababababababababababababababababababab",
            ),
        ],
    }
}

pub fn render_vectors_json_pretty() -> Result<String, IntentSchemaError> {
    Ok(format!(
        "{}\n",
        serde_json::to_string_pretty(&render_vectors_artifact())?
    ))
}

fn render_vector(
    id: &str,
    template: &str,
    param_types: &[ParamTypeJson],
    params_data_hex: &str,
    expected: &str,
) -> RenderVectorArtifact {
    RenderVectorArtifact {
        id: id.to_owned(),
        template: template.to_owned(),
        param_types: param_types.to_vec(),
        params_data_hex: params_data_hex.to_owned(),
        expected: expected.to_owned(),
    }
}

pub fn validate_registered_template(
    value: &IntentTransactionJson,
) -> Result<&'static RegisteredIntentTemplate, IntentSchemaError> {
    value.validate()?;
    let id = value
        .template_id
        .as_deref()
        .ok_or_else(|| invalid("registered intent is missing template_id"))?;
    let registered = registered_template(id)
        .ok_or_else(|| invalid(format!("unknown registered template_id '{id}'")))?;
    if registered.schema_version != value.schema_version
        || registered.chain != value.chain
        || registered.template != value.template
    {
        return Err(invalid(format!(
            "intent '{id}' does not match its registered version, chain, and template"
        )));
    }
    Ok(registered)
}
