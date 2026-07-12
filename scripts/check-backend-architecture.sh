#!/usr/bin/env bash
set -euo pipefail

forbidden='tokio::process|std::process::Command|Command::new|CLEAR_MSIG_BIN|cli_bin'
if grep -REn "$forbidden" backend-api/src backend-api/Cargo.toml Dockerfile render.yaml; then
  echo "Backend architecture check failed: subprocess coupling was reintroduced." >&2
  exit 1
fi

grep -q 'clear-msig-cli = { path = "../cli" }' backend-api/Cargo.toml
grep -q '"in_process_bounded"' backend-api/src/runner.rs

echo "Backend architecture: shared in-process execution, no CLI subprocess coupling."
