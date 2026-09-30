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

/// Reject signed-to-unsigned amount wrapping before persistence or signing.
pub fn positive_amount_minor(value: i64) -> anyhow::Result<u64> {
    if value <= 0 {
        anyhow::bail!("asset amount_minor must be greater than zero");
    }
    Ok(value as u64)
}

#[cfg(test)]
mod amount_tests {
    use super::positive_amount_minor;

    #[test]
    fn rejects_negative_and_zero_atomic_amounts() {
        for value in [i64::MIN, -1, 0] {
            assert!(positive_amount_minor(value).is_err());
        }
        assert_eq!(positive_amount_minor(1).unwrap(), 1);
        assert_eq!(positive_amount_minor(i64::MAX).unwrap(), i64::MAX as u64);
    }
}
