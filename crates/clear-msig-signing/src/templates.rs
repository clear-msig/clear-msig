#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TemplateKind {
    NativeTransfer,
    TokenTransfer,
    BatchPayment,
    PolicyUpdate,
    MemberAdd,
    MemberRemove,
    ThresholdChange,
    EscrowRelease,
    EscrowReturn,
    AgentPermissionGrant,
    AgentPermissionRevoke,
    AgentBudgetChange,
    AgentTradeApproval,
    AgentTradeSettlement,
    CrossChainTransfer,
    Swap,
    ContractInteraction,
    Staking,
    Unstaking,
    GovernanceVote,
    UnknownAction,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TemplateSupport {
    Executable,
    ReviewOnly,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TemplateDefinition {
    pub kind: TemplateKind,
    pub identifier: &'static str,
    pub support: TemplateSupport,
}

pub const TEMPLATE_REGISTRY: &[TemplateDefinition] = &[
    executable(TemplateKind::NativeTransfer, "native_transfer"),
    executable(TemplateKind::TokenTransfer, "token_transfer"),
    executable(TemplateKind::BatchPayment, "batch_payment"),
    executable(TemplateKind::PolicyUpdate, "policy_update"),
    executable(TemplateKind::MemberAdd, "member_add"),
    executable(TemplateKind::MemberRemove, "member_remove"),
    executable(TemplateKind::ThresholdChange, "threshold_change"),
    executable(TemplateKind::EscrowRelease, "escrow_release"),
    executable(TemplateKind::EscrowReturn, "escrow_return"),
    executable(TemplateKind::AgentPermissionGrant, "agent_permission_grant"),
    executable(
        TemplateKind::AgentPermissionRevoke,
        "agent_permission_revoke",
    ),
    executable(TemplateKind::AgentBudgetChange, "agent_budget_change"),
    executable(TemplateKind::AgentTradeApproval, "agent_trade_approval"),
    executable(TemplateKind::AgentTradeSettlement, "agent_trade_settlement"),
    executable(TemplateKind::CrossChainTransfer, "cross_chain_transfer"),
    review_only(TemplateKind::Swap, "swap"),
    review_only(TemplateKind::ContractInteraction, "contract_interaction"),
    review_only(TemplateKind::Staking, "staking"),
    review_only(TemplateKind::Unstaking, "unstaking"),
    review_only(TemplateKind::GovernanceVote, "governance_vote"),
    review_only(TemplateKind::UnknownAction, "unknown_action"),
];

const fn executable(kind: TemplateKind, identifier: &'static str) -> TemplateDefinition {
    TemplateDefinition {
        kind,
        identifier,
        support: TemplateSupport::Executable,
    }
}

const fn review_only(kind: TemplateKind, identifier: &'static str) -> TemplateDefinition {
    TemplateDefinition {
        kind,
        identifier,
        support: TemplateSupport::ReviewOnly,
    }
}

pub fn template_definition(kind: TemplateKind) -> &'static TemplateDefinition {
    TEMPLATE_REGISTRY
        .iter()
        .find(|definition| definition.kind == kind)
        .expect("every TemplateKind must have a registry entry")
}

#[derive(Clone, Copy)]
pub struct UnsupportedReviewInput<'a> {
    pub action_label: &'a [u8],
    pub network_label: &'a [u8],
    pub program_or_contract: &'a [u8],
    pub transaction_commitment: [u8; 32],
}
