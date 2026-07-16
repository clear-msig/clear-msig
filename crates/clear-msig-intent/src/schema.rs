use crate::{
    canonical::canonical_json,
    error::{invalid, IntentSchemaError},
    validation::validate_common,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const INTENT_SCHEMA_VERSION: u16 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IntentDefinitionJson {
    #[serde(default = "current_schema_version")]
    pub schema_version: u16,
    #[serde(default)]
    pub template_id: Option<String>,
    pub proposers: Vec<String>,
    pub approvers: Vec<String>,
    #[serde(default = "default_one")]
    pub approval_threshold: u8,
    #[serde(default = "default_one")]
    pub cancellation_threshold: u8,
    #[serde(default)]
    pub timelock_seconds: u32,
    #[serde(default)]
    pub chain: ChainKindJson,
    #[serde(default)]
    pub params: Vec<ParamDefJson>,
    #[serde(default)]
    pub accounts: Vec<AccountDefJson>,
    #[serde(default)]
    pub instructions: Vec<InstructionDefJson>,
    #[serde(default)]
    pub tx_template: Option<TxTemplateJson>,
    #[serde(default)]
    pub template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct IntentTransactionJson {
    #[serde(default = "current_schema_version")]
    pub schema_version: u16,
    #[serde(default)]
    pub template_id: Option<String>,
    #[serde(default)]
    pub chain: ChainKindJson,
    #[serde(default)]
    pub params: Vec<ParamDefJson>,
    #[serde(default)]
    pub accounts: Vec<AccountDefJson>,
    #[serde(default)]
    pub instructions: Vec<InstructionDefJson>,
    #[serde(default)]
    pub tx_template: Option<TxTemplateJson>,
    #[serde(default)]
    pub template: String,
}

impl IntentTransactionJson {
    pub fn with_governance(
        self,
        proposers: Vec<String>,
        approvers: Vec<String>,
        approval_threshold: u8,
        cancellation_threshold: u8,
        timelock_seconds: u32,
    ) -> IntentDefinitionJson {
        IntentDefinitionJson {
            schema_version: self.schema_version,
            template_id: self.template_id,
            proposers,
            approvers,
            approval_threshold,
            cancellation_threshold,
            timelock_seconds,
            chain: self.chain,
            params: self.params,
            accounts: self.accounts,
            instructions: self.instructions,
            tx_template: self.tx_template,
            template: self.template,
        }
    }

    pub fn validate(&self) -> Result<(), IntentSchemaError> {
        validate_common(
            self.schema_version,
            self.template_id.as_deref(),
            self.chain,
            &self.params,
            &self.accounts,
            &self.instructions,
            self.tx_template.as_ref(),
            &self.template,
        )
    }

    pub fn canonical_json(&self) -> Result<String, IntentSchemaError> {
        self.validate()?;
        canonical_json(self)
    }

    pub fn canonical_hash(&self) -> Result<[u8; 32], IntentSchemaError> {
        Ok(Sha256::digest(self.canonical_json()?.as_bytes()).into())
    }
}

impl IntentDefinitionJson {
    pub fn validate(&self) -> Result<(), IntentSchemaError> {
        if self.approval_threshold == 0 || self.cancellation_threshold == 0 {
            return Err(invalid(
                "approval and cancellation thresholds must be at least 1",
            ));
        }
        validate_common(
            self.schema_version,
            self.template_id.as_deref(),
            self.chain,
            &self.params,
            &self.accounts,
            &self.instructions,
            self.tx_template.as_ref(),
            &self.template,
        )
    }

    pub fn canonical_json(&self) -> Result<String, IntentSchemaError> {
        self.validate()?;
        canonical_json(self)
    }

    pub fn canonical_hash(&self) -> Result<[u8; 32], IntentSchemaError> {
        Ok(Sha256::digest(self.canonical_json()?.as_bytes()).into())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChainKindJson {
    #[default]
    Solana,
    #[serde(rename = "evm_1559")]
    Evm1559,
    BitcoinP2wpkh,
    ZcashTransparent,
    #[serde(rename = "evm_1559_erc20")]
    Evm1559Erc20,
    #[serde(rename = "hyperliquid_evm")]
    HyperliquidEvm,
}

impl ChainKindJson {
    pub const fn as_u8(self) -> u8 {
        match self {
            Self::Solana => 0,
            Self::Evm1559 => 1,
            Self::BitcoinP2wpkh => 2,
            Self::ZcashTransparent => 3,
            Self::Evm1559Erc20 => 4,
            Self::HyperliquidEvm => 5,
        }
    }

    pub const fn is_remote(self) -> bool {
        !matches!(self, Self::Solana)
    }

    pub const fn needs_tx_template(self) -> bool {
        self.is_remote()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TxTemplateJson {
    #[serde(rename = "evm_1559")]
    Evm1559 {
        chain_id: u64,
        gas_limit: u64,
        max_priority_fee_per_gas: u64,
        max_fee_per_gas: u64,
    },
    BitcoinP2wpkh {
        version: u32,
        lock_time: u32,
        sequence: u32,
        sighash_type: u32,
    },
    Solana {
        nonce_account: String,
    },
    ZcashTransparent {
        header: u32,
        version_group_id: u32,
        lock_time: u32,
        expiry_height: u32,
        consensus_branch_id: u32,
    },
}

impl TxTemplateJson {
    pub fn encode(&self) -> Vec<u8> {
        match self {
            Self::Solana { nonce_account } => bs58::decode(nonce_account)
                .into_vec()
                .expect("validated nonce_account base58"),
            Self::Evm1559 {
                chain_id,
                gas_limit,
                max_priority_fee_per_gas,
                max_fee_per_gas,
            } => [
                chain_id.to_le_bytes(),
                gas_limit.to_le_bytes(),
                max_priority_fee_per_gas.to_le_bytes(),
                max_fee_per_gas.to_le_bytes(),
            ]
            .concat(),
            Self::BitcoinP2wpkh {
                version,
                lock_time,
                sequence,
                sighash_type,
            } => [
                version.to_le_bytes(),
                lock_time.to_le_bytes(),
                sequence.to_le_bytes(),
                sighash_type.to_le_bytes(),
            ]
            .concat(),
            Self::ZcashTransparent {
                header,
                version_group_id,
                lock_time,
                expiry_height,
                consensus_branch_id,
            } => [
                header.to_le_bytes(),
                version_group_id.to_le_bytes(),
                lock_time.to_le_bytes(),
                expiry_height.to_le_bytes(),
                consensus_branch_id.to_le_bytes(),
            ]
            .concat(),
        }
    }

    pub const fn matches_chain(&self, chain: ChainKindJson) -> bool {
        matches!(
            (self, chain),
            (Self::Solana { .. }, ChainKindJson::Solana)
                | (
                    Self::Evm1559 { .. },
                    ChainKindJson::Evm1559
                        | ChainKindJson::Evm1559Erc20
                        | ChainKindJson::HyperliquidEvm
                )
                | (Self::BitcoinP2wpkh { .. }, ChainKindJson::BitcoinP2wpkh)
                | (
                    Self::ZcashTransparent { .. },
                    ChainKindJson::ZcashTransparent
                )
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParamDefJson {
    pub name: String,
    #[serde(rename = "type")]
    pub param_type: ParamTypeJson,
    #[serde(default)]
    pub constraint: Option<ConstraintJson>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ParamTypeJson {
    Address,
    U64,
    I64,
    String,
    Bool,
    U8,
    U16,
    U32,
    U128,
    Bytes20,
    Bytes32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConstraintJson {
    LessThan(u64),
    GreaterThan(u64),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountDefJson {
    pub source: AccountSourceJson,
    #[serde(default)]
    pub signer: bool,
    #[serde(default)]
    pub writable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccountSourceJson {
    Static(String),
    Param(u8),
    Pda(PdaSourceJson),
    HasOne(HasOneJson),
    Vault,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PdaSourceJson {
    pub program_account_index: u8,
    pub seeds: Vec<SeedJson>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SeedJson {
    Literal(Vec<u8>),
    ParamRef(u8),
    AccountRef(u8),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HasOneJson {
    pub account_index: u8,
    pub byte_offset: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstructionDefJson {
    pub program_account_index: u8,
    pub account_indexes: Vec<u8>,
    pub data_segments: Vec<DataSegmentJson>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DataSegmentJson {
    Literal(Vec<u8>),
    Param(ParamSegmentJson),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ParamSegmentJson {
    pub param_index: u8,
    pub encoding: DataEncodingJson,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DataEncodingJson {
    RawAddress,
    LeU64,
    LeI64,
    Bool,
    LeU8,
    LeU16,
    LeU32,
    LeU128,
}

fn current_schema_version() -> u16 {
    INTENT_SCHEMA_VERSION
}

fn default_one() -> u8 {
    1
}
