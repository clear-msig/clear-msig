use super::transport::{DestinationTransport, HttpResponse};
use crate::error::*;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

use super::delivery_identity::{execution_id, expected_tx_id, normalize_raw_hex};
use super::delivery_probe::{probe, ProbeState};
pub use super::delivery_store::FileDestinationReceiptStore;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryState {
    Prepared,
    Unknown,
    Submitted,
    Confirmed,
    Failed,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct DestinationReceipt {
    pub execution_id: String,
    pub chain_kind: u8,
    pub tx_id: String,
    pub raw_tx_hex: String,
    pub state: DeliveryState,
    pub attempts: u32,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

pub trait DestinationReceiptStore: Send + Sync {
    /// Returns a process-local lock shared by the same execution ID.
    fn execution_lock(&self, execution_id: &str) -> Arc<Mutex<()>>;

    /// Loads a previously persisted delivery receipt.
    ///
    /// # Errors
    /// Returns an error when the durable store cannot be read or decoded.
    fn load(&self, execution_id: &str) -> Result<Option<DestinationReceipt>>;
    /// Durably replaces the receipt for one deterministic execution.
    ///
    /// # Errors
    /// Returns an error when the receipt cannot be persisted atomically.
    fn save(&self, receipt: &DestinationReceipt) -> Result<()>;
}

pub struct ReconciledDestinationTransport<'a> {
    inner: &'a dyn DestinationTransport,
    store: &'a dyn DestinationReceiptStore,
    chain_kind: u8,
    rpc_url: &'a str,
    receipt: Mutex<Option<DestinationReceipt>>,
}

impl<'a> ReconciledDestinationTransport<'a> {
    pub fn new(
        inner: &'a dyn DestinationTransport,
        store: &'a dyn DestinationReceiptStore,
        chain_kind: u8,
        rpc_url: &'a str,
    ) -> Self {
        Self {
            inner,
            store,
            chain_kind,
            rpc_url,
            receipt: Mutex::new(None),
        }
    }

    pub fn receipt(&self) -> Option<DestinationReceipt> {
        self.receipt.lock().ok()?.clone()
    }

    fn send(
        &self,
        raw_tx_hex: &str,
        submit: impl FnOnce() -> Result<HttpResponse>,
        response: ResponseShape,
    ) -> Result<HttpResponse> {
        let raw_tx_hex = normalize_raw_hex(raw_tx_hex)?;
        let tx_id = expected_tx_id(self.chain_kind, &raw_tx_hex)?;
        let execution_id = execution_id(self.chain_kind, &tx_id);
        let execution_lock = self.store.execution_lock(&execution_id);
        let _execution_guard = execution_lock
            .lock()
            .map_err(|_| anyhow!("destination execution lock poisoned for {execution_id}"))?;
        let mut receipt = self
            .store
            .load(&execution_id)
            .with_context(|| format!("load destination delivery {execution_id}"))?
            .unwrap_or_else(|| DestinationReceipt {
                execution_id: execution_id.clone(),
                chain_kind: self.chain_kind,
                tx_id: tx_id.clone(),
                raw_tx_hex: raw_tx_hex.clone(),
                state: DeliveryState::Prepared,
                attempts: 0,
                updated_at: now(),
                last_error: None,
            });

        if receipt.chain_kind != self.chain_kind
            || receipt.tx_id != tx_id
            || receipt.raw_tx_hex != raw_tx_hex
        {
            return Err(anyhow!(
                "destination execution identity collision for {execution_id}"
            ));
        }

        if receipt.state == DeliveryState::Failed {
            self.remember(receipt.clone());
            return Err(anyhow!(
                "destination execution {execution_id} previously failed: {}",
                receipt
                    .last_error
                    .as_deref()
                    .unwrap_or("destination rejected transaction")
            ));
        }

        if receipt.attempts > 0 || receipt.state != DeliveryState::Prepared {
            match self.probe(&tx_id) {
                Ok(ProbeState::Confirmed) => {
                    receipt.state = DeliveryState::Confirmed;
                    receipt.updated_at = now();
                    receipt.last_error = None;
                    self.persist_and_remember(receipt.clone())?;
                    return Ok(response.success(&tx_id));
                }
                Ok(ProbeState::Submitted) => {
                    receipt.state = DeliveryState::Submitted;
                    receipt.updated_at = now();
                    receipt.last_error = None;
                    self.persist_and_remember(receipt.clone())?;
                    return Ok(response.success(&tx_id));
                }
                Ok(ProbeState::Failed) => {
                    receipt.state = DeliveryState::Failed;
                    receipt.updated_at = now();
                    receipt.last_error = Some("destination chain reports failed execution".into());
                    self.persist_and_remember(receipt.clone())?;
                    return Err(anyhow!(
                        "destination execution {execution_id} failed on chain"
                    ));
                }
                Ok(ProbeState::NotFound) => {}
                Err(error) => {
                    receipt.state = DeliveryState::Unknown;
                    receipt.updated_at = now();
                    receipt.last_error = Some(format!("reconciliation query failed: {error:#}"));
                    self.persist_and_remember(receipt)?;
                    return Err(anyhow!(
                        "destination execution {execution_id} remains unknown; refusing to rebroadcast until reconciliation succeeds: {error:#}"
                    ));
                }
            }
        }

        receipt.state = DeliveryState::Prepared;
        receipt.attempts = receipt.attempts.saturating_add(1);
        receipt.updated_at = now();
        receipt.last_error = None;
        self.persist_and_remember(receipt.clone())?;

        let submitted = match submit() {
            Ok(value) => value,
            Err(error) => {
                receipt.state = DeliveryState::Unknown;
                receipt.updated_at = now();
                receipt.last_error = Some(format!("broadcast transport failed: {error:#}"));
                self.persist_and_remember(receipt)?;
                return Err(anyhow!(
                    "destination execution {execution_id} delivery is unknown after transport failure: {error:#}"
                ));
            }
        };

        let broadcast_response = match response.read_tx_id(&submitted) {
            Ok(value) => value,
            Err(error) => {
                receipt.state = DeliveryState::Unknown;
                receipt.updated_at = now();
                receipt.last_error = Some(format!("invalid broadcast response: {error:#}"));
                self.persist_and_remember(receipt)?;
                return Err(anyhow!(
                    "destination execution {execution_id} delivery is unknown after an invalid response: {error:#}"
                ));
            }
        };
        match broadcast_response {
            BroadcastResponse::Accepted(returned_tx_id) => {
                if !returned_tx_id.eq_ignore_ascii_case(&tx_id) {
                    receipt.state = DeliveryState::Failed;
                    receipt.updated_at = now();
                    receipt.last_error = Some(format!(
                        "destination returned tx id {returned_tx_id}, expected {tx_id}"
                    ));
                    self.persist_and_remember(receipt)?;
                    return Err(anyhow!(
                        "destination execution {execution_id} returned mismatched tx id {returned_tx_id}; expected {tx_id}"
                    ));
                }
                receipt.state = DeliveryState::Submitted;
                receipt.updated_at = now();
                receipt.last_error = None;
                self.persist_and_remember(receipt)?;
                Ok(submitted)
            }
            BroadcastResponse::Rejected(error) => {
                receipt.state = DeliveryState::Failed;
                receipt.updated_at = now();
                receipt.last_error = Some(error);
                self.persist_and_remember(receipt)?;
                Ok(submitted)
            }
            BroadcastResponse::MaybeKnown(error) => match self.probe(&tx_id) {
                Ok(ProbeState::Confirmed) => {
                    receipt.state = DeliveryState::Confirmed;
                    receipt.updated_at = now();
                    receipt.last_error = None;
                    self.persist_and_remember(receipt)?;
                    Ok(response.success(&tx_id))
                }
                Ok(ProbeState::Submitted) => {
                    receipt.state = DeliveryState::Submitted;
                    receipt.updated_at = now();
                    receipt.last_error = None;
                    self.persist_and_remember(receipt)?;
                    Ok(response.success(&tx_id))
                }
                Ok(ProbeState::Failed) => {
                    receipt.state = DeliveryState::Failed;
                    receipt.updated_at = now();
                    receipt.last_error = Some(error);
                    self.persist_and_remember(receipt)?;
                    Ok(submitted)
                }
                Ok(ProbeState::NotFound) | Err(_) => {
                    receipt.state = DeliveryState::Unknown;
                    receipt.updated_at = now();
                    receipt.last_error = Some(error);
                    self.persist_and_remember(receipt)?;
                    Ok(submitted)
                }
            },
            BroadcastResponse::Unknown(error) => {
                receipt.state = DeliveryState::Unknown;
                receipt.updated_at = now();
                receipt.last_error = Some(error);
                self.persist_and_remember(receipt)?;
                Ok(submitted)
            }
        }
    }

    fn persist_and_remember(&self, receipt: DestinationReceipt) -> Result<()> {
        self.store
            .save(&receipt)
            .with_context(|| format!("persist destination delivery {}", receipt.execution_id))?;
        self.remember(receipt);
        Ok(())
    }

    fn remember(&self, receipt: DestinationReceipt) {
        if let Ok(mut slot) = self.receipt.lock() {
            *slot = Some(receipt);
        }
    }

    fn probe(&self, tx_id: &str) -> Result<ProbeState> {
        probe(self.inner, self.chain_kind, self.rpc_url, tx_id)
    }
}

impl DestinationTransport for ReconciledDestinationTransport<'_> {
    fn get(&self, url: &str) -> Result<HttpResponse> {
        self.inner.get(url)
    }

    fn post_json(&self, url: &str, body: &serde_json::Value) -> Result<HttpResponse> {
        let raw = body
            .get("params")
            .and_then(|params| params.get(0))
            .and_then(|value| value.as_str())
            .ok_or_else(|| anyhow!("destination broadcast request is missing raw transaction"))?;
        self.send(
            raw,
            || self.inner.post_json(url, body),
            ResponseShape::JsonRpc,
        )
    }

    fn post_text(&self, url: &str, body: &str) -> Result<HttpResponse> {
        self.send(
            body,
            || self.inner.post_text(url, body),
            ResponseShape::PlainText,
        )
    }

    fn post_form_hex(&self, url: &str, raw_hex: &str) -> Result<HttpResponse> {
        self.send(
            raw_hex,
            || self.inner.post_form_hex(url, raw_hex),
            ResponseShape::Blockchair,
        )
    }
}

