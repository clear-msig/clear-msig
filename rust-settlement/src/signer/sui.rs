use std::{str::FromStr, time::Duration};

use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use sui_crypto::{SuiSigner as SuiCryptoSigner, ed25519::Ed25519PrivateKey};
use sui_rpc::Client as SuiClient;
use sui_rpc::proto::sui::rpc::v2::ExecuteTransactionRequest;
use sui_sdk_types::{Address, Digest};
use sui_transaction_builder::{ObjectInput, TransactionBuilder};

use crate::config::AppConfig;

use super::engine::{AssetTransferRequest, AssetTransferResult, ChainSigner};

#[derive(Clone)]
pub struct SuiSigner {
    config: AppConfig,
}

impl SuiSigner {
    pub fn new(config: AppConfig) -> Self {
        Self { config }
    }

    pub async fn has_sufficient_balance(
        &self,
        asset_symbol: &str,
        amount_minor: i64,
    ) -> anyhow::Result<bool> {
        if asset_symbol.to_uppercase() != "SUI" {
            anyhow::bail!("Only SUI native balance checks are currently supported");
        }
        if amount_minor <= 0 {
            anyhow::bail!("amount_minor must be > 0 for SUI liquidity check");
        }
        if self.config.sui_rpc_url.trim().is_empty() {
            anyhow::bail!("SUI_RPC_URL is required for SUI liquidity check");
        }

        let sender = Address::from_str(self.config.treasury_sui_address.trim())
            .map_err(|error| anyhow::anyhow!("Invalid TREASURY_SUI_ADDRESS: {error}"))?;

        let client = SuiClient::new(self.config.sui_rpc_url.trim())?;
        let coin_type = sui_sdk_types::TypeTag::from_str("0x2::sui::SUI")
            .map_err(|error| anyhow::anyhow!("Failed to parse SUI type tag: {error}"))?;

        let required = amount_minor as u64 + 5_000_000;
        let selected = client.select_coins(&sender, &coin_type, required, &[]).await?;
        Ok(!selected.is_empty())
    }
}

fn decode_ed25519_key(base64_key: &str) -> anyhow::Result<Ed25519PrivateKey> {
    let decoded = STANDARD
        .decode(base64_key.trim())
        .map_err(|error| anyhow::anyhow!("Invalid TREASURY_SUI_PRIVATE_KEY_BASE64: {error}"))?;

    let key_bytes: [u8; 32] = match decoded.as_slice() {
        bytes if bytes.len() == 32 => {
            let mut out = [0_u8; 32];
            out.copy_from_slice(bytes);
            out
        }
        bytes if bytes.len() == 33 && bytes[0] == 0 => {
            let mut out = [0_u8; 32];
            out.copy_from_slice(&bytes[1..]);
            out
        }
        bytes => {
            anyhow::bail!(
                "TREASURY_SUI_PRIVATE_KEY_BASE64 must decode to 32-byte key or 33-byte [scheme+key], got {} bytes",
                bytes.len()
            );
        }
    };

    Ok(Ed25519PrivateKey::new(key_bytes))
}

#[async_trait]
impl ChainSigner for SuiSigner {
    async fn transfer(&self, request: &AssetTransferRequest) -> anyhow::Result<AssetTransferResult> {
        if request.asset_symbol.to_uppercase() != "SUI" {
            anyhow::bail!("Only SUI native disbursement is currently enabled in signer path");
        }

        if request.amount_minor <= 0 {
            anyhow::bail!("amount_minor must be > 0 for SUI transfer");
        }

        if self.config.sui_rpc_url.trim().is_empty() {
            anyhow::bail!("SUI_RPC_URL is required for direct Sui signing");
        }
        if self.config.treasury_sui_private_key_base64.trim().is_empty() {
            anyhow::bail!("TREASURY_SUI_PRIVATE_KEY_BASE64 is required for direct Sui signing");
        }

        let sender = Address::from_str(self.config.treasury_sui_address.trim())
            .map_err(|error| anyhow::anyhow!("Invalid TREASURY_SUI_ADDRESS: {error}"))?;
        let recipient = Address::from_str(request.recipient_wallet.trim())
            .map_err(|error| anyhow::anyhow!("Invalid recipient Sui address: {error}"))?;

        let mut client = SuiClient::new(self.config.sui_rpc_url.trim())?;
        let gas_price = client.get_reference_gas_price().await?;

        let required_amount = request.amount_minor as u64 + 5_000_000;
        let coin_type = sui_sdk_types::TypeTag::from_str("0x2::sui::SUI")
            .map_err(|error| anyhow::anyhow!("Failed to parse SUI type tag: {error}"))?;
        let gas_objects = client
            .select_coins(&sender, &coin_type, required_amount, &[])
            .await?;

        if gas_objects.is_empty() {
            anyhow::bail!("No eligible SUI coins found for treasury gas/payment");
        }

        let mut tx_builder = TransactionBuilder::new();
        tx_builder.set_sender(sender);
        tx_builder.set_gas_price(gas_price);
        tx_builder.set_gas_budget(5_000_000);

        let gas_inputs = gas_objects
            .iter()
            .map(|object| {
                let object_id = Address::from_str(object.object_id())
                    .map_err(|error| anyhow::anyhow!("Invalid Sui object_id from RPC: {error}"))?;
                let digest = Digest::from_str(object.digest())
                    .map_err(|error| anyhow::anyhow!("Invalid Sui object digest from RPC: {error}"))?;
                Ok(ObjectInput::owned(object_id, object.version(), digest))
            })
            .collect::<anyhow::Result<Vec<_>>>()?;

        tx_builder.add_gas_objects(gas_inputs);

        let gas_coin = tx_builder.gas();
        let amount_arg = tx_builder.pure(&(request.amount_minor as u64));
        let recipient_arg = tx_builder.pure(&recipient);
        let split_result = tx_builder.split_coins(gas_coin, vec![amount_arg]);
        tx_builder.transfer_objects(vec![split_result[0]], recipient_arg);

        let transaction_data = tx_builder
            .try_build()
            .map_err(|error| anyhow::anyhow!("Failed to build Sui transaction: {error}"))?;

        let keypair = decode_ed25519_key(&self.config.treasury_sui_private_key_base64)?;
        let user_signature = keypair
            .sign_transaction(&transaction_data)
            .map_err(|error| anyhow::anyhow!("Failed signing Sui transaction: {error}"))?;

        let mut execute_request = ExecuteTransactionRequest::new(transaction_data.clone().into());
        execute_request.signatures.push(user_signature.into());

        client
            .execute_transaction_and_wait_for_checkpoint(execute_request, Duration::from_secs(45))
            .await
            .map_err(|error| anyhow::anyhow!("Sui execute failed: {error}"))?;

        let tx_hash = transaction_data.digest().to_string();
        if tx_hash.trim().is_empty() {
            anyhow::bail!("Computed Sui transaction digest is empty");
        }

        Ok(AssetTransferResult {
            tx_hash,
            finalized: true,
        })
    }
}
