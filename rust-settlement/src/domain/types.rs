use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntentType {
    Onramp,
    Offramp,
}

/// Chain families supported by the ramp service.
///
/// Mirrors clear-msig's chain coverage: Solana, EVM (Ethereum + L2s),
/// Bitcoin (P2WPKH), and Zcash (transparent). Each family has a
/// matching signer in `crate::signer`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChainFamily {
    Solana,
    Evm,
    Bitcoin,
    Zcash,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntentStatus {
    IntentCreated,
    AwaitingUserTransferSignature,
    AwaitingUserTransferConfirmation,
    AwaitingPayment,
    PaymentConfirmed,
    SettlementQueued,
    SettlementInProgress,
    SettlementCompleted,
    PayoutInProgress,
    PayoutCompleted,
    Expired,
    Failed,
    Cancelled,
    ManualReviewRequired,
}

impl IntentStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            IntentStatus::Expired
                | IntentStatus::Failed
                | IntentStatus::Cancelled
                | IntentStatus::ManualReviewRequired
                | IntentStatus::PayoutCompleted
        )
    }
}
