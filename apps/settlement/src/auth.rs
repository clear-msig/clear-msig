//! Dynamic session verification. The settlement service is the authentication
//! boundary, including when called directly without the Next.js proxy.
//!
//! Dynamic signs wallet ownership in `verified_credentials`; client-selected
//! UUIDs, wallet headers, JWT claims without a valid signature, and devnet are
//! never authentication. See https://docs.dynamic.xyz/authentication-methods/auth-tokens
//! and https://docs.dynamic.xyz/authentication-methods/how-to-validate-users-on-the-backend.
use axum::http::{HeaderMap, StatusCode};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::domain::types::ChainFamily;

const MAX_TOKEN_BYTES: usize = 32 * 1024;
const MAX_JWKS_BYTES: usize = 64 * 1024;
const KEY_TTL: Duration = Duration::from_secs(600);
const REFRESH_COOLDOWN: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub struct DynamicAuthConfig {
    environment_id: Uuid,
    audiences: Vec<String>,
}

impl DynamicAuthConfig {
    pub fn new(environment_id: &str, audiences: &str) -> anyhow::Result<Self> {
        let environment_id = Uuid::parse_str(environment_id.trim())
            .map_err(|_| anyhow::anyhow!("DYNAMIC_ENVIRONMENT_ID must be a UUID"))?;
        let audiences = audiences
            .split(',')
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(|value| {
                let url = reqwest::Url::parse(value)?;
                anyhow::ensure!(
                    matches!(url.scheme(), "https" | "http")
                        && url.host_str().is_some()
                        && url.username().is_empty()
                        && url.password().is_none()
                        && url.query().is_none()
                        && url.fragment().is_none()
                        && url.path() == "/",
                    "RAMP_AUTH_AUDIENCES must contain exact HTTP(S) origins"
                );
                Ok(url.origin().ascii_serialization())
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        anyhow::ensure!(
            !audiences.is_empty(),
            "RAMP_AUTH_AUDIENCES must not be empty"
        );
        Ok(Self {
            environment_id,
            audiences,
        })
    }

    pub fn from_env() -> anyhow::Result<Self> {
        let environment_id = std::env::var("DYNAMIC_ENVIRONMENT_ID")
            .or_else(|_| std::env::var("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID"))
            .map_err(|_| {
                anyhow::anyhow!("DYNAMIC_ENVIRONMENT_ID is required for settlement authentication")
            })?;
        let audiences = std::env::var("RAMP_AUTH_AUDIENCES").map_err(|_| {
            anyhow::anyhow!("RAMP_AUTH_AUDIENCES is required for settlement authentication")
        })?;
        Self::new(&environment_id, &audiences)
    }

    fn issuers(&self) -> [String; 4] {
        [
            format!("app.dynamic.xyz/{}", self.environment_id),
            format!("https://app.dynamic.xyz/{}", self.environment_id),
            format!("app.dynamicauth.com/{}", self.environment_id),
            format!("https://app.dynamicauth.com/{}", self.environment_id),
        ]
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthError {
    Unauthorized,
    WalletNotVerified,
    Unavailable,
}

impl AuthError {
    pub fn status(&self) -> StatusCode {
        match self {
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::WalletNotVerified => StatusCode::FORBIDDEN,
            Self::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        }
    }
    pub fn message(&self) -> &'static str {
        match self {
            Self::Unauthorized => "A valid signed-in Dynamic session is required",
            Self::WalletNotVerified => "Wallet ownership is not verified by this session",
            Self::Unavailable => "Session verification is temporarily unavailable",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    /// Environment-scoped Dynamic subject. Never reuse legacy caller-generated
    /// wallet UUIDs: historical unauthenticated records cannot establish ownership.
    pub user_id: Uuid,
    wallets: Vec<VerifiedCredential>,
}

impl AuthenticatedUser {
    pub fn require_wallet(&self, family: ChainFamily, address: &str) -> Result<(), AuthError> {
        if address.is_empty() || address.trim() != address {
            return Err(AuthError::WalletNotVerified);
        }
        let matches = self.wallets.iter().any(|credential| {
            // Some legacy signed Dynamic credentials omit format; a supported
            // chain plus address is still an attested blockchain credential.
            if credential
                .format
                .as_deref()
                .is_some_and(|format| format != "blockchain")
            {
                return false;
            }
            let chain = credential.chain.as_deref().unwrap_or_default();
            let chain_matches = match family {
                ChainFamily::Solana => matches!(chain, "SOL" | "solana"),
                ChainFamily::Evm => matches!(chain, "ETH" | "EVM" | "eip155"),
                ChainFamily::Bitcoin => matches!(chain, "BTC" | "bip122"),
                // Dynamic does not attest Zcash wallet ownership. Never invent
                // a trusted claim shape for an unsupported provider/chain.
                ChainFamily::Zcash => false,
            };
            chain_matches
                && credential.address.as_deref().is_some_and(|verified| {
                    if family == ChainFamily::Evm {
                        verified.len() == 42
                            && address.len() == 42
                            && verified.starts_with("0x")
                            && address.starts_with("0x")
                            && verified[2..].bytes().all(|c| c.is_ascii_hexdigit())
                            && address[2..].bytes().all(|c| c.is_ascii_hexdigit())
                            && verified.eq_ignore_ascii_case(address)
                    } else {
                        verified == address
                    }
                })
        });
        if matches {
            Ok(())
        } else {
            Err(AuthError::WalletNotVerified)
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
struct VerifiedCredential {
    format: Option<String>,
    chain: Option<String>,
    address: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DynamicClaims {
    sub: String,
    environment_id: String,
    exp: u64,
    iat: u64,
    #[serde(default)]
    scope: String,
    #[serde(default)]
    scopes: Vec<String>,
    #[serde(default)]
    verified_credentials: Vec<VerifiedCredential>,
}

#[derive(Clone)]
pub struct DynamicAuthenticator {
    config: DynamicAuthConfig,
    client: reqwest::Client,
    cache: Arc<Mutex<KeyCache>>,
}

#[derive(Default)]
struct KeyCache {
    keys: Vec<SigningKey>,
    fetched_at: Option<Instant>,
    last_attempt: Option<Instant>,
}

#[derive(Clone, Deserialize)]
struct SigningKey {
    kid: String,
    kty: String,
    #[serde(default)]
    alg: Option<String>,
    #[serde(default, rename = "use")]
    key_use: Option<String>,
    #[serde(default)]
    key_ops: Option<Vec<String>>,
    n: String,
    e: String,
}

#[derive(Deserialize)]
struct Jwks {
    keys: Vec<SigningKey>,
}

impl SigningKey {
    fn decoding_key(&self, kid: &str) -> Result<DecodingKey, AuthError> {
        if self.kid != kid
            || self.kty != "RSA"
            || self.alg.as_deref().is_some_and(|alg| alg != "RS256")
            || self.key_use.as_deref().is_some_and(|usage| usage != "sig")
            || self
                .key_ops
                .as_ref()
                .is_some_and(|ops| !ops.iter().any(|op| op == "verify"))
        {
            return Err(AuthError::Unauthorized);
        }
        DecodingKey::from_rsa_components(&self.n, &self.e).map_err(|_| AuthError::Unauthorized)
    }
}

impl DynamicAuthenticator {
    pub fn new(config: DynamicAuthConfig) -> anyhow::Result<Self> {
        Ok(Self {
            config,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(3))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            cache: Arc::new(Mutex::new(KeyCache::default())),
        })
    }

    pub async fn authenticate(&self, headers: &HeaderMap) -> Result<AuthenticatedUser, AuthError> {
        let token = bearer_token(headers)?;
        let header = decode_header(token).map_err(|_| AuthError::Unauthorized)?;
        if header.alg != Algorithm::RS256 {
            return Err(AuthError::Unauthorized);
        }
        let kid = header
            .kid
            .filter(|kid| !kid.is_empty() && kid.len() <= 256)
            .ok_or(AuthError::Unauthorized)?;
        // Ignore jku/x5u and every token-provided key. Keys only come from the
        // fixed official Dynamic JWKS URL for our configured environment.
        let key = self.signing_key(&kid).await?;
        let user = verify_token(&self.config, token, &key)?;
        if let Some(wallet) = headers.get("x-wallet-address") {
            user.require_wallet(
                ChainFamily::Solana,
                wallet.to_str().map_err(|_| AuthError::WalletNotVerified)?,
            )?;
        }
        Ok(user)
    }

    async fn signing_key(&self, kid: &str) -> Result<DecodingKey, AuthError> {
        // One bounded cache per authenticator. Unknown kid values cannot create
        // unbounded cache entries or trigger an upstream request on every call.
        let mut cache = self.cache.lock().await;
        if cache.fetched_at.is_some_and(|at| at.elapsed() < KEY_TTL) {
            if let Some(key) = cache.keys.iter().find(|key| key.kid == kid) {
                return key.decoding_key(kid);
            }
        }
        if cache
            .last_attempt
            .is_some_and(|at| at.elapsed() < REFRESH_COOLDOWN)
        {
            return Err(
                if cache.fetched_at.is_some_and(|at| at.elapsed() < KEY_TTL) {
                    AuthError::Unauthorized
                } else {
                    AuthError::Unavailable
                },
            );
        }
        cache.last_attempt = Some(Instant::now());
        for host in ["app.dynamic.xyz", "app.dynamicauth.com"] {
            let url = format!(
                "https://{host}/api/v0/sdk/{}/.well-known/jwks",
                self.config.environment_id
            );
            if let Ok(keys) = self.fetch_jwks(&url).await {
                cache.keys = keys;
                cache.fetched_at = Some(Instant::now());
                return cache
                    .keys
                    .iter()
                    .find(|key| key.kid == kid)
                    .ok_or(AuthError::Unauthorized)?
                    .decoding_key(kid);
            }
        }
        Err(AuthError::Unavailable)
    }

    async fn fetch_jwks(&self, url: &str) -> Result<Vec<SigningKey>, AuthError> {
        let mut response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| AuthError::Unavailable)?;
        if !response.status().is_success()
            || response
                .content_length()
                .is_some_and(|len| len > MAX_JWKS_BYTES as u64)
        {
            return Err(AuthError::Unavailable);
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| AuthError::Unavailable)? {
            if body.len() + chunk.len() > MAX_JWKS_BYTES {
                return Err(AuthError::Unavailable);
            }
            body.extend_from_slice(&chunk);
        }
        let jwks: Jwks = serde_json::from_slice(&body).map_err(|_| AuthError::Unavailable)?;
        if jwks.keys.is_empty() || jwks.keys.len() > 16 {
            return Err(AuthError::Unavailable);
        }
        Ok(jwks.keys)
    }
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, AuthError> {
    let mut values = headers.get_all("authorization").iter();
    let value = values
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or(AuthError::Unauthorized)?;
    if values.next().is_some() {
        return Err(AuthError::Unauthorized);
    }
    let (scheme, token) = value.split_once(' ').ok_or(AuthError::Unauthorized)?;
    if !scheme.eq_ignore_ascii_case("bearer")
        || token.is_empty()
        || token.len() > MAX_TOKEN_BYTES
        || token.chars().any(char::is_whitespace)
    {
        return Err(AuthError::Unauthorized);
    }
    Ok(token)
}

fn verify_token(
    config: &DynamicAuthConfig,
    token: &str,
    key: &DecodingKey,
) -> Result<AuthenticatedUser, AuthError> {
    let mut validation = Validation::new(Algorithm::RS256);
    validation.leeway = 0;
    validation.validate_nbf = true;
    validation.set_required_spec_claims(&["exp", "iat", "sub", "iss", "aud"]);
    validation.set_issuer(&config.issuers());
    validation.set_audience(&config.audiences);
    let claims = decode::<DynamicClaims>(token, key, &validation)
        .map_err(|_| AuthError::Unauthorized)?
        .claims;
    let now = jsonwebtoken::get_current_timestamp();
    if claims.environment_id != config.environment_id.to_string()
        || Uuid::parse_str(&claims.sub).is_err()
        || claims.exp <= now
        || claims.iat > now.saturating_add(60)
        || claims.iat >= claims.exp
        || claims
            .scope
            .split_whitespace()
            .chain(claims.scopes.iter().map(String::as_str))
            .any(|scope| scope == "requiresAdditionalAuth")
    {
        return Err(AuthError::Unauthorized);
    }
    Ok(AuthenticatedUser {
        user_id: Uuid::new_v5(&config.environment_id, claims.sub.as_bytes()),
        wallets: claims.verified_credentials,
    })
}

#[cfg(test)]
mod tests;
