const MAX_ARGS: usize = 256;
const MAX_ARG_BYTES: usize = 16 * 1024;

const CONFIG_ACTIONS: &[&str] = &["set", "show"];
const WALLET_ACTIONS: &[&str] = &["create", "show", "add-chain", "chains"];
const INTENT_ACTIONS: &[&str] = &["add", "remove", "update", "update-template", "list"];
const PROPOSAL_ACTIONS: &[&str] = &[
    "create",
    "typed-create",
    "typed-approve",
    "typed-cancel",
    "typed-execute",
    "typed-escrow-release",
    "typed-spl-escrow-release",
    "typed-spl-escrow-return",
    "typed-cross-chain-escrow-release",
    "typed-cross-chain-escrow-return",
    "typed-private-escrow-release",
    "typed-private-escrow-return",
    "typed-agent-trade-approval",
    "typed-agent-session-grant",
    "typed-escrow-return",
    "typed-sol-send",
    "typed-wallet-policy-update",
    "typed-intent-governance",
    "typed-chain-send",
    "typed-chain-send-ika",
    "typed-sol-batch-send",
    "approve",
    "cancel",
    "execute",
    "list",
    "show",
    "cleanup",
];

/// Shared process-boundary contract used by both the HTTP backend and CLI.
/// Values remain opaque argv entries; no shell interpolation is ever involved.
pub fn validate_invocation_args(args: &[String]) -> Result<(), String> {
    if args.len() > MAX_ARGS {
        return Err(format!("invocation has too many arguments: {}", args.len()));
    }
    for value in args {
        if value.len() > MAX_ARG_BYTES {
            return Err("invocation argument exceeds the size limit".into());
        }
        if value
            .chars()
            .any(|character| matches!(character, '\0' | '\n' | '\r'))
        {
            return Err("invocation arguments cannot contain control separators".into());
        }
    }

    let mut command_index = 0usize;
    while command_index < args.len() {
        match args[command_index].as_str() {
            "--signer-ledger" | "--dry-run" => command_index += 1,
            "--url" | "--keypair" | "--signer" | "--ledger-account" | "--signer-pubkey"
            | "--signature" | "--params-data" | "--message-flavor" | "--signed-message" => {
                command_index += 2
            }
            _ => break,
        }
    }
    let command = args
        .get(command_index)
        .filter(|value| matches!(value.as_str(), "config" | "wallet" | "intent" | "proposal"))
        .ok_or_else(|| "invocation is missing a supported command".to_string())?;
    let action = args
        .get(command_index + 1)
        .filter(|value| !value.starts_with('-'))
        .ok_or_else(|| format!("{command} invocation is missing an action"))?;
    let allowed = match command.as_str() {
        "config" => CONFIG_ACTIONS,
        "wallet" => WALLET_ACTIONS,
        "intent" => INTENT_ACTIONS,
        "proposal" => PROPOSAL_ACTIONS,
        _ => unreachable!(),
    };
    if !allowed.contains(&action.as_str()) {
        return Err(format!("unsupported {command} action: {action}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_invocation_args;

    #[test]
    fn accepts_globals_before_a_typed_action() {
        let args = vec![
            "--url".into(),
            "https://rpc.example".into(),
            "proposal".into(),
            "typed-sol-send".into(),
            "wallet".into(),
        ];
        assert!(validate_invocation_args(&args).is_ok());
    }

    #[test]
    fn rejects_unknown_actions_and_control_separators() {
        assert!(validate_invocation_args(&["proposal".into(), "drain-wallet".into()]).is_err());
        assert!(validate_invocation_args(&[
            "proposal".into(),
            "typed-sol-send".into(),
            "bad\nvalue".into(),
        ])
        .is_err());
    }
}
