use crate::domain::types::IntentStatus;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransitionContext {
    pub chain_transfer_confirmed: bool,
    pub ledger_posted: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TransitionError {
    #[error("invalid transition from {from:?} to {to:?}")]
    InvalidTransition {
        from: IntentStatus,
        to: IntentStatus,
    },
    #[error("payout transition blocked: chain transfer is not confirmed")]
    PayoutBlockedByUnconfirmedTransfer,
    #[error("payout transition blocked: ledger posting is incomplete")]
    PayoutBlockedByLedger,
}

pub fn validate_transition(
    from: IntentStatus,
    to: IntentStatus,
    context: TransitionContext,
) -> Result<(), TransitionError> {
    if from == to {
        return Ok(());
    }

    if from.is_terminal() {
        return Err(TransitionError::InvalidTransition { from, to });
    }

    let allowed = match from {
        IntentStatus::IntentCreated => matches!(
            to,
            IntentStatus::AwaitingUserTransferSignature
                | IntentStatus::AwaitingPayment
                | IntentStatus::Expired
                | IntentStatus::Cancelled
        ),
        IntentStatus::AwaitingUserTransferSignature => matches!(
            to,
            IntentStatus::AwaitingUserTransferConfirmation
                | IntentStatus::Expired
                | IntentStatus::Cancelled
        ),
        IntentStatus::AwaitingUserTransferConfirmation => matches!(
            to,
            IntentStatus::SettlementQueued
                | IntentStatus::ManualReviewRequired
                | IntentStatus::Expired
                | IntentStatus::Failed
        ),
        IntentStatus::AwaitingPayment => matches!(
            to,
            IntentStatus::PaymentConfirmed | IntentStatus::Expired | IntentStatus::Failed
        ),
        IntentStatus::PaymentConfirmed => {
            matches!(to, IntentStatus::SettlementQueued | IntentStatus::Failed)
        }
        IntentStatus::SettlementQueued => {
            matches!(
                to,
                IntentStatus::SettlementInProgress | IntentStatus::Failed
            )
        }
        IntentStatus::SettlementInProgress => matches!(
            to,
            IntentStatus::SettlementCompleted
                | IntentStatus::Failed
                | IntentStatus::ManualReviewRequired
        ),
        IntentStatus::SettlementCompleted => {
            matches!(
                to,
                IntentStatus::PayoutInProgress | IntentStatus::PayoutCompleted
            )
        }
        IntentStatus::PayoutInProgress => {
            matches!(to, IntentStatus::PayoutCompleted | IntentStatus::Failed)
        }
        IntentStatus::PayoutCompleted => false,
        IntentStatus::Expired => false,
        IntentStatus::Failed => false,
        IntentStatus::Cancelled => false,
        IntentStatus::ManualReviewRequired => false,
    };

    if !allowed {
        return Err(TransitionError::InvalidTransition { from, to });
    }

    if matches!(
        to,
        IntentStatus::PayoutInProgress | IntentStatus::PayoutCompleted
    ) && !context.chain_transfer_confirmed
    {
        return Err(TransitionError::PayoutBlockedByUnconfirmedTransfer);
    }

    if matches!(
        to,
        IntentStatus::PayoutInProgress | IntentStatus::PayoutCompleted
    ) && !context.ledger_posted
    {
        return Err(TransitionError::PayoutBlockedByLedger);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> TransitionContext {
        TransitionContext {
            chain_transfer_confirmed: false,
            ledger_posted: false,
        }
    }

    #[test]
    fn allows_expected_transition() {
        let result = validate_transition(
            IntentStatus::IntentCreated,
            IntentStatus::AwaitingUserTransferSignature,
            ctx(),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn blocks_invalid_transition() {
        let result = validate_transition(
            IntentStatus::IntentCreated,
            IntentStatus::PayoutInProgress,
            ctx(),
        );
        assert!(matches!(
            result,
            Err(TransitionError::InvalidTransition { .. })
        ));
    }

    #[test]
    fn blocks_payout_without_chain_confirmation() {
        let result = validate_transition(
            IntentStatus::SettlementCompleted,
            IntentStatus::PayoutInProgress,
            TransitionContext {
                chain_transfer_confirmed: false,
                ledger_posted: true,
            },
        );
        assert_eq!(
            result,
            Err(TransitionError::PayoutBlockedByUnconfirmedTransfer)
        );
    }

    #[test]
    fn blocks_payout_without_ledger_post() {
        let result = validate_transition(
            IntentStatus::SettlementCompleted,
            IntentStatus::PayoutInProgress,
            TransitionContext {
                chain_transfer_confirmed: true,
                ledger_posted: false,
            },
        );
        assert_eq!(result, Err(TransitionError::PayoutBlockedByLedger));
    }

    #[test]
    fn allows_payout_with_guards_satisfied() {
        let result = validate_transition(
            IntentStatus::SettlementCompleted,
            IntentStatus::PayoutInProgress,
            TransitionContext {
                chain_transfer_confirmed: true,
                ledger_posted: true,
            },
        );
        assert!(result.is_ok());
    }
}
