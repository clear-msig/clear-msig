use crate::error::*;
use crate::signing::{
    KeypairMessageSigner, MessageFlavor, MessageSigner, PreSignedMessageSigner,
    PubkeyOnlyMessageSigner,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Every global CLI flag, bundled for propagation from `main.rs` into
/// `load_config`. Keeps the function signature from exploding as more
/// cross-cutting flags (pre-signed mode, dry-run, …) land.
pub struct CliGlobals {
    pub url: Option<String>,
    pub keypair: Option<String>,
    pub signer: Option<String>,
    pub signer_ledger: bool,
    pub ledger_account: Option<u32>,
    /// Pre-signed mode inputs. `signer_pubkey` + `signature` are required
    /// together; `params_data` is separate because some commands (approve /
    /// cancel) read params from the on-chain Proposal account instead of
    /// taking them from the caller.
    pub signer_pubkey: Option<String>,
    pub signature: Option<String>,
    pub params_data: Option<String>,
    pub message_flavor: Option<String>,
    pub signed_message: Option<String>,
    /// Dry-run: emit a JSON descriptor of what would be signed and exit.
    pub dry_run: bool,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct PersistedConfig {
    #[serde(default = "default_rpc_url")]
    pub rpc_url: String,
    #[serde(default = "default_payer_path")]
    pub payer: String,
    #[serde(default = "default_payer_path")]
    pub signer: String,
    #[serde(default)]
    pub signer_type: SignerType,
    #[serde(default = "default_expiry_seconds")]
    pub expiry_seconds: u64,
    #[serde(default)]
    pub ledger_account: Option<u32>,
}

/// Default signed-message expiry window. The flow is prepare →
/// (user reads + opens wallet + signs) → submit → CLI sends → chain
/// confirms. Five minutes was tight: a user pausing on the confirm
/// screen, or a slow wallet popup, easily ate the buffer and the
/// chain rejected with WalletError::Expired (0x1777). 30 minutes is
/// safely above any realistic human-pause budget without being so
/// long that a stolen signature is dangerous to leave outstanding.
fn default_expiry_seconds() -> u64 {
    1800
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "snake_case")]
pub enum SignerType {
    #[default]
    Keypair,
    Ledger,
}

fn default_rpc_url() -> String {
    "http://localhost:8899".to_string()
}

fn default_payer_path() -> String {
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".config/solana/id.json")
        .to_string_lossy()
        .to_string()
}

pub fn config_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".config/clear-msig/config.json")
}

impl PersistedConfig {
    pub fn load() -> Self {
        let path = config_path();
        if path.exists() {
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_else(|_| Self::fresh())
        } else {
            // File missing → route through the deserializer with an
            // empty object so every `#[serde(default = "fn")]` hint
            // fires (esp. expiry_seconds; the derived `Default` for a
            // u64 is 0, which would silently turn every signed
            // message into "expired the moment it's prepared").
            Self::fresh()
        }
    }

    /// Defaults that honor the serde `#[serde(default = ...)]` hints.
    /// `Self::default()` (auto-derived) does NOT — it just returns
    /// each field's type-level default (0 for u64, "" for String).
    fn fresh() -> Self {
        serde_json::from_str("{}").expect("PersistedConfig serde defaults are sound")
    }

    pub fn save(&self) -> Result<()> {
        let path = config_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, content)?;
        Ok(())
    }
}

/// Loaded runtime config used by every command handler.
pub struct RuntimeConfig {
    pub rpc_url: String,
    pub payer: solana_keypair::Keypair,
    pub signer: Box<dyn MessageSigner>,
    pub expiry_seconds: u64,
    /// Pre-built `params_data` bytes supplied via `--params-data`.
    /// Commands that normally build this value from `--param key=value`
    /// or from a JSON file MUST honour this override when present, so
    /// that whatever the caller signed is what actually lands in the
    /// instruction.
    pub params_data_override: Option<Vec<u8>>,
    /// Exact readable ClearSign typed vote bytes supplied via
    /// `--signed-message` in browser pre-signed mode.
    pub signed_message_override: Option<Vec<u8>>,
    /// True when `--dry-run` was passed. Handlers that build a signable
    /// message must emit `output::print_dry_run(...)` and early-return
    /// before calling the signer or RPC.
    pub dry_run: bool,
    /// True when pre-signed mode is active. Handlers that have a
    /// "signer must be a wallet member" check can use this to emit a
    /// clearer error if the pre-signed pubkey isn't in the proposer /
    /// approver list of the intent.
    pub pre_signed: bool,
    /// Exact message byte layout the browser says it signed. Only set
    /// in pre-signed mode by newer frontends.
    pub message_flavor: Option<MessageFlavor>,
}

impl RuntimeConfig {
    /// Compute the default expiry timestamp (now + configured expiry_seconds).
    pub fn default_expiry(&self) -> i64 {
        chrono::Utc::now().timestamp() + self.expiry_seconds as i64
    }
}

