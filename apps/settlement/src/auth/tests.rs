use super::*;
use aws_lc_rs::signature::KeyPair;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::{encode, EncodingKey, Header};
use serde_json::{json, Value};
use std::sync::OnceLock;

const ENVIRONMENT: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUBJECT: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WALLET: &str = "11111111111111111111111111111111";

fn config() -> DynamicAuthConfig {
    DynamicAuthConfig::new(ENVIRONMENT, "https://clearsig.test,http://localhost:3000").unwrap()
}

// Generate a dedicated ephemeral signing key in memory. No real credentials or
// reusable private-key fixture is read, committed, or contacted by these tests.
fn test_key() -> &'static aws_lc_rs::rsa::KeyPair {
    static KEY: OnceLock<aws_lc_rs::rsa::KeyPair> = OnceLock::new();
    KEY.get_or_init(|| aws_lc_rs::rsa::KeyPair::generate(aws_lc_rs::rsa::KeySize::Rsa2048).unwrap())
}

fn signing_key() -> SigningKey {
    let public: aws_lc_rs::rsa::PublicKeyComponents<Vec<u8>> = test_key().public_key().into();
    SigningKey {
        kid: "test-only-key".to_string(),
        kty: "RSA".to_string(),
        alg: Some("RS256".to_string()),
        key_use: Some("sig".to_string()),
        key_ops: None,
        n: URL_SAFE_NO_PAD.encode(public.n),
        e: URL_SAFE_NO_PAD.encode(public.e),
    }
}

fn claims() -> Value {
    let now = jsonwebtoken::get_current_timestamp();
    json!({
        "iss": format!("app.dynamic.xyz/{ENVIRONMENT}"), "aud": "https://clearsig.test",
        "environment_id": ENVIRONMENT, "sub": SUBJECT, "iat": now - 1, "exp": now + 300,
        "verified_credentials": [{"format":"blockchain", "chain":"SOL", "address": WALLET}]
    })
}

fn token(payload: &Value) -> String {
    let header = json!({"alg":"RS256", "typ":"JWT", "kid":"test-only-key"});
    let input = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&header).unwrap()),
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(payload).unwrap())
    );
    let key = test_key();
    let mut signature = vec![0; key.public_modulus_len()];
    key.sign(
        &aws_lc_rs::signature::RSA_PKCS1_SHA256,
        &aws_lc_rs::rand::SystemRandom::new(),
        input.as_bytes(),
        &mut signature,
    )
    .unwrap();
    format!("{input}.{}", URL_SAFE_NO_PAD.encode(signature))
}

fn verify(payload: &Value) -> Result<AuthenticatedUser, AuthError> {
    verify_token(
        &config(),
        &token(payload),
        &signing_key().decoding_key("test-only-key").unwrap(),
    )
}

async fn authenticator() -> DynamicAuthenticator {
    let auth = DynamicAuthenticator::new(config()).unwrap();
    {
        let mut cache = auth.cache.lock().await;
        cache.keys = vec![signing_key()];
        cache.fetched_at = Some(Instant::now());
        cache.last_attempt = Some(Instant::now());
    }
    auth
}

fn headers(payload: &Value) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        "authorization",
        format!("Bearer {}", token(payload)).parse().unwrap(),
    );
    headers
}

#[test]
fn accepts_signed_subject_and_attested_wallet() {
    let user = verify(&claims()).unwrap();
    assert_eq!(
        user.user_id,
        Uuid::new_v5(&Uuid::parse_str(ENVIRONMENT).unwrap(), SUBJECT.as_bytes())
    );
    assert_eq!(user.require_wallet(ChainFamily::Solana, WALLET), Ok(()));
    assert_eq!(
        user.require_wallet(ChainFamily::Solana, "attacker-wallet"),
        Err(AuthError::WalletNotVerified)
    );
    assert_eq!(
        user.require_wallet(ChainFamily::Evm, WALLET),
        Err(AuthError::WalletNotVerified)
    );
}

