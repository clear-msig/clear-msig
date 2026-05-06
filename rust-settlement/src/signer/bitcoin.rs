// Bitcoin treasury signer — local P2WPKH signing + Esplora HTTP.
//
// Why this design:
//   - Esplora over running our own bitcoind: operators can deploy
//     without 500GB of blockchain on disk. Blockstream's public Esplora
//     is fine for testnet; production deployments point at a hosted
//     Esplora (e.g. mempool.space, Blockstream Enterprise, or a
//     self-hosted electrs).
//   - Single-input → single-output P2WPKH spend with change back to
//     the treasury. Coin selection is "smallest-set-that-covers-amount-
//     plus-fee" (greedy by largest first). Fine for an operator hot
//     wallet where UTXO management is intentional.
//   - BIP143 sighash via `bitcoin::sighash::SighashCache`, signed with
//     the secp256k1 re-export from the `bitcoin` crate.
//
// What this does NOT do (deferred):
//   - Multi-output (split disbursements)
//   - Replace-by-fee bumping
//   - SPV / lightweight verification of Esplora answers
//   - Wallet backups, multi-sig, hardware-key signing

use std::str::FromStr;

use async_trait::async_trait;
use bitcoin::{
    absolute::LockTime,
    consensus::encode,
    ecdsa::Signature as EcdsaSig,
    hashes::Hash,
    secp256k1::{All, Message, Secp256k1},
    sighash::{EcdsaSighashType, SighashCache},
    transaction::Version,
    Address, Amount, Network, OutPoint, PrivateKey, PublicKey, ScriptBuf, Sequence, Transaction,
    TxIn, TxOut, Witness,
};
use serde::Deserialize;

use crate::config::AppConfig;

use super::engine::{AssetTransferRequest, AssetTransferResult, ChainSigner};

#[derive(Clone)]
pub struct BitcoinSigner {
    config: AppConfig,
}

#[derive(Debug, Clone, Deserialize)]
struct EsploraUtxo {
    txid: String,
    vout: u32,
    value: u64,
    status: EsploraUtxoStatus,
}

#[derive(Debug, Clone, Deserialize)]
struct EsploraUtxoStatus {
    confirmed: bool,
}

impl BitcoinSigner {
    pub fn new(config: AppConfig) -> Self {
        Self { config }
    }

    fn network(&self) -> anyhow::Result<Network> {
        match self.config.bitcoin_network.as_str() {
            "mainnet" | "main" | "bitcoin" => Ok(Network::Bitcoin),
            "testnet" | "test" | "testnet3" => Ok(Network::Testnet),
            "signet" => Ok(Network::Signet),
            "regtest" => Ok(Network::Regtest),
            other => anyhow::bail!("Unknown BITCOIN_NETWORK '{other}'"),
        }
    }

    fn private_key(&self) -> anyhow::Result<PrivateKey> {
        let wif = self.config.treasury_btc_private_key_wif.trim();
        if wif.is_empty() {
            anyhow::bail!("TREASURY_BTC_PRIVATE_KEY_WIF is required for Bitcoin signing");
        }
        PrivateKey::from_wif(wif)
            .map_err(|e| anyhow::anyhow!("Invalid TREASURY_BTC_PRIVATE_KEY_WIF: {e}"))
    }

    fn treasury_address(&self, secp: &Secp256k1<All>) -> anyhow::Result<Address> {
        // Prefer the explicit configured address (fast path, lets the
        // operator double-check it matches what the key derives to);
        // fall back to deriving from the WIF.
        let configured = self.config.treasury_btc_address.trim();
        if !configured.is_empty() {
            let parsed = Address::from_str(configured)
                .map_err(|e| anyhow::anyhow!("Invalid TREASURY_BTC_ADDRESS: {e}"))?;
            return parsed
                .require_network(self.network()?)
                .map_err(|e| anyhow::anyhow!("TREASURY_BTC_ADDRESS network mismatch: {e}"));
        }
        let pk = self.private_key()?;
        let pubkey = PublicKey::from_private_key(secp, &pk);
        Address::p2wpkh(&pubkey.into(), self.network()?)
            .map_err(|e| anyhow::anyhow!("Failed to derive P2WPKH address: {e}"))
    }

    fn esplora_base(&self) -> anyhow::Result<&str> {
        let base = self.config.bitcoin_esplora_url.trim();
        if base.is_empty() {
            anyhow::bail!("BITCOIN_ESPLORA_URL is required for Bitcoin signing");
        }
        Ok(base.trim_end_matches('/'))
    }

    async fn fetch_utxos(&self, addr: &Address) -> anyhow::Result<Vec<EsploraUtxo>> {
        let base = self.esplora_base()?;
        let url = format!("{base}/address/{addr}/utxo");
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()?;
        let resp = http.get(&url).send().await?;
        if !resp.status().is_success() {
            anyhow::bail!(
                "Esplora UTXO fetch failed: {} {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            );
        }
        Ok(resp.json::<Vec<EsploraUtxo>>().await?)
    }

    async fn broadcast(&self, raw_hex: &str) -> anyhow::Result<String> {
        let base = self.esplora_base()?;
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()?;
        let resp = http
            .post(format!("{base}/tx"))
            .body(raw_hex.to_string())
            .send()
            .await?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("Esplora broadcast failed: {status} {body}");
        }
        Ok(body.trim().to_string())
    }

