use crate::error::*;
use ed25519_dalek::{Signer, Verifier};

pub trait MessageSigner {
    fn pubkey(&self) -> [u8; 32];
    fn sign_message(&self, message: &[u8]) -> Result<[u8; 64]>;
}

/// Try the legacy offchain-wrapped bytes first, then the plain body.
/// This keeps old wallets and legacy proposals working while Phantom
/// migrates to the plain-body v2 path.
pub fn sign_message_with_fallback<S: MessageSigner + ?Sized>(
    signer: &S,
    wrapped: &[u8],
    plain: &[u8],
) -> Result<[u8; 64]> {
    match signer.sign_message(wrapped) {
        Ok(sig) => Ok(sig),
        Err(_) => signer.sign_message(plain),
    }
}

/// A signer whose signature was produced elsewhere — a browser wallet, a
/// trusted HSM, another process — and handed to the CLI verbatim.
///
/// Every `sign_message(msg)` call verifies `ed25519_verify(pubkey, msg,
/// signature)`. If the verification passes we return the provided
/// signature; if not we loudly refuse to submit. This catches both
/// directions of a byte-layout bug:
///   - the caller signed the wrong bytes (they get a clear error instead
///     of an opaque on-chain `InvalidArgument`), and
///   - the CLI internally rebuilt a different message than the caller
///     assumed (same error, immediate).
///
/// This is the foundation of the real multisig architecture: browser
/// wallets compute ed25519 signatures over the human-readable
/// offchain-wrapped message, the relayer forwards `(pubkey, signature)`
/// to the CLI, and every command path converges on this signer.
pub struct PreSignedMessageSigner {
    pubkey: [u8; 32],
    signature: [u8; 64],
    verifying_key: ed25519_dalek::VerifyingKey,
}

impl PreSignedMessageSigner {
    pub fn new(pubkey: [u8; 32], signature: [u8; 64]) -> Result<Self> {
        let verifying_key = ed25519_dalek::VerifyingKey::from_bytes(&pubkey)
            .map_err(|e| anyhow!("invalid ed25519 pubkey: {e}"))?;
        Ok(Self { pubkey, signature, verifying_key })
    }
}

impl MessageSigner for PreSignedMessageSigner {
    fn pubkey(&self) -> [u8; 32] {
        self.pubkey
    }

    fn sign_message(&self, message: &[u8]) -> Result<[u8; 64]> {
        let sig = ed25519_dalek::Signature::from_bytes(&self.signature);
        self.verifying_key.verify(message, &sig).map_err(|_| {
            anyhow!(
                "pre-signed signature does not verify against the message \
                 the CLI is about to submit ({} bytes). Either the caller \
                 computed the message differently, or the CLI's \
                 message-building logic drifted from the caller's. \
                 Refusing to submit.",
                message.len()
            )
        })?;
        Ok(self.signature)
    }
}

/// A signer that only knows its pubkey — never produces a signature.
/// Used in dry-run mode when the relayer has the user's pubkey but
/// the user hasn't been prompted yet, so no signature exists. The
/// pubkey alone is enough for the CLI's proposer / approver
/// validation; the actual signing work happens later in a separate
/// `--signer-pubkey` + `--signature` invocation.
///
/// Refusing to sign here is a safety property: if someone wires this
/// signer into a non-dry-run code path by mistake, we fail loudly
/// instead of silently producing garbage on chain.
pub struct PubkeyOnlyMessageSigner {
    pubkey: [u8; 32],
}

impl PubkeyOnlyMessageSigner {
    pub fn new(pubkey: [u8; 32]) -> Self {
        Self { pubkey }
    }
}

impl MessageSigner for PubkeyOnlyMessageSigner {
    fn pubkey(&self) -> [u8; 32] {
        self.pubkey
    }

