#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_MAIN="$ROOT_DIR/backend-api/src/main.rs"
FRONTEND_ENDPOINTS="$ROOT_DIR/frontend/src/lib/api/endpoints.ts"

require_pattern() {
  local pattern="$1"
  local file="$2"
  local label="$3"
  if grep -Fq -- "$pattern" "$file"; then
    echo "OK: $label"
  else
    echo "FAIL: missing $label in $file"
    exit 1
  fi
}

echo "== Phase 2: Backend endpoint coverage check =="
require_pattern 'route("/health", get(health))' "$BACKEND_MAIN" "health route"
require_pattern 'route("/wallets", post(create_wallet))' "$BACKEND_MAIN" "create wallet route"
require_pattern 'route("/wallets/{name}", get(show_wallet))' "$BACKEND_MAIN" "show wallet route"
require_pattern 'route("/wallets/{name}/chains", get(list_wallet_chains))' "$BACKEND_MAIN" "list chains route"
require_pattern 'route("/wallets/{name}/chains/add", post(add_wallet_chain))' "$BACKEND_MAIN" "add chain route"
require_pattern 'route("/wallets/{name}/intents", get(list_intents))' "$BACKEND_MAIN" "list intents route"
require_pattern 'route("/wallets/{name}/intents/add", post(add_intent))' "$BACKEND_MAIN" "add intent route"
require_pattern 'route("/wallets/{name}/intents/remove", post(remove_intent))' "$BACKEND_MAIN" "remove intent route"
require_pattern 'route("/wallets/{name}/intents/update", post(update_intent))' "$BACKEND_MAIN" "update intent route"
require_pattern 'route("/wallets/{name}/proposals", post(create_proposal).get(list_proposals))' "$BACKEND_MAIN" "create/list proposals route"
require_pattern '/wallets/{name}/proposals/{proposal}/approve' "$BACKEND_MAIN" "approve proposal route"
require_pattern '/wallets/{name}/proposals/{proposal}/cancel' "$BACKEND_MAIN" "cancel proposal route"
require_pattern '/wallets/{name}/proposals/{proposal}/execute' "$BACKEND_MAIN" "execute proposal route"
require_pattern 'route("/proposals/{proposal}", get(show_proposal))' "$BACKEND_MAIN" "show proposal route"
require_pattern 'route("/proposals/{proposal}/cleanup", post(cleanup_proposal))' "$BACKEND_MAIN" "cleanup route"

echo "== Phase 2: Frontend uses backend API layer =="
require_pattern 'health:' "$FRONTEND_ENDPOINTS" "health endpoint client"
require_pattern 'createWallet:' "$FRONTEND_ENDPOINTS" "create wallet endpoint client"
require_pattern 'addWalletChain:' "$FRONTEND_ENDPOINTS" "add chain endpoint client"
require_pattern 'addIntent:' "$FRONTEND_ENDPOINTS" "add intent endpoint client"
require_pattern 'createProposal:' "$FRONTEND_ENDPOINTS" "create proposal endpoint client"
require_pattern 'approveProposal:' "$FRONTEND_ENDPOINTS" "approve proposal endpoint client"
require_pattern 'cancelProposal:' "$FRONTEND_ENDPOINTS" "cancel proposal endpoint client"
require_pattern 'executeProposal:' "$FRONTEND_ENDPOINTS" "execute proposal endpoint client"
require_pattern 'cleanupProposal:' "$FRONTEND_ENDPOINTS" "cleanup proposal endpoint client"

echo "== Phase 2: Execute flag mapping check =="
require_pattern '"--dwallet-program".to_string()' "$BACKEND_MAIN" "dwallet_program mapping"
require_pattern '"--grpc-url".to_string()' "$BACKEND_MAIN" "grpc_url mapping"
require_pattern '"--rpc-url".to_string()' "$BACKEND_MAIN" "rpc_url mapping"
require_pattern '"--broadcast".to_string()' "$BACKEND_MAIN" "broadcast mapping"

echo "== Phase 2: No direct frontend chain/RPC bypass =="

# Allowed files that MAY call fetch() directly.
#   - lib/api/client.ts      — the central backend API gateway used by all hooks
#   - lib/organizations/client.ts — POSTs to Next.js /api/invitations (same-origin)
ALLOWED_FETCH_PATTERN='frontend/src/lib/(api|organizations)/client\.ts'

matches=$(grep -R --line-number -E '(^|[^[:alnum:]_])fetch\(' "$ROOT_DIR/frontend/src" || true)
disallowed=$(echo "$matches" | grep -vE "$ALLOWED_FETCH_PATTERN" || true)

if [[ -n "$disallowed" ]]; then
  echo "FAIL: fetch() found outside the allowed gateway files:"
  echo "$disallowed"
  echo "(allowed files regex: $ALLOWED_FETCH_PATTERN)"
  exit 1
fi

echo "OK: frontend requests route through the allowed gateway layer"

echo "Phase 2 checks passed."
