use crate::config::RuntimeConfig;
use crate::error::*;
use solana_client::rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig};
use solana_client::rpc_filter::{Memcmp, RpcFilterType};
use solana_commitment_config::CommitmentConfig;
use solana_instruction::Instruction;
use solana_pubkey::Pubkey;
use solana_sdk::compute_budget::ComputeBudgetInstruction;
use solana_sdk::hash::Hash;
use solana_signature::Signature;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::{future::Future, sync::Arc, time::Duration};

pub trait SolanaRpcPort: Send + Sync {
    fn fetch_account(&self, address: &Pubkey) -> Result<Option<Vec<u8>>>;
    fn scan_wallet_accounts(&self, program_id: &Pubkey) -> Result<Vec<(Pubkey, Vec<u8>)>>;
    fn latest_blockhash(&self) -> Result<Hash>;
    fn send_and_confirm(&self, transaction: &Transaction) -> Result<Signature>;
}

pub trait SolanaRpcFactory: Send + Sync {
    fn connect(&self, rpc_url: String, control: crate::ExecutionControl) -> Client;
}

#[derive(Default)]
pub struct LiveSolanaRpcFactory;

impl SolanaRpcFactory for LiveSolanaRpcFactory {
    fn connect(&self, rpc_url: String, control: crate::ExecutionControl) -> Client {
        let port = LiveSolanaRpcPort {
            inner: solana_client::nonblocking::rpc_client::RpcClient::new_with_commitment(
                rpc_url,
                CommitmentConfig::confirmed(),
            ),
            control: control.clone(),
        };
        client_with_port(control, Arc::new(port))
    }
}

struct LiveSolanaRpcPort {
    inner: solana_client::nonblocking::rpc_client::RpcClient,
    control: crate::ExecutionControl,
}

impl LiveSolanaRpcPort {
    fn run<T, E>(&self, future: impl Future<Output = Result<T, E>>) -> Result<T>
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        let control = self.control.clone();
        let controlled = async move {
            tokio::select! {
                result = future => result.map_err(anyhow::Error::from),
                _ = control.cancelled() => Err(anyhow!("Solana RPC request cancelled")),
            }
        };
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.block_on(controlled)
        } else {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .with_context(|| "tokio runtime build failed")?
                .block_on(controlled)
        }
    }
}

impl SolanaRpcPort for LiveSolanaRpcPort {
    fn fetch_account(&self, address: &Pubkey) -> Result<Option<Vec<u8>>> {
        match self.run(self.inner.get_account(address)) {
            Ok(account) => Ok(Some(account.data)),
            Err(error) if is_account_not_found(&error) => Ok(None),
            Err(error) => Err(error).with_context(|| format!("fetching account {address}")),
        }
    }

    fn scan_wallet_accounts(&self, program_id: &Pubkey) -> Result<Vec<(Pubkey, Vec<u8>)>> {
        let config = RpcProgramAccountsConfig {
            filters: Some(vec![RpcFilterType::Memcmp(Memcmp::new_raw_bytes(
                0,
                vec![1u8],
            ))]),
            account_config: RpcAccountInfoConfig {
                encoding: None,
                commitment: Some(CommitmentConfig::confirmed()),
                data_slice: None,
                min_context_slot: None,
            },
            with_context: None,
            sort_results: None,
        };
        let accounts = self.run(
            self.inner
                .get_program_accounts_with_config(program_id, config),
        )?;
        Ok(accounts
            .into_iter()
            .map(|(pubkey, account)| (pubkey, account.data))
            .collect())
    }

    fn latest_blockhash(&self) -> Result<Hash> {
        self.run(self.inner.get_latest_blockhash())
    }

    fn send_and_confirm(&self, transaction: &Transaction) -> Result<Signature> {
        self.run(self.inner.send_and_confirm_transaction(transaction))
    }
}

pub struct Client {
    port: Arc<dyn SolanaRpcPort>,
    control: crate::ExecutionControl,
}

impl Client {
    pub fn wait(&self, duration: Duration) -> Result<()> {
        self.control.wait(duration)
    }
}