pub fn load_config(globals: &CliGlobals) -> Result<RuntimeConfig> {
    let persisted = PersistedConfig::load();

    let rpc_url = globals.url.clone().unwrap_or(persisted.rpc_url);

    let payer_path = globals.keypair.clone().unwrap_or(persisted.payer);
    let payer = load_keypair(&payer_path)
        .with_context(|| format!("loading payer keypair from {payer_path}"))?;

    // Pre-signed mode: derive the signer from `--signer-pubkey` +
    // `--signature`. Must be all-or-nothing — any asymmetry is a relayer
    // bug and we surface it loudly instead of silently falling back.
    let signer: Box<dyn MessageSigner> = match (&globals.signer_pubkey, &globals.signature) {
        (Some(pk_b58), Some(sig_hex)) => {
            let pk_bytes = bs58::decode(pk_b58)
                .into_vec()
                .with_context(|| format!("invalid --signer-pubkey (expected base58): {pk_b58}"))?;
            if pk_bytes.len() != 32 {
                return Err(anyhow!(
                    "--signer-pubkey must decode to 32 bytes, got {}",
                    pk_bytes.len()
                ));
            }
            let mut pubkey = [0u8; 32];
            pubkey.copy_from_slice(&pk_bytes);

            let sig_bytes = decode_hex(sig_hex)
                .with_context(|| format!("invalid --signature hex: {sig_hex}"))?;
            if sig_bytes.len() != 64 {
                return Err(anyhow!(
                    "--signature must decode to 64 bytes, got {}",
                    sig_bytes.len()
                ));
            }
            let mut signature = [0u8; 64];
            signature.copy_from_slice(&sig_bytes);

            Box::new(PreSignedMessageSigner::new(pubkey, signature)?)
        }
        (Some(pk_b58), None) if globals.dry_run => {
            // Dry-run with just the pubkey — relayer is asking "what
            // would this user need to sign?" before prompting them.
            // We don't need a signature yet; the pubkey is enough for
            // the CLI's proposer / approver validation checks.
            let pk_bytes = bs58::decode(pk_b58)
                .into_vec()
                .with_context(|| format!("invalid --signer-pubkey (expected base58): {pk_b58}"))?;
            if pk_bytes.len() != 32 {
                return Err(anyhow!(
                    "--signer-pubkey must decode to 32 bytes, got {}",
                    pk_bytes.len()
                ));
            }
            let mut pubkey = [0u8; 32];
            pubkey.copy_from_slice(&pk_bytes);
            Box::new(PubkeyOnlyMessageSigner::new(pubkey))
        }
        (Some(_), None) | (None, Some(_)) => {
            return Err(anyhow!(
                "--signer-pubkey and --signature must be supplied together \
                 outside of --dry-run mode (pre-signed mode is all-or-nothing)"
            ));
        }
        (None, None) => {
            let ledger_account = globals.ledger_account.or(persisted.ledger_account);
            let use_ledger =
                globals.signer_ledger || matches!(persisted.signer_type, SignerType::Ledger);
            if use_ledger {
                Box::new(
                    crate::signing::LedgerMessageSigner::new(ledger_account)
                        .context("connecting to Ledger")?,
                )
            } else {
                let signer_path = globals.signer.clone().unwrap_or(persisted.signer);
                Box::new(
                    KeypairMessageSigner::from_file(&signer_path)
                        .with_context(|| format!("loading signer keypair from {signer_path}"))?,
                )
            }
        }
    };

    let params_data_override = match &globals.params_data {
        Some(hex_str) => {
            Some(decode_hex(hex_str).with_context(|| "invalid --params-data hex".to_string())?)
        }
        None => None,
    };
    let signed_message_override = match &globals.signed_message {
        Some(hex_str) => {
            Some(decode_hex(hex_str).with_context(|| "invalid --signed-message hex".to_string())?)
        }
        None => None,
    };
    let message_flavor = match &globals.message_flavor {
        Some(value) => Some(value.parse::<MessageFlavor>()?),
        None => None,
    };

    Ok(RuntimeConfig {
        rpc_url,
        payer,
        signer,
        expiry_seconds: persisted.expiry_seconds,
        params_data_override,
        signed_message_override,
        dry_run: globals.dry_run,
        pre_signed: globals.signer_pubkey.is_some(),
        message_flavor,
    })
}

/// Decode a hex string, tolerant of a `0x` prefix and whitespace.
fn decode_hex(s: &str) -> Result<Vec<u8>> {
    let s = s.trim();
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.len() % 2 != 0 {
        return Err(anyhow!("hex string has odd length"));
    }
    (0..s.len() / 2)
        .map(|i| {
            u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).map_err(|e| anyhow!("invalid hex: {e}"))
        })
        .collect()
}

pub fn load_keypair_public(path: &str) -> Result<String> {
    let kp = load_keypair(path)?;
    Ok(bs58::encode(solana_signer::Signer::pubkey(&kp).to_bytes()).into_string())
}

fn load_keypair(path: &str) -> Result<solana_keypair::Keypair> {
    let expanded = shellexpand::tilde(path).to_string();
    let data = std::fs::read_to_string(&expanded)
        .with_context(|| format!("reading keypair from {expanded}"))?;
    let bytes: Vec<u8> = serde_json::from_str(&data).with_context(|| "parsing keypair JSON")?;
    solana_keypair::Keypair::try_from(bytes.as_slice()).map_err(|e| anyhow!("invalid keypair: {e}"))
}
