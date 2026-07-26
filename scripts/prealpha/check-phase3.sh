#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_ENV="$ROOT_DIR/apps/api/.env.pre-alpha"
FRONTEND_ENV="$ROOT_DIR/apps/web/.env.local"

if [[ ! -f "$BACKEND_ENV" ]]; then
  "$ROOT_DIR/scripts/prealpha/bootstrap-backend-env.sh"
fi

if [[ ! -f "$FRONTEND_ENV" ]]; then
  "$ROOT_DIR/scripts/prealpha/bootstrap-frontend-env.sh"
fi

set -a
source "$BACKEND_ENV"
source "$FRONTEND_ENV"
set +a

BASE_URL="${NEXT_PUBLIC_BACKEND_API_URL:-http://127.0.0.1:8080}"
CHAIN="${NEXT_PUBLIC_IKA_CHAIN:-evm_1559}"
DWALLET_PROGRAM="${NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID:-87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY}"
GRPC_URL="${NEXT_PUBLIC_IKA_GRPC_URL:-https://pre-alpha-dev-1.ika.ika-network.net:443}"

if [[ -n "${PHASE3_SIGNER_PUBKEY:-}" ]]; then
  SIGNER_PUBKEY="$PHASE3_SIGNER_PUBKEY"
elif command -v solana-keygen >/dev/null 2>&1; then
  SIGNER_PUBKEY="$(solana-keygen pubkey "${CLEAR_MSIG_SIGNER}")"
else
  echo "Missing signer pubkey. Set PHASE3_SIGNER_PUBKEY or install solana-keygen."
  exit 1
fi

WALLET_NAME="phase3-$RANDOM-$RANDOM"

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  local response_file
  response_file="$(mktemp)"

  local status
  if [[ -n "$body" ]]; then
    status=$(curl -sS -o "$response_file" -w '%{http_code}' -X "$method" \
      -H 'Content-Type: application/json' \
      -d "$body" \
      "$BASE_URL$path")
  else
    status=$(curl -sS -o "$response_file" -w '%{http_code}' -X "$method" \
      "$BASE_URL$path")
  fi

  echo "[$method $path] status=$status"
  cat "$response_file"
  echo

  if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
    echo "Request failed: $method $path"
    rm -f "$response_file"
    exit 1
  fi

  rm -f "$response_file"
}

echo "== Phase 3: wallet onboarding verification =="
request GET "/health"

create_wallet_payload=$(cat <<JSON
{"name":"$WALLET_NAME","proposers":["$SIGNER_PUBKEY"],"approvers":["$SIGNER_PUBKEY"],"threshold":1,"cancellation_threshold":1,"timelock":0}
JSON
)
request POST "/wallets" "$create_wallet_payload"

request GET "/wallets/$WALLET_NAME"

add_chain_payload=$(cat <<JSON
{"chain":"$CHAIN","dwallet_program":"$DWALLET_PROGRAM","grpc_url":"$GRPC_URL"}
JSON
)
request POST "/wallets/$WALLET_NAME/chains/add" "$add_chain_payload"

request GET "/wallets/$WALLET_NAME/chains"

echo "Phase 3 checks completed for wallet: $WALLET_NAME"
echo "Manual ownership lock validation: attempt bind same dWallet from another wallet and confirm rejection."
