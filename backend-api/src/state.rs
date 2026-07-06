use std::sync::Arc;

use crate::{pro::ProStore, rate_limit::RateLimiter, runner::CliRunner};

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) runner: Arc<CliRunner>,
    /// Per-pubkey rate limiter for pre-signed writes.
    pub(crate) rate_limiter: Arc<RateLimiter>,
    pub(crate) pro_store: Arc<ProStore>,
}
