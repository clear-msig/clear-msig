#!/usr/bin/env bash
set -euo pipefail

forbidden='tokio::process|std::process::Command|Command::new|CLEAR_MSIG_BIN|cli_bin|CliRunner|clear_msig_cli|clear-msig-cli'
if grep -REn "$forbidden" backend-api/src backend-api/Cargo.toml Dockerfile render.yaml; then
  echo "Backend architecture check failed: a forbidden execution coupling was introduced." >&2
  exit 1
fi

grep -q 'clear-msig-execution = { path = "../crates/clear-msig-execution" }' backend-api/Cargo.toml
grep -q 'clear-msig-command-contract = { path = "../crates/clear-msig-command-contract" }' backend-api/Cargo.toml
grep -q '"in_process_cancellable"' backend-api/src/runner.rs
grep -q 'clear_msig_execution::execute_request' backend-api/src/runner.rs
grep -q 'run_typed_proposal' backend-api/src/proposals.rs
grep -q 'run_typed_lifecycle' backend-api/src/proposals.rs
grep -q 'run_direct' backend-api/src/wallet.rs
grep -q 'run_direct' backend-api/src/intents.rs
grep -q 'run_direct' backend-api/src/proposals.rs
grep -q 'TypedProposalExecution' backend-api/src/proposals/typed_execution.rs
grep -q 'TypedProposalLifecycle' backend-api/src/proposals/typed_lifecycle.rs

if grep -REn 'clear_msig_execution::(DirectCommand|DirectExecutionContext|TypedProposalExecution|TypedExecutionContext|TypedProposalLifecycle|LamportPayment)' backend-api/src; then
  echo "Backend architecture check failed: backend domain types leaked into the execution infrastructure crate." >&2
  exit 1
fi

if grep -REn 'clear-wallet|solana|ika|reqwest|tokio' cli/Cargo.toml cli/src; then
  echo "Backend architecture check failed: execution dependencies leaked into the thin CLI package." >&2
  exit 1
fi
grep -q 'clear_msig_execution::prepare_command' cli/src/main.rs
grep -q 'clear_msig_execution::execute_request' cli/src/main.rs

if grep -REn 'clap|ConfigAction|WalletAction|IntentAction|ProposalAction|"--[a-z]' crates/clear-msig-command-contract/src; then
  echo "Backend architecture check failed: CLI adapter vocabulary leaked into the command core." >&2
  exit 1
fi

if grep -En 'Result<Vec<String>|&mut Vec<String>|"--[a-z]' backend-api/src/proposals/typed_execution.rs; then
  echo "Backend architecture check failed: typed proposal routes rebuilt raw adapter arguments." >&2
  exit 1
fi

if grep -En 'Result<Vec<String>|&mut Vec<String>|"--[a-z]' backend-api/src/proposals/typed_lifecycle.rs; then
  echo "Backend architecture check failed: typed lifecycle routes rebuilt raw adapter arguments." >&2
  exit 1
fi

if grep -En '"typed-(create|approve|cancel|execute)"\.(into|to_string)' backend-api/src/proposals.rs; then
  echo "Backend architecture check failed: typed lifecycle handlers bypassed their domain module." >&2
  exit 1
fi

for module in backend-api/src/wallet.rs backend-api/src/intents.rs backend-api/src/proposals.rs; do
  if grep -En 'run_json|&mut Vec<String>|"--[a-z]' "$module"; then
    echo "Backend architecture check failed: $module rebuilt raw adapter arguments." >&2
    exit 1
  fi
done

if grep -En 'run_json|"--[a-z]' backend-api/src/clearsign.rs; then
  echo "Backend architecture check failed: ClearSign preparation bypassed typed wallet lookup." >&2
  exit 1
fi

if grep -REn 'run_json|prepare_execution|validate_invocation_args|base_args' backend-api/src; then
  echo "Backend architecture check failed: a CLI-shaped compatibility path was reintroduced." >&2
  exit 1
fi

if grep -REn 'solana_client::rpc_client::RpcClient|std::thread::sleep' crates/clear-msig-execution/src/rpc.rs crates/clear-msig-execution/src/ika.rs; then
  echo "Backend architecture check failed: synchronous Solana/Ika infrastructure was reintroduced." >&2
  exit 1
fi

grep -q 'solana_client::nonblocking::rpc_client::RpcClient' crates/clear-msig-execution/src/rpc.rs
grep -q 'trait SolanaRpcPort' crates/clear-msig-execution/src/rpc.rs
grep -q 'trait SolanaRpcFactory' crates/clear-msig-execution/src/rpc.rs
grep -q 'Arc<dyn SolanaRpcPort>' crates/clear-msig-execution/src/rpc.rs
grep -q 'with_solana_rpc_factory' crates/clear-msig-execution/src/lib.rs
grep -q 'solana_rpc_factory: std::sync::Arc<dyn crate::rpc::SolanaRpcFactory>' crates/clear-msig-execution/src/config.rs
if grep -REn 'solana_client::.*RpcClient' crates/clear-msig-execution/src/commands; then
  echo "Backend architecture check failed: command handlers bypassed the Solana RPC port." >&2
  exit 1
fi
grep -q 'control.cancelled()' crates/clear-msig-execution/src/rpc.rs
grep -q 'trait IkaGrpcPort' crates/clear-msig-execution/src/ika.rs
grep -q 'with_ika_grpc_port' crates/clear-msig-execution/src/lib.rs
grep -q 'ika_grpc_port: std::sync::Arc<dyn crate::ika::IkaGrpcPort>' crates/clear-msig-execution/src/config.rs
grep -q 'cancellation_drops_pending_ika_io' crates/clear-msig-execution/src/ika.rs
if grep -REn 'DWalletServiceClient|submit_transaction' crates/clear-msig-execution/src/commands; then
  echo "Backend architecture check failed: command handlers bypassed the Ika gRPC port." >&2
  exit 1
fi
grep -q 'control.cancelled()' crates/clear-msig-execution/src/ika.rs
grep -q 'control.cancel()' backend-api/src/runner.rs
grep -q 'cargo test -p clear-msig-command-contract -p clear-msig-execution -p clear-msig-cli -p clear-wallet-client -p clear-msig-backend-api' .github/workflows/ci.yml
grep -q 'cargo clippy -p clear-msig-backend-api -p clear-msig-command-contract -p clear-msig-cli' .github/workflows/ci.yml

bash scripts/check-execution-properties.sh

echo "Backend architecture: command contracts + reusable execution library + thin CLI, with injected Solana, Ika, and destination ports."