/// The default Solana compute budget is 200k CUs. The member-update
/// flows routinely consume that ceiling during proposal signing and
/// simulation, so we give every CLI transaction a wider headroom by
/// default instead of making each call site remember to opt in.
const DEFAULT_COMPUTE_UNIT_LIMIT: u32 = 600_000;
const RPC_SCAN_RETRY_ATTEMPTS: usize = 4;
const RPC_SEND_RETRY_ATTEMPTS: usize = 4;

pub fn client(config: &RuntimeConfig) -> Client {
    client_for_url(config, config.rpc_url.clone())
}

pub fn client_for_url(config: &RuntimeConfig, rpc_url: String) -> Client {
    config
        .solana_rpc_factory
        .connect(rpc_url, config.control.clone())
}

pub fn client_with_port(control: crate::ExecutionControl, port: Arc<dyn SolanaRpcPort>) -> Client {
    Client { port, control }
}

pub fn send_signed_transaction(rpc: &Client, transaction: &Transaction) -> Result<Signature> {
    rpc.port
        .send_and_confirm(transaction)
        .with_context(|| "sending signed Solana transaction")
}

pub fn fetch_account(rpc: &Client, address: &Pubkey) -> Result<Vec<u8>> {
    rpc.port
        .fetch_account(address)?
        .ok_or_else(|| anyhow!("account {address} not found"))
}

/// Resolve a wallet by its on-chain name. Post creator-scoped PDA
/// upgrade, the PDA is `[b"clear_wallet", creator, sha256(name)]` —
/// callers can't derive without knowing the creator first. Falls back
/// to a `getProgramAccounts` scan with a discriminator filter and
/// matches by the parsed `name` field.
///
/// Returns `(wallet_pda, parsed_account)` or an error if no match.
pub fn resolve_wallet_by_name(
    rpc: &Client,
    name: &str,
) -> Result<(Pubkey, crate::accounts::WalletAccount)> {
    let program_id = crate::instructions::program_id();
    let mut scan_attempt = 0usize;
    let accounts = loop {
        let attempt = scan_attempt + 1;
        match rpc.port.scan_wallet_accounts(&program_id) {
            Ok(accounts) => break accounts,
            Err(error) => {
                if attempt >= RPC_SCAN_RETRY_ATTEMPTS || !is_retryable_rpc_error(&error) {
                    return Err(error).with_context(|| "scanning ClearWallet accounts");
                }
                crate::progress!(
                    "devnet RPC scan failed while resolving wallet name (attempt {attempt}/{RPC_SCAN_RETRY_ATTEMPTS}); retrying..."
                );
                rpc.wait(rpc_retry_delay(attempt))?;
            }
        }
        scan_attempt += 1;
    };

    for (pubkey, data) in accounts {
        match crate::accounts::parse_wallet(&data) {
            Ok(parsed) if parsed.name == name => return Ok((pubkey, parsed)),
            _ => continue,
        }
    }

    Err(anyhow!("wallet `{name}` not found on-chain"))
}

fn rpc_retry_delay(attempt: usize) -> Duration {
    Duration::from_millis(350 * attempt as u64)
}

fn is_retryable_rpc_error(error: &impl std::fmt::Display) -> bool {
    let message = error.to_string().to_lowercase();
    [
        "error sending request",
        "connection",
        "deadline has elapsed",
        "blockhash not found",
        "max retries exceeded",
        "node is behind",
        "request failed",
        "transport",
        "timed out",
        "timeout",
        "transaction was not confirmed",
        "unable to confirm transaction",
        "too many requests",
        "429",
        "500",
        "502",
        "503",
        "504",
    ]
    .iter()
    .any(|needle| message.contains(needle))
}

fn is_account_not_found(error: &impl std::fmt::Display) -> bool {
    let message = error.to_string();
    message.contains("AccountNotFound") || message.contains("could not find account")
}

pub fn fetch_account_optional(rpc: &Client, address: &Pubkey) -> Result<Option<Vec<u8>>> {
    rpc.port.fetch_account(address)
}

pub fn send_instruction(
    rpc: &Client,
    config: &RuntimeConfig,
    instruction: Instruction,
) -> Result<Signature> {
    send_instructions(rpc, config, vec![instruction])
}

