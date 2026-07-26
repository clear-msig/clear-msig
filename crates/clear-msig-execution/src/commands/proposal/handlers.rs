use super::action::HandlerGroup;
use super::*;

mod agent;
mod creation;
mod escrow;
mod governance;
mod legacy;
mod recurring;
mod send;
mod votes;

pub(super) fn handle(action: ProposalAction, config: &RuntimeConfig) -> Result<()> {
    match action.handler_group() {
        HandlerGroup::Agent => agent::handle(action, config),
        HandlerGroup::Creation => creation::handle(action, config),
        HandlerGroup::Escrow => escrow::handle(action, config),
        HandlerGroup::Governance => governance::handle(action, config),
        HandlerGroup::Legacy => legacy::handle(action, config),
        HandlerGroup::Recurring => recurring::handle(action, config),
        HandlerGroup::Send => send::handle(action, config),
        HandlerGroup::Votes => votes::handle(action, config),
    }
}
