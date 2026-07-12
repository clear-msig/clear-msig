use super::delivery::{DestinationExecutionLease, DestinationReceipt, DestinationReceiptStore};
use crate::error::*;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    future::Future,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, Weak,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const RECEIPT_PREFIX: &str = "clearsig:destination-delivery:v1:";
const LOCK_PREFIX: &str = "clearsig:destination-delivery-lock:v1:";
const LOCK_TTL_MILLIS: &str = "180000";
const RELEASE_SCRIPT: &str =
    "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end";
static TOKEN_COUNTER: AtomicU64 = AtomicU64::new(0);

trait RedisCommandPort: Send + Sync {
    fn command(&self, command: &[String], control: &crate::ExecutionControl) -> Result<Value>;
}

struct UpstashRestPort {
    url: String,
    token: String,
    client: reqwest::Client,
}

impl UpstashRestPort {
    fn new(url: String, token: String) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .context("build Upstash delivery client")?;
        Ok(Self {
            url: url.trim_end_matches('/').to_string(),
            token,
            client,
        })
    }

    fn run<T>(
        &self,
        future: impl Future<Output = Result<T>> + Send,
        control: crate::ExecutionControl,
    ) -> Result<T> {
        let controlled = async move {
            tokio::select! {
                result = future => result,
                _ = control.cancelled() => Err(anyhow!("Upstash delivery command cancelled")),
            }
        };
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.block_on(controlled)
        } else {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .context("build Upstash delivery runtime")?
                .block_on(controlled)
        }
    }
}

impl RedisCommandPort for UpstashRestPort {
    fn command(&self, command: &[String], control: &crate::ExecutionControl) -> Result<Value> {
        let request = self
            .client
            .post(&self.url)
            .bearer_auth(&self.token)
            .json(command)
            .send();
        self.run(
            async move {
                let response = request.await.context("send Upstash delivery command")?;
                let status = response.status();
                let body = response
                    .text()
                    .await
                    .context("read Upstash delivery response")?;
                if !status.is_success() {
                    return Err(anyhow!("Upstash delivery HTTP {status}: {body}"));
                }
                let value: Value =
                    serde_json::from_str(&body).context("parse Upstash delivery response")?;
                if let Some(error) = value.get("error").and_then(Value::as_str) {
                    return Err(anyhow!("Upstash delivery command failed: {error}"));
                }
                value
                    .get("result")
                    .cloned()
                    .ok_or_else(|| anyhow!("Upstash delivery response omitted result"))
            },
            control.clone(),
        )
    }
}

pub struct UpstashDestinationReceiptStore {
    redis: Arc<dyn RedisCommandPort>,
    execution_locks: Mutex<BTreeMap<String, Weak<Mutex<()>>>>,
}

impl UpstashDestinationReceiptStore {
    /// Builds the distributed store when both Upstash variables are present.
    ///
    /// # Errors
    /// Returns an error for partial configuration or an invalid HTTP client.
    pub fn from_environment() -> Result<Option<Self>> {
        let url = non_empty_env("UPSTASH_REDIS_REST_URL");
        let token = non_empty_env("UPSTASH_REDIS_REST_TOKEN");
        match (url, token) {
            (Some(url), Some(token)) => Ok(Some(Self::new(url, token)?)),
            (None, None) => Ok(None),
            _ => Err(anyhow!(
                "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be configured together"
            )),
        }
    }

    fn new(url: String, token: String) -> Result<Self> {
        Ok(Self::with_port(Arc::new(UpstashRestPort::new(url, token)?)))
    }

    fn with_port(redis: Arc<dyn RedisCommandPort>) -> Self {
        Self {
            redis,
            execution_locks: Mutex::new(BTreeMap::new()),
        }
    }

    fn receipt_key(execution_id: &str) -> String {
        format!("{RECEIPT_PREFIX}{execution_id}")
    }

    fn lock_key(execution_id: &str) -> String {
        format!("{LOCK_PREFIX}{execution_id}")
    }
}

