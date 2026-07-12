#!/usr/bin/env bash
#
# Container entrypoint. Materialises the payer + signer keypairs from base64-
# encoded env vars (set as platform secrets) into ephemeral files inside /tmp,
# then exec's the backend-api.
#
# Why base64 instead of mounting a secret file: hosted platforms expose env
# secrets consistently, and the keypairs here are devnet-only and explicitly
# disposable per the project's pre-alpha disclaimer.

set -euo pipefail

if [[ -n "${PORT:-}" && -z "${BACKEND_API_BIND:-}" ]]; then
  export BACKEND_API_BIND="0.0.0.0:${PORT}"
fi

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
  echo "FATAL: payer keypair not present. Set CLEAR_MSIG_KEYPAIR_BASE64." >&2
  exit 1
fi

if [[ ! -f "${CLEAR_MSIG_SIGNER:-}" ]]; then
  echo "FATAL: signer keypair not present. Set CLEAR_MSIG_SIGNER_BASE64." >&2
  exit 1
fi

if [[ "${CLEAR_MSIG_ENV:-}" == "production" ]]; then
  if [[ -z "${UPSTASH_REDIS_REST_URL:-}" || -z "${UPSTASH_REDIS_REST_TOKEN:-}" ]]; then
    echo "FATAL: production destination delivery requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN." >&2
    echo "FATAL: configure both secrets on the Render clear-msig-backend service before deploying." >&2
    exit 1
  fi
fi

# Persist DKG attestations across redeploys. The CLI saves them to
# `CLEAR_MSIG_ATTESTATION_DIR` (set to a path on the mounted persistent
# disk/volume) and re-reads them on every `proposal execute`.
# Without persistence each redeploy bricks every wallet whose chain
# bindings depend on the attestation files. Create the directory if
# the volume is freshly mounted.
if [[ -n "${CLEAR_MSIG_ATTESTATION_DIR:-}" ]]; then
  mkdir -p "$CLEAR_MSIG_ATTESTATION_DIR"
  chmod 700 "$CLEAR_MSIG_ATTESTATION_DIR"
fi

echo "starting backend-api"
echo "  payer:        $CLEAR_MSIG_KEYPAIR"
echo "  signer:       $CLEAR_MSIG_SIGNER"
echo "  rpc:          ${CLEAR_MSIG_URL:-https://api.devnet.solana.com}"
echo "  bind:         ${BACKEND_API_BIND:-0.0.0.0:8080}"
echo "  attestations: ${CLEAR_MSIG_ATTESTATION_DIR:-<host default>}"
RECEIPT_MODE="file"
if [[ -n "${UPSTASH_REDIS_REST_URL:-}" ]]; then
  RECEIPT_MODE="redis"
fi
echo "  receipts:     $RECEIPT_MODE"

exec /usr/local/bin/clear-msig-backend-api
