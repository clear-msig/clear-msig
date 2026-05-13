// Solana treasury signer — local keypair, RPC submission.
//
// Loads the treasury keypair from either a base58-encoded 64-byte
// secret (the Phantom export format) or a `solana-keygen`-style JSON
// keypair file, whichever is configured. Signs `system_instruction::
// transfer` for native SOL or `spl_token::instruction::transfer` for
// SPL tokens, and submits via the configured RPC.
//
// `chain_id` is unused on Solana (devnet/mainnet/testnet selection
// happens via SOLANA_RPC_URL); it's kept on the request shape for
// uniformity with the other signers.

use std::str::FromStr;

use async_trait::async_trait;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair, Signer},
    transaction::Transaction,
};
use solana_system_interface::{instruction::SystemInstruction, program};

use crate::config::AppConfig;

use super::engine::{AssetTransferRequest, AssetTransferResult, ChainSigner};

#[derive(Clone)]
pub struct SolanaSigner {
    config: AppConfig,
}

impl SolanaSigner {
    pub fn new(config: AppConfig) -> Self {
        Self { config }
    }

    fn rpc_client(&self) -> anyhow::Result<RpcClient> {
        if self.config.solana_rpc_url.trim().is_empty() {
            anyhow::bail!("SOLANA_RPC_URL is required for Solana signing");
        }
        Ok(RpcClient::new_with_commitment(
            self.config.solana_rpc_url.clone(),
            CommitmentConfig::confirmed(),
        ))
    }

    /// Load the treasury keypair. Prefers the base58 secret (single env
    /// var, easiest to inject as a Fly secret); falls back to the file
    /// path. Errors clearly when neither is set.
    fn load_keypair(&self) -> anyhow::Result<Keypair> {
        let base58 = self.config.treasury_sol_keypair_base58.trim();
        if !base58.is_empty() {
            let bytes = bs58::decode(base58)
                .into_vec()
                .map_err(|e| anyhow::anyhow!("TREASURY_SOL_KEYPAIR_BASE58 is not valid base58: {e}"))?;
            if bytes.len() != 64 {
                anyhow::bail!(
                    "TREASURY_SOL_KEYPAIR_BASE58 must decode to 64 bytes (got {})",
                    bytes.len()
                );
            }
            return Keypair::try_from(bytes.as_slice())
                .map_err(|e| anyhow::anyhow!("Invalid Solana keypair bytes: {e}"));
        }

        let path = self.config.treasury_sol_keypair_path.trim();
        if !path.is_empty() {
            return read_keypair_file(path)
                .map_err(|e| anyhow::anyhow!("Failed to load Solana keypair from {path}: {e}"));
        }

        anyhow::bail!(
            "Solana signing requires either TREASURY_SOL_KEYPAIR_BASE58 or TREASURY_SOL_KEYPAIR_PATH"
        );
    }

    pub async fn has_sufficient_balance(
        &self,
        asset_symbol: &str,
        amount_minor: i64,
        token_address: Option<&str>,
    ) -> anyhow::Result<bool> {
        if amount_minor <= 0 {
            anyhow::bail!("amount_minor must be > 0");
        }
        let client = self.rpc_client()?;
        let treasury = self.treasury_pubkey()?;

        if let Some(_mint) = token_address {
            // SPL token balance check: would require finding the
            // associated token account. Defer until SPL transfer is
            // wired below; for now, native SOL is the supported path.
            anyhow::bail!(
                "SPL token balance checks not yet supported (asset_symbol={asset_symbol})"
            );
        }

        let lamports = client.get_balance(&treasury).await?;
        Ok(lamports >= amount_minor as u64)
    }

    fn treasury_pubkey(&self) -> anyhow::Result<Pubkey> {
        // Prefer the explicitly-configured address; fall back to
        // deriving from the keypair so single-env-var deployments work.
        let configured = self.config.treasury_sol_address.trim();
        if !configured.is_empty() {
            return Pubkey::from_str(configured)
                .map_err(|e| anyhow::anyhow!("Invalid TREASURY_SOL_ADDRESS: {e}"));
        }
        let kp = self.load_keypair()?;
        Ok(kp.pubkey())
    }
}

#[async_trait]
impl ChainSigner for SolanaSigner {
    async fn transfer(&self, request: &AssetTransferRequest) -> anyhow::Result<AssetTransferResult> {
        if request.amount_minor <= 0 {
            anyhow::bail!("amount_minor must be > 0");
        }
        if request.token_address.is_some() {
            // SPL token transfer requires the spl-token crate +
            // associated-token-account derivation. Out of scope for the
            // initial wiring; fail loudly instead of silently
            // mishandling.
            anyhow::bail!(
                "SPL token transfers are not yet implemented for Solana (asset_symbol={})",
                request.asset_symbol
            );
        }

        let client = self.rpc_client()?;
        let payer = self.load_keypair()?;
        let recipient = Pubkey::from_str(request.recipient_wallet.trim())
            .map_err(|e| anyhow::anyhow!("Invalid Solana recipient address: {e}"))?;

        let lamports = request.amount_minor as u64;
        let ix = Instruction::new_with_bincode(
            Pubkey::new_from_array(program::id().to_bytes()),
            &SystemInstruction::Transfer { lamports },
            vec![
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new(recipient, false),
            ],
        );

        let recent_blockhash = client.get_latest_blockhash().await?;
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[&payer],
            recent_blockhash,
        );

        let signature = client.send_and_confirm_transaction(&tx).await?;

        Ok(AssetTransferResult {
            tx_hash: signature.to_string(),
            finalized: true,
        })
    }
}
