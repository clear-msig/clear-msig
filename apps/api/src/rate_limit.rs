use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use crate::ApiError;

const MAX_BUCKETS: usize = 10_000;
const MAX_KEY_BYTES: usize = 256;

/// Bounded, process-local fixed-window limiter. Keys are caller claims, not
/// proof of identity; an authenticated ingress limit is still required.
pub(crate) struct RateLimiter {
    window: Duration,
    max_per_window: u32,
    buckets: tokio::sync::Mutex<BucketStore>,
}

struct BucketStore {
    entries: HashMap<String, BucketState>,
    last_pruned: Instant,
}

struct BucketState {
    window_start: Instant,
    count: u32,
}

impl RateLimiter {
    pub(crate) fn new(window: Duration, max_per_window: u32) -> Self {
        Self {
            // A zero-length window must not silently disable throttling.
            window: window.max(Duration::from_secs(1)),
            max_per_window,
            buckets: tokio::sync::Mutex::new(BucketStore {
                entries: HashMap::new(),
                last_pruned: Instant::now(),
            }),
        }
    }

    pub(crate) async fn check(&self, key: &str) -> Result<(), ApiError> {
        self.check_at(key, Instant::now()).await
    }

    async fn check_at(&self, key: &str, now: Instant) -> Result<(), ApiError> {
        let key = key.trim();
        if key.is_empty() || key.len() > MAX_KEY_BYTES {
            return Err(ApiError::BadRequest("invalid rate-limit key".into()));
        }
        let mut buckets = self.buckets.lock().await;
        if now.saturating_duration_since(buckets.last_pruned) >= self.window {
            // At most one bounded scan per window, rather than one scan per
            // request or a permanent entry for every attacker-chosen key.
            buckets
                .entries
                .retain(|_, state| now.saturating_duration_since(state.window_start) < self.window);
            buckets.last_pruned = now;
        }
        if !buckets.entries.contains_key(key) && buckets.entries.len() >= MAX_BUCKETS {
            return Err(ApiError::RateLimited {
                retry_after: self.window,
                max_per_window: self.max_per_window,
            });
        }
        let state = buckets
            .entries
            .entry(key.to_string())
            .or_insert(BucketState {
                window_start: now,
                count: 0,
            });
        let elapsed = now.saturating_duration_since(state.window_start);
        if elapsed >= self.window {
            state.window_start = now;
            state.count = 0;
        }
        // Check before incrementing: rejected traffic cannot overflow a u32
        // counter and regain access (or panic in a checked build).
        if state.count >= self.max_per_window {
            return Err(ApiError::RateLimited {
                retry_after: self
                    .window
                    .saturating_sub(now.saturating_duration_since(state.window_start)),
                max_per_window: self.max_per_window,
            });
        }
        state.count += 1;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_excess_requests_and_resets_at_the_window_boundary() {
        let limiter = RateLimiter::new(Duration::from_secs(60), 1);
        let now = Instant::now();
        limiter.check_at("member", now).await.unwrap();
        assert!(matches!(
            limiter.check_at(" member ", now).await,
            Err(ApiError::RateLimited { .. })
        ));
        limiter
            .check_at("member", now + Duration::from_secs(60))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn caps_attacker_key_cardinality_without_evicting_active_limits() {
        let limiter = RateLimiter::new(Duration::from_secs(60), 1);
        let now = Instant::now();
        for index in 0..MAX_BUCKETS {
            limiter
                .check_at(&format!("key-{index}"), now)
                .await
                .unwrap();
        }
        assert!(limiter.check_at("overflow", now).await.is_err());
        assert!(limiter.check_at("key-0", now).await.is_err());
        assert_eq!(limiter.buckets.lock().await.entries.len(), MAX_BUCKETS);
        limiter
            .check_at("fresh", now + Duration::from_secs(60))
            .await
            .unwrap();
        assert_eq!(limiter.buckets.lock().await.entries.len(), 1);
    }

    #[tokio::test]
    async fn saturated_counter_stays_limited_without_overflow() {
        let limiter = RateLimiter::new(Duration::from_secs(60), u32::MAX);
        let now = Instant::now();
        limiter.buckets.lock().await.entries.insert(
            "member".into(),
            BucketState {
                window_start: now,
                count: u32::MAX,
            },
        );
        assert!(limiter.check_at("member", now).await.is_err());
        assert_eq!(
            limiter.buckets.lock().await.entries["member"].count,
            u32::MAX
        );
    }

    #[tokio::test]
    async fn invalid_keys_and_zero_limits_fail_closed() {
        let limiter = RateLimiter::new(Duration::ZERO, 0);
        assert_eq!(limiter.window, Duration::from_secs(1));
        assert!(limiter.check("").await.is_err());
        assert!(limiter.check(&"x".repeat(MAX_KEY_BYTES + 1)).await.is_err());
        assert!(limiter.check("member").await.is_err());
    }
}
