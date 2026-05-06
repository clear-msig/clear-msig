// Zcash treasury signer — delegated to a zcashd JSON-RPC node.
//
// Why this design:
//   - ZIP-243 transparent-input sighash construction has no first-class
//     Rust signing crate today; rolling our own would mean re-deriving
//     the BLAKE2b-256 personalised sighash from scratch and signing
//     with secp256k1 — doable, but a careful multi-day effort to be
//     production-safe.
//   - Operators running on Zcash already need a node for confirmation
//     watching (no Esplora-equivalent on Zcash mainnet). Having that
//     node also hold the treasury's transparent key + sign +
//     broadcast is the path of least surprise.
//   - The treasury private key never leaves the operator's host —
//     either it's loaded into zcashd's wallet.dat, or zcashd runs in
//     the same trust boundary as this service.
//
// Flow:
//   1. zcashd has the treasury's transparent key in its wallet
//   2. We call `sendtoaddress <recipient> <amount_zec>` over JSON-RPC
//   3. zcashd selects UTXOs, builds + signs + broadcasts the tx
//   4. We get back a txid
//
// Configuration: ZCASH_RPC_URL, ZCASH_RPC_USER, ZCASH_RPC_PASSWORD.
// `chain_id` from the request is informational only — the URL
// determines mainnet vs testnet.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::config::AppConfig;

use super::engine::{AssetTransferRequest, AssetTransferResult, ChainSigner};

#[derive(Clone)]
pub struct ZcashSigner {
    config: AppConfig,
}

#[derive(Debug, Serialize)]
struct RpcRequest<'a, T: Serialize> {
    jsonrpc: &'a str,
    id: &'a str,
    method: &'a str,
    params: T,
}

#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: Option<T>,
    error: Option<serde_json::Value>,
}

impl ZcashSigner {
    pub fn new(config: AppConfig) -> Self {
        Self { config }
    }

    fn rpc_url(&self) -> anyhow::Result<&str> {
        let url = self.config.zcash_rpc_url.trim();
        if url.is_empty() {
            anyhow::bail!("ZCASH_RPC_URL is required for Zcash signing");
        }
        Ok(url)
    }

    async fn rpc_call<P, R>(&self, method: &str, params: P) -> anyhow::Result<R>
    where
        P: Serialize,
        R: for<'de> Deserialize<'de>,
    {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()?;
        let req = RpcRequest {
            jsonrpc: "1.0",
            id: "rust-settlement",
            method,
            params,
        };
        let resp = http
            .post(self.rpc_url()?)
            .basic_auth(
                self.config.zcash_rpc_user.trim(),
                Some(self.config.zcash_rpc_password.trim()),
            )
            .json(&req)
            .send()
            .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            anyhow::bail!("Zcash RPC {method} failed: {status} {body}");
        }
        let parsed: RpcResponse<R> = resp.json().await?;
        if let Some(err) = parsed.error {
            anyhow::bail!("Zcash RPC {method} error: {err}");
        }
        parsed
            .result
            .ok_or_else(|| anyhow::anyhow!("Zcash RPC {method} returned empty result"))
    }

    pub async fn has_sufficient_balance(&self, amount_minor: i64) -> anyhow::Result<bool> {
        if amount_minor <= 0 {
            anyhow::bail!("amount_minor must be > 0");
        }
        // `getbalance` returns a JSON number in ZEC (8 decimals).
        let balance_zec: f64 = self.rpc_call("getbalance", serde_json::json!([])).await?;
        // 1 ZEC = 100_000_000 zatoshis (the minor unit on the wire).
        let balance_zatoshis = (balance_zec * 100_000_000.0).round() as u64;
        Ok(balance_zatoshis >= amount_minor as u64)
    }
}

#[async_trait]
impl ChainSigner for ZcashSigner {
    async fn transfer(&self, request: &AssetTransferRequest) -> anyhow::Result<AssetTransferResult> {
        if request.amount_minor <= 0 {
            anyhow::bail!("amount_minor must be > 0");
        }
        if request.token_address.is_some() {
            anyhow::bail!("Zcash treasury does not support token transfers");
        }

        // zcashd's `sendtoaddress` takes the amount in ZEC as a
        // floating-point number. Convert from zatoshis.
        let amount_zec = (request.amount_minor as f64) / 100_000_000.0;
        let recipient = request.recipient_wallet.trim().to_string();

        let txid: String = self
            .rpc_call(
                "sendtoaddress",
                serde_json::json!([recipient, amount_zec]),
            )
            .await?;

        Ok(AssetTransferResult {
            tx_hash: txid,
            finalized: false,
        })
    }
}
