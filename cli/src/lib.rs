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
mod error;
mod ika;
mod instructions;
mod message;
mod output;
mod params;
mod quasar_client;
mod resolve;
mod rpc;
mod signing;

use std::process::ExitCode;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "clear-msig", about = "Clear-sign multisig wallet CLI")]
struct Cli {
    #[command(subcommand)]
    command: Command,

    /// RPC URL (overrides config)
    #[arg(long, global = true)]
    url: Option<String>,
    /// Path to payer keypair (overrides config)
    #[arg(long, global = true)]
    keypair: Option<String>,
    /// Path to signer keypair for multisig messages (overrides config)
    #[arg(long, global = true)]
    signer: Option<String>,
    /// Use Ledger as signer (overrides config)
    #[arg(long, global = true)]
    signer_ledger: bool,
    /// Ledger derivation account index (overrides config)
    #[arg(long, global = true)]
    ledger_account: Option<u32>,
    /// Pre-signed mode signer pubkey; must accompany `--signature`.
    #[arg(long, global = true)]
    signer_pubkey: Option<String>,
    /// Pre-signed mode hex-encoded 64-byte ed25519 signature.
    #[arg(long, global = true)]
    signature: Option<String>,
    /// Pre-signed mode hex-encoded params bytes signed by the caller.
    #[arg(long, global = true)]
    params_data: Option<String>,
    /// Exact signed message layout: offchain_v1, plain_v2, or clearsign_v2_text.
    #[arg(long, global = true)]
    message_flavor: Option<String>,
    /// Pre-signed typed mode hex-encoded readable ClearSign vote bytes.
    #[arg(long, global = true)]
    signed_message: Option<String>,
    /// Print the signable descriptor without sending a transaction.
    #[arg(long, global = true)]
    dry_run: bool,
}

#[derive(Subcommand)]
enum Command {
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

/// Validate the exact argv shape the CLI will execute. The shared contract
/// rejects unsupported process-boundary commands; Clap then validates every
/// option and positional argument against the full CLI schema.
pub fn validate_invocation_args(args: &[String]) -> Result<(), String> {
    clear_msig_command_contract::validate_invocation_args(args)?;
    let argv = std::iter::once("clear-msig").chain(args.iter().map(String::as_str));
    Cli::try_parse_from(argv)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Execute one CLI invocation in-process and return its single structured
/// response. This is the shared adapter used by backend workers and tests;
/// the binary remains a thin stdout/stderr wrapper around the same handlers.
pub fn execute_args(args: &[String]) -> anyhow::Result<serde_json::Value> {
    let argv = std::iter::once("clear-msig").chain(args.iter().map(String::as_str));
    let cli = Cli::try_parse_from(argv).map_err(|error| anyhow::anyhow!(error.to_string()))?;
    let (result, outputs) = output::capture_json(|| execute(cli));
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

pub fn run_from_env() -> ExitCode {
    match execute(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            crate::progress!("{error:?}");
            let json = serde_json::json!({ "error": format!("{error}") });
            println!("{}", serde_json::to_string_pretty(&json).unwrap());
            ExitCode::FAILURE
        }
    }
}

fn execute(cli: Cli) -> anyhow::Result<()> {
    let globals = config::CliGlobals {
        url: cli.url,
        keypair: cli.keypair,
        signer: cli.signer,
        signer_ledger: cli.signer_ledger,
        ledger_account: cli.ledger_account,
        signer_pubkey: cli.signer_pubkey,
        signature: cli.signature,
        params_data: cli.params_data,
        message_flavor: cli.message_flavor,
        signed_message: cli.signed_message,
        dry_run: cli.dry_run,
    };

    match cli.command {
        Command::Config { action } => commands::config::handle(action),
        Command::Wallet { action } => {
            let config = config::load_config(&globals)?;
            commands::wallet::handle(action, &config)
        }
        Command::Intent { action } => {
            let config = config::load_config(&globals)?;
            commands::intent::handle(action, &config)
        }
        Command::Proposal { action } => {
            let config = config::load_config(&globals)?;
            commands::proposal::handle(action, &config)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Cli;
    use super::{execute_args, validate_invocation_args};
    use clap::CommandFactory;

    #[test]
    fn shared_parser_accepts_known_commands() {
        assert!(validate_invocation_args(&["config".into(), "show".into()]).is_ok());
    }

    #[test]
    fn shared_parser_rejects_unknown_backend_invocations() {
        let error = validate_invocation_args(&[
            "proposal".into(),
            "execute".into(),
            "--unknown-relayer-flag".into(),
        ])
        .expect_err("unknown flags must not reach a child process");
        assert!(error.contains("unexpected argument") || error.contains("unrecognized"));
    }

    #[test]
    fn process_boundary_allowlist_covers_every_cli_action() {
        let cli = Cli::command();
        for command in cli.get_subcommands() {
            for action in command.get_subcommands() {
                let args = vec![command.get_name().into(), action.get_name().into()];
                clear_msig_command_contract::validate_invocation_args(&args).unwrap_or_else(
                    |error| {
                        panic!(
                            "{} {} is missing from the process-boundary contract: {error}",
                            command.get_name(),
                            action.get_name()
                        )
                    },
                );
            }
        }
    }

    #[test]
    fn in_process_config_show_returns_one_json_value() {
        let value = execute_args(&["config".into(), "show".into()]).unwrap();
        assert!(value
            .get("config_path")
            .and_then(|item| item.as_str())
            .is_some());
    }
}
