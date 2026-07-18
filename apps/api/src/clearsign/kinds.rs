use crate::ApiError;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ClearSignActionKind {
    Send,
    BatchSend,
    AddMember,
    RemoveMember,
    ChangeThreshold,
    SetProtection,
    ReleaseMilestone,
    ReturnEscrowFunds,
    AgentTradeApproval,
    RecoveryAction,
    SwapIntent,
    AgentSessionGrant,
    AgentRiskPolicy,
    AgentTradeSettlement,
    RecurringSchedule,
}

impl ClearSignActionKind {
    pub(super) fn parse(value: &str) -> Result<Self, ApiError> {
        match value.trim() {
            "send" => Ok(Self::Send),
            "batch_send" => Ok(Self::BatchSend),
            "add_member" => Ok(Self::AddMember),
            "remove_member" => Ok(Self::RemoveMember),
            "change_threshold" => Ok(Self::ChangeThreshold),
            "set_protection" => Ok(Self::SetProtection),
            "release_milestone" => Ok(Self::ReleaseMilestone),
            "return_escrow_funds" => Ok(Self::ReturnEscrowFunds),
            "agent_trade_approval" => Ok(Self::AgentTradeApproval),
            "recovery_action" => Ok(Self::RecoveryAction),
            "swap_intent" => Ok(Self::SwapIntent),
            "agent_session_grant" => Ok(Self::AgentSessionGrant),
            "agent_risk_policy" => Ok(Self::AgentRiskPolicy),
            "agent_trade_settlement" => Ok(Self::AgentTradeSettlement),
            "recurring_schedule" => Ok(Self::RecurringSchedule),
            other => Err(ApiError::BadRequest(format!(
                "unsupported clearsign action kind: {other}"
            ))),
        }
    }

    pub(super) fn code(self) -> u8 {
        match self {
            Self::Send => 1,
            Self::BatchSend => 2,
            Self::AddMember => 3,
            Self::RemoveMember => 4,
            Self::ChangeThreshold => 5,
            Self::SetProtection => 6,
            Self::ReleaseMilestone => 7,
            Self::ReturnEscrowFunds => 8,
            Self::AgentTradeApproval => 9,
            Self::RecoveryAction => 10,
            Self::SwapIntent => 11,
            Self::AgentSessionGrant => 12,
            Self::AgentRiskPolicy => 13,
            Self::AgentTradeSettlement => 14,
            Self::RecurringSchedule => 15,
        }
    }
}
