#[derive(Debug, Clone)]
pub struct AppConfig {
    pub bind_addr: String,
    pub database_url: String,

    // ── Fiat providers ────────────────────────────────────────────
    pub paystack_secret_key: String,
    pub paystack_base_url: String,
    pub paystack_webhook_secret: String,
    pub kora_secret_key: String,
    pub kora_base_url: String,
    pub kora_webhook_secret: String,
    pub ramp_payment_provider: String,

    pub worker_poll_interval_ms: u64,
    pub treasury_signer_backend: String,

    // ── EVM (Ethereum + L2s) ─────────────────────────────────────
    pub evm_rpc_url: String,
    pub treasury_evm_private_key: String,
    pub treasury_evm_address: String,

    // ── Solana ───────────────────────────────────────────────────
    pub solana_rpc_url: String,
    /// Treasury Solana keypair as base58 (the standard Phantom export
    /// format — 64 bytes encoded base58). Either this OR
    /// `treasury_sol_keypair_path` must be set.
    pub treasury_sol_keypair_base58: String,
    /// Path to a `solana-keygen`-style JSON keypair file (an array of
    /// 64 bytes). Used when the operator prefers file-based key storage
    /// (e.g. Fly secrets mounted at /secrets/sol-keypair.json).
    pub treasury_sol_keypair_path: String,
    pub treasury_sol_address: String,

    // ── Bitcoin ──────────────────────────────────────────────────
    /// `mainnet` | `testnet` | `signet` | `regtest`
    pub bitcoin_network: String,
    /// Esplora HTTP base URL — e.g. `https://blockstream.info/api`
    /// (mainnet) or `https://blockstream.info/testnet/api` (testnet).
    /// We use Esplora rather than running a full bitcoind node so
    /// operators can deploy without a 500GB blockchain.
    pub bitcoin_esplora_url: String,
    /// Treasury Bitcoin private key in WIF format (the `5...`/`L...`/
    /// `K...`/`c...` form). The signer derives the P2WPKH address +
    /// pubkey from this.
    pub treasury_btc_private_key_wif: String,
    pub treasury_btc_address: String,
    /// Sat/vB to attach to outgoing txs. Esplora exposes a fee
    /// estimate endpoint; this acts as a floor.
    pub bitcoin_fee_sats_per_vbyte: u64,

    // ── Zcash (transparent only) ─────────────────────────────────
    /// JSON-RPC URL of a zcashd node (with the treasury's transparent
    /// key loaded into the wallet). We delegate construction +
    /// signing + broadcast to the node via `sendtoaddress` — operators
    /// already run zcashd for confirmation watching, and ZIP-243
    /// transparent signing has no first-class Rust crate today.
    pub zcash_rpc_url: String,
    pub zcash_rpc_user: String,
    pub zcash_rpc_password: String,
    pub treasury_zec_address: String,

    // ── Policy ───────────────────────────────────────────────────
    pub enable_treasury_liquidity_check: bool,
    pub onramp_max_usd_cents: i64,
    /// Optional Paystack callback URL sent with `transaction/initialize`
    /// so that after the user completes payment, Paystack redirects
    /// them back to the app.
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
            treasury_evm_private_key: std::env::var("TREASURY_EVM_PRIVATE_KEY").unwrap_or_default(),
            treasury_evm_address: std::env::var("TREASURY_EVM_ADDRESS").unwrap_or_default(),

            solana_rpc_url: std::env::var("SOLANA_RPC_URL")
                .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string()),
            treasury_sol_keypair_base58: std::env::var("TREASURY_SOL_KEYPAIR_BASE58")
                .unwrap_or_default(),
            treasury_sol_keypair_path: std::env::var("TREASURY_SOL_KEYPAIR_PATH")
                .unwrap_or_default(),
            treasury_sol_address: std::env::var("TREASURY_SOL_ADDRESS").unwrap_or_default(),

            bitcoin_network: std::env::var("BITCOIN_NETWORK")
                .unwrap_or_else(|_| "testnet".to_string())
                .trim()
                .to_ascii_lowercase(),
            bitcoin_esplora_url: std::env::var("BITCOIN_ESPLORA_URL")
                .unwrap_or_else(|_| "https://blockstream.info/testnet/api".to_string()),
            treasury_btc_private_key_wif: std::env::var("TREASURY_BTC_PRIVATE_KEY_WIF")
                .unwrap_or_default(),
            treasury_btc_address: std::env::var("TREASURY_BTC_ADDRESS").unwrap_or_default(),
            bitcoin_fee_sats_per_vbyte: std::env::var("BITCOIN_FEE_SATS_PER_VBYTE")
                .ok()
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(2),

            zcash_rpc_url: std::env::var("ZCASH_RPC_URL").unwrap_or_default(),
            zcash_rpc_user: std::env::var("ZCASH_RPC_USER").unwrap_or_default(),
            zcash_rpc_password: std::env::var("ZCASH_RPC_PASSWORD").unwrap_or_default(),
            treasury_zec_address: std::env::var("TREASURY_ZEC_ADDRESS").unwrap_or_default(),

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
