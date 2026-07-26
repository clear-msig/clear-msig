use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct PaystackClient {
    http: reqwest::Client,
    base_url: String,
    secret_key: String,
}

// ── Transfer (offramp payout) ─────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct InitiateTransferRequest {
    pub amount_minor: i64,
    pub recipient_code: String,
    pub reason: String,
    pub reference: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct PaystackTransferResponse {
    pub status: bool,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

// ── Transaction initialisation (onramp checkout) ─────────────────────────────

#[derive(Debug, Deserialize)]
pub struct InitializeTransactionData {
    pub authorization_url: String,
    pub access_code: String,
    pub reference: String,
}

#[derive(Debug, Deserialize)]
pub struct InitializeTransactionResponse {
    pub status: bool,
    pub message: String,
    pub data: Option<InitializeTransactionData>,
}

// ── Transaction verification ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct VerifyTransactionData {
    pub status: String, // "success", "abandoned", "failed", etc.
    pub reference: String,
    pub amount: i64,
    pub authorization_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VerifyTransactionResponse {
    pub status: bool,
    pub message: String,
    pub data: Option<VerifyTransactionData>,
}

// ── Bank account name resolution ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ResolveAccountData {
    pub account_name: String,
    pub account_number: String,
}

#[derive(Debug, Deserialize)]
pub struct ResolveAccountResponse {
    pub status: bool,
    pub message: String,
    pub data: Option<ResolveAccountData>,
}

// ── Bank listing ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PaystackBank {
    pub id: Option<i64>,
    pub name: String,
    pub code: String,
    pub slug: Option<String>,
    pub longcode: Option<String>,
    pub country: Option<String>,
    pub currency: Option<String>,
    #[serde(rename = "type")]
    pub bank_type: Option<String>,
    pub active: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ListBanksResponse {
    status: bool,
    message: String,
    data: Option<Vec<PaystackBank>>,
}

// ── Transfer recipient creation (offramp recipient_code) ─────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateRecipientData {
    pub recipient_code: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateRecipientResponse {
    pub status: bool,
    pub message: String,
    pub data: Option<CreateRecipientData>,
}

