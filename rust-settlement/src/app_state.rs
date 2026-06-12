use crate::{
    config::AppConfig,
    kora::client::KoraClient,
    providers::PaymentProvider,
    signer::engine::SignerEngine,
};
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: AppConfig,
    pub kora_client: KoraClient,
    pub payment_provider: Arc<dyn PaymentProvider>,
    pub signer_engine: SignerEngine,
}
