#!/usr/bin/env bash
#
# Container entrypoint. Materialises the payer + signer keypairs from base64-
# encoded env vars (set via Fly secrets) into ephemeral files inside /tmp,
# then exec's the backend-api.
#
# Why base64 instead of mounting a volume: Fly secrets are the lowest-friction
# way to ship credentials. The keypairs we use here are devnet-only and
# explicitly disposable per the project's pre-alpha disclaimer.

set -euo pipefail

KEYPAIR_PATH="${CLEAR_MSIG_KEYPAIR:-/tmp/payer.json}"
SIGNER_PATH="${CLEAR_MSIG_SIGNER:-/tmp/signer.json}"

if [[ -n "${CLEAR_MSIG_KEYPAIR_BASE64:-}" ]]; then
  echo "$CLEAR_MSIG_KEYPAIR_BASE64" | base64 -d > "$KEYPAIR_PATH"
  chmod 600 "$KEYPAIR_PATH"
  export CLEAR_MSIG_KEYPAIR="$KEYPAIR_PATH"
fi

if [[ -n "${CLEAR_MSIG_SIGNER_BASE64:-}" ]]; then
  echo "$CLEAR_MSIG_SIGNER_BASE64" | base64 -d > "$SIGNER_PATH"
  chmod 600 "$SIGNER_PATH"
  export CLEAR_MSIG_SIGNER="$SIGNER_PATH"
fi

if [[ ! -f "${CLEAR_MSIG_KEYPAIR:-}" ]]; then
  echo "FATAL: payer keypair not present. Set CLEAR_MSIG_KEYPAIR_BASE64 (Fly secret)." >&2
  exit 1
fi

if [[ ! -f "${CLEAR_MSIG_SIGNER:-}" ]]; then
  echo "FATAL: signer keypair not present. Set CLEAR_MSIG_SIGNER_BASE64 (Fly secret)." >&2
  exit 1
fi

echo "starting backend-api"
echo "  payer:  $CLEAR_MSIG_KEYPAIR"
echo "  signer: $CLEAR_MSIG_SIGNER"
echo "  rpc:    ${CLEAR_MSIG_URL:-https://api.devnet.solana.com}"
echo "  bind:   ${BACKEND_API_BIND:-0.0.0.0:8080}"

exec /usr/local/bin/clear-msig-backend-api