#[allow(dead_code)]
pub fn send_instructions(
    rpc: &Client,
    config: &RuntimeConfig,
    instructions: Vec<Instruction>,
) -> Result<Signature> {
    let instructions = with_compute_budget(instructions);
    for attempt in 1..=RPC_SEND_RETRY_ATTEMPTS {
        let recent_blockhash = match rpc.port.latest_blockhash() {
            Ok(blockhash) => blockhash,
            Err(error) => {
                if attempt >= RPC_SEND_RETRY_ATTEMPTS || !is_retryable_rpc_error(&error) {
                    return Err(error).with_context(|| "fetching latest blockhash");
                }
                crate::progress!(
                    "devnet RPC blockhash fetch failed (attempt {attempt}/{RPC_SEND_RETRY_ATTEMPTS}); retrying..."
                );
                rpc.wait(rpc_retry_delay(attempt))?;
                continue;
            }
        };
        let transaction = Transaction::new_signed_with_payer(
            &instructions,
            Some(&config.payer.pubkey()),
            &[&config.payer],
            recent_blockhash,
        );
        match rpc.port.send_and_confirm(&transaction) {
            Ok(signature) => return Ok(signature),
            Err(error) => {
                if attempt >= RPC_SEND_RETRY_ATTEMPTS || !is_retryable_rpc_error(&error) {
                    return Err(error).with_context(|| "sending transaction");
                }
                crate::progress!(
                    "devnet RPC send failed (attempt {attempt}/{RPC_SEND_RETRY_ATTEMPTS}); retrying with a fresh blockhash..."
                );
                rpc.wait(rpc_retry_delay(attempt))?;
            }
        }
    }
    unreachable!("bounded send retry loop always returns")
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

    struct StubRpcPort {
        account: Option<Vec<u8>>,
    }

    impl SolanaRpcPort for StubRpcPort {
        fn fetch_account(&self, _address: &Pubkey) -> Result<Option<Vec<u8>>> {
            Ok(self.account.clone())
        }

        fn scan_wallet_accounts(&self, _program_id: &Pubkey) -> Result<Vec<(Pubkey, Vec<u8>)>> {
            Ok(Vec::new())
        }

        fn latest_blockhash(&self) -> Result<Hash> {
            Ok(Hash::default())
        }

        fn send_and_confirm(&self, _transaction: &Transaction) -> Result<Signature> {
            Ok(Signature::default())
        }
    }

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

    #[test]
    fn classifies_transient_send_errors_as_retryable() {
        for message in [
            "error sending request for url",
            "Blockhash not found",
            "Data writes to account failed: Custom error: Max retries exceeded",
            "unable to confirm transaction",
            "429 Too Many Requests",
        ] {
            assert!(is_retryable_rpc_error(&message), "{message}");
        }
    }

    #[test]
    fn does_not_retry_program_logic_errors() {
        for message in [
            "custom program error: 0x1777",
            "Error processing Instruction 1: invalid account data",
            "signature verification failed",
        ] {
            assert!(!is_retryable_rpc_error(&message), "{message}");
        }
    }

    #[test]
    fn injected_port_controls_account_reads() {
        let address = Pubkey::new_unique();
        let client = client_with_port(
            crate::ExecutionControl::default(),
            Arc::new(StubRpcPort {
                account: Some(vec![7, 8, 9]),
            }),
        );
        assert_eq!(fetch_account(&client, &address).unwrap(), vec![7, 8, 9]);

        let missing = client_with_port(
            crate::ExecutionControl::default(),
            Arc::new(StubRpcPort { account: None }),
        );
        assert!(fetch_account_optional(&missing, &address)
            .unwrap()
            .is_none());
        assert!(fetch_account(&missing, &address)
            .unwrap_err()
            .to_string()
            .contains("not found"));
    }

    #[test]
    fn cancelled_rpc_drops_a_pending_network_future() {
        let control = crate::ExecutionControl::default();
        let rpc = LiveSolanaRpcPort {
            inner: solana_client::nonblocking::rpc_client::RpcClient::new(
                "http://127.0.0.1:1".to_string(),
            ),
            control: control.clone(),
        };
        control.cancel();
        let result = rpc.run(std::future::pending::<Result<(), std::io::Error>>());
        assert!(result.unwrap_err().to_string().contains("cancelled"));
    }
}
