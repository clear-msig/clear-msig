mod accounts;
mod chains;
mod commands;
mod config;
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

    /// Ledger derivation account index (overrides config, e.g. 10 for m/44'/501'/10')
    #[arg(long, global = true)]
    ledger_account: Option<u32>,

    /// Pre-signed mode: base58-encoded ed25519 pubkey of the signer that
    /// produced `--signature`. Must accompany `--signature`. When set,
    /// the CLI skips its own signer (keypair / Ledger) entirely and
    /// verifies the provided signature against the message it builds.
    /// Used by the browser → relayer → CLI pipeline where the user's
    /// wallet signs client-side.
    #[arg(long, global = true)]
    signer_pubkey: Option<String>,

    /// Pre-signed mode: hex-encoded 64-byte ed25519 signature. Must
    /// accompany `--signer-pubkey`.
    #[arg(long, global = true)]
    signature: Option<String>,

    /// Pre-signed mode: hex-encoded `params_data` bytes the caller built
    /// client-side. When set, commands that normally encode params from
    /// `--param key=value` or from a JSON file skip their own encoder and
    /// use these bytes verbatim. The security invariant is that these
    /// bytes MUST be what `--signer-pubkey` signed over.
    #[arg(long, global = true)]
    params_data: Option<String>,

    /// Dry-run: print a JSON descriptor of the message the CLI would
    /// sign, along with `params_data` and the derived proposal/intent
    /// PDAs, then exit without sending any transaction. Used by the
    /// browser to ask "what do I need to sign?" before prompting the
    /// user's wallet.
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

fn main() {
    let cli = Cli::parse();

    let globals = config::CliGlobals {
        url: cli.url,
        keypair: cli.keypair,
        signer: cli.signer,
        signer_ledger: cli.signer_ledger,
        ledger_account: cli.ledger_account,
        signer_pubkey: cli.signer_pubkey,
        signature: cli.signature,
        params_data: cli.params_data,
        dry_run: cli.dry_run,
    };

    let result = match cli.command {
        Command::Config { action } => commands::config::handle(action),
        Command::Wallet { action } => {
            let cfg = config::load_config(&globals).expect("load runtime config");
            commands::wallet::handle(action, &cfg)
        }
        Command::Intent { action } => {
            let cfg = config::load_config(&globals).expect("load runtime config");
            commands::intent::handle(action, &cfg)
        }
        Command::Proposal { action } => {
            let cfg = config::load_config(&globals).expect("load runtime config");
            commands::proposal::handle(action, &cfg)
        }
    };

    if let Err(err) = result {
        // Stderr gets the human-readable debug dump; stdout is reserved
        // for JSON so relayers / tests can pipe stdout to a JSON parser.
        eprintln!("{err:?}");
        let json = serde_json::json!({ "error": format!("{err}") });
        println!("{}", serde_json::to_string_pretty(&json).unwrap());
        std::process::exit(1);
    }
}
