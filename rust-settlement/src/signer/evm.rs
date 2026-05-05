use std::{str::FromStr, sync::Arc};

use async_trait::async_trait;
use ethers::{
    contract::abigen,
    providers::{Http, Middleware, Provider},
    signers::{LocalWallet, Signer},
    types::{Address, TransactionRequest, U256},
};

use crate::config::AppConfig;

use super::engine::{AssetTransferRequest, AssetTransferResult, ChainSigner};

abigen!(
    Erc20Token,
    r#"[
        function balanceOf(address account) external view returns (uint256)
        function transfer(address to, uint256 amount) external returns (bool)
    ]"#
);

#[derive(Clone)]
pub struct EvmSigner {
    config: AppConfig,
}

impl EvmSigner {
    pub fn new(config: AppConfig) -> Self {
        Self { config }
    }

    async fn build_client(
        &self,
        chain_id: u64,
    ) -> anyhow::Result<Arc<ethers::middleware::SignerMiddleware<Provider<Http>, LocalWallet>>> {
        if self.config.evm_rpc_url.trim().is_empty() {
            anyhow::bail!("EVM_RPC_URL is required for EVM signing");
        }
        if self.config.treasury_evm_private_key.trim().is_empty() {
            anyhow::bail!("TREASURY_EVM_PRIVATE_KEY is required for EVM signing");
        }

        let provider = Provider::<Http>::try_from(self.config.evm_rpc_url.as_str())?;
        let wallet = LocalWallet::from_str(self.config.treasury_evm_private_key.trim())?
            .with_chain_id(chain_id);
        let middleware = ethers::middleware::SignerMiddleware::new(provider, wallet);
        Ok(Arc::new(middleware))
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
        let client = self.build_client(chain_id).await?;
        let treasury = Address::from_str(self.config.treasury_evm_address.trim())?;

        if let Some(token_address) = token_address {
            let token_address = Address::from_str(token_address.trim())?;
            let contract = Erc20Token::new(token_address, client.clone());
            let balance = contract
                .balance_of(treasury)
                .call()
                .await
                .map_err(|e| anyhow::anyhow!("Failed ERC20 balanceOf call: {e}"))?;
            Ok(balance)
        } else {
            Ok(client.get_balance(treasury, None).await?)
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
    async fn transfer(&self, request: &AssetTransferRequest) -> anyhow::Result<AssetTransferResult> {
        let chain_id = Self::parse_chain_id(&request.chain_id)?;
        let client = self.build_client(chain_id).await?;
        let recipient = Address::from_str(request.recipient_wallet.trim())?;

        let tx_hash = if let Some(token_address) = request.token_address.as_deref() {
            let token_address = Address::from_str(token_address.trim())?;
            let contract = Erc20Token::new(token_address, client.clone());
            let call = contract.transfer(recipient, U256::from(request.amount_minor as u128));
            let pending = call.send().await?;
            let receipt = pending
                .await?
                .ok_or_else(|| anyhow::anyhow!("EVM ERC20 transaction dropped from mempool"))?;
            format!("{:x}", receipt.transaction_hash)
        } else {
            let tx = TransactionRequest::new()
                .to(recipient)
                .value(U256::from(request.amount_minor as u128));
            let pending = client.send_transaction(tx, None).await?;
            let receipt = pending
                .await?
                .ok_or_else(|| anyhow::anyhow!("EVM transaction dropped from mempool"))?;
            format!("{:x}", receipt.transaction_hash)
        };

        Ok(AssetTransferResult {
            tx_hash,
            finalized: true,
        })
    }
}
