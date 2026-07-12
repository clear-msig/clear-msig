#!/usr/bin/env bash
set -euo pipefail

forbidden='tokio::process|std::process::Command|Command::new|CLEAR_MSIG_BIN|cli_bin|clear_msig_cli::execute_args'
if grep -REn "$forbidden" backend-api/src backend-api/Cargo.toml Dockerfile render.yaml; then
  echo "Backend architecture check failed: a forbidden execution coupling was introduced." >&2
  exit 1
fi

grep -q 'clear-msig-cli = { path = "../cli" }' backend-api/Cargo.toml
grep -q '"in_process_bounded"' backend-api/src/runner.rs
grep -q 'clear_msig_cli::prepare_execution' backend-api/src/runner.rs
grep -q 'clear_msig_cli::execute_request' backend-api/src/runner.rs
grep -q 'run_typed_proposal' backend-api/src/proposals.rs
grep -q 'TypedProposalExecution' backend-api/src/proposals/typed_execution.rs

if grep -En 'Result<Vec<String>|&mut Vec<String>|"--[a-z]' backend-api/src/proposals/typed_execution.rs; then
  echo "Backend architecture check failed: typed proposal routes rebuilt raw adapter arguments." >&2
  exit 1
fi

echo "Backend architecture: validated typed requests, bounded in-process execution, no CLI subprocess coupling."
