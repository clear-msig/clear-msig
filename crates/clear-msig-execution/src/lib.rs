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

pub use chains::delivery::{
    DeliveryState, DestinationReceipt, DestinationReceiptStore, FileDestinationReceiptStore,
};
pub use clear_msig_command_contract::{
    DirectCommand, DirectExecutionContext, LamportPayment, TypedExecutionContext,
    TypedProposalExecution, TypedProposalLifecycle,
};
pub use control::ExecutionControl;
pub use direct::prepare_direct_command;
pub use execution::prepare_typed_proposal_execution;
pub use ika::{IkaGrpcPort, IkaSubmitRequest};
pub use lifecycle::prepare_typed_proposal_lifecycle;
pub use rpc::{SolanaRpcFactory, SolanaRpcPort};

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
    ika_grpc_port: std::sync::Arc<dyn ika::IkaGrpcPort>,
    destination_receipt_store: std::sync::Arc<dyn chains::delivery::DestinationReceiptStore>,
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
            ika_grpc_port: std::sync::Arc::new(ika::LiveIkaGrpcPort),
            destination_receipt_store: std::sync::Arc::new(
                chains::delivery::FileDestinationReceiptStore::from_environment(),
            ),
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

    pub fn with_ika_grpc_port(mut self, port: std::sync::Arc<dyn ika::IkaGrpcPort>) -> Self {
        self.ika_grpc_port = port;
        self
    }

    pub fn with_destination_receipt_store(
        mut self,
        store: std::sync::Arc<dyn chains::delivery::DestinationReceiptStore>,
    ) -> Self {
        self.destination_receipt_store = store;
        self
    }
}

fn execute(request: ExecutionRequest) -> anyhow::Result<()> {
    request.control.check()?;
    let solana_rpc_factory = request.solana_rpc_factory.clone();
    let ika_grpc_port = request.ika_grpc_port.clone();
    let destination_receipt_store = request.destination_receipt_store.clone();
    match request.command {
        Command::Config { action } => commands::config::handle(action),
        Command::Wallet { action } => {
            let config = config::load_config(
                &request.globals,
                request.control.clone(),
                solana_rpc_factory.clone(),
                ika_grpc_port.clone(),
                destination_receipt_store.clone(),
            )?;
            commands::wallet::handle(action, &config)
        }
        Command::Intent { action } => {
            let config = config::load_config(
                &request.globals,
                request.control.clone(),
                solana_rpc_factory.clone(),
                ika_grpc_port.clone(),
                destination_receipt_store.clone(),
            )?;
            commands::intent::handle(action, &config)
        }
        Command::Proposal { action } => {
            let config = config::load_config(
                &request.globals,
                request.control.clone(),
                solana_rpc_factory,
                ika_grpc_port,
                destination_receipt_store,
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
    struct TestIkaGrpcPort;
    struct TestDestinationReceiptStore;

    impl crate::rpc::SolanaRpcFactory for TestSolanaRpcFactory {
        fn connect(
            &self,
            _rpc_url: String,
            _control: crate::ExecutionControl,
        ) -> crate::rpc::Client {
            panic!("test factory should not connect for config commands")
        }
    }

    impl crate::ika::IkaGrpcPort for TestIkaGrpcPort {
        fn submit(
            &self,
            _grpc_url: &str,
            _request: crate::ika::IkaSubmitRequest,
            _control: crate::ExecutionControl,
        ) -> anyhow::Result<Vec<u8>> {
            panic!("test port should not submit for config commands")
        }
    }

    impl crate::DestinationReceiptStore for TestDestinationReceiptStore {
        fn execution_lock(&self, _execution_id: &str) -> Arc<std::sync::Mutex<()>> {
            Arc::new(std::sync::Mutex::new(()))
        }

        fn load(&self, _execution_id: &str) -> anyhow::Result<Option<crate::DestinationReceipt>> {
            Ok(None)
        }

        fn save(&self, _receipt: &crate::DestinationReceipt) -> anyhow::Result<()> {
            Ok(())
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

    #[test]
    fn execution_request_carries_the_injected_ika_port() {
        let port: Arc<dyn crate::ika::IkaGrpcPort> = Arc::new(TestIkaGrpcPort);
        let request = prepare_command(
            crate::config::CliGlobals::default(),
            Command::Config {
                action: crate::commands::config::ConfigAction::Show,
            },
        )
        .with_ika_grpc_port(port.clone());
        assert!(Arc::ptr_eq(&request.ika_grpc_port, &port));
    }

    #[test]
    fn execution_request_carries_the_injected_destination_receipt_store() {
        let store: Arc<dyn crate::DestinationReceiptStore> = Arc::new(TestDestinationReceiptStore);
        let request = prepare_command(
            crate::config::CliGlobals::default(),
            Command::Config {
                action: crate::commands::config::ConfigAction::Show,
            },
        )
        .with_destination_receipt_store(store.clone());
        assert!(Arc::ptr_eq(&request.destination_receipt_store, &store));
    }
}
