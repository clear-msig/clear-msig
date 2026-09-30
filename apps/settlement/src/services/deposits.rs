//! Authenticated deposit claims are reconciled from operator-configured RPCs.
//! No client-selected endpoint, amount, or finality flag becomes evidence.
use super::deposit_proof::{self, DepositExpectation};
use crate::{
    config::AppConfig, contracts::api::ChainTransferConfirmationRequest, domain::types::ChainFamily,
};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::time::Duration;
use uuid::Uuid;

const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;

struct ChainReader {
    http: reqwest::Client,
}
impl ChainReader {
    fn new() -> anyhow::Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
        })
    }
    async fn body(&self, mut response: reqwest::Response) -> anyhow::Result<String> {
        anyhow::ensure!(
            response.status().is_success(),
            "chain evidence provider rejected request"
        );
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            anyhow::ensure!(
                chunk.len() <= MAX_RESPONSE_BYTES.saturating_sub(body.len()),
                "chain evidence response too large"
            );
            body.extend_from_slice(&chunk);
        }
        Ok(String::from_utf8(body)?)
    }
    async fn rpc(
        &self,
        url: &str,
        method: &str,
        params: Value,
        credentials: Option<(&str, &str)>,
    ) -> anyhow::Result<Value> {
        anyhow::ensure!(
            !url.trim().is_empty(),
            "chain evidence endpoint not configured"
        );
        let mut request = self
            .http
            .post(url)
            .json(&json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}));
        if let Some((user, password)) = credentials {
            request = request.basic_auth(user, Some(password));
        }
        let body = self.body(request.send().await?).await?;
        let value: Value = serde_json::from_str(&body)?;
        anyhow::ensure!(
            value.get("error").is_none_or(Value::is_null),
            "chain evidence RPC returned an error"
        );
        value
            .get("result")
            .filter(|value| !value.is_null())
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("chain evidence not found or not finalized"))
    }
    async fn get(&self, url: &str) -> anyhow::Result<String> {
        self.body(self.http.get(url).send().await?).await
    }
}

fn normalized_tx_hash(family: ChainFamily, hash: &str) -> anyhow::Result<String> {
    if family == ChainFamily::Solana {
        anyhow::ensure!(
            hash.len() <= 88 && bs58::decode(hash).into_vec()?.len() == 64,
            "invalid Solana transaction signature"
        );
        return Ok(hash.to_string());
    }
    let digits = hash.strip_prefix("0x").unwrap_or(hash);
    anyhow::ensure!(
        digits.len() == 64 && digits.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "invalid transaction hash"
    );
    Ok(if family == ChainFamily::Evm {
        format!("0x{}", digits.to_ascii_lowercase())
    } else {
        digits.to_ascii_lowercase()
    })
}

