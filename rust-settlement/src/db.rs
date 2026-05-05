use sqlx::{postgres::{PgConnectOptions, PgPoolOptions}, PgPool};
use std::str::FromStr;
use std::time::Duration;

pub fn create_pool(database_url: &str) -> anyhow::Result<PgPool> {
    // Disable prepared statements so SQLx works with Supabase pgBouncer
    // (both port 6543 transaction mode and port 5432 session mode).
    let options = PgConnectOptions::from_str(database_url)?
        .statement_cache_capacity(0);

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(30))
        .idle_timeout(Some(Duration::from_secs(30)))
        .max_lifetime(Some(Duration::from_secs(300)))
        .connect_lazy_with(options);

    Ok(pool)
}