impl DestinationReceiptStore for UpstashDestinationReceiptStore {
    fn execution_lock(&self, execution_id: &str) -> Arc<Mutex<()>> {
        let mut locks = self
            .execution_locks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        locks.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = locks.get(execution_id).and_then(Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(Mutex::new(()));
        locks.insert(execution_id.to_string(), Arc::downgrade(&lock));
        lock
    }

    fn acquire_execution_lease(
        &self,
        execution_id: &str,
        control: &crate::ExecutionControl,
    ) -> Result<DestinationExecutionLease> {
        let token = lease_token();
        let result = self.redis.command(
            &[
                "SET".into(),
                Self::lock_key(execution_id),
                token.clone(),
                "NX".into(),
                "PX".into(),
                LOCK_TTL_MILLIS.into(),
            ],
            control,
        )?;
        if result.as_str() != Some("OK") {
            return Err(anyhow!(
                "destination execution {execution_id} is already in progress on another backend instance"
            ));
        }
        Ok(DestinationExecutionLease::new(
            execution_id.to_string(),
            token,
        ))
    }

    fn release_execution_lease(&self, lease: &DestinationExecutionLease) -> Result<()> {
        self.redis.command(
            &[
                "EVAL".into(),
                RELEASE_SCRIPT.into(),
                "1".into(),
                Self::lock_key(lease.execution_id()),
                lease.token().to_string(),
            ],
            &crate::ExecutionControl::default(),
        )?;
        Ok(())
    }

    fn load(
        &self,
        execution_id: &str,
        control: &crate::ExecutionControl,
    ) -> Result<Option<DestinationReceipt>> {
        let result = self
            .redis
            .command(&["GET".into(), Self::receipt_key(execution_id)], control)?;
        match result {
            Value::Null => Ok(None),
            Value::String(raw) => serde_json::from_str(&raw)
                .map(Some)
                .context("decode Upstash destination receipt"),
            _ => Err(anyhow!("Upstash destination receipt had an invalid type")),
        }
    }

    fn save(&self, receipt: &DestinationReceipt, control: &crate::ExecutionControl) -> Result<()> {
        let raw = serde_json::to_string(receipt).context("encode Upstash destination receipt")?;
        let result = self.redis.command(
            &["SET".into(), Self::receipt_key(&receipt.execution_id), raw],
            control,
        )?;
        if result.as_str() != Some("OK") {
            return Err(anyhow!(
                "Upstash destination receipt SET was not acknowledged"
            ));
        }
        Ok(())
    }
}

fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn lease_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = TOKEN_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{nanos}-{counter}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chains::delivery::{DeliveryState, DestinationReceipt};
    use std::collections::HashMap;

    #[derive(Default)]
    struct FakeRedis {
        values: Mutex<HashMap<String, String>>,
    }

    struct UnavailableRedis;

    impl RedisCommandPort for UnavailableRedis {
        fn command(
            &self,
            _command: &[String],
            _control: &crate::ExecutionControl,
        ) -> Result<Value> {
            Err(anyhow!("Redis unavailable"))
        }
    }

    impl RedisCommandPort for FakeRedis {
        fn command(&self, command: &[String], _control: &crate::ExecutionControl) -> Result<Value> {
            let mut values = self.values.lock().unwrap();
            match command.first().map(String::as_str) {
                Some("GET") => Ok(values
                    .get(&command[1])
                    .cloned()
                    .map_or(Value::Null, Value::String)),
                Some("SET") if command.get(3).map(String::as_str) == Some("NX") => {
                    if values.contains_key(&command[1]) {
                        Ok(Value::Null)
                    } else {
                        values.insert(command[1].clone(), command[2].clone());
                        Ok(Value::String("OK".into()))
                    }
                }
                Some("SET") => {
                    values.insert(command[1].clone(), command[2].clone());
                    Ok(Value::String("OK".into()))
                }
                Some("EVAL") => {
                    let key = &command[3];
                    let token = &command[4];
                    if values.get(key) == Some(token) {
                        values.remove(key);
                        Ok(Value::from(1))
                    } else {
                        Ok(Value::from(0))
                    }
                }
                _ => Err(anyhow!("unexpected Redis command")),
            }
        }
    }

    fn receipt() -> DestinationReceipt {
        DestinationReceipt {
            execution_id: "dst_shared".into(),
            chain_kind: 2,
            tx_id: "tx".into(),
            raw_tx_hex: "00".into(),
            state: DeliveryState::Unknown,
            attempts: 1,
            updated_at: 1,
            last_error: Some("timeout".into()),
        }
    }

    #[test]
    fn receipts_are_shared_across_store_instances() {
        let redis = Arc::new(FakeRedis::default());
        let first = UpstashDestinationReceiptStore::with_port(redis.clone());
        let second = UpstashDestinationReceiptStore::with_port(redis);
        first
            .save(&receipt(), &crate::ExecutionControl::default())
            .unwrap();

        assert_eq!(
            second
                .load("dst_shared", &crate::ExecutionControl::default())
                .unwrap(),
            Some(receipt())
        );
    }

    #[test]
    fn distributed_lease_excludes_another_instance_and_releases_by_token() {
        let redis = Arc::new(FakeRedis::default());
        let first = UpstashDestinationReceiptStore::with_port(redis.clone());
        let second = UpstashDestinationReceiptStore::with_port(redis);
        let lease = first
            .acquire_execution_lease("dst_shared", &crate::ExecutionControl::default())
            .unwrap();

        assert!(second
            .acquire_execution_lease("dst_shared", &crate::ExecutionControl::default())
            .is_err());
        first.release_execution_lease(&lease).unwrap();
        assert!(second
            .acquire_execution_lease("dst_shared", &crate::ExecutionControl::default())
            .is_ok());
    }

    #[test]
    fn redis_outage_fails_closed_for_lease_and_receipts() {
        let store = UpstashDestinationReceiptStore::with_port(Arc::new(UnavailableRedis));

        let control = crate::ExecutionControl::default();
        assert!(store
            .acquire_execution_lease("dst_shared", &control)
            .is_err());
        assert!(store.load("dst_shared", &control).is_err());
        assert!(store.save(&receipt(), &control).is_err());
    }

    #[test]
    fn cancellation_drops_pending_upstash_io() {
        let port = UpstashRestPort::new("https://redis.example".into(), "token".into()).unwrap();
        let control = crate::ExecutionControl::default();
        control.cancel();
        let result = port.run(std::future::pending::<Result<()>>(), control);

        assert!(result.unwrap_err().to_string().contains("cancelled"));
    }
}
