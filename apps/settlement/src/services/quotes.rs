//! Executable pricing is a server-owned port. Display prices and client USD
//! estimates cannot authorize treasury quantities or bank payouts.
use crate::{
    contracts::api::CreateRampIntentRequest,
    domain::types::{ChainFamily, IntentType},
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutableQuote {
    pub provider: String,
    pub provider_quote_id: String,
    pub request_hash: String,
    pub chain_family: ChainFamily,
    pub chain_id: String,
    pub asset_symbol: String,
    pub asset_amount_minor: i64,
    pub fiat_currency: String,
    pub fiat_amount_minor: i64,
    pub expires_at: i64,
}

#[async_trait]
pub trait ExecutableQuoteProvider: Send + Sync {
    async fn quote(&self, request: &CreateRampIntentRequest) -> anyhow::Result<ExecutableQuote>;
}

/// No commercial pricing source is silently selected by this application.
/// Deployment must supply a reviewed executable-price adapter, distinct from
/// the existing Paystack/Korapay checkout and payout adapters.
pub struct UnavailableQuoteProvider;
#[async_trait]
impl ExecutableQuoteProvider for UnavailableQuoteProvider {
    async fn quote(&self, _request: &CreateRampIntentRequest) -> anyhow::Result<ExecutableQuote> {
        anyhow::bail!(
            "Executable quote provider is not configured; new settlement intents are disabled"
        )
    }
}

impl ExecutableQuote {
    pub fn validate(&self, request: &CreateRampIntentRequest, now: i64) -> anyhow::Result<()> {
        anyhow::ensure!(
            !self.provider.is_empty()
                && self.provider.len() <= 128
                && !self.provider_quote_id.is_empty()
                && self.provider_quote_id.len() <= 256,
            "invalid executable quote identity"
        );
        anyhow::ensure!(
            self.request_hash == super::idempotency::hash_request_payload(request)?,
            "executable quote request mismatch"
        );
        anyhow::ensure!(
            self.chain_family == request.chain_family
                && self.chain_id == request.chain_id
                && self.asset_symbol == request.asset_symbol,
            "executable quote asset or network mismatch"
        );
        anyhow::ensure!(
            self.asset_amount_minor > 0
                && self.fiat_amount_minor > 0
                && self.fiat_currency == "NGN",
            "invalid executable quote amounts or currency"
        );
        anyhow::ensure!(
            self.expires_at > now && self.expires_at.saturating_sub(now) <= 300,
            "executable quote expired or validity too long"
        );
        if request.intent_type == IntentType::Offramp {
            anyhow::ensure!(
                self.asset_amount_minor == request.asset_amount_minor,
                "executable quote changed deposit quantity"
            );
        }
        let supported = match self.chain_family {
            ChainFamily::Solana => {
                self.asset_symbol == "SOL"
                    && matches!(
                        self.chain_id.as_str(),
                        "devnet" | "testnet" | "mainnet-beta"
                    )
            }
            ChainFamily::Evm => {
                (self.asset_symbol == "ETH" && matches!(self.chain_id.as_str(), "1" | "11155111"))
                    || (self.asset_symbol == "HYPE"
                        && matches!(self.chain_id.as_str(), "998" | "999"))
            }
            ChainFamily::Bitcoin => {
                self.asset_symbol == "BTC"
                    && matches!(
                        self.chain_id.as_str(),
                        "mainnet" | "testnet" | "signet" | "regtest"
                    )
            }
            ChainFamily::Zcash => {
                self.asset_symbol == "ZEC"
                    && matches!(self.chain_id.as_str(), "mainnet" | "testnet")
            }
        };
        anyhow::ensure!(supported, "unsupported executable settlement asset/network");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> CreateRampIntentRequest {
        CreateRampIntentRequest {
            intent_type: IntentType::Offramp,
            chain_family: ChainFamily::Solana,
            chain_id: "devnet".into(),
            asset_symbol: "SOL".into(),
            asset_amount_minor: 100,
            usd_amount_cents: None,
            destination_wallet: None,
            source_wallet: Some("source".into()),
            bank_code: Some("bank".into()),
            bank_account_number: Some("account".into()),
        }
    }
    struct MockProvider;
    #[async_trait]
    impl ExecutableQuoteProvider for MockProvider {
        async fn quote(
            &self,
            request: &CreateRampIntentRequest,
        ) -> anyhow::Result<ExecutableQuote> {
            Ok(ExecutableQuote {
                provider: "test-provider".into(),
                provider_quote_id: "quote-123".into(),
                request_hash: super::super::idempotency::hash_request_payload(request)?,
                chain_family: request.chain_family,
                chain_id: request.chain_id.clone(),
                asset_symbol: request.asset_symbol.clone(),
                asset_amount_minor: request.asset_amount_minor,
                fiat_currency: "NGN".into(),
                fiat_amount_minor: 1200,
                expires_at: 1100,
            })
        }
    }
    #[tokio::test]
    async fn unavailable_provider_fails_closed_without_network_or_fallback_price() {
        assert!(UnavailableQuoteProvider
            .quote(&request())
            .await
            .unwrap_err()
            .to_string()
            .contains("not configured"));
    }
    #[tokio::test]
    async fn server_quote_is_bound_to_exact_request_asset_amount_currency_and_expiry() {
        let request = request();
        let quote = MockProvider.quote(&request).await.unwrap();
        quote.validate(&request, 1000).unwrap();
        let mut changed = quote.clone();
        changed.asset_amount_minor += 1;
        assert!(changed.validate(&request, 1000).is_err());
        let mut changed = quote.clone();
        changed.fiat_currency = "USD".into();
        assert!(changed.validate(&request, 1000).is_err());
        let mut changed = quote.clone();
        changed.chain_id = "mainnet-beta".into();
        assert!(changed.validate(&request, 1000).is_err());
        let mut changed = quote.clone();
        changed.expires_at = 999;
        assert!(changed.validate(&request, 1000).is_err());
        let mut changed = quote.clone();
        changed.fiat_amount_minor = 0;
        assert!(changed.validate(&request, 1000).is_err());
        let mut other = request.clone();
        other.source_wallet = Some("attacker".into());
        assert!(quote.validate(&other, 1000).is_err());
    }
}
