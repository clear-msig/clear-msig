#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/backend-api/.env.pre-alpha"

"$ROOT_DIR/scripts/prealpha/bootstrap-backend-env.sh"

set -a
source "$ENV_FILE"
set +a

if [[ ! -f "$CLEAR_MSIG_KEYPAIR" ]]; then
  echo "CLEAR_MSIG_KEYPAIR file not found: $CLEAR_MSIG_KEYPAIR"
  exit 1
fi

if [[ ! -f "$CLEAR_MSIG_SIGNER" ]]; then
  echo "CLEAR_MSIG_SIGNER file not found: $CLEAR_MSIG_SIGNER"
  exit 1
fi

echo "Using CLEAR_MSIG_URL=${CLEAR_MSIG_URL:-https://api.devnet.solana.com}"
cd "$ROOT_DIR"
cargo run -p clear-msig-backend-api
