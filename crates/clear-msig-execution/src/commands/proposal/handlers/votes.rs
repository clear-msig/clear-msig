use super::super::*;

pub(super) fn handle(action: ProposalAction, config: &RuntimeConfig) -> Result<()> {
    match action {
        ProposalAction::TypedApprove {
            wallet: wallet_name,
            proposal: proposal_addr_str,
        } => {
            typed_approve_or_cancel(config, &wallet_name, &proposal_addr_str, true)?;
        }

        ProposalAction::TypedCancel {
            wallet: wallet_name,
            proposal: proposal_addr_str,
        } => {
            typed_approve_or_cancel(config, &wallet_name, &proposal_addr_str, false)?;
        }

        ProposalAction::Approve {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            expiry,
        } => {
            approve_or_cancel(config, &wallet_name, &proposal_addr_str, &expiry, true)?;
        }

        ProposalAction::Cancel {
            wallet: wallet_name,
            proposal: proposal_addr_str,
            expiry,
        } => {
            approve_or_cancel(config, &wallet_name, &proposal_addr_str, &expiry, false)?;
        }
        _ => unreachable!("proposal handler group mismatch"),
    }
    Ok(())
}
