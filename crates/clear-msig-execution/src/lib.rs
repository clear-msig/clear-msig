macro_rules! progress {
    ($($argument:tt)*) => {
        $crate::output::emit_progress(format_args!($($argument)*))
    };
}

pub(crate) use progress;

mod accounts;
mod chains;
pub mod commands;
pub mod config;
mod control;
mod direct;
#[cfg(test)]
mod direct_tests;
mod error;
mod execution;
mod ika;
mod instructions;
mod lifecycle;
mod message;
mod output;
mod params;
mod quasar_client;
mod resolve;
mod rpc;
mod signing;

use clap::Subcommand;

pub use clear_msig_command_contract::{
    DirectCommand, DirectExecutionContext, LamportPayment, TypedExecutionContext,
    TypedProposalExecution, TypedProposalLifecycle,
};
pub use control::ExecutionControl;
pub use direct::prepare_direct_command;
pub use execution::prepare_typed_proposal_execution;
pub use lifecycle::prepare_typed_proposal_lifecycle;

#[derive(Subcommand)]
pub enum Command {
    /// Manage CLI configuration
    Config {
        #[command(subcommand)]
        action: commands::config::ConfigAction,
    },
    /// Manage multisig wallets
    Wallet {
        #[command(subcommand)]
        action: commands::wallet::WalletAction,
    },
    /// Manage intents on a wallet
    Intent {
        #[command(subcommand)]
        action: commands::intent::IntentAction,
    },
    /// Manage proposals
    Proposal {
        #[command(subcommand)]
        action: commands::proposal::ProposalAction,
    },
}

/// A validated, typed execution request.
///
/// Its fields stay private so infrastructure callers cannot construct a
/// partially validated command or mutate one after validation.
pub struct ExecutionRequest {
    globals: config::CliGlobals,
    command: Command,
    control: control::ExecutionControl,
    solana_rpc_factory: std::sync::Arc<dyn rpc::SolanaRpcFactory>,
}

/// Prepare a typed command for one isolated execution.
pub fn prepare_command(globals: config::CliGlobals, command: Command) -> ExecutionRequest {
    ExecutionRequest::new(globals, command)
}

/// Execute one previously validated request and return its single structured
/// response. Infrastructure workers use this API so parsing and validation
/// cannot race with queueing or execution.
pub fn execute_request(request: ExecutionRequest) -> anyhow::Result<serde_json::Value> {
    let (result, outputs) = output::capture_json(|| execute(request));
    result?;
    match outputs.as_slice() {
        [value] => Ok(value.clone()),
        [] => Err(anyhow::anyhow!(
            "command completed without a structured response"
        )),
        _ => Err(anyhow::anyhow!(
            "command emitted {} structured responses",
            outputs.len()
        )),
    }
}

impl ExecutionRequest {
    fn new(globals: config::CliGlobals, command: Command) -> Self {
        Self {
            globals,
            command,
            control: control::ExecutionControl::default(),
            solana_rpc_factory: std::sync::Arc::new(rpc::LiveSolanaRpcFactory),
        }
    }

    pub fn cancellation_handle(&self) -> control::ExecutionControl {
        self.control.clone()
    }

    pub fn with_solana_rpc_factory(
        mut self,
        factory: std::sync::Arc<dyn rpc::SolanaRpcFactory>,
    ) -> Self {
        self.solana_rpc_factory = factory;
        self
    }
}

fn execute(request: ExecutionRequest) -> anyhow::Result<()> {
    request.control.check()?;
    let solana_rpc_factory = request.solana_rpc_factory.clone();
    match request.command {
        Command::Config { action } => commands::config::handle(action),
        Command::Wallet { action } => {
            let config = config::load_config(
                &request.globals,
                request.control.clone(),
                solana_rpc_factory.clone(),
            )?;
            commands::wallet::handle(action, &config)
        }
        Command::Intent { action } => {
            let config = config::load_config(
                &request.globals,
                request.control.clone(),
                solana_rpc_factory.clone(),
            )?;
            commands::intent::handle(action, &config)
        }
        Command::Proposal { action } => {
            let config = config::load_config(
                &request.globals,
                request.control.clone(),
                solana_rpc_factory,
            )?;
            commands::proposal::handle(action, &config)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{execute_request, prepare_command, Command};
    use std::sync::Arc;

    struct TestSolanaRpcFactory;

    impl crate::rpc::SolanaRpcFactory for TestSolanaRpcFactory {
        fn connect(
            &self,
            _rpc_url: String,
            _control: crate::ExecutionControl,
        ) -> crate::rpc::Client {
            panic!("test factory should not connect for config commands")
        }
    }

    #[test]
    fn typed_config_command_returns_one_json_value() {
        let request = prepare_command(
            crate::config::CliGlobals::default(),
            Command::Config {
                action: crate::commands::config::ConfigAction::Show,
            },
        );
        let value = execute_request(request).unwrap();
        assert!(value
            .get("config_path")
            .and_then(|item| item.as_str())
            .is_some());
    }

    #[test]
    fn execution_request_carries_the_injected_solana_factory() {
        let factory: Arc<dyn crate::rpc::SolanaRpcFactory> = Arc::new(TestSolanaRpcFactory);
        let request = prepare_command(
            crate::config::CliGlobals::default(),
            Command::Config {
                action: crate::commands::config::ConfigAction::Show,
            },
        )
        .with_solana_rpc_factory(factory.clone());
        assert!(Arc::ptr_eq(&request.solana_rpc_factory, &factory));
    }
}
