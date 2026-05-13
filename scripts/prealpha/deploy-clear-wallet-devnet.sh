#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_KEYPAIR="$ROOT_DIR/target/deploy/clear_wallet-keypair.json"
PAYER_KEYPAIR="${PAYER_KEYPAIR:-$ROOT_DIR/backend-api/keys/payer.json}"
DEVNET_URL="https://api.devnet.solana.com"

if [[ ! -f "$DEPLOY_KEYPAIR" ]]; then
  echo "Missing $DEPLOY_KEYPAIR"
  echo "Run quasar build in programs/clear-wallet first."
  exit 1
fi

cd "$ROOT_DIR"
quasar deploy -u "$DEVNET_URL" -k "$PAYER_KEYPAIR" --skip-build --program-keypair "$DEPLOY_KEYPAIR"

PROGRAM_ID="$(solana address -k "$DEPLOY_KEYPAIR")"
echo "Deployed clear-wallet Program ID: $PROGRAM_ID"
solana program show "$PROGRAM_ID" --url "$DEVNET_URL"