    pub async fn has_sufficient_balance(&self, amount_minor: i64) -> anyhow::Result<bool> {
        if amount_minor <= 0 {
            anyhow::bail!("amount_minor must be > 0");
        }
        let secp = Secp256k1::new();
        let addr = self.treasury_address(&secp)?;
        let utxos = self.fetch_utxos(&addr).await?;
        let confirmed: u64 = utxos
            .iter()
            .filter(|u| u.status.confirmed)
            .map(|u| u.value)
            .sum();
        Ok(confirmed >= amount_minor as u64)
    }
}

#[async_trait]
impl ChainSigner for BitcoinSigner {
    async fn transfer(&self, request: &AssetTransferRequest) -> anyhow::Result<AssetTransferResult> {
        if request.amount_minor <= 0 {
            anyhow::bail!("amount_minor must be > 0");
        }
        if request.token_address.is_some() {
            anyhow::bail!("Bitcoin treasury does not support token transfers");
        }

        let secp = Secp256k1::new();
        let pk = self.private_key()?;
        let pubkey = PublicKey::from_private_key(&secp, &pk);
        let from_addr = self.treasury_address(&secp)?;
        let to_addr = Address::from_str(request.recipient_wallet.trim())
            .map_err(|e| anyhow::anyhow!("Invalid Bitcoin recipient: {e}"))?
            .require_network(self.network()?)
            .map_err(|e| anyhow::anyhow!("Recipient network mismatch: {e}"))?;

        let send_amount = Amount::from_sat(request.amount_minor as u64);
        let fee_rate = self.config.bitcoin_fee_sats_per_vbyte.max(1);

        // Pick UTXOs greedy-by-largest until we cover the send amount
        // plus a generous fee. We over-estimate fee by assuming 110
        // vbytes per input + 31 per output + 11 fixed (for a single-
        // input two-output P2WPKH spend). The change output absorbs
        // any over-estimation.
        let mut utxos = self.fetch_utxos(&from_addr).await?;
        utxos.retain(|u| u.status.confirmed);
        utxos.sort_by(|a, b| b.value.cmp(&a.value));

        let mut chosen: Vec<EsploraUtxo> = Vec::new();
        let mut total: u64 = 0;
        let target = send_amount.to_sat();

        for u in utxos.into_iter() {
            chosen.push(u.clone());
            total = total.saturating_add(u.value);
            // Estimate fee with current input count.
            let estimated_vbytes = 11 + (chosen.len() as u64) * 110 + 2 * 31;
            let estimated_fee = estimated_vbytes * fee_rate;
            if total >= target + estimated_fee {
                break;
            }
        }

        if chosen.is_empty() {
            anyhow::bail!("No confirmed UTXOs in treasury");
        }
        let estimated_vbytes = 11 + (chosen.len() as u64) * 110 + 2 * 31;
        let fee = estimated_vbytes * fee_rate;
        if total < target + fee {
            anyhow::bail!(
                "Insufficient confirmed treasury balance: need {} sats (incl. fee {}), have {}",
                target + fee,
                fee,
                total
            );
        }
        let change = total - target - fee;

        // Build the unsigned transaction.
        let mut tx_in: Vec<TxIn> = Vec::with_capacity(chosen.len());
        for u in &chosen {
            let txid = bitcoin::Txid::from_str(&u.txid)
                .map_err(|e| anyhow::anyhow!("Invalid utxo txid {}: {}", u.txid, e))?;
            tx_in.push(TxIn {
                previous_output: OutPoint::new(txid, u.vout),
                script_sig: ScriptBuf::new(),
                sequence: Sequence::ENABLE_RBF_NO_LOCKTIME,
                witness: Witness::new(),
            });
        }

        let mut tx_out: Vec<TxOut> = Vec::with_capacity(2);
        tx_out.push(TxOut {
            value: send_amount,
            script_pubkey: to_addr.script_pubkey(),
        });
        // Drop dust change (<= 546 sats by Bitcoin Core's policy).
        if change > 546 {
            tx_out.push(TxOut {
                value: Amount::from_sat(change),
                script_pubkey: from_addr.script_pubkey(),
            });
        }

        let mut unsigned = Transaction {
            version: Version::TWO,
            lock_time: LockTime::ZERO,
            input: tx_in,
            output: tx_out,
        };

        // Sign each input with BIP143 sighash. P2WPKH spends use the
        // implicit script_code derived from the pubkey hash.
        let secp_signer = Secp256k1::signing_only();
        let mut cache = SighashCache::new(&unsigned);
        let mut witnesses: Vec<Witness> = Vec::with_capacity(chosen.len());
        for (i, u) in chosen.iter().enumerate() {
            let sighash = cache
                .p2wpkh_signature_hash(
                    i,
                    &from_addr.script_pubkey(),
                    Amount::from_sat(u.value),
                    EcdsaSighashType::All,
                )
                .map_err(|e| anyhow::anyhow!("Failed to compute BIP143 sighash: {e}"))?;
            let msg = Message::from_digest(sighash.to_byte_array());
            let sig = secp_signer.sign_ecdsa(&msg, &pk.inner);
            let ecdsa_sig = EcdsaSig {
                signature: sig,
                sighash_type: EcdsaSighashType::All,
            };
            let mut w = Witness::new();
            w.push(ecdsa_sig.to_vec());
            w.push(pubkey.to_bytes());
            witnesses.push(w);
        }
        for (i, w) in witnesses.into_iter().enumerate() {
            unsigned.input[i].witness = w;
        }

        let raw_hex = encode::serialize_hex(&unsigned);
        let txid = self.broadcast(&raw_hex).await?;

        Ok(AssetTransferResult {
            tx_hash: txid,
            finalized: false,
        })
    }
}
