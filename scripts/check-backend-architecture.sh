#!/usr/bin/env bash
set -euo pipefail

while IFS= read -r file; do
  lines="$(wc -l < "$file" | tr -d ' ')"
  if [[ "$lines" -gt 1000 ]]; then
    echo "Backend architecture check failed: $file has $lines lines (limit 1000)." >&2
    exit 1
  fi
done < <(find apps/api/src -name '*.rs' -type f | sort)

forbidden='tokio::process|std::process::Command|Command::new|CLEAR_MSIG_BIN|cli_bin|CliRunner|clear_msig_cli|clear-msig-cli'
if grep -REn "$forbidden" apps/api/src apps/api/Cargo.toml Dockerfile railway.json; then
  echo "Backend architecture check failed: a forbidden execution coupling was introduced." >&2
  exit 1
fi

grep -q 'clear-msig-execution = { path = "../../crates/clear-msig-execution" }' apps/api/Cargo.toml
grep -q 'clear-msig-command-contract = { path = "../../crates/clear-msig-command-contract" }' apps/api/Cargo.toml
grep -q '"in_process_cancellable"' apps/api/src/runner.rs
grep -q 'clear_msig_execution::execute_request' apps/api/src/runner.rs
grep -q 'run_typed_proposal' apps/api/src/proposals.rs
grep -q 'run_typed_lifecycle' apps/api/src/proposals.rs
grep -q 'run_direct' apps/api/src/wallet.rs
grep -q 'run_direct' apps/api/src/intents.rs
grep -q 'run_direct' apps/api/src/proposals.rs
grep -q 'TypedProposalExecution' apps/api/src/proposals/typed_execution.rs
grep -q 'TypedProposalLifecycle' apps/api/src/proposals/typed_lifecycle.rs
grep -q 'TypedProposalExecution::AgentRiskPolicy' apps/api/src/proposals/typed_agent_risk.rs
grep -q 'TypedProposalExecution::AgentTradeSettlement' apps/api/src/proposals/typed_agent_risk.rs
grep -q 'typed-agent-risk-policy' apps/api/src/proposals.rs
grep -q 'typed-agent-trade-settlement' apps/api/src/proposals.rs

if grep -REn 'clear_msig_execution::(DirectCommand|DirectExecutionContext|TypedProposalExecution|TypedExecutionContext|TypedProposalLifecycle|LamportPayment)' apps/api/src; then
  echo "Backend architecture check failed: backend domain types leaked into the execution infrastructure crate." >&2
  exit 1
fi

if grep -REn 'clear-wallet|solana|ika|reqwest|tokio' apps/cli/Cargo.toml apps/cli/src; then
  echo "Backend architecture check failed: execution dependencies leaked into the thin CLI package." >&2
  exit 1
fi
grep -q 'clear_msig_execution::prepare_command' apps/cli/src/main.rs
grep -q 'clear_msig_execution::execute_request' apps/cli/src/main.rs

if grep -REn 'clap|ConfigAction|WalletAction|IntentAction|ProposalAction|"--[a-z]' crates/clear-msig-command-contract/src; then
  echo "Backend architecture check failed: CLI adapter vocabulary leaked into the command core." >&2
  exit 1
fi

if grep -En 'Result<Vec<String>|&mut Vec<String>|"--[a-z]' apps/api/src/proposals/typed_execution.rs; then
  echo "Backend architecture check failed: typed proposal routes rebuilt raw adapter arguments." >&2
  exit 1
fi

if grep -En 'Result<Vec<String>|&mut Vec<String>|"--[a-z]' apps/api/src/proposals/typed_lifecycle.rs; then
  echo "Backend architecture check failed: typed lifecycle routes rebuilt raw adapter arguments." >&2
  exit 1
fi

if grep -En '"typed-(create|approve|cancel|execute)"\.(into|to_string)' apps/api/src/proposals.rs; then
  echo "Backend architecture check failed: typed lifecycle handlers bypassed their domain module." >&2
  exit 1
fi

