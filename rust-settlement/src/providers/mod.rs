use std::sync::Arc;

use async_trait::async_trait;

use crate::{config::AppConfig, kora::client::{KoraBank, KoraClient}};

#[derive(Debug, Clone)]
pub struct ProviderCheckout {
    pub authorization_url: String,
    pub access_code: String,
    pub reference: String,
}

#[derive(Debug, Clone)]
pub struct ProviderVerifiedCheckout {
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct ProviderBank {
    pub name: String,
    pub code: String,
    pub slug: Option<String>,
    pub country: Option<String>,
    pub currency: Option<String>,
    pub active: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct PayoutRequest {
    pub amount_minor: i64,
    pub reference: String,
    pub bank_code: Option<String>,
    pub account_number: Option<String>,
    pub account_name: Option<String>,
    pub customer_email: Option<String>,
    pub narration: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PayoutResponse {
    pub accepted: bool,
    pub provider_status: String,
    pub provider_payload: serde_json::Value,
}

#[async_trait]
pub trait PaymentProvider: Send + Sync {
    fn name(&self) -> &'static str;

    async fn initialize_checkout(
        &self,
        email: &str,
        amount_ngn_minor: i64,
        reference: &str,
        callback_url: Option<&str>,
    ) -> anyhow::Result<ProviderCheckout>;

    async fn verify_checkout(&self, reference: &str) -> anyhow::Result<ProviderVerifiedCheckout>;

    async fn resolve_account_number(
        &self,
        account_number: &str,
        bank_code: &str,
    ) -> anyhow::Result<(String, String)>;

    async fn create_transfer_recipient(
        &self,
        name: &str,
        account_number: &str,
        bank_code: &str,
    ) -> anyhow::Result<String>;

    async fn list_banks(&self, country: &str) -> anyhow::Result<Vec<ProviderBank>>;

    async fn initiate_payout(&self, request: &PayoutRequest) -> anyhow::Result<PayoutResponse>;
}

#[derive(Clone)]
pub struct KoraProvider {
    client: KoraClient,
}

impl KoraProvider {
    pub fn new(client: KoraClient) -> Self {
        Self { client }
    }
}

#[async_trait]
impl PaymentProvider for KoraProvider {
    fn name(&self) -> &'static str {
        "kora"
    }

    async fn initialize_checkout(
        &self,
        email: &str,
        amount_ngn_minor: i64,
        reference: &str,
        callback_url: Option<&str>,
    ) -> anyhow::Result<ProviderCheckout> {
        let result = self
            .client
            .initialize_charge(email, amount_ngn_minor, reference, callback_url)
            .await?;

        Ok(ProviderCheckout {
            authorization_url: result.checkout_url,
            access_code: String::new(),
            reference: result.reference,
        })
    }

    async fn verify_checkout(&self, reference: &str) -> anyhow::Result<ProviderVerifiedCheckout> {
        let result = self.client.verify_charge(reference).await?;
        Ok(ProviderVerifiedCheckout {
            status: result.status,
        })
    }

    async fn resolve_account_number(
        &self,
        account_number: &str,
        bank_code: &str,
    ) -> anyhow::Result<(String, String)> {
        let result = self
            .client
            .resolve_bank_account(account_number, bank_code, "NG")
            .await?;
        Ok((result.account_name, result.account_number))
    }

    async fn create_transfer_recipient(
        &self,
        _name: &str,
        _account_number: &str,
        _bank_code: &str,
    ) -> anyhow::Result<String> {
        Ok(String::new())
    }

    async fn list_banks(&self, country: &str) -> anyhow::Result<Vec<ProviderBank>> {
        let banks = self.client.list_banks(country).await?;
        Ok(banks
            .into_iter()
                .map(|bank: KoraBank| ProviderBank {
                name: bank.name,
                code: bank.code,
                slug: bank.slug,
                country: bank.country,
                currency: None,
                active: Some(true),
            })
            .collect())
    }

    async fn initiate_payout(&self, request: &PayoutRequest) -> anyhow::Result<PayoutResponse> {
        let bank_code = request
            .bank_code
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_string();
        let account_number = request
            .account_number
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_string();

        if bank_code.is_empty() || account_number.is_empty() {
            anyhow::bail!("missing bank_code/account_number for Kora payout");
        }

        let account_name = request
            .account_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Clear multisig recipient")
            .to_string();
        let customer_email = request
            .customer_email
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("{}@clear.local", request.reference));
        let narration = request
            .narration
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("Clear Pro payout")
            .to_string();

        let response = self
            .client
            .disburse_bank_account(
                &request.reference,
                request.amount_minor,
                &bank_code,
                &account_number,
                &account_name,
                &customer_email,
                &narration,
            )
            .await?;

        let provider_status = response
            .data
            .as_ref()
            .map(|row| row.status.clone())
            .unwrap_or_else(|| if response.status { "processing".to_string() } else { "failed".to_string() });

        Ok(PayoutResponse {
            accepted: response.status,
            provider_status,
            provider_payload: serde_json::to_value(response)?,
        })
    }
}

pub fn build_payment_provider(config: &AppConfig) -> anyhow::Result<Arc<dyn PaymentProvider>> {
    if config.kora_secret_key.trim().is_empty() {
        anyhow::bail!("KORA_SECRET_KEY is required for settlement payouts");
    }

    Ok(Arc::new(KoraProvider::new(KoraClient::new(
        config.kora_base_url.clone(),
        config.kora_secret_key.clone(),
    ))))
}