    fn sign_message(&self, _message: &[u8]) -> Result<[u8; 64]> {
        Err(anyhow!(
            "PubkeyOnlyMessageSigner cannot sign — this signer is only \
             valid in --dry-run mode for proposer/approver validation. \
             Re-invoke with --signer-pubkey + --signature to actually \
             submit."
        ))
    }
}

pub struct KeypairMessageSigner {
    key: ed25519_dalek::SigningKey,
}

impl KeypairMessageSigner {
    pub fn from_file(path: &str) -> Result<Self> {
        let expanded = shellexpand::tilde(path).to_string();
        let data = std::fs::read_to_string(&expanded)
            .with_context(|| format!("reading signer keypair from {expanded}"))?;
        let bytes: Vec<u8> = serde_json::from_str(&data)
            .with_context(|| "parsing signer keypair JSON")?;
        // Solana keypair JSON is 64 bytes: [secret_key(32) ++ public_key(32)]
        if bytes.len() < 32 {
            return Err(anyhow!("keypair too short"));
        }
        let secret: [u8; 32] = bytes[..32].try_into()?;
        let key = ed25519_dalek::SigningKey::from_bytes(&secret);
        Ok(Self { key })
    }
}

impl MessageSigner for KeypairMessageSigner {
    fn pubkey(&self) -> [u8; 32] {
        self.key.verifying_key().to_bytes()
    }

    fn sign_message(&self, message: &[u8]) -> Result<[u8; 64]> {
        Ok(self.key.sign(message).to_bytes())
    }
}

pub struct LedgerMessageSigner {
    wallet_manager: std::rc::Rc<solana_remote_wallet::remote_wallet::RemoteWalletManager>,
    derivation_path: solana_derivation_path::DerivationPath,
    cached_pubkey: [u8; 32],
}

impl LedgerMessageSigner {
    pub fn new(ledger_account: Option<u32>) -> Result<Self> {
        let wallet_manager = solana_remote_wallet::remote_wallet::initialize_wallet_manager()
            .map_err(|e| anyhow!("failed to initialize wallet manager: {e}"))?;

        wallet_manager.update_devices()
            .map_err(|e| anyhow!("failed to detect Ledger devices: {e}"))?;

        let devices = wallet_manager.list_devices();
        if devices.is_empty() {
            return Err(anyhow!("no Ledger device found — is it connected and unlocked with the Solana app open?"));
        }

        let derivation_path = solana_derivation_path::DerivationPath::new_bip44(ledger_account, None);

        let locator = solana_remote_wallet::locator::Locator {
            manufacturer: solana_remote_wallet::locator::Manufacturer::Ledger,
            pubkey: None,
        };

        let keypair = solana_remote_wallet::remote_keypair::generate_remote_keypair(
            locator,
            derivation_path.clone(),
            &wallet_manager,
            false,
            "signer",
        ).map_err(|e| anyhow!("failed to connect to Ledger: {e}"))?;

        let cached_pubkey = solana_signer::Signer::pubkey(&keypair).to_bytes();

        Ok(Self {
            wallet_manager,
            derivation_path,
            cached_pubkey,
        })
    }
}

impl MessageSigner for LedgerMessageSigner {
    fn pubkey(&self) -> [u8; 32] {
        self.cached_pubkey
    }

    fn sign_message(&self, message: &[u8]) -> Result<[u8; 64]> {
        let locator = solana_remote_wallet::locator::Locator {
            manufacturer: solana_remote_wallet::locator::Manufacturer::Ledger,
            pubkey: None,
        };

        let keypair = solana_remote_wallet::remote_keypair::generate_remote_keypair(
            locator,
            self.derivation_path.clone(),
            &self.wallet_manager,
            false,
            "signer",
        ).map_err(|e| anyhow!("failed to connect to Ledger: {e}"))?;

        let signature = solana_signer::Signer::try_sign_message(&keypair, message)
            .map_err(|e| anyhow!("Ledger signing failed: {e}"))?;

        Ok(signature.into())
    }
}
