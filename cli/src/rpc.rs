use crate::config::RuntimeConfig;
use crate::error::*;
use solana_client::rpc_client::RpcClient;
use solana_commitment_config::CommitmentConfig;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use solana_sdk::compute_budget::ComputeBudgetInstruction;
use solana_signature::Signature;
use solana_signer::Signer;
use solana_transaction::Transaction;

/// The default Solana compute budget is 200k CUs. The member-update
/// flows routinely consume that ceiling during proposal signing and
/// simulation, so we give every CLI transaction a wider headroom by
/// default instead of making each call site remember to opt in.
const DEFAULT_COMPUTE_UNIT_LIMIT: u32 = 600_000;

pub fn client(config: &RuntimeConfig) -> RpcClient {
    RpcClient::new_with_commitment(&config.rpc_url, CommitmentConfig::confirmed())
}

pub fn fetch_account(rpc: &RpcClient, address: &Pubkey) -> Result<Vec<u8>> {
    let account = rpc
        .get_account(address)
        .with_context(|| format!("fetching account {address}"))?;
    Ok(account.data)
}

/// Resolve a wallet by its on-chain name. Post creator-scoped PDA
/// upgrade, the PDA is `[b"clear_wallet", creator, sha256(name)]` —
/// callers can't derive without knowing the creator first. Falls back
/// to a `getProgramAccounts` scan with a discriminator filter and
/// matches by the parsed `name` field.
///
/// Returns `(wallet_pda, parsed_account)` or an error if no match.
pub fn resolve_wallet_by_name(
    rpc: &RpcClient,
    name: &str,
) -> Result<(Pubkey, crate::accounts::WalletAccount)> {
    use solana_client::rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig};
    use solana_client::rpc_filter::{Memcmp, RpcFilterType};

    let program_id = crate::instructions::program_id();
    let config = RpcProgramAccountsConfig {
        filters: Some(vec![
            // Discriminator byte at offset 0 = 1 (ClearWallet).
            RpcFilterType::Memcmp(Memcmp::new_raw_bytes(0, vec![1u8])),
        ]),
        account_config: RpcAccountInfoConfig {
            // None defaults to base64 — fine for our parser. We don't
            // pull in solana-account-decoder just to name the encoding.
            encoding: None,
            commitment: Some(CommitmentConfig::confirmed()),
            data_slice: None,
            min_context_slot: None,
        },
        with_context: None,
        sort_results: None,
    };

    let accounts = rpc
        .get_program_accounts_with_config(&program_id, config)
        .with_context(|| "scanning ClearWallet accounts")?;

    for (pubkey, account) in accounts {
        match crate::accounts::parse_wallet(&account.data) {
            Ok(parsed) if parsed.name == name => return Ok((pubkey, parsed)),
            _ => continue,
        }
    }

    Err(anyhow!("wallet `{name}` not found on-chain"))
}

pub fn fetch_account_optional(rpc: &RpcClient, address: &Pubkey) -> Result<Option<Vec<u8>>> {
    match rpc.get_account(address) {
        Ok(account) => Ok(Some(account.data)),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("AccountNotFound") || msg.contains("could not find account") {
                Ok(None)
            } else {
                Err(e).with_context(|| format!("fetching account {address}"))
            }
        }
    }
}

pub fn send_instruction(
    rpc: &RpcClient,
    config: &RuntimeConfig,
    instruction: Instruction,
) -> Result<Signature> {
    send_instructions(rpc, config, vec![instruction])
}

#[allow(dead_code)]
pub fn send_instructions(
    rpc: &RpcClient,
    config: &RuntimeConfig,
    instructions: Vec<Instruction>,
) -> Result<Signature> {
    let instructions = with_compute_budget(instructions);
    let recent_blockhash = rpc.get_latest_blockhash()?;
    let transaction = Transaction::new_signed_with_payer(
        &instructions,
        Some(&config.payer.pubkey()),
        &[&config.payer],
        recent_blockhash,
    );
    let signature = rpc
        .send_and_confirm_transaction(&transaction)
        .with_context(|| "sending transaction")?;
    Ok(signature)
}

fn with_compute_budget(mut instructions: Vec<Instruction>) -> Vec<Instruction> {
    let budget_ix = ComputeBudgetInstruction::set_compute_unit_limit(DEFAULT_COMPUTE_UNIT_LIMIT);
    instructions.insert(0, budget_ix);
    instructions
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_instruction::AccountMeta;

    #[test]
    fn prepends_compute_budget_instruction() {
        let ix = Instruction {
            program_id: Pubkey::new_unique(),
            accounts: vec![AccountMeta::new(Pubkey::new_unique(), false)],
            data: vec![1, 2, 3],
        };

        let prepared = with_compute_budget(vec![ix.clone()]);
        assert_eq!(prepared.len(), 2);
        assert_eq!(prepared[1], ix);
        assert_eq!(
            prepared[0].program_id,
            ComputeBudgetInstruction::set_compute_unit_limit(1).program_id
        );
    }
}