async fn fetch_and_verify(
    config: &AppConfig,
    family: ChainFamily,
    expected: &DepositExpectation,
) -> anyhow::Result<Value> {
    let reader = ChainReader::new()?;
    match family {
        ChainFamily::Evm => {
            let url = &config.evm_rpc_url;
            let chain = reader.rpc(url, "eth_chainId", json!([]), None).await?;
            let transaction = reader
                .rpc(
                    url,
                    "eth_getTransactionByHash",
                    json!([expected.tx_hash]),
                    None,
                )
                .await?;
            let receipt = reader
                .rpc(
                    url,
                    "eth_getTransactionReceipt",
                    json!([expected.tx_hash]),
                    None,
                )
                .await?;
            let finalized = reader
                .rpc(
                    url,
                    "eth_getBlockByNumber",
                    json!(["finalized", false]),
                    None,
                )
                .await?;
            let height = receipt
                .get("blockNumber")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow::anyhow!("missing receipt block"))?;
            let block = reader
                .rpc(url, "eth_getBlockByNumber", json!([height, false]), None)
                .await?;
            deposit_proof::verify_evm(
                expected,
                &chain,
                &transaction,
                &receipt,
                &finalized,
                &block,
            )?;
            Ok(
                json!({"block_hash":receipt["blockHash"],"block_number":receipt["blockNumber"],"finality":"finalized"}),
            )
        }
        ChainFamily::Solana => {
            // Both values are operator-owned, never accepted from a claim.
            let network = std::env::var("RAMP_SOLANA_CHAIN_ID").unwrap_or_default();
            let genesis = std::env::var("RAMP_SOLANA_GENESIS_HASH").unwrap_or_default();
            anyhow::ensure!(
                !genesis.is_empty() && network == expected.chain_id,
                "Solana deposit network identity is not configured"
            );
            let actual = reader
                .rpc(&config.solana_rpc_url, "getGenesisHash", json!([]), None)
                .await?;
            anyhow::ensure!(
                actual.as_str() == Some(genesis.as_str()),
                "Solana deposit network mismatch"
            );
            let status = reader
                .rpc(
                    &config.solana_rpc_url,
                    "getSignatureStatuses",
                    json!([[expected.tx_hash],{"searchTransactionHistory":true}]),
                    None,
                )
                .await?;
            anyhow::ensure!(
                status
                    .get("value")
                    .and_then(Value::as_array)
                    .and_then(|rows| rows.first())
                    .and_then(|row| row.get("confirmationStatus"))
                    .and_then(Value::as_str)
                    == Some("finalized"),
                "Solana deposit is not finalized"
            );
            let tx=reader.rpc(&config.solana_rpc_url,"getTransaction",json!([expected.tx_hash,{"commitment":"finalized","encoding":"jsonParsed","maxSupportedTransactionVersion":0}]),None).await?;
            deposit_proof::verify_solana(expected, &tx)?;
            Ok(json!({"slot":tx["slot"],"genesis_hash":genesis,"finality":"finalized"}))
        }
        ChainFamily::Bitcoin => {
            let network = match expected.chain_id.as_str() {
                "mainnet" => bitcoin::Network::Bitcoin,
                "testnet" => bitcoin::Network::Testnet,
                "signet" => bitcoin::Network::Signet,
                "regtest" => bitcoin::Network::Regtest,
                _ => anyhow::bail!("unsupported Bitcoin network"),
            };
            anyhow::ensure!(
                config.bitcoin_network == expected.chain_id,
                "Bitcoin configured network mismatch"
            );
            let base = config.bitcoin_esplora_url.trim_end_matches('/');
            let genesis = reader.get(&format!("{base}/block-height/0")).await?;
            anyhow::ensure!(
                genesis.trim()
                    == bitcoin::blockdata::constants::genesis_block(network)
                        .block_hash()
                        .to_string(),
                "Bitcoin evidence network mismatch"
            );
            let tx: Value = serde_json::from_str(
                &reader
                    .get(&format!("{base}/tx/{}", expected.tx_hash))
                    .await?,
            )?;
            let height = tx
                .get("status")
                .and_then(|status| status.get("block_height"))
                .and_then(Value::as_u64)
                .ok_or_else(|| anyhow::anyhow!("Bitcoin deposit unconfirmed"))?;
            let tip: u64 = reader
                .get(&format!("{base}/blocks/tip/height"))
                .await?
                .trim()
                .parse()?;
            let block = reader.get(&format!("{base}/block-height/{height}")).await?;
            deposit_proof::verify_bitcoin(expected, &tx, tip, block.trim())?;
            Ok(
                json!({"block_hash":block.trim(),"block_height":height,"confirmations":tip-height+1}),
            )
        }
        ChainFamily::Zcash => {
            let url = &config.zcash_rpc_url;
            let credentials = Some((
                config.zcash_rpc_user.as_str(),
                config.zcash_rpc_password.as_str(),
            ));
            let info = reader
                .rpc(url, "getblockchaininfo", json!([]), credentials)
                .await?;
            let tx = reader
                .rpc(
                    url,
                    "getrawtransaction",
                    json!([expected.tx_hash, 1]),
                    credentials,
                )
                .await?;
            let inputs = tx
                .get("vin")
                .and_then(Value::as_array)
                .filter(|inputs| !inputs.is_empty() && inputs.len() <= 32)
                .ok_or_else(|| anyhow::anyhow!("unsupported Zcash input count"))?;
            let mut previous = Vec::with_capacity(inputs.len());
            for input in inputs {
                let hash = input
                    .get("txid")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow::anyhow!("unsupported Zcash input"))?;
                previous.push(
                    reader
                        .rpc(url, "getrawtransaction", json!([hash, 1]), credentials)
                        .await?,
                );
            }
            let block_hash = tx
                .get("blockhash")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow::anyhow!("Zcash deposit unconfirmed"))?;
            let header = reader
                .rpc(url, "getblockheader", json!([block_hash]), credentials)
                .await?;
            let height = header
                .get("height")
                .and_then(Value::as_u64)
                .ok_or_else(|| anyhow::anyhow!("missing Zcash block height"))?;
            let block = reader
                .rpc(url, "getblockhash", json!([height]), credentials)
                .await?;
            let block = block
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("missing Zcash canonical block"))?;
            deposit_proof::verify_zcash(expected, &tx, &previous, &info, block)?;
            Ok(
                json!({"block_hash":block,"block_height":height,"confirmations":tx["confirmations"]}),
            )
        }
    }
}

