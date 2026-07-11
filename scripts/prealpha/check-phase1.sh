#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_ENV="$ROOT_DIR/backend-api/.env.pre-alpha"
FRONTEND_ENV="$ROOT_DIR/frontend/.env.local"

EXPECTED_GRPC="https://pre-alpha-dev-1.ika.ika-network.net:443"
EXPECTED_SOLANA_RPC="https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH"
EXPECTED_DWALLET_PROGRAM="87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY"

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

if [[ "${CLEAR_MSIG_URL:-}" != "$EXPECTED_SOLANA_RPC" ]]; then
  echo "WARN: CLEAR_MSIG_URL is '${CLEAR_MSIG_URL:-unset}', expected '$EXPECTED_SOLANA_RPC'"
else
  echo "OK: CLEAR_MSIG_URL"
fi

if [[ "${NEXT_PUBLIC_IKA_GRPC_URL:-}" != "$EXPECTED_GRPC" ]]; then
  echo "WARN: NEXT_PUBLIC_IKA_GRPC_URL is '${NEXT_PUBLIC_IKA_GRPC_URL:-unset}', expected '$EXPECTED_GRPC'"
else
  echo "OK: NEXT_PUBLIC_IKA_GRPC_URL"
fi

if [[ "${NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID:-}" != "$EXPECTED_DWALLET_PROGRAM" ]]; then
  echo "WARN: NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID is '${NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID:-unset}', expected '$EXPECTED_DWALLET_PROGRAM'"
else
  echo "OK: NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID"
fi

HEALTH_URL="${NEXT_PUBLIC_BACKEND_API_URL:-http://127.0.0.1:8080}/health"
if curl -sSf "$HEALTH_URL" >/dev/null 2>&1; then
  echo "OK: backend health reachable at $HEALTH_URL"
else
  echo "WARN: backend health not reachable at $HEALTH_URL"
fi
