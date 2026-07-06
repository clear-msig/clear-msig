use std::{collections::HashMap, time::Duration};

use crate::ApiError;

/// Per-pubkey token bucket, tokio-friendly. The surface is deliberately tiny
/// so it can move to Redis later without route handlers changing.
pub(crate) struct RateLimiter {
    window: Duration,
    max_per_window: u32,
    buckets: tokio::sync::Mutex<HashMap<String, BucketState>>,
}

struct BucketState {
    window_start: std::time::Instant,
    count: u32,
}

impl RateLimiter {
    pub(crate) fn new(window: Duration, max_per_window: u32) -> Self {
        Self {
            window,
            max_per_window,
            buckets: tokio::sync::Mutex::new(HashMap::new()),
        }
    }

    pub(crate) async fn check(&self, pubkey: &str) -> Result<(), ApiError> {
        let mut buckets = self.buckets.lock().await;
        let now = std::time::Instant::now();
        let state = buckets.entry(pubkey.to_string()).or_insert(BucketState {
            window_start: now,
            count: 0,
        });
        if now.duration_since(state.window_start) > self.window {
            state.window_start = now;
            state.count = 0;
        }
        state.count += 1;
        if state.count > self.max_per_window {
            return Err(ApiError::RateLimited {
                retry_after: self.window - now.duration_since(state.window_start),
                max_per_window: self.max_per_window,
            });
        }
        Ok(())
    }
}