for module in apps/api/src/wallet.rs apps/api/src/intents.rs apps/api/src/proposals.rs; do
  if grep -En 'run_json|&mut Vec<String>|"--[a-z]' "$module"; then
    echo "Backend architecture check failed: $module rebuilt raw adapter arguments." >&2
    exit 1
  fi
done

if grep -En 'run_json|"--[a-z]' apps/api/src/clearsign.rs; then
  echo "Backend architecture check failed: ClearSign preparation bypassed typed wallet lookup." >&2
  exit 1
fi

if grep -REn 'run_json|prepare_execution|validate_invocation_args|base_args' apps/api/src; then
  echo "Backend architecture check failed: a CLI-shaped compatibility path was reintroduced." >&2
  exit 1
fi

if grep -REn 'solana_(rpc_)?client::rpc_client::RpcClient|std::thread::sleep' crates/clear-msig-execution/src/rpc.rs crates/clear-msig-execution/src/ika.rs; then
  echo "Backend architecture check failed: synchronous Solana/Ika infrastructure was reintroduced." >&2
  exit 1
fi

grep -q 'solana_rpc_client::nonblocking::rpc_client::RpcClient' crates/clear-msig-execution/src/rpc.rs
grep -q 'trait SolanaRpcPort' crates/clear-msig-execution/src/rpc.rs
grep -q 'trait SolanaRpcFactory' crates/clear-msig-execution/src/rpc.rs
grep -q 'Arc<dyn SolanaRpcPort>' crates/clear-msig-execution/src/rpc.rs
grep -q 'with_solana_rpc_factory' crates/clear-msig-execution/src/lib.rs
grep -q 'solana_rpc_factory: std::sync::Arc<dyn crate::rpc::SolanaRpcFactory>' crates/clear-msig-execution/src/config.rs
if grep -REn 'solana_(rpc_)?client::.*RpcClient' crates/clear-msig-execution/src/commands; then
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
grep -q 'clear_wallet_client::generated::approve::ApproveInstruction' crates/clear-msig-execution/src/instructions.rs
if [[ -d crates/clear-msig-execution/src/quasar_client || -d apps/e2e/src/quasar_client ]]; then
  echo "Backend architecture check failed: duplicate generated Solana client found." >&2
  exit 1
fi
grep -q 'trait DestinationReceiptStore' crates/clear-msig-execution/src/chains/delivery.rs
grep -q 'with_destination_receipt_store' crates/clear-msig-execution/src/lib.rs
grep -q 'with_destination_receipt_store(self.destination_receipt_store.clone())' apps/api/src/runner.rs
grep -q 'destination_receipt_store:' crates/clear-msig-execution/src/config.rs
grep -q 'struct UpstashDestinationReceiptStore' crates/clear-msig-execution/src/chains/delivery_redis.rs
grep -q 'acquire_execution_lease' crates/clear-msig-execution/src/chains/delivery_redis.rs
grep -q 'production destination delivery requires UPSTASH_REDIS_REST_URL' apps/api/src/runner.rs
grep -q 'destination_receipt_storage":"redis"' scripts/smoke-live.sh
grep -q 'ReconciledDestinationTransport' crates/clear-msig-execution/src/chains/delivery.rs
grep -q 'UPSTASH_REDIS_REST_URL' ops/entrypoint.sh
grep -q 'unknown_delivery_refuses_rebroadcast_when_reconciliation_is_down' crates/clear-msig-execution/src/chains/delivery.rs
grep -q 'control.cancel()' apps/api/src/runner.rs
grep -q 'cargo test -p clear-msig-command-contract -p clear-msig-intent -p clear-msig-signing -p clear-msig-execution -p clear-msig-cli -p clear-wallet-client -p clear-msig-backend-api' .github/workflows/ci.yml
grep -q 'cargo clippy -p clear-msig-backend-api -p clear-msig-command-contract -p clear-msig-intent -p clear-msig-signing -p clear-msig-cli' .github/workflows/ci.yml

bash scripts/check-execution-properties.sh

echo "Backend architecture: command contracts + reusable execution library + thin CLI, with injected Solana/Ika ports and durable destination reconciliation."
