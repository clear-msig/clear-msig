use crate::{
    config::AppConfig, paystack::client::PaystackClient, providers::PaymentProvider,
    signer::engine::SignerEngine,
};
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: AppConfig,
    pub paystack_client: PaystackClient,
    pub payment_provider: Arc<dyn PaymentProvider>,
    pub signer_engine: SignerEngine,
}
