use super::delivery::{DestinationExecutionLease, DestinationReceipt, DestinationReceiptStore};
use crate::error::*;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
};

const MAX_RECEIPTS: usize = 10_000;

pub struct FileDestinationReceiptStore {
    path: PathBuf,
    lock: Mutex<()>,
    execution_locks: Mutex<BTreeMap<String, Weak<Mutex<()>>>>,
}

impl FileDestinationReceiptStore {
    pub fn from_environment() -> Self {
        let path = std::env::var("CLEAR_MSIG_DELIVERY_STORE_PATH")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map_or_else(default_store_path, PathBuf::from);
        Self::new(path)
    }

    #[must_use]
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Mutex::new(()),
            execution_locks: Mutex::new(BTreeMap::new()),
        }
    }

    fn read_locked(&self) -> Result<BTreeMap<String, DestinationReceipt>> {
        match std::fs::read(&self.path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .with_context(|| format!("parse delivery store {}", self.path.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(error) => {
                Err(error).with_context(|| format!("read delivery store {}", self.path.display()))
            }
        }
    }

    fn write_locked(&self, receipts: &BTreeMap<String, DestinationReceipt>) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create delivery store directory {}", parent.display()))?;
        }
        let body = serde_json::to_vec(receipts).context("serialize delivery receipts")?;
        let temporary = self
            .path
            .with_extension(format!("{}.tmp", std::process::id()));
        std::fs::write(&temporary, body).with_context(|| {
            format!(
                "write delivery store temporary file {}",
                temporary.display()
            )
        })?;
        std::fs::rename(&temporary, &self.path)
            .with_context(|| format!("replace delivery store {}", self.path.display()))
    }
}

impl DestinationReceiptStore for FileDestinationReceiptStore {
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
        _control: &crate::ExecutionControl,
    ) -> Result<DestinationExecutionLease> {
        Ok(DestinationExecutionLease::new(
            execution_id.to_string(),
            String::new(),
        ))
    }

    fn release_execution_lease(&self, _lease: &DestinationExecutionLease) -> Result<()> {
        Ok(())
    }

    fn load(
        &self,
        execution_id: &str,
        _control: &crate::ExecutionControl,
    ) -> Result<Option<DestinationReceipt>> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow!("delivery store lock poisoned"))?;
        Ok(self.read_locked()?.remove(execution_id))
    }

    fn save(&self, receipt: &DestinationReceipt, _control: &crate::ExecutionControl) -> Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| anyhow!("delivery store lock poisoned"))?;
        let mut receipts = self.read_locked()?;
        receipts.insert(receipt.execution_id.clone(), receipt.clone());
        while receipts.len() > MAX_RECEIPTS {
            let oldest = receipts
                .iter()
                .min_by_key(|(_, value)| value.updated_at)
                .map(|(key, _)| key.clone())
                .expect("non-empty receipt store");
            receipts.remove(&oldest);
        }
        self.write_locked(&receipts)
    }
}

fn default_store_path() -> PathBuf {
    let render_disk = Path::new("/data");
    if render_disk.is_dir() {
        return render_disk.join("destination-deliveries.json");
    }
    crate::config::config_path()
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("destination-deliveries.json")
}