#[test]
fn rejects_wrong_issuer_audience_environment_and_partial_auth() {
    for (name, value) in [
        ("iss", json!("https://attacker.test")),
        ("aud", json!("https://attacker.test")),
        (
            "aud",
            json!(["https://attacker.test", "http://untrusted.test"]),
        ),
        (
            "environment_id",
            json!("cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
        ),
        ("sub", json!("not-a-uuid")),
        ("scope", json!("read requiresAdditionalAuth")),
        ("scopes", json!(["requiresAdditionalAuth"])),
    ] {
        let mut payload = claims();
        payload[name] = value;
        assert_eq!(
            verify(&payload).unwrap_err(),
            AuthError::Unauthorized,
            "claim {name}"
        );
    }
}

#[test]
fn rejects_missing_required_claims() {
    for name in ["iss", "aud", "sub", "exp", "iat", "environment_id"] {
        let mut payload = claims();
        payload.as_object_mut().unwrap().remove(name);
        assert_eq!(
            verify(&payload).unwrap_err(),
            AuthError::Unauthorized,
            "claim {name}"
        );
    }
}

#[test]
fn rejects_expired_future_and_not_yet_valid_sessions() {
    let now = jsonwebtoken::get_current_timestamp();
    for (name, value) in [
        ("exp", now - 1),
        ("exp", now),
        ("iat", now + 120),
        ("nbf", now + 120),
    ] {
        let mut payload = claims();
        payload[name] = json!(value);
        assert_eq!(
            verify(&payload).unwrap_err(),
            AuthError::Unauthorized,
            "claim {name}"
        );
    }
}

#[test]
fn rejects_forged_claims_without_resigning() {
    let original = token(&claims());
    let mut payload = claims();
    payload["sub"] = json!("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    let parts: Vec<_> = original.split('.').collect();
    let forged = format!(
        "{}.{}.{}",
        parts[0],
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap()),
        parts[2]
    );
    assert_eq!(
        verify_token(
            &config(),
            &forged,
            &signing_key().decoding_key("test-only-key").unwrap()
        )
        .unwrap_err(),
        AuthError::Unauthorized
    );
}

#[tokio::test]
async fn ignores_self_asserted_ids_and_separates_authenticated_users() {
    let auth = authenticator().await;
    let mut request = headers(&claims());
    let attacker_id = Uuid::new_v4();
    request.insert("x-user-id", attacker_id.to_string().parse().unwrap());
    let user = auth.authenticate(&request).await.unwrap();
    assert_ne!(user.user_id, attacker_id);
    let mut other = claims();
    other["sub"] = json!("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    assert_ne!(
        user.user_id,
        auth.authenticate(&headers(&other)).await.unwrap().user_id
    );
    request.insert("x-wallet-address", WALLET.parse().unwrap());
    assert_eq!(
        auth.authenticate(&request).await.unwrap().user_id,
        user.user_id
    );
    request.insert("x-wallet-address", "some-other-wallet".parse().unwrap());
    assert_eq!(
        auth.authenticate(&request).await.unwrap_err(),
        AuthError::WalletNotVerified
    );
}

#[tokio::test]
async fn rejects_missing_forged_duplicate_and_oversized_bearer_credentials() {
    let auth = authenticator().await;
    let mut request = HeaderMap::new();
    request.insert("x-user-id", Uuid::new_v4().to_string().parse().unwrap());
    request.insert("x-wallet-address", WALLET.parse().unwrap());
    assert_eq!(
        auth.authenticate(&request).await.unwrap_err(),
        AuthError::Unauthorized
    );
    for value in [
        "Bearer unsigned".to_string(),
        "Basic abc".to_string(),
        format!("Bearer {}", "a".repeat(MAX_TOKEN_BYTES + 1)),
    ] {
        request.insert("authorization", value.parse().unwrap());
        assert_eq!(
            auth.authenticate(&request).await.unwrap_err(),
            AuthError::Unauthorized
        );
    }
    request = headers(&claims());
    request.append("authorization", "Bearer another-token".parse().unwrap());
    assert_eq!(
        auth.authenticate(&request).await.unwrap_err(),
        AuthError::Unauthorized
    );
}

#[tokio::test]
async fn rejects_algorithm_confusion_and_unknown_keys_without_refresh_storm() {
    let auth = authenticator().await;
    let mut request = HeaderMap::new();
    let forged = encode(
        &Header::new(Algorithm::HS256),
        &claims(),
        &EncodingKey::from_secret(b"not-a-trusted-key"),
    )
    .unwrap();
    request.insert("authorization", format!("Bearer {forged}").parse().unwrap());
    assert_eq!(
        auth.authenticate(&request).await.unwrap_err(),
        AuthError::Unauthorized
    );
    for kid in ["unknown-key-1", "unknown-key-2"] {
        assert!(matches!(
            auth.signing_key(kid).await,
            Err(AuthError::Unauthorized)
        ));
    }
    assert_eq!(auth.cache.lock().await.keys.len(), 1);
}

#[test]
fn only_accepts_signed_blockchain_credentials_and_exact_chain_addresses() {
    let mut payload = claims();
    payload["verified_credentials"][0]["format"] = json!("email");
    assert_eq!(
        verify(&payload)
            .unwrap()
            .require_wallet(ChainFamily::Solana, WALLET),
        Err(AuthError::WalletNotVerified)
    );
    payload["verified_credentials"] = json!([]);
    assert_eq!(
        verify(&payload)
            .unwrap()
            .require_wallet(ChainFamily::Solana, WALLET),
        Err(AuthError::WalletNotVerified)
    );
    payload["verified_credentials"] =
        json!([{"chain":"ETH", "address":"0xAb00000000000000000000000000000000000000"}]);
    let user = verify(&payload).unwrap();
    assert!(user
        .require_wallet(
            ChainFamily::Evm,
            "0xab00000000000000000000000000000000000000"
        )
        .is_ok());
    assert_eq!(
        user.require_wallet(
            ChainFamily::Zcash,
            "0xAb00000000000000000000000000000000000000"
        ),
        Err(AuthError::WalletNotVerified)
    );
}

#[test]
fn rejects_untrusted_signing_key_metadata() {
    for field in ["kty", "alg", "use"] {
        let mut key = signing_key();
        match field {
            "kty" => key.kty = "untrusted".to_string(),
            "alg" => key.alg = Some("untrusted".to_string()),
            _ => key.key_use = Some("untrusted".to_string()),
        }
        assert!(matches!(
            key.decoding_key("test-only-key"),
            Err(AuthError::Unauthorized)
        ));
    }
    let mut key = signing_key();
    key.key_ops = Some(vec!["encrypt".to_string()]);
    assert!(matches!(
        key.decoding_key("test-only-key"),
        Err(AuthError::Unauthorized)
    ));
}

#[test]
fn requires_explicit_trust_configuration_even_for_development() {
    assert!(DynamicAuthConfig::new("", "http://localhost:3000").is_err());
    for audience in [
        "",
        "*",
        "https://clearsig.test/path",
        "https://user@clearsig.test",
        "https://clearsig.test?aud=any",
    ] {
        assert!(DynamicAuthConfig::new(ENVIRONMENT, audience).is_err());
    }
}

// Exercise the actual HTTP handlers with an inert database/provider configuration.
// Every protected operation must fail before a database lookup, quote, payout,
// bank lookup, or chain RPC when only the old spoofable headers are supplied.
async fn handler_state() -> crate::app_state::AppState {
    let auth = authenticator().await;
    let config = crate::config::AppConfig {
        bind_addr: String::new(),
        database_url: "postgresql://unused:unused@127.0.0.1:1/auth-tests".to_string(),
        auth: auth.config.clone(),
        paystack_secret_key: "test-only-not-a-credential".to_string(),
        paystack_base_url: "https://unused.invalid".to_string(),
        paystack_webhook_secret: String::new(),
        kora_secret_key: String::new(),
        kora_base_url: "https://unused.invalid".to_string(),
        kora_webhook_secret: String::new(),
        ramp_payment_provider: "paystack".to_string(),
        worker_poll_interval_ms: 1,
        treasury_signer_backend: String::new(),
        evm_rpc_url: String::new(),
        treasury_evm_private_key: String::new(),
        treasury_evm_address: String::new(),
        solana_rpc_url: String::new(),
        treasury_sol_keypair_base58: String::new(),
        treasury_sol_keypair_path: String::new(),
        treasury_sol_address: String::new(),
        bitcoin_network: String::new(),
        bitcoin_esplora_url: String::new(),
        treasury_btc_private_key_wif: String::new(),
        treasury_btc_address: String::new(),
        bitcoin_fee_sats_per_vbyte: 1,
        zcash_rpc_url: String::new(),
        zcash_rpc_user: String::new(),
        zcash_rpc_password: String::new(),
        treasury_zec_address: String::new(),
        enable_treasury_liquidity_check: false,
        onramp_max_usd_cents: 1000,
        ramp_frontend_callback_url: None,
    };
    let pool = sqlx::postgres::PgPoolOptions::new()
        .acquire_timeout(Duration::from_millis(20))
        .connect_lazy(&config.database_url)
        .unwrap();
    let paystack_client = crate::paystack::client::PaystackClient::new(
        config.paystack_base_url.clone(),
        config.paystack_secret_key.clone(),
    );
    let payment_provider = crate::providers::build_payment_provider(&config).unwrap();
    let signer_engine = crate::signer::engine::SignerEngine::new(&config);
    crate::app_state::AppState {
        pool,
        config,
        auth,
        paystack_client,
        payment_provider,
        signer_engine,
        quote_provider: Arc::new(crate::services::quotes::UnavailableQuoteProvider),
    }
}

#[tokio::test]
async fn protected_handlers_reject_self_asserted_identity_before_side_effects() {
    use crate::{contracts::api::*, domain::types::IntentType, http::handlers};
    use axum::{
        extract::{Path, Query, State},
        Json,
    };
    let state = handler_state().await;
    let mut request = HeaderMap::new();
    request.insert("x-user-id", Uuid::new_v4().to_string().parse().unwrap());
    request.insert("x-wallet-address", WALLET.parse().unwrap());
    request.insert("idempotency-key", "some-key".parse().unwrap());
    let intent_id = Uuid::new_v4();
    let responses = [
        handlers::create_intent(
            State(state.clone()),
            request.clone(),
            Json(CreateRampIntentRequest {
                intent_type: IntentType::Onramp,
                chain_family: ChainFamily::Solana,
                chain_id: "devnet".to_string(),
                asset_symbol: "SOL".to_string(),
                asset_amount_minor: 1,
                usd_amount_cents: Some(100),
                destination_wallet: Some(WALLET.to_string()),
                source_wallet: None,
                bank_code: None,
                bank_account_number: None,
            }),
        )
        .await,
        handlers::get_intent(State(state.clone()), request.clone(), Path(intent_id)).await,
        handlers::prepare_signature(State(state.clone()), request.clone(), Path(intent_id)).await,
        handlers::initialize_payment(State(state.clone()), request.clone(), Path(intent_id)).await,
        handlers::resolve_bank(
            State(state.clone()),
            request.clone(),
            Query(BankResolveQuery {
                account_number: "0123456789".to_string(),
                bank_code: "001".to_string(),
            }),
        )
        .await,
        handlers::chain_confirm(
            State(state),
            request,
            Json(ChainTransferConfirmationRequest {
                intent_id,
                chain_family: ChainFamily::Solana,
                chain_id: "devnet".to_string(),
                tx_hash: "unverified".to_string(),
                event_index: 0,
                sender_wallet: WALLET.to_string(),
                asset_symbol: "SOL".to_string(),
                amount_minor: 1,
                confirmations: 1,
                finalized: true,
            }),
        )
        .await,
    ];
    for response in responses {
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
}

#[test]
fn scopes_same_subject_to_the_configured_environment() {
    let first = verify(&claims()).unwrap().user_id;
    let environment = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    let config = DynamicAuthConfig::new(environment, "https://clearsig.test").unwrap();
    let mut payload = claims();
    payload["environment_id"] = json!(environment);
    payload["iss"] = json!(format!("app.dynamic.xyz/{environment}"));
    let second = verify_token(
        &config,
        &token(&payload),
        &signing_key().decoding_key("test-only-key").unwrap(),
    )
    .unwrap()
    .user_id;
    assert_ne!(first, second);
}
