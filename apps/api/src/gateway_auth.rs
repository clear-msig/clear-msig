//! Direct HTTP ingress boundary for commands without an end-user signature.
//! Only the authenticated application gateway may forward these requests after
//! verifying the user's authority. This token is never sent to the browser.
use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use subtle::ConstantTimeEq;

pub(crate) const GATEWAY_HEADER: &str = "x-clearsig-backend-token";
const MIN_TOKEN_BYTES: usize = 32;
const MAX_TOKEN_BYTES: usize = 512;

pub(crate) struct GatewayAuth {
    token_hash: Option<[u8; 32]>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GatewayError {
    Unconfigured,
    Unauthorized,
}
impl IntoResponse for GatewayError {
    fn into_response(self) -> Response {
        let (status, message, kind) = match self {
            Self::Unconfigured => (
                StatusCode::SERVICE_UNAVAILABLE,
                "Backend gateway authentication is not configured",
                "gateway_unconfigured",
            ),
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "Authenticated backend gateway required",
                "gateway_unauthorized",
            ),
        };
        (
            status,
            Json(serde_json::json!({"error":message,"kind":kind})),
        )
            .into_response()
    }
}

impl GatewayAuth {
    pub(crate) fn from_environment() -> anyhow::Result<Self> {
        Self::from_token(std::env::var("CLEAR_MSIG_BACKEND_GATEWAY_TOKEN").ok())
    }
    fn from_token(token: Option<String>) -> anyhow::Result<Self> {
        let token = token.filter(|value| !value.is_empty());
        let token_hash = token
            .map(|value| {
                anyhow::ensure!(
                    (MIN_TOKEN_BYTES..=MAX_TOKEN_BYTES).contains(&value.len())
                        && value.bytes().all(|byte| byte.is_ascii_graphic()),
                    "CLEAR_MSIG_BACKEND_GATEWAY_TOKEN must contain 32-512 visible ASCII characters"
                );
                Ok(Sha256::digest(value.as_bytes()).into())
            })
            .transpose()?;
        Ok(Self { token_hash })
    }
    pub(crate) fn authorize(&self, headers: &HeaderMap) -> Result<(), GatewayError> {
        let expected = self.token_hash.as_ref().ok_or(GatewayError::Unconfigured)?;
        let mut values = headers.get_all(GATEWAY_HEADER).iter();
        let token = values.next().ok_or(GatewayError::Unauthorized)?.as_bytes();
        if values.next().is_some() || !(MIN_TOKEN_BYTES..=MAX_TOKEN_BYTES).contains(&token.len()) {
            return Err(GatewayError::Unauthorized);
        }
        let supplied: [u8; 32] = Sha256::digest(token).into();
        if bool::from(expected.ct_eq(&supplied)) {
            Ok(())
        } else {
            Err(GatewayError::Unauthorized)
        }
    }
}

pub(crate) async fn require_gateway(
    State(auth): State<Arc<GatewayAuth>>,
    request: Request,
    next: Next,
) -> Result<Response, GatewayError> {
    auth.authorize(request.headers())?;
    Ok(next.run(request).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    const TOKEN: &str = "test-only-gateway-token-not-a-real-secret-123";

    #[test]
    fn requires_configured_exact_single_gateway_token() {
        let auth = GatewayAuth::from_token(Some(TOKEN.into())).unwrap();
        let mut headers = HeaderMap::new();
        assert_eq!(auth.authorize(&headers), Err(GatewayError::Unauthorized));
        headers.insert(
            GATEWAY_HEADER,
            "test-only-gateway-token-not-a-real-secret-124"
                .parse()
                .unwrap(),
        );
        assert_eq!(auth.authorize(&headers), Err(GatewayError::Unauthorized));
        headers.insert(GATEWAY_HEADER, TOKEN.parse().unwrap());
        assert_eq!(auth.authorize(&headers), Ok(()));
        headers.append(GATEWAY_HEADER, TOKEN.parse().unwrap());
        assert_eq!(auth.authorize(&headers), Err(GatewayError::Unauthorized));
        assert_eq!(
            GatewayAuth::from_token(None).unwrap().authorize(&headers),
            Err(GatewayError::Unconfigured)
        );
        assert!(GatewayAuth::from_token(Some("short".into())).is_err());
        assert!(GatewayAuth::from_token(Some(format!(" {TOKEN}"))).is_err());
    }

    #[tokio::test]
    async fn actual_unsigned_routes_reject_direct_calls_before_side_effects() {
        let auth = Arc::new(GatewayAuth::from_token(Some(TOKEN.into())).unwrap());
        let state = crate::AppState {
            runner: Arc::new(crate::runner::build_runner().unwrap()),
            rate_limiter: Arc::new(crate::RateLimiter::new(
                std::time::Duration::from_secs(60),
                1,
            )),
            pro_store: Arc::new(crate::pro::ProStore::new(
                std::env::temp_dir().join(format!("clearsig-gateway-test-{}", std::process::id())),
            )),
        };
        let router = crate::wallet::router(auth.clone())
            .nest("/v1/pro", crate::pro::router(auth))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let client = reqwest::Client::new();
        for path in [
            "/wallets",
            "/wallets/team/chains/add",
            "/v1/pro/wallets/team/schedules",
            "/v1/pro/wallets/team/schedules/delete",
            "/v1/pro/wallets/team/escrows",
            "/v1/pro/wallets/team/escrows/delete",
            "/v1/pro/wallets/team/escrows/return-preview",
            "/v1/pro/wallets/team/escrows/release-preview",
            "/v1/pro/audit-events",
        ] {
            let response = client
                .post(format!("http://{address}{path}"))
                .header("content-type", "application/json")
                .body("{}")
                .send()
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                reqwest::StatusCode::UNAUTHORIZED,
                "{path}"
            );
        }
        for path in [
            "/v1/pro/wallets/team/schedules",
            "/v1/pro/wallets/team/escrows",
            "/v1/pro/wallets/team/audit-events",
        ] {
            let response = client
                .get(format!("http://{address}{path}"))
                .send()
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                reqwest::StatusCode::UNAUTHORIZED,
                "{path}"
            );
        }
        let health = client
            .get(format!("http://{address}/health"))
            .send()
            .await
            .unwrap();
        assert_eq!(health.status(), reqwest::StatusCode::OK);
        // Authorized ingress reaches normal validation, but an invalid body
        // must not invoke a real RPC or wallet creation in this test.
        let authorized = client
            .post(format!("http://{address}/wallets"))
            .header(GATEWAY_HEADER, TOKEN)
            .json(&serde_json::json!({}))
            .send()
            .await
            .unwrap();
        assert_eq!(
            authorized.status(),
            reqwest::StatusCode::UNPROCESSABLE_ENTITY
        );
        server.abort();
    }
}
