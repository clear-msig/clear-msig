#!/usr/bin/env bash
set -euo pipefail

execute_modules=(
  programs/clear-wallet/src/instructions/execute.rs
  programs/clear-wallet/src/instructions/ika_sign.rs
  programs/clear-wallet/src/instructions/typed_*.rs
  programs/clear-wallet/src/instructions/wallet_policy.rs
)

if grep -En 'has_one = payer|payer.*(proposer|approver)|(proposer|approver).*payer' "${execute_modules[@]}"; then
  echo "Execution property check failed: an executor payer was coupled to wallet membership." >&2
  exit 1
fi

grep -q 'constraint = proposal.status == ProposalStatus::Approved' \
  programs/clear-wallet/src/instructions/typed_proposal.rs
grep -q 'proposal.status = ProposalStatus::Executed' \
  programs/clear-wallet/src/instructions/typed_proposal.rs
grep -q 'test_execute_typed_sol_send_is_permissionless_and_idempotent' \
  programs/clear-wallet/src/tests.rs

if grep -REn 'reqwest::blocking|solana_client::rpc_client::RpcClient' cli/src; then
  echo "Execution property check failed: a blocking destination or Solana client was introduced." >&2
  exit 1
fi

grep -q 'trait DestinationTransport' cli/src/chains/transport.rs
grep -q 'control.cancelled()' cli/src/chains/transport.rs

echo "Execution properties: replaceable relayer, replay guard, cancellable destination transport."
