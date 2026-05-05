use std::sync::Arc;

use async_trait::async_trait;

use crate::{
    config::AppConfig,
    kora::client::{KoraClient, KoraPaystackLikeBank},
    paystack::client::{InitiateTransferRequest, PaystackClient},
};

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
    pub recipient_code: Option<String>,
    pub bank_code: Option<String>,
    pub account_number: Option<String>,
    pub account_name: Option<String>,
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
pub struct PaystackProvider {
    client: PaystackClient,
}

impl PaystackProvider {
    pub fn new(client: PaystackClient) -> Self {
        Self { client }
    }
}

#[async_trait]
impl PaymentProvider for PaystackProvider {
    fn name(&self) -> &'static str {
        "paystack"
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
            .initialize_transaction(email, amount_ngn_minor, reference, callback_url)
            .await?;

        Ok(ProviderCheckout {
            authorization_url: result.authorization_url,
            access_code: result.access_code,
            reference: result.reference,
        })
    }

    async fn verify_checkout(&self, reference: &str) -> anyhow::Result<ProviderVerifiedCheckout> {
        let result = self.client.verify_transaction(reference).await?;
        Ok(ProviderVerifiedCheckout {
            status: result.status,
        })
    }

    async fn resolve_account_number(
        &self,
        account_number: &str,
        bank_code: &str,
    ) -> anyhow::Result<(String, String)> {
        let data = self
            .client
            .resolve_account_number(account_number, bank_code)
            .await?;
        Ok((data.account_name, data.account_number))
    }

    async fn create_transfer_recipient(
        &self,
        name: &str,
        account_number: &str,
        bank_code: &str,
    ) -> anyhow::Result<String> {
        self.client
            .create_transfer_recipient(name, account_number, bank_code)
            .await
    }

    async fn list_banks(&self, country: &str) -> anyhow::Result<Vec<ProviderBank>> {
        let rows = self.client.list_banks(country).await?;
        Ok(rows
            .into_iter()
            .map(|bank| ProviderBank {
                name: bank.name,
                code: bank.code,
                slug: bank.slug,
                country: bank.country,
                currency: bank.currency,
                active: bank.active,
            })
            .collect())
    }

    async fn initiate_payout(&self, request: &PayoutRequest) -> anyhow::Result<PayoutResponse> {
        let recipient_code = request
            .recipient_code
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_string();

        if recipient_code.is_empty() {
            anyhow::bail!("missing recipient_code for Paystack payout");
        }

        let response = self
            .client
            .initiate_transfer(&InitiateTransferRequest {
                amount_minor: request.amount_minor,
                recipient_code,
                reason: "DETA offramp payout".to_string(),
                reference: request.reference.clone(),
            })
            .await?;

        Ok(PayoutResponse {
            accepted: response.status,
            provider_status: if response.status {
                "accepted".to_string()
            } else {
                "failed".to_string()
            },
            provider_payload: serde_json::to_value(response)?,
        })
    }
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
            .map(|bank: KoraPaystackLikeBank| ProviderBank {
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
            .unwrap_or("DETA User")
            .to_string();

        let response = self
            .client
            .disburse_bank_account(
                &request.reference,
                request.amount_minor,
                &bank_code,
                &account_number,
                &account_name,
                &format!("{}@deta.app", request.reference),
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
    let selected = config.ramp_payment_provider.trim().to_ascii_lowercase();

    if selected == "kora" {
        if config.kora_secret_key.trim().is_empty() {
            anyhow::bail!("RAMP_PAYMENT_PROVIDER is 'kora' but KORA_SECRET_KEY is empty");
        }

        return Ok(Arc::new(KoraProvider::new(KoraClient::new(
            config.kora_base_url.clone(),
            config.kora_secret_key.clone(),
        ))));
    }

    if selected == "paystack" {
        if config.paystack_secret_key.trim().is_empty() {
            anyhow::bail!("RAMP_PAYMENT_PROVIDER is 'paystack' but PAYSTACK_SECRET_KEY is empty");
        }

        return Ok(Arc::new(PaystackProvider::new(PaystackClient::new(
            config.paystack_base_url.clone(),
            config.paystack_secret_key.clone(),
        ))));
    }

    anyhow::bail!(
        "Unsupported payment provider '{}'. Allowed values: paystack | kora",
        selected
    );
}
