use anyhow::{anyhow, Context};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct KoraClient {
    client: reqwest::Client,
    base_url: String,
    secret_key: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KoraChargeInitializeResponse {
    pub checkout_url: String,
    pub reference: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KoraChargeVerifyResponse {
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KoraResolveBankResponse {
    pub account_name: String,
    pub account_number: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KoraBank {
    pub name: String,
    pub code: String,
    pub slug: Option<String>,
    pub country: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KoraDisburseRow {
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub reference: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct KoraDisburseResponse {
    pub status: bool,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub data: Option<KoraDisburseRow>,
}

impl KoraClient {
    pub fn new(base_url: String, secret_key: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url,
            secret_key,
        }
    }

    pub async fn initialize_charge(
        &self,
        email: &str,
        amount_minor: i64,
        reference: &str,
        callback_url: Option<&str>,
    ) -> anyhow::Result<KoraChargeInitializeResponse> {
        #[derive(Serialize)]
        struct Customer<'a> {
            email: &'a str,
        }

        #[derive(Serialize)]
        struct RequestBody<'a> {
            amount: String,
            currency: &'static str,
            reference: &'a str,
            customer: Customer<'a>,
            #[serde(skip_serializing_if = "Option::is_none")]
            redirect_url: Option<&'a str>,
        }

        #[derive(Deserialize)]
        struct ApiData {
            checkout_url: String,
            reference: String,
        }

        #[derive(Deserialize)]
        struct ApiResponse {
            status: bool,
            message: Option<String>,
            data: Option<ApiData>,
        }

        let amount = format!("{:.2}", amount_minor as f64 / 100.0);

        let response = self
            .client
            .post(format!("{}/api/v1/charges/initialize", self.base_url.trim_end_matches('/')))
            .bearer_auth(&self.secret_key)
            .json(&RequestBody {
                amount,
                currency: "NGN",
                reference,
                customer: Customer { email },
                redirect_url: callback_url,
            })
            .send()
            .await
            .context("failed to initialize Kora charge")?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Kora initialize failed ({}): {}", status, body));
        }

        let parsed: ApiResponse = serde_json::from_str(&body)
            .with_context(|| format!("invalid Kora initialize response: {}", body))?;

        if !parsed.status {
            return Err(anyhow!(
                "Kora initialize rejected: {}",
                parsed.message.unwrap_or_else(|| "unknown error".to_string())
            ));
        }

        let data = parsed
            .data
            .ok_or_else(|| anyhow!("missing Kora initialize data"))?;

        Ok(KoraChargeInitializeResponse {
            checkout_url: data.checkout_url,
            reference: data.reference,
        })
    }

    pub async fn verify_charge(&self, reference: &str) -> anyhow::Result<KoraChargeVerifyResponse> {
        #[derive(Deserialize)]
        struct ApiData {
            status: Option<String>,
            charge_status: Option<String>,
        }

        #[derive(Deserialize)]
        struct ApiResponse {
            status: bool,
            data: Option<ApiData>,
        }

        let response = self
            .client
            .get(format!(
                "{}/api/v1/charges/{}",
                self.base_url.trim_end_matches('/'),
                reference
            ))
            .bearer_auth(&self.secret_key)
            .send()
            .await
            .context("failed to verify Kora charge")?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if status == StatusCode::NOT_FOUND {
            return Ok(KoraChargeVerifyResponse {
                status: "not_found".to_string(),
            });
        }

        if !status.is_success() {
            return Err(anyhow!("Kora verify failed ({}): {}", status, body));
        }

        let parsed: ApiResponse = serde_json::from_str(&body)
            .with_context(|| format!("invalid Kora verify response: {}", body))?;

        if !parsed.status {
            return Ok(KoraChargeVerifyResponse {
                status: "failed".to_string(),
            });
        }

        let status_text = parsed
            .data
            .and_then(|value| value.charge_status.or(value.status))
            .unwrap_or_else(|| "pending".to_string());

        Ok(KoraChargeVerifyResponse { status: status_text })
    }

    pub async fn resolve_bank_account(
        &self,
        account_number: &str,
        bank_code: &str,
        country_code: &str,
    ) -> anyhow::Result<KoraResolveBankResponse> {
        #[derive(Serialize)]
        struct RequestBody<'a> {
            account: &'a str,
            bank: &'a str,
            currency: &'a str,
        }

        #[derive(Deserialize)]
        struct ApiData {
            account_name: String,
            account_number: String,
        }

        #[derive(Deserialize)]
        struct ApiResponse {
            status: bool,
            message: Option<String>,
            data: Option<ApiData>,
        }

        let currency = if country_code.eq_ignore_ascii_case("NG") {
            "NGN"
        } else {
            country_code
        };

        let response = self
            .client
            .post(format!("{}/api/v1/misc/banks/resolve", self.base_url.trim_end_matches('/')))
            .bearer_auth(&self.secret_key)
            .json(&RequestBody {
                account: account_number,
                bank: bank_code,
                currency,
            })
            .send()
            .await
            .context("failed to resolve Kora bank account")?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Kora resolve failed ({}): {}", status, body));
        }

        let parsed: ApiResponse = serde_json::from_str(&body)
            .with_context(|| format!("invalid Kora resolve response: {}", body))?;

        if !parsed.status {
            return Err(anyhow!(
                "Kora resolve rejected: {}",
                parsed.message.unwrap_or_else(|| "unknown error".to_string())
            ));
        }

        let data = parsed
            .data
            .ok_or_else(|| anyhow!("missing Kora resolve data"))?;

        Ok(KoraResolveBankResponse {
            account_name: data.account_name,
            account_number: data.account_number,
        })
    }

    pub async fn list_banks(&self, country: &str) -> anyhow::Result<Vec<KoraBank>> {
        #[derive(Deserialize)]
        struct ApiBank {
            name: String,
            code: String,
            #[serde(default)]
            slug: Option<String>,
            #[serde(default)]
            country: Option<String>,
        }

        #[derive(Deserialize)]
        struct ApiResponse {
            status: bool,
            message: Option<String>,
            data: Option<Vec<ApiBank>>,
        }

        let country_code = if country.eq_ignore_ascii_case("nigeria") {
            "NG"
        } else {
            country
        };

        let response = self
            .client
            .get(format!(
                "{}/api/v1/misc/banks?countryCode={}",
                self.base_url.trim_end_matches('/'),
                country_code
            ))
            .bearer_auth(&self.secret_key)
            .send()
            .await
            .context("failed to list Kora banks")?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Kora banks failed ({}): {}", status, body));
        }

        let parsed: ApiResponse = serde_json::from_str(&body)
            .with_context(|| format!("invalid Kora banks response: {}", body))?;

        if !parsed.status {
            return Err(anyhow!(
                "Kora banks rejected: {}",
                parsed.message.unwrap_or_else(|| "unknown error".to_string())
            ));
        }

        Ok(parsed
            .data
            .unwrap_or_default()
            .into_iter()
            .map(|item| KoraBank {
                name: item.name,
                code: item.code,
                slug: item.slug,
                country: item.country,
            })
            .collect())
    }

    pub async fn disburse_bank_account(
        &self,
        reference: &str,
        amount_minor: i64,
        bank_code: &str,
        account_number: &str,
        account_name: &str,
        customer_email: &str,
        narration: &str,
    ) -> anyhow::Result<KoraDisburseResponse> {
        #[derive(Serialize)]
        struct Destination<'a> {
            #[serde(rename = "type")]
            destination_type: &'static str,
            amount: String,
            currency: &'static str,
            narration: &'a str,
            reference: &'a str,
            bank_account: BankAccount<'a>,
            customer: Customer<'a>,
        }

        #[derive(Serialize)]
        struct BankAccount<'a> {
            bank: &'a str,
            account: &'a str,
        }

        #[derive(Serialize)]
        struct Customer<'a> {
            name: &'a str,
            email: &'a str,
        }

        #[derive(Serialize)]
        struct RequestBody<'a> {
            reference: &'a str,
            destination: Destination<'a>,
        }

        let amount = format!("{:.2}", amount_minor as f64 / 100.0);

        let response = self
            .client
            .post(format!("{}/api/v1/transactions/disburse", self.base_url.trim_end_matches('/')))
            .bearer_auth(&self.secret_key)
            .json(&RequestBody {
                reference,
                destination: Destination {
                    destination_type: "bank_account",
                    amount,
                    currency: "NGN",
                    narration,
                    reference,
                    bank_account: BankAccount {
                        bank: bank_code,
                        account: account_number,
                    },
                    customer: Customer {
                        name: account_name,
                        email: customer_email,
                    },
                },
            })
            .send()
            .await
            .context("failed to disburse via Kora")?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Kora disburse failed ({}): {}", status, body));
        }

        let parsed: KoraDisburseResponse = serde_json::from_str(&body)
            .with_context(|| format!("invalid Kora disburse response: {}", body))?;

        if !parsed.status {
            return Err(anyhow!(
                "Kora disburse rejected: {}",
                parsed.message
                    .clone()
                    .unwrap_or_else(|| "unknown error".to_string())
            ));
        }

        Ok(parsed)
    }
}
