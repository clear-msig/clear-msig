#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_KEYPAIR="${DEPLOY_KEYPAIR:-$ROOT_DIR/target/deploy/clear_wallet-keypair.json}"
PAYER_KEYPAIR="${PAYER_KEYPAIR:-$DEPLOY_KEYPAIR}"
UPGRADE_AUTHORITY="${UPGRADE_AUTHORITY:-$PAYER_KEYPAIR}"
DEFAULT_UPGRADE_AUTHORITY="$PAYER_KEYPAIR"
PROGRAM_SO="${PROGRAM_SO:-$ROOT_DIR/target/deploy/clear_wallet.so}"
DEFAULT_PROGRAM_ID="53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v"
PROGRAM_ID="${PROGRAM_ID:-$DEFAULT_PROGRAM_ID}"
INITIAL_DEPLOY="${INITIAL_DEPLOY:-0}"
DEVNET_URL="${DEVNET_URL:?Set DEVNET_URL to the Alchemy Solana devnet RPC URL}"
if [[ "$DEVNET_URL" != https://solana-devnet.g.alchemy.com/v2/* ]]; then
  echo "DEVNET_URL must use the configured Alchemy Solana devnet endpoint."
  exit 1
fi
DEPLOY_TRANSPORT="${DEPLOY_TRANSPORT:---use-rpc}"
DEPLOY_DRY_RUN="${DEPLOY_DRY_RUN:-0}"
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
  echo "Set PAYER_KEYPAIR=/path/to/current-upgrade-authority.json."
  echo "Current devnet authority should match: GpTfW9LiJb8pM2xmi7oENuUiV1e4LurPu9rzcPfhaJCM"
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
echo "Devnet RPC: https://solana-devnet.g.alchemy.com/v2/***"
echo "Deploy transport: $DEPLOY_TRANSPORT"
echo
echo "Current deployed program:"
CURRENT_PROGRAM="$(solana program show "$PROGRAM_ID" --url "$DEVNET_URL" --keypair "$PAYER_KEYPAIR")"
printf '%s\n' "$CURRENT_PROGRAM"

if [[ "$INITIAL_DEPLOY" != "1" ]]; then
  ARTIFACT_SIZE="$(wc -c < "$PROGRAM_SO" | tr -d ' ')"
  CURRENT_DATA_LEN="$(printf '%s\n' "$CURRENT_PROGRAM" | awk '/Data Length:/ {print $3}')"
  BUFFER_RENT="$(solana rent "$ARTIFACT_SIZE" --url "$DEVNET_URL" | awk '/Rent-exempt minimum:/ {print $3}')"
  CURRENT_PROGRAM_RENT="$(solana rent "$CURRENT_DATA_LEN" --url "$DEVNET_URL" | awk '/Rent-exempt minimum:/ {print $3}')"
  TARGET_PROGRAM_RENT="$(solana rent "$ARTIFACT_SIZE" --url "$DEVNET_URL" | awk '/Rent-exempt minimum:/ {print $3}')"
  PAYER_BALANCE="$(solana balance "$PAYER_KEYPAIR" --url "$DEVNET_URL" | awk '{print $1}')"
  REQUIRED_BALANCE="$(awk -v buffer="$BUFFER_RENT" -v current="$CURRENT_PROGRAM_RENT" -v target="$TARGET_PROGRAM_RENT" 'BEGIN {
    extension = target > current ? target - current : 0;
    printf "%.9f", buffer + extension + 0.02;
  }')"
  if ! awk -v balance="$PAYER_BALANCE" -v required="$REQUIRED_BALANCE" 'BEGIN { exit !(balance >= required) }'; then
    echo
    echo "Insufficient temporary deploy balance: ${PAYER_BALANCE} SOL available, ${REQUIRED_BALANCE} SOL required."
    echo "The requirement includes upload-buffer rent, program-data extension rent, and a fee cushion."
    exit 1
  fi
  echo "Deploy balance preflight: ${PAYER_BALANCE} SOL available, ${REQUIRED_BALANCE} SOL required"
fi
echo
if [[ "$DEPLOY_DRY_RUN" == "1" ]]; then
  echo "Deploy dry run passed; no on-chain write was submitted."
  exit 0
fi
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
