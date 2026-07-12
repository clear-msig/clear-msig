#!/usr/bin/env bash
set -euo pipefail

forbidden='tokio::process|std::process::Command|Command::new|CLEAR_MSIG_BIN|cli_bin|clear_msig_cli::execute_args'
if grep -REn "$forbidden" backend-api/src backend-api/Cargo.toml Dockerfile render.yaml; then
  echo "Backend architecture check failed: a forbidden execution coupling was introduced." >&2
  exit 1
fi

grep -q 'clear-msig-cli = { path = "../cli" }' backend-api/Cargo.toml
grep -q 'clear-msig-command-contract = { path = "../crates/clear-msig-command-contract" }' backend-api/Cargo.toml
grep -q '"in_process_cancellable"' backend-api/src/runner.rs
grep -q 'clear_msig_cli::execute_request' backend-api/src/runner.rs
grep -q 'run_typed_proposal' backend-api/src/proposals.rs
grep -q 'run_typed_lifecycle' backend-api/src/proposals.rs
grep -q 'run_direct' backend-api/src/wallet.rs
grep -q 'run_direct' backend-api/src/intents.rs
grep -q 'run_direct' backend-api/src/proposals.rs
grep -q 'TypedProposalExecution' backend-api/src/proposals/typed_execution.rs
grep -q 'TypedProposalLifecycle' backend-api/src/proposals/typed_lifecycle.rs

if grep -REn 'clear_msig_cli::(DirectCommand|DirectExecutionContext|TypedProposalExecution|TypedExecutionContext|TypedProposalLifecycle|LamportPayment)' backend-api/src; then
  echo "Backend architecture check failed: backend domain types leaked back into the CLI adapter crate." >&2
  exit 1
fi

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

if grep -REn 'solana_client::rpc_client::RpcClient|std::thread::sleep' cli/src/rpc.rs cli/src/ika.rs; then
  echo "Backend architecture check failed: synchronous Solana/Ika infrastructure was reintroduced." >&2
  exit 1
fi

grep -q 'solana_client::nonblocking::rpc_client::RpcClient' cli/src/rpc.rs
grep -q 'control.cancelled()' cli/src/rpc.rs
grep -q 'control.cancelled()' cli/src/ika.rs
grep -q 'control.cancel()' backend-api/src/runner.rs

echo "Backend architecture: core-owned contracts, cancellable Solana/Ika I/O, bounded in-process execution."
