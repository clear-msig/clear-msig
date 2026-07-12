use clap::Parser;

#[derive(Parser)]
#[command(name = "clear-msig", about = "Clear-sign multisig wallet CLI")]
struct Cli {
    #[command(subcommand)]
    command: clear_msig_execution::Command,

    #[arg(long, global = true)]
    url: Option<String>,
    #[arg(long, global = true)]
    keypair: Option<String>,
    #[arg(long, global = true)]
    signer: Option<String>,
    #[arg(long, global = true)]
    signer_ledger: bool,
    #[arg(long, global = true)]
    ledger_account: Option<u32>,
    #[arg(long, global = true)]
    signer_pubkey: Option<String>,
    #[arg(long, global = true)]
    signature: Option<String>,
    #[arg(long, global = true)]
    params_data: Option<String>,
    #[arg(long, global = true)]
    message_flavor: Option<String>,
    #[arg(long, global = true)]
    signed_message: Option<String>,
    #[arg(long, global = true)]
    dry_run: bool,
}

fn main() -> std::process::ExitCode {
    let cli = Cli::parse();
    let request = clear_msig_execution::prepare_command(
        clear_msig_execution::config::CliGlobals {
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
        },
        cli.command,
    );
    match clear_msig_execution::execute_request(request) {
        Ok(value) => {
            println!("{}", serde_json::to_string_pretty(&value).unwrap());
            std::process::ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error:?}");
            let value = serde_json::json!({ "error": format!("{error}") });
            println!("{}", serde_json::to_string_pretty(&value).unwrap());
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Cli;
    use clap::Parser;

    #[test]
    fn parser_accepts_known_commands() {
        assert!(Cli::try_parse_from(["clear-msig", "config", "show"]).is_ok());
    }

    #[test]
    fn parser_rejects_unknown_flags() {
        assert!(Cli::try_parse_from([
            "clear-msig",
            "proposal",
            "execute",
            "--unknown-relayer-flag",
        ])
        .is_err());
    }
}
