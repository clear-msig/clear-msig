#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/backend-api/.env.pre-alpha"
EXAMPLE_FILE="$ROOT_DIR/backend-api/.env.pre-alpha.example"
KEYS_DIR="$ROOT_DIR/backend-api/keys"

mkdir -p "$KEYS_DIR"

set_env_var() {
  local key="$1"
  local value="$2"
  local file="$3"

  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "Created $ENV_FILE from template."
fi

set -a
source "$ENV_FILE"
set +a

KEYPAIR_PATH="${CLEAR_MSIG_KEYPAIR:-}"
SIGNER_PATH="${CLEAR_MSIG_SIGNER:-}"

if [[ -z "$KEYPAIR_PATH" || "$KEYPAIR_PATH" == "/absolute/path/to/payer.json" ]]; then
  KEYPAIR_PATH="$KEYS_DIR/payer.json"
fi

if [[ -z "$SIGNER_PATH" || "$SIGNER_PATH" == "/absolute/path/to/signer.json" ]]; then
  SIGNER_PATH="$KEYS_DIR/signer.json"
fi

if [[ ! -f "$KEYPAIR_PATH" ]]; then
  if command -v solana-keygen >/dev/null 2>&1; then
    solana-keygen new --no-bip39-passphrase --silent --force -o "$KEYPAIR_PATH" >/dev/null
    echo "Generated payer keypair: $KEYPAIR_PATH"
  else
    echo "solana-keygen is not installed; cannot generate payer keypair."
    echo "Set CLEAR_MSIG_KEYPAIR manually in $ENV_FILE"
    exit 1
  fi
fi

if [[ ! -f "$SIGNER_PATH" ]]; then
  if command -v solana-keygen >/dev/null 2>&1; then
    solana-keygen new --no-bip39-passphrase --silent --force -o "$SIGNER_PATH" >/dev/null
    echo "Generated signer keypair: $SIGNER_PATH"
  else
    echo "solana-keygen is not installed; cannot generate signer keypair."
    echo "Set CLEAR_MSIG_SIGNER manually in $ENV_FILE"
    exit 1
  fi
fi

set_env_var "CLEAR_MSIG_KEYPAIR" "$KEYPAIR_PATH" "$ENV_FILE"
set_env_var "CLEAR_MSIG_SIGNER" "$SIGNER_PATH" "$ENV_FILE"
set_env_var "CLEAR_MSIG_URL" "${CLEAR_MSIG_URL:-https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH}" "$ENV_FILE"
set_env_var "BACKEND_API_BIND" "${BACKEND_API_BIND:-127.0.0.1:8080}" "$ENV_FILE"

echo "Backend env ready: $ENV_FILE"