pub async fn confirm_deposit(
    pool: &PgPool,
    config: &AppConfig,
    user_id: Uuid,
    claim: &ChainTransferConfirmationRequest,
) -> anyhow::Result<()> {
    let row=sqlx::query("SELECT chain_family,chain_id,asset_symbol,asset_amount_minor,source_wallet,status,metadata FROM ramp_intents WHERE id=$1 AND user_id=$2 AND intent_type='offramp'")
        .bind(claim.intent_id).bind(user_id).fetch_optional(pool).await?.ok_or_else(||anyhow::anyhow!("deposit intent not found"))?;
    let family = match row.get::<String, _>("chain_family").as_str() {
        "solana" => ChainFamily::Solana,
        "evm" => ChainFamily::Evm,
        "bitcoin" => ChainFamily::Bitcoin,
        "zcash" => ChainFamily::Zcash,
        _ => anyhow::bail!("unsupported deposit family"),
    };
    let metadata: Value = row.get("metadata");
    let treasury = metadata
        .get("deposit_treasury_address")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            anyhow::anyhow!("deposit intent has no trusted treasury snapshot; prepare a new intent")
        })?;
    let quote: super::quotes::ExecutableQuote = serde_json::from_value(
        metadata
            .get("executable_quote")
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("deposit intent has no executable quote"))?,
    )?;
    anyhow::ensure!(
        quote.chain_family == family
            && quote.chain_id == row.get::<String, _>("chain_id")
            && quote.asset_symbol == row.get::<String, _>("asset_symbol")
            && quote.asset_amount_minor == row.get::<i64, _>("asset_amount_minor"),
        "deposit quote mismatch"
    );
    let expected = DepositExpectation {
        intent_id: claim.intent_id,
        chain_id: row.get("chain_id"),
        asset_symbol: row.get("asset_symbol"),
        source: row
            .get::<Option<String>, _>("source_wallet")
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow::anyhow!("deposit source missing"))?,
        treasury: treasury.to_string(),
        amount_minor: crate::domain::types::positive_amount_minor(row.get("asset_amount_minor"))?,
        event_index: usize::try_from(claim.event_index)?,
        tx_hash: normalized_tx_hash(family, &claim.tx_hash)?,
        funding_deadline: quote.expires_at,
    };
    anyhow::ensure!(
        family == claim.chain_family
            && expected.chain_id == claim.chain_id
            && expected.asset_symbol == claim.asset_symbol
            && expected.source == claim.sender_wallet
            && i64::try_from(expected.amount_minor)? == claim.amount_minor,
        "deposit claim does not match intent"
    );
    anyhow::ensure!(
        metadata.get("deposit_reference").and_then(Value::as_str)
            == Some(expected.reference().as_str()),
        "deposit intent reference missing"
    );
    let existing: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM ramp_chain_transfers WHERE intent_id=$1 AND tx_hash=$2 AND event_index=$3 AND verifier_version=1 AND amount_minor=$4 AND recipient_wallet=$5 AND deposit_reference=$6)")
        .bind(claim.intent_id).bind(&expected.tx_hash).bind(claim.event_index).bind(claim.amount_minor).bind(&expected.treasury).bind(expected.reference()).fetch_one(pool).await?;
    if existing {
        return Ok(());
    }
    let family_name = match family {
        ChainFamily::Solana => "solana",
        ChainFamily::Evm => "evm",
        ChainFamily::Bitcoin => "bitcoin",
        ChainFamily::Zcash => "zcash",
    };
    // No locks are held during network calls; the immutable intent and state
    // are rechecked under a row lock before evidence is persisted.
    let proof = tokio::time::timeout(
        Duration::from_secs(90),
        fetch_and_verify(config, family, &expected),
    )
    .await??;
    let mut tx = pool.begin().await?;
    let status:Option<String>=sqlx::query_scalar("SELECT status FROM ramp_intents WHERE id=$1 AND user_id=$2 AND chain_id=$3 AND asset_symbol=$4 AND asset_amount_minor=$5 AND source_wallet=$6 AND metadata->>'deposit_treasury_address'=$7 AND chain_family=$8 AND intent_type='offramp' AND metadata->>'deposit_reference'=$9 AND metadata->'executable_quote'=$10 AND metadata->>'executable_quote_version'='1' FOR UPDATE")
        .bind(claim.intent_id).bind(user_id).bind(&expected.chain_id).bind(&expected.asset_symbol).bind(claim.amount_minor).bind(&expected.source).bind(&expected.treasury).bind(family_name).bind(expected.reference()).bind(serde_json::to_value(&quote)?).fetch_optional(&mut *tx).await?;
    let status =
        status.ok_or_else(|| anyhow::anyhow!("deposit intent changed during verification"))?;
    if status != "awaiting_user_transfer_confirmation" {
        let existing:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM ramp_chain_transfers WHERE intent_id=$1 AND tx_hash=$2 AND event_index=$3 AND verifier_version=1)").bind(claim.intent_id).bind(&expected.tx_hash).bind(claim.event_index).fetch_one(&mut *tx).await?;
        anyhow::ensure!(existing, "deposit intent is not awaiting confirmation");
        tx.commit().await?;
        return Ok(());
    }
    let family_name = match family {
        ChainFamily::Solana => "solana",
        ChainFamily::Evm => "evm",
        ChainFamily::Bitcoin => "bitcoin",
        ChainFamily::Zcash => "zcash",
    };
    let inserted=sqlx::query("INSERT INTO ramp_chain_transfers(id,intent_id,chain_family,chain_id,tx_hash,event_index,sender_wallet,asset_symbol,amount_minor,confirmations,is_finalized,confirmed_at,recipient_wallet,deposit_reference,verifier_version,verification_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,TRUE,NOW(),$10,$11,1,$12) ON CONFLICT DO NOTHING")
        .bind(Uuid::new_v4()).bind(claim.intent_id).bind(family_name).bind(&expected.chain_id).bind(&expected.tx_hash).bind(claim.event_index).bind(&expected.source).bind(&expected.asset_symbol).bind(claim.amount_minor).bind(&expected.treasury).bind(expected.reference()).bind(proof).execute(&mut *tx).await?;
    if inserted.rows_affected() == 0 {
        let same:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM ramp_chain_transfers WHERE intent_id=$1 AND tx_hash=$2 AND event_index=$3 AND verifier_version=1)").bind(claim.intent_id).bind(&expected.tx_hash).bind(claim.event_index).fetch_one(&mut *tx).await?;
        anyhow::ensure!(
            same,
            "deposit transaction already claimed or unverified legacy evidence exists"
        );
    }
    tx.commit().await?;
    Ok(())
}
