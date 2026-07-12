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

if grep -REn 'reqwest::blocking|solana_client::rpc_client::RpcClient' crates/clear-msig-execution/src; then
  echo "Execution property check failed: a blocking destination or Solana client was introduced." >&2
  exit 1
fi

grep -q 'trait DestinationTransport' crates/clear-msig-execution/src/chains/transport.rs
grep -q 'control.cancelled()' crates/clear-msig-execution/src/chains/transport.rs
grep -q 'control.cancelled()' crates/clear-msig-execution/src/chains/delivery_redis.rs
grep -q 'timeout_after_remote_acceptance_reconciles_without_rebroadcast' \
  crates/clear-msig-execution/src/chains/delivery.rs
grep -q 'malformed_status_response_keeps_delivery_unknown_and_blocks_retry' \
  crates/clear-msig-execution/src/chains/delivery.rs
grep -q 'tampered_persisted_receipt_fails_before_broadcast' \
  crates/clear-msig-execution/src/chains/delivery.rs
grep -q 'distributed_lease_excludes_another_instance_and_releases_by_token' \
  crates/clear-msig-execution/src/chains/delivery_redis.rs
grep -q 'redis_outage_fails_closed_for_lease_and_receipts' \
  crates/clear-msig-execution/src/chains/delivery_redis.rs
grep -q 'signed_preimage_binds_chain_nonce_and_calldata' \
  programs/clear-wallet/client/src/chains.rs
grep -q 'test_execute_typed_chain_send_finalizes_verified_remote_send' \
  programs/clear-wallet/src/tests.rs
grep -q 'interrupted_ika_execution_reuses_only_a_signed_message_approval' \
  crates/clear-msig-execution/src/commands/proposal.rs
grep -q 'cancellation_drops_pending_ika_io' \
  crates/clear-msig-execution/src/ika.rs

echo "Execution properties: replaceable relayer, replay guard, distributed delivery leases, adversarial substitution/retry coverage, and cancellable destination transport."
