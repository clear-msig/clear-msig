use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

#[derive(Clone, Default)]
pub struct ExecutionControl {
    cancelled: Arc<AtomicBool>,
}

impl ExecutionControl {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn check(&self) -> anyhow::Result<()> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(anyhow::anyhow!("execution cancelled"))
        } else {
            Ok(())
        }
    }

    pub async fn cancelled(&self) {
        while !self.cancelled.load(Ordering::Acquire) {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    pub fn wait(&self, duration: Duration) -> anyhow::Result<()> {
        let started = std::time::Instant::now();
        while started.elapsed() < duration {
            self.check()?;
            std::thread::sleep(
                Duration::from_millis(20).min(duration.saturating_sub(started.elapsed())),
            );
        }
        self.check()
    }
}

#[cfg(test)]
mod tests {
    use super::ExecutionControl;

    #[test]
    fn cancellation_is_shared_but_isolated_per_request() {
        let first = ExecutionControl::default();
        let first_worker = first.clone();
        let second = ExecutionControl::default();
        first.cancel();
        assert!(first_worker.check().is_err());
        assert!(second.check().is_ok());
    }
}
