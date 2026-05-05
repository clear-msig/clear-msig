#[derive(Debug, Clone)]
pub struct AppConfig {
    pub bind_addr: String,
    pub database_url: String,
    pub paystack_secret_key: String,
    pub paystack_base_url: String,
    pub paystack_webhook_secret: String,
    pub kora_secret_key: String,
    pub kora_base_url: String,
    pub kora_webhook_secret: String,
    pub ramp_payment_provider: String,
    pub worker_poll_interval_ms: u64,
    pub treasury_signer_backend: String,
    pub evm_rpc_url: String,
    pub sui_rpc_url: String,
    pub treasury_evm_private_key: String,
    pub treasury_sui_private_key_base64: String,
    pub treasury_evm_address: String,
    pub treasury_sui_address: String,
    pub enable_treasury_liquidity_check: bool,
    pub onramp_max_usd_cents: i64,
    /// Optional Paystack callback URL sent with `transaction/initialize` so that
    /// after the user completes payment, Paystack redirects them back to the app.
    pub ramp_frontend_callback_url: Option<String>,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL_DIRECT")
            .or_else(|_| std::env::var("DATABASE_URL"))
            .map_err(|_| anyhow::anyhow!("DATABASE_URL or DATABASE_URL_DIRECT is required"))?;

        let ramp_payment_provider = std::env::var("RAMP_PAYMENT_PROVIDER")
            .unwrap_or_else(|_| "paystack".to_string())
            .trim()
            .to_ascii_lowercase();

        if ramp_payment_provider != "paystack" && ramp_payment_provider != "kora" {
            anyhow::bail!(
                "Invalid RAMP_PAYMENT_PROVIDER='{}'. Allowed values: paystack | kora",
                ramp_payment_provider
            );
        }

        Ok(Self {
            bind_addr: std::env::var("RAMP_BIND_ADDR")
                .unwrap_or_else(|_| "0.0.0.0:8088".to_string()),
            database_url,
            paystack_secret_key: std::env::var("PAYSTACK_SECRET_KEY").unwrap_or_default(),
            paystack_base_url: std::env::var("PAYSTACK_BASE_URL")
                .unwrap_or_else(|_| "https://api.paystack.co".to_string()),
            paystack_webhook_secret: std::env::var("PAYSTACK_WEBHOOK_SECRET")
                .or_else(|_| std::env::var("PAYSTACK_SECRET_KEY"))
                .unwrap_or_default(),
            kora_secret_key: std::env::var("KORA_SECRET_KEY").unwrap_or_default(),
            kora_base_url: std::env::var("KORA_BASE_URL")
                .unwrap_or_else(|_| "https://api.korapay.com/merchant".to_string()),
            kora_webhook_secret: std::env::var("KORA_WEBHOOK_SECRET")
                .or_else(|_| std::env::var("KORA_SECRET_KEY"))
                .unwrap_or_default(),
            ramp_payment_provider,
            worker_poll_interval_ms: std::env::var("RAMP_WORKER_POLL_INTERVAL_MS")
                .ok()
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(2000),
            treasury_signer_backend: std::env::var("TREASURY_SIGNER_BACKEND")
                .unwrap_or_else(|_| "raw".to_string()),
            evm_rpc_url: std::env::var("EVM_RPC_URL").unwrap_or_default(),
            sui_rpc_url: std::env::var("SUI_RPC_URL").unwrap_or_default(),
            treasury_evm_private_key: std::env::var("TREASURY_EVM_PRIVATE_KEY")
                .unwrap_or_default(),
            treasury_sui_private_key_base64: std::env::var("TREASURY_SUI_PRIVATE_KEY_BASE64")
                .unwrap_or_default(),
            treasury_evm_address: std::env::var("TREASURY_EVM_ADDRESS").unwrap_or_default(),
            treasury_sui_address: std::env::var("TREASURY_SUI_ADDRESS").unwrap_or_default(),
            enable_treasury_liquidity_check: std::env::var("RAMP_ENABLE_TREASURY_LIQUIDITY_CHECK")
                .ok()
                .map(|value| {
                    matches!(
                        value.trim().to_ascii_lowercase().as_str(),
                        "1" | "true" | "yes" | "on"
                    )
                })
                .unwrap_or(false),
            onramp_max_usd_cents: std::env::var("RAMP_ONRAMP_MAX_USD_CENTS")
                .ok()
                .and_then(|value| value.parse::<i64>().ok())
                .filter(|value| *value > 0)
                .unwrap_or(1000),
            ramp_frontend_callback_url: std::env::var("RAMP_FRONTEND_CALLBACK_URL").ok(),
        })
    }
}
