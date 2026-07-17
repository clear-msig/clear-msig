use std::str::FromStr;

use alloy::{
    primitives::{Address, U256},
    providers::{Provider, ProviderBuilder},
    rpc::types::TransactionRequest,
    signers::local::PrivateKeySigner,
    sol,
};
use async_trait::async_trait;

use crate::config::AppConfig;

use super::engine::{AssetTransferRequest, AssetTransferResult, ChainSigner};

sol! {
    #[allow(missing_docs)]
    #[sol(rpc)]
    interface Erc20Token {
        function balanceOf(address account) external view returns (uint256);
        function transfer(address to, uint256 amount) external returns (bool);
    }
}

#[derive(Clone)]
pub struct EvmSigner {
    config: AppConfig,
}

impl EvmSigner {
    pub fn new(config: AppConfig) -> Self {
        Self { config }
    }

    fn build_provider(&self, chain_id: u64) -> anyhow::Result<impl Provider + Clone> {
        if self.config.evm_rpc_url.trim().is_empty() {
            anyhow::bail!("EVM_RPC_URL is required for EVM signing");
        }
        if self.config.treasury_evm_private_key.trim().is_empty() {
            anyhow::bail!("TREASURY_EVM_PRIVATE_KEY is required for EVM signing");
        }

        let signer = PrivateKeySigner::from_str(self.config.treasury_evm_private_key.trim())?;
        let configured_address = Address::from_str(self.config.treasury_evm_address.trim())?;
        if signer.address() != configured_address {
            anyhow::bail!("TREASURY_EVM_ADDRESS does not match TREASURY_EVM_PRIVATE_KEY");
        }
        let rpc_url = self.config.evm_rpc_url.parse()?;
        Ok(ProviderBuilder::new()
            .with_chain_id(chain_id)
            .wallet(signer)
            .connect_http(rpc_url))
    }

    fn parse_chain_id(chain_id: &str) -> anyhow::Result<u64> {
        chain_id
            .parse::<u64>()
            .map_err(|_| anyhow::anyhow!("Invalid EVM chain_id: {}", chain_id))
    }

    async fn treasury_balance(
        &self,
        chain_id: &str,
        token_address: Option<&str>,
    ) -> anyhow::Result<U256> {
        let chain_id = Self::parse_chain_id(chain_id)?;
        let provider = self.build_provider(chain_id)?;
        let treasury = Address::from_str(self.config.treasury_evm_address.trim())?;

        if let Some(token_address) = token_address {
            let token_address = Address::from_str(token_address.trim())?;
            let contract = Erc20Token::new(token_address, &provider);
            let balance = contract
                .balanceOf(treasury)
                .call()
                .await
                .map_err(|e| anyhow::anyhow!("Failed ERC20 balanceOf call: {e}"))?;
            Ok(balance)
        } else {
            Ok(provider.get_balance(treasury).await?)
        }
    }

    pub async fn has_sufficient_balance(
        &self,
        chain_id: &str,
        amount_minor: i64,
        token_address: Option<&str>,
    ) -> anyhow::Result<bool> {
        if amount_minor <= 0 {
            anyhow::bail!("amount_minor must be > 0");
        }

        let required = U256::from(amount_minor as u128);
        let available = self.treasury_balance(chain_id, token_address).await?;
        Ok(available >= required)
    }
}

#[async_trait]
impl ChainSigner for EvmSigner {
    async fn transfer(
        &self,
        request: &AssetTransferRequest,
    ) -> anyhow::Result<AssetTransferResult> {
        let chain_id = Self::parse_chain_id(&request.chain_id)?;
        let provider = self.build_provider(chain_id)?;
        let recipient = Address::from_str(request.recipient_wallet.trim())?;

        let tx_hash = if let Some(token_address) = request.token_address.as_deref() {
            let token_address = Address::from_str(token_address.trim())?;
            let contract = Erc20Token::new(token_address, &provider);
            let call = contract.transfer(recipient, U256::from(request.amount_minor as u128));
            let pending = call.send().await?;
            let receipt = pending.get_receipt().await?;
            format!("{:x}", receipt.transaction_hash)
        } else {
            let tx = TransactionRequest {
                to: Some(recipient.into()),
                value: Some(U256::from(request.amount_minor as u128)),
                ..Default::default()
            };
            let receipt = provider.send_transaction(tx).await?.get_receipt().await?;
            format!("{:x}", receipt.transaction_hash)
        };

        Ok(AssetTransferResult {
            tx_hash,
            finalized: true,
        })
    }
}
