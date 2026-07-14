#!/usr/bin/env bash
#
# Quick smoke test for the live deployment.
#
# Verifies:
#   - Render backend /health
#   - Vercel frontend /api/prices
#   - Optional backend membership lookup when an address is supplied
#
# Usage:
#   BACKEND_URL=https://clear-msig-backend-production.up.railway.app \
#   FRONTEND_URL=https://clearsig.xyz \
#   ./scripts/smoke-live.sh [--address <solana-pubkey>]

set -euo pipefail

BACKEND_URL="${BACKEND_URL:-https://clear-msig-backend-production.up.railway.app}"
FRONTEND_URL="${FRONTEND_URL:-https://clearsig.xyz}"
ADDRESS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --address)
      ADDRESS="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

curl_json() {
  curl -fsSL "$1"
}

echo "Checking backend health: ${BACKEND_URL}/health"
health="$(curl_json "${BACKEND_URL}/health")"
echo "$health" | grep -q '"status":"ok"'
echo "$health" | grep -q '"destination_receipt_storage":"redis"'
echo "  ok"

echo "Checking frontend live prices: ${FRONTEND_URL}/api/prices"
prices="$(curl_json "${FRONTEND_URL}/api/prices")"
echo "$prices" | grep -q '"SOL"'
echo "  ok"

if [[ -n "$ADDRESS" ]]; then
  echo "Checking backend membership lookup"
  membership="$(curl_json "${BACKEND_URL}/memberships?address=${ADDRESS}")"
  echo "$membership" | grep -q '"organizations"'
  echo "  ok"
fi

echo "Smoke test passed."
