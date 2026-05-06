use async_trait::async_trait;

use crate::{config::AppConfig, domain::types::ChainFamily};

use super::{
    bitcoin::BitcoinSigner, evm::EvmSigner, solana::SolanaSigner, zcash::ZcashSigner,
};

#[derive(Debug, Clone)]
pub struct AssetTransferRequest {
    pub chain_family: ChainFamily,
    pub chain_id: String,
    pub asset_symbol: String,
    pub amount_minor: i64,
    pub recipient_wallet: String,
    /// For ERC-20 / SPL token transfers. None for native asset moves.
    pub token_address: Option<String>,
}

#[derive(Debug, Clone)]
pub struct AssetTransferResult {
    pub tx_hash: String,
    pub finalized: bool,
}

#[async_trait]
pub trait ChainSigner: Send + Sync {
    async fn transfer(&self, request: &AssetTransferRequest) -> anyhow::Result<AssetTransferResult>;
}

#[derive(Clone)]
pub struct SignerEngine {
    solana: SolanaSigner,
    evm: EvmSigner,
    bitcoin: BitcoinSigner,
    zcash: ZcashSigner,
}

impl SignerEngine {
    pub fn new(config: &AppConfig) -> Self {
        Self {
            solana: SolanaSigner::new(config.clone()),
            evm: EvmSigner::new(config.clone()),
            bitcoin: BitcoinSigner::new(config.clone()),
            zcash: ZcashSigner::new(config.clone()),
        }
    }

    pub async fn transfer(&self, request: &AssetTransferRequest) -> anyhow::Result<AssetTransferResult> {
        match request.chain_family {
            ChainFamily::Solana => self.solana.transfer(request).await,
            ChainFamily::Evm => self.evm.transfer(request).await,
            ChainFamily::Bitcoin => self.bitcoin.transfer(request).await,
            ChainFamily::Zcash => self.zcash.transfer(request).await,
        }
    }

    pub async fn has_sufficient_balance(
        &self,
        chain_family: ChainFamily,
        chain_id: &str,
        asset_symbol: &str,
        amount_minor: i64,
        token_address: Option<&str>,
    ) -> anyhow::Result<bool> {
        match chain_family {
            ChainFamily::Solana => {
                self.solana
                    .has_sufficient_balance(asset_symbol, amount_minor, token_address)
                    .await
            }
            ChainFamily::Evm => {
                self.evm
                    .has_sufficient_balance(chain_id, amount_minor, token_address)
                    .await
            }
            ChainFamily::Bitcoin => {
                self.bitcoin
                    .has_sufficient_balance(amount_minor)
                    .await
            }
            ChainFamily::Zcash => {
                self.zcash
                    .has_sufficient_balance(amount_minor)
                    .await
            }
        }
    }
}
