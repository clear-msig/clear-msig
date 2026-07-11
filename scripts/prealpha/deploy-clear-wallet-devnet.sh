#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_KEYPAIR="${DEPLOY_KEYPAIR:-$ROOT_DIR/target/deploy/clear_wallet-keypair.json}"
PAYER_KEYPAIR="${PAYER_KEYPAIR:-$ROOT_DIR/backend-api/keys/payer.json}"
UPGRADE_AUTHORITY="${UPGRADE_AUTHORITY:-$PAYER_KEYPAIR}"
DEFAULT_UPGRADE_AUTHORITY="$PAYER_KEYPAIR"
PROGRAM_SO="${PROGRAM_SO:-$ROOT_DIR/target/deploy/clear_wallet.so}"
DEFAULT_PROGRAM_ID="53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v"
PROGRAM_ID="${PROGRAM_ID:-$DEFAULT_PROGRAM_ID}"
INITIAL_DEPLOY="${INITIAL_DEPLOY:-0}"
DEVNET_URL="${DEVNET_URL:-https://api.devnet.solana.com}"
DEPLOY_TRANSPORT="${DEPLOY_TRANSPORT:---use-quic}"
TEMP_KEYPAIRS=()

cleanup_temp_keypairs() {
  local keypair
  for keypair in ${TEMP_KEYPAIRS+"${TEMP_KEYPAIRS[@]}"}; do
    if [[ -n "$keypair" && -f "$keypair" ]]; then
      rm -f "$keypair"
    fi
  done
}
trap cleanup_temp_keypairs EXIT

materialize_keypair_base64() {
  local env_name="$1"
  local path_prefix="$2"
  local raw="${!env_name:-}"
  if [[ -z "$raw" ]]; then
    return 0
  fi

  local keypair
  keypair="$(mktemp "${TMPDIR:-/tmp}/${path_prefix}.XXXXXX.json")"
  printf '%s' "$raw" | base64 --decode > "$keypair"
  chmod 600 "$keypair"
  TEMP_KEYPAIRS+=("$keypair")
  printf '%s\n' "$keypair"
}

PAYER_KEYPAIR_FROM_BASE64="$(materialize_keypair_base64 PAYER_KEYPAIR_BASE64 clear-wallet-payer)"
UPGRADE_AUTHORITY_FROM_BASE64="$(materialize_keypair_base64 UPGRADE_AUTHORITY_BASE64 clear-wallet-upgrade-authority)"

if [[ -n "$PAYER_KEYPAIR_FROM_BASE64" ]]; then
  PAYER_KEYPAIR="$PAYER_KEYPAIR_FROM_BASE64"
fi

if [[ -n "$UPGRADE_AUTHORITY_FROM_BASE64" ]]; then
  UPGRADE_AUTHORITY="$UPGRADE_AUTHORITY_FROM_BASE64"
elif [[ "$UPGRADE_AUTHORITY" == "$DEFAULT_UPGRADE_AUTHORITY" && -n "$PAYER_KEYPAIR_FROM_BASE64" ]]; then
  UPGRADE_AUTHORITY="$PAYER_KEYPAIR"
fi

if [[ ! -f "$PROGRAM_SO" ]]; then
  echo "Missing $PROGRAM_SO"
  echo "Download the passing GitHub Actions clear_wallet-so artifact into target/deploy first."
  exit 1
fi

if [[ "$INITIAL_DEPLOY" == "1" ]]; then
  if [[ ! -f "$DEPLOY_KEYPAIR" ]]; then
    echo "Missing $DEPLOY_KEYPAIR"
    echo "Initial deploys need the program keypair."
    exit 1
  fi
  PROGRAM_ID="$(solana address -k "$DEPLOY_KEYPAIR")"
  PROGRAM_ID_ARG="$DEPLOY_KEYPAIR"
else
  PROGRAM_ID_ARG="$PROGRAM_ID"
  echo "Using existing program ID for upgrade: $PROGRAM_ID"
  echo "Set INITIAL_DEPLOY=1 to deploy with $DEPLOY_KEYPAIR instead."
  echo
fi

if [[ ! -f "$PAYER_KEYPAIR" ]]; then
  echo "Missing $PAYER_KEYPAIR"
  echo "Set PAYER_KEYPAIR=/path/to/funded-upgrade-authority.json or restore backend-api/keys/payer.json."
  exit 1
fi

if [[ ! -f "$UPGRADE_AUTHORITY" ]]; then
  echo "Missing $UPGRADE_AUTHORITY"
  echo "Set UPGRADE_AUTHORITY=/path/to/current-upgrade-authority.json."
  exit 1
fi

cd "$ROOT_DIR"

echo "clear-wallet Program ID: $PROGRAM_ID"
echo "Program binary: $PROGRAM_SO"
echo "Program SHA256: $(shasum -a 256 "$PROGRAM_SO" | awk '{print $1}')"
echo "Payer: $(solana address -k "$PAYER_KEYPAIR")"
echo "Upgrade authority: $(solana address -k "$UPGRADE_AUTHORITY")"
echo "Deploy transport: $DEPLOY_TRANSPORT"
echo
echo "Current deployed program:"
solana program show "$PROGRAM_ID" --url "$DEVNET_URL" --keypair "$PAYER_KEYPAIR" || true
echo
echo "Deploying upgrade to devnet..."
solana program deploy "$PROGRAM_SO" \
  --url "$DEVNET_URL" \
  --program-id "$PROGRAM_ID_ARG" \
  --keypair "$PAYER_KEYPAIR" \
  --upgrade-authority "$UPGRADE_AUTHORITY" \
  "$DEPLOY_TRANSPORT"

echo
echo "Upgraded clear-wallet Program ID: $PROGRAM_ID"
solana program show "$PROGRAM_ID" --url "$DEVNET_URL" --keypair "$PAYER_KEYPAIR"