#[derive(Clone, Copy)]
enum ResponseShape {
    JsonRpc,
    PlainText,
    Blockchair,
}

enum BroadcastResponse {
    Accepted(String),
    Rejected(String),
    Unknown(String),
    MaybeKnown(String),
}

impl ResponseShape {
    fn success(self, tx_id: &str) -> HttpResponse {
        let body = match self {
            Self::JsonRpc => serde_json::json!({"jsonrpc":"2.0","id":1,"result":tx_id}).to_string(),
            Self::PlainText => tx_id.to_string(),
            Self::Blockchair => serde_json::json!({
                "context": {"error": null},
                "data": {"transaction_hash": tx_id}
            })
            .to_string(),
        };
        HttpResponse { status: 200, body }
    }

    fn read_tx_id(self, response: &HttpResponse) -> Result<BroadcastResponse> {
        if !response.is_success() {
            return Ok(BroadcastResponse::Unknown(format!(
                "destination HTTP {}: {}",
                response.status,
                response.body.trim()
            )));
        }
        match self {
            Self::PlainText => {
                let trimmed = response.body.trim();
                if trimmed.len() == 64 && trimmed.bytes().all(|value| value.is_ascii_hexdigit()) {
                    Ok(BroadcastResponse::Accepted(trimmed.to_string()))
                } else if let Ok(body) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    match body.get("txid").and_then(|value| value.as_str()) {
                        Some(tx_id) => Ok(BroadcastResponse::Accepted(tx_id.to_string())),
                        None => Ok(BroadcastResponse::Rejected(format!(
                            "invalid destination transaction id response: {trimmed}"
                        ))),
                    }
                } else {
                    Ok(BroadcastResponse::Rejected(format!(
                        "invalid destination transaction id response: {trimmed}"
                    )))
                }
            }
            Self::JsonRpc => {
                let body: serde_json::Value = serde_json::from_str(&response.body)
                    .with_context(|| "parse destination JSON-RPC broadcast response")?;
                if let Some(error) = body.get("error").filter(|value| !value.is_null()) {
                    let message = format!("destination rejected transaction: {error}");
                    let lower = message.to_ascii_lowercase();
                    return Ok(
                        if lower.contains("already known")
                            || lower.contains("already in block chain")
                            || lower.contains("txn-already-in-mempool")
                        {
                            BroadcastResponse::MaybeKnown(message)
                        } else {
                            BroadcastResponse::Rejected(message)
                        },
                    );
                }
                match body.get("result").and_then(|value| value.as_str()) {
                    Some(tx_id) => Ok(BroadcastResponse::Accepted(tx_id.to_string())),
                    None => Ok(BroadcastResponse::Unknown(
                        "destination response omitted transaction id".into(),
                    )),
                }
            }
            Self::Blockchair => {
                let body: serde_json::Value = serde_json::from_str(&response.body)
                    .with_context(|| "parse Blockchair broadcast response")?;
                if let Some(error) = body
                    .pointer("/context/error")
                    .filter(|value| !value.is_null())
                {
                    return Ok(BroadcastResponse::Rejected(format!(
                        "Blockchair rejected transaction: {error}"
                    )));
                }
                match body
                    .pointer("/data/transaction_hash")
                    .and_then(|value| value.as_str())
                {
                    Some(tx_id) => Ok(BroadcastResponse::Accepted(tx_id.to_string())),
                    None => Ok(BroadcastResponse::Unknown(
                        "Blockchair response omitted transaction id".into(),
                    )),
                }
            }
        }
    }
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chains::delivery_probe::{probe_bitcoin, probe_zcash};
    use std::{
        collections::{BTreeMap, VecDeque},
        sync::atomic::{AtomicUsize, Ordering},
    };

    #[derive(Default)]
    struct MemoryStore {
        receipts: Mutex<BTreeMap<String, DestinationReceipt>>,
        locks: Mutex<BTreeMap<String, Arc<Mutex<()>>>>,
    }

    impl DestinationReceiptStore for MemoryStore {
        fn execution_lock(&self, execution_id: &str) -> Arc<Mutex<()>> {
            self.locks
                .lock()
                .unwrap()
                .entry(execution_id.to_string())
                .or_default()
                .clone()
        }

        fn load(&self, execution_id: &str) -> Result<Option<DestinationReceipt>> {
            Ok(self.receipts.lock().unwrap().get(execution_id).cloned())
        }

        fn save(&self, receipt: &DestinationReceipt) -> Result<()> {
            self.receipts
                .lock()
                .unwrap()
                .insert(receipt.execution_id.clone(), receipt.clone());
            Ok(())
        }
    }

    #[derive(Clone, Copy)]
    enum ProbeReply {
        NotFound,
        Submitted,
        Confirmed,
        Error,
    }

    struct FakeTransport {
        chain_kind: u8,
        probe: Mutex<ProbeReply>,
        broadcast_failures: Mutex<VecDeque<bool>>,
        broadcasts: AtomicUsize,
        mismatched_tx_id: bool,
    }

    impl FakeTransport {
        fn new(chain_kind: u8, probe: ProbeReply) -> Self {
            Self {
                chain_kind,
                probe: Mutex::new(probe),
                broadcast_failures: Mutex::new(VecDeque::new()),
                broadcasts: AtomicUsize::new(0),
                mismatched_tx_id: false,
            }
        }

        fn with_failure(mut self) -> Self {
            self.broadcast_failures.get_mut().unwrap().push_back(true);
            self
        }

        fn with_mismatched_tx_id(mut self) -> Self {
            self.mismatched_tx_id = true;
            self
        }

        fn set_probe(&self, reply: ProbeReply) {
            *self.probe.lock().unwrap() = reply;
        }

        fn broadcast_response(&self, raw: &str) -> Result<HttpResponse> {
            self.broadcasts.fetch_add(1, Ordering::SeqCst);
            if self
                .broadcast_failures
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(false)
            {
                return Err(anyhow!("connection reset after write"));
            }
            let tx_id = if self.mismatched_tx_id {
                "0xdeadbeef".to_string()
            } else {
                expected_tx_id(self.chain_kind, &normalize_raw_hex(raw)?)?
            };
            Ok(HttpResponse {
                status: 200,
                body: serde_json::json!({"jsonrpc":"2.0","id":1,"result":tx_id}).to_string(),
            })
        }

        fn probe_response(&self, method: &str) -> Result<HttpResponse> {
            let reply = *self.probe.lock().unwrap();
            if matches!(reply, ProbeReply::Error) {
                return Err(anyhow!("status provider unavailable"));
            }
            let result = match (self.chain_kind, method, reply) {
                (1 | 4 | 5, "eth_getTransactionReceipt", ProbeReply::Confirmed) => {
                    serde_json::json!({"status":"0x1","blockNumber":"0x10"})
                }
                (1 | 4 | 5, "eth_getTransactionReceipt", _) => serde_json::Value::Null,
                (1 | 4 | 5, "eth_getTransactionByHash", ProbeReply::Submitted) => {
                    serde_json::json!({"hash":"0x01"})
                }
                (1 | 4 | 5, "eth_getTransactionByHash", _) => serde_json::Value::Null,
                (2 | 3, "getrawtransaction", ProbeReply::Confirmed) => {
                    serde_json::json!({"confirmations":2})
                }
                (2 | 3, "getrawtransaction", ProbeReply::Submitted) => {
                    serde_json::json!({"confirmations":0})
                }
                (2 | 3, "getrawtransaction", ProbeReply::NotFound) => {
                    return Ok(HttpResponse {
                        status: 200,
                        body: serde_json::json!({"jsonrpc":"2.0","id":1,"error":{"code":-5,"message":"not found"}}).to_string(),
                    });
                }
                _ => serde_json::Value::Null,
            };
            Ok(HttpResponse {
                status: 200,
                body: serde_json::json!({"jsonrpc":"2.0","id":1,"result":result}).to_string(),
            })
        }
    }

    impl DestinationTransport for FakeTransport {
        fn get(&self, _url: &str) -> Result<HttpResponse> {
            Err(anyhow!("unexpected GET"))
        }

        fn post_json(&self, _url: &str, body: &serde_json::Value) -> Result<HttpResponse> {
            let method = body.get("method").and_then(|value| value.as_str()).unwrap();
            if matches!(method, "eth_sendRawTransaction" | "sendrawtransaction") {
                let raw = body["params"][0].as_str().unwrap();
                self.broadcast_response(raw)
            } else {
                self.probe_response(method)
            }
        }

        fn post_text(&self, _url: &str, _body: &str) -> Result<HttpResponse> {
            Err(anyhow!("unexpected text broadcast"))
        }

        fn post_form_hex(&self, _url: &str, _raw_hex: &str) -> Result<HttpResponse> {
            Err(anyhow!("unexpected form broadcast"))
        }
    }

    fn send_evm(
        transport: &FakeTransport,
        store: &MemoryStore,
        raw: &str,
    ) -> Result<DestinationReceipt> {
        let reconciled =
            ReconciledDestinationTransport::new(transport, store, 1, "https://evm.example");
        reconciled.post_json(
            "https://evm.example",
            &serde_json::json!({"jsonrpc":"2.0","id":1,"method":"eth_sendRawTransaction","params":[raw]}),
        )?;
        reconciled
            .receipt()
            .ok_or_else(|| anyhow!("missing receipt"))
    }

    #[test]
    fn duplicate_retry_queries_chain_and_does_not_rebroadcast() {
        let store = MemoryStore::default();
        let transport = FakeTransport::new(1, ProbeReply::Submitted);
        let first = send_evm(&transport, &store, "0x02aa").unwrap();
        let second = send_evm(&transport, &store, "0x02aa").unwrap();

        assert_eq!(first.state, DeliveryState::Submitted);
        assert_eq!(second.state, DeliveryState::Submitted);
        assert_eq!(second.attempts, 1);
        assert_eq!(transport.broadcasts.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn concurrent_identical_execution_broadcasts_once() {
        let store = MemoryStore::default();
        let transport = FakeTransport::new(1, ProbeReply::Submitted);
        std::thread::scope(|scope| {
            let first = scope.spawn(|| send_evm(&transport, &store, "0x02af").unwrap());
            let second = scope.spawn(|| send_evm(&transport, &store, "0x02af").unwrap());
            first.join().unwrap();
            second.join().unwrap();
        });

        assert_eq!(transport.broadcasts.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn unknown_delivery_refuses_rebroadcast_when_reconciliation_is_down() {
        let store = MemoryStore::default();
        let transport = FakeTransport::new(1, ProbeReply::Error).with_failure();
        let first = send_evm(&transport, &store, "0x02bb").unwrap_err();
        let second = send_evm(&transport, &store, "0x02bb").unwrap_err();

        assert!(first.to_string().contains("delivery is unknown"));
        assert!(second.to_string().contains("refusing to rebroadcast"));
        assert_eq!(transport.broadcasts.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn unknown_delivery_rebroadcasts_exact_bytes_only_after_not_found() {
        let store = MemoryStore::default();
        let transport = FakeTransport::new(1, ProbeReply::Error).with_failure();
        send_evm(&transport, &store, "0x02cc").unwrap_err();
        transport.set_probe(ProbeReply::NotFound);
        let receipt = send_evm(&transport, &store, "0x02cc").unwrap();

        assert_eq!(receipt.state, DeliveryState::Submitted);
        assert_eq!(receipt.attempts, 2);
        assert_eq!(transport.broadcasts.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn retry_promotes_a_destination_receipt_to_confirmed() {
        let store = MemoryStore::default();
        let transport = FakeTransport::new(1, ProbeReply::Confirmed);
        send_evm(&transport, &store, "0x02dd").unwrap();
        let receipt = send_evm(&transport, &store, "0x02dd").unwrap();

        assert_eq!(receipt.state, DeliveryState::Confirmed);
        assert_eq!(transport.broadcasts.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn mismatched_destination_tx_id_fails_closed() {
        let store = MemoryStore::default();
        let transport = FakeTransport::new(1, ProbeReply::NotFound).with_mismatched_tx_id();
        let error = send_evm(&transport, &store, "0x02ee").unwrap_err();
        let receipt = store
            .receipts
            .lock()
            .unwrap()
            .values()
            .next()
            .unwrap()
            .clone();

        assert!(error.to_string().contains("mismatched tx id"));
        assert_eq!(receipt.state, DeliveryState::Failed);
    }

    #[test]
    fn bitcoin_tx_id_excludes_witness_bytes() {
        let prefix = "02000000000101";
        let input = format!("{}0000000000ffffffff", "00".repeat(32));
        let output = format!("01{}00", "00".repeat(8));
        let first = format!("{prefix}{input}{output}0101aa00000000");
        let second = format!("{prefix}{input}{output}0101bb00000000");

        assert_eq!(
            expected_tx_id(2, &first).unwrap(),
            expected_tx_id(2, &second).unwrap()
        );
    }

    #[test]
    fn bitcoin_and_zcash_probe_confirmation_state() {
        for chain_kind in [2, 3] {
            let transport = FakeTransport::new(chain_kind, ProbeReply::Confirmed);
            let url = if chain_kind == 2 {
                "https://bitcoin-testnet.g.alchemy.com/v2/key"
            } else {
                "https://zec-testnet.example"
            };
            let state = if chain_kind == 2 {
                probe_bitcoin(&transport, url, &"00".repeat(32)).unwrap()
            } else {
                probe_zcash(&transport, url, &"00".repeat(32)).unwrap()
            };
            assert_eq!(state, ProbeState::Confirmed);
        }
    }

    #[test]
    fn file_store_survives_new_store_instance() {
        let path = std::env::temp_dir().join(format!(
            "clear-msig-delivery-test-{}-{}.json",
            std::process::id(),
            now()
        ));
        let receipt = DestinationReceipt {
            execution_id: "dst_test".into(),
            chain_kind: 3,
            tx_id: "tx".into(),
            raw_tx_hex: "00".into(),
            state: DeliveryState::Unknown,
            attempts: 1,
            updated_at: now(),
            last_error: Some("timeout".into()),
        };
        FileDestinationReceiptStore::new(path.clone())
            .save(&receipt)
            .unwrap();
        let loaded = FileDestinationReceiptStore::new(path.clone())
            .load("dst_test")
            .unwrap();
        std::fs::remove_file(path).unwrap();

        assert_eq!(loaded, Some(receipt));
    }
}
