use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntentType {
    Onramp,
    Offramp,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChainFamily {
    Evm,
    Sui,
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