impl PaystackClient {
    pub fn new(base_url: String, secret_key: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url,
            secret_key,
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn base(&self) -> &str {
        self.base_url.trim_end_matches('/')
    }

    fn is_configured(&self) -> bool {
        !self.secret_key.is_empty()
    }

    // ── Offramp: initiate a bank transfer ─────────────────────────────────────

    pub async fn initiate_transfer(
        &self,
        request: &InitiateTransferRequest,
    ) -> anyhow::Result<PaystackTransferResponse> {
        if !self.is_configured() {
            return Ok(PaystackTransferResponse {
                status: true,
                message: "PAYSTACK_SECRET_KEY not configured; transfer request skipped".to_string(),
                data: None,
            });
        }

        let payload = serde_json::json!({
            "source": "balance",
            "amount": request.amount_minor,
            "recipient": request.recipient_code,
            "reason": request.reason,
            "reference": request.reference,
        });

        let response = self
            .http
            .post(format!("{}/transfer", self.base()))
            .bearer_auth(&self.secret_key)
            .json(&payload)
            .send()
            .await?;

        let parsed = response.json::<PaystackTransferResponse>().await?;
        Ok(parsed)
    }

    // ── Onramp: initialise a Paystack transaction (returns checkout URL) ───────

    /// Calls `POST /transaction/initialize` and returns the hosted checkout URL,
    /// access code, and the Paystack-assigned reference.  The reference **must**
    /// be stored in `ramp_intents.metadata ->> 'paystack_reference'` so that the
    /// `charge.success` webhook can later advance the intent to `payment_confirmed`.
    pub async fn initialize_transaction(
        &self,
        email: &str,
        amount_ngn_minor: i64,
        reference: &str,
        callback_url: Option<&str>,
    ) -> anyhow::Result<InitializeTransactionData> {
        if !self.is_configured() {
            anyhow::bail!("PAYSTACK_SECRET_KEY is not configured");
        }

        let mut payload = serde_json::json!({
            "email": email,
            "amount": amount_ngn_minor,
            "reference": reference,
            "currency": "NGN",
        });

        if let Some(cb) = callback_url {
            payload["callback_url"] = serde_json::Value::String(cb.to_string());
        }

        let response = self
            .http
            .post(format!("{}/transaction/initialize", self.base()))
            .bearer_auth(&self.secret_key)
            .json(&payload)
            .send()
            .await?;

        let parsed = response.json::<InitializeTransactionResponse>().await?;

        if !parsed.status {
            anyhow::bail!("Paystack initialize_transaction failed: {}", parsed.message);
        }

        parsed
            .data
            .ok_or_else(|| anyhow::anyhow!("Paystack returned no data for initialize_transaction"))
    }

    // ── Onramp: verify a Paystack transaction by reference ───────────────────

    /// Calls `GET /transaction/verify/:reference` and returns the transaction
    /// status.  Used to check if a previously-initialised checkout is still
    /// open (pending) or has been abandoned / succeeded / failed.
    pub async fn verify_transaction(
        &self,
        reference: &str,
    ) -> anyhow::Result<VerifyTransactionData> {
        if !self.is_configured() {
            anyhow::bail!("PAYSTACK_SECRET_KEY is not configured");
        }

        let url = format!("{}/transaction/verify/{}", self.base(), reference);

        let response = self
            .http
            .get(&url)
            .bearer_auth(&self.secret_key)
            .send()
            .await?;

        let parsed = response.json::<VerifyTransactionResponse>().await?;

        if !parsed.status {
            anyhow::bail!("Paystack verify_transaction failed: {}", parsed.message);
        }

        parsed
            .data
            .ok_or_else(|| anyhow::anyhow!("Paystack returned no data for verify_transaction"))
    }

    // ── Bank account name resolution ──────────────────────────────────────────

    /// Calls `GET /bank/resolve?account_number=&bank_code=` and returns the
    /// resolved account name.  Used before creating an offramp intent so the
    /// user can confirm they are sending money to the right person.
    pub async fn resolve_account_number(
        &self,
        account_number: &str,
        bank_code: &str,
    ) -> anyhow::Result<ResolveAccountData> {
        if !self.is_configured() {
            anyhow::bail!("PAYSTACK_SECRET_KEY is not configured");
        }

        let url = format!(
            "{}/bank/resolve?account_number={}&bank_code={}",
            self.base(),
            account_number,
            bank_code
        );

        let response = self
            .http
            .get(&url)
            .bearer_auth(&self.secret_key)
            .send()
            .await?;

        let parsed = response.json::<ResolveAccountResponse>().await?;

        if !parsed.status {
            anyhow::bail!("Paystack resolve_account_number failed: {}", parsed.message);
        }

        parsed
            .data
            .ok_or_else(|| anyhow::anyhow!("Paystack returned no data for resolve_account_number"))
    }

    // ── Offramp: create a transfer recipient to obtain recipient_code ─────────

    /// Calls `POST /transferrecipient` and returns the `recipient_code` that
    /// must be stored in `ramp_bank_snapshots.recipient_code` for `payout_dispatch`
    /// to successfully initiate a bank transfer.
    pub async fn create_transfer_recipient(
        &self,
        name: &str,
        account_number: &str,
        bank_code: &str,
    ) -> anyhow::Result<String> {
        if !self.is_configured() {
            // Return a sentinel so that create_intent does not fail in dev
            return Ok(String::new());
        }

        let payload = serde_json::json!({
            "type": "nuban",
            "name": name,
            "account_number": account_number,
            "bank_code": bank_code,
            "currency": "NGN",
        });

        let response = self
            .http
            .post(format!("{}/transferrecipient", self.base()))
            .bearer_auth(&self.secret_key)
            .json(&payload)
            .send()
            .await?;

        let parsed = response.json::<CreateRecipientResponse>().await?;

        if !parsed.status {
            anyhow::bail!(
                "Paystack create_transfer_recipient failed: {}",
                parsed.message
            );
        }

        parsed.data.map(|d| d.recipient_code).ok_or_else(|| {
            anyhow::anyhow!("Paystack returned no data for create_transfer_recipient")
        })
    }

    // ── List supported banks ──────────────────────────────────────────────────

    /// Calls `GET /bank?country=nigeria&perPage=100` and returns the list of
    /// banks that Paystack supports for NGN transfers.
    pub async fn list_banks(&self, country: &str) -> anyhow::Result<Vec<PaystackBank>> {
        if !self.is_configured() {
            anyhow::bail!("PAYSTACK_SECRET_KEY is not configured");
        }

        // Paystack paginates at 50 by default; request 200 to get all in one shot.
        let url = format!(
            "{}/bank?country={}&perPage=200&use_cursor=false",
            self.base(),
            country
        );

        let response = self
            .http
            .get(&url)
            .bearer_auth(&self.secret_key)
            .send()
            .await?;

        let parsed = response.json::<ListBanksResponse>().await?;

        if !parsed.status {
            anyhow::bail!("Paystack list_banks failed: {}", parsed.message);
        }

        Ok(parsed.data.unwrap_or_default())
    }
}
