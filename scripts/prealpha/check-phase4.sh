#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_ENV="$ROOT_DIR/backend-api/.env.pre-alpha"
FRONTEND_ENV="$ROOT_DIR/frontend/.env.local"

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
INTENT_FILE="examples/intents/transfer_sol.json"
UPDATE_FILE="examples/intents/transfer_tokens.json"

if [[ -n "${PHASE4_SIGNER_PUBKEY:-}" ]]; then
  SIGNER_PUBKEY="$PHASE4_SIGNER_PUBKEY"
elif command -v solana-keygen >/dev/null 2>&1; then
  SIGNER_PUBKEY="$(solana-keygen pubkey "${CLEAR_MSIG_SIGNER}")"
else
  echo "Missing signer pubkey. Set PHASE4_SIGNER_PUBKEY or install solana-keygen."
  exit 1
fi

if [[ ! -f "$ROOT_DIR/$INTENT_FILE" ]]; then
  echo "Missing intent file: $ROOT_DIR/$INTENT_FILE"
  exit 1
fi
if [[ ! -f "$ROOT_DIR/$UPDATE_FILE" ]]; then
  echo "Missing update intent file: $ROOT_DIR/$UPDATE_FILE"
  exit 1
fi

WALLET_NAME="phase4-$RANDOM-$RANDOM"
RESP_FILE="$(mktemp)"
cleanup() {
  rm -f "$RESP_FILE"
}
trap cleanup EXIT

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"

  local status
  if [[ -n "$body" ]]; then
    status=$(curl -sS -o "$RESP_FILE" -w '%{http_code}' -X "$method" \
      -H 'Content-Type: application/json' \
      -d "$body" \
      "$BASE_URL$path")
  else
    status=$(curl -sS -o "$RESP_FILE" -w '%{http_code}' -X "$method" \
      "$BASE_URL$path")
  fi

  echo "[$method $path] status=$status"
  cat "$RESP_FILE"
  echo

  if [[ "$status" -lt 200 || "$status" -ge 300 ]]; then
    echo "Request failed: $method $path"
    exit 1
  fi
}

extract_proposal_addr() {
  python3 - "$RESP_FILE" <<'PY'
import json,sys,re
p=sys.argv[1]
with open(p,'r',encoding='utf-8') as f:
    data=json.load(f)

candidates=[]

def walk(obj):
    if isinstance(obj,dict):
        for k,v in obj.items():
            lk=k.lower()
            if isinstance(v,str) and lk in {"proposal","proposal_address","address"}:
                candidates.append(v)
            walk(v)
    elif isinstance(obj,list):
        for it in obj:
            walk(it)

walk(data)
for c in candidates:
    if re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{32,64}", c):
        print(c)
        sys.exit(0)

# fallback: scan any string values
all_strings=[]
def walk2(obj):
    if isinstance(obj,dict):
        for v in obj.values(): walk2(v)
    elif isinstance(obj,list):
        for it in obj: walk2(it)
    elif isinstance(obj,str):
        all_strings.append(obj)
walk2(data)
for s in all_strings:
    if re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{32,64}", s):
        print(s)
        sys.exit(0)
print("")
PY
}

assert_intent_count_at_least() {
  local min_count="$1"
  python3 - "$RESP_FILE" "$min_count" <<'PY'
import json,sys
p=sys.argv[1]
min_count=int(sys.argv[2])
with open(p,'r',encoding='utf-8') as f:
    data=json.load(f)

def extract_list(obj):
    if isinstance(obj,list):
        return obj
    if isinstance(obj,dict):
        for k in ("intents","items","data"):
            if k in obj and isinstance(obj[k],list):
                return obj[k]
    return None
lst=extract_list(data)
if lst is None:
    print("Could not determine intent list shape")
    sys.exit(1)
if len(lst) < min_count:
    print(f"Expected >= {min_count} intents, got {len(lst)}")
    sys.exit(1)
print(f"OK: intent count is {len(lst)}")
PY
}

echo "== Phase 4: intent governance lifecycle verification =="
request GET "/health"

create_wallet_payload=$(cat <<JSON
{"name":"$WALLET_NAME","proposers":["$SIGNER_PUBKEY"],"approvers":["$SIGNER_PUBKEY"],"threshold":1,"cancellation_threshold":1,"timelock":0}
JSON
)
request POST "/wallets" "$create_wallet_payload"

add_intent_payload=$(cat <<JSON
{"file":"$INTENT_FILE","proposers":["$SIGNER_PUBKEY"],"approvers":["$SIGNER_PUBKEY"],"threshold":1,"cancellation_threshold":1,"timelock":0}
JSON
)
request POST "/wallets/$WALLET_NAME/intents/add" "$add_intent_payload"
ADD_PROPOSAL="$(extract_proposal_addr)"
if [[ -z "$ADD_PROPOSAL" ]]; then
  echo "Failed to extract add-intent proposal address from response"
  exit 1
fi
echo "AddIntent proposal: $ADD_PROPOSAL"

request POST "/wallets/$WALLET_NAME/proposals/$ADD_PROPOSAL/approve" "{}"
request POST "/wallets/$WALLET_NAME/proposals/$ADD_PROPOSAL/execute" "{}"

request GET "/wallets/$WALLET_NAME/intents"
assert_intent_count_at_least 4

remove_payload='{"index":3}'
request POST "/wallets/$WALLET_NAME/intents/remove" "$remove_payload"
REMOVE_PROPOSAL="$(extract_proposal_addr)"
if [[ -z "$REMOVE_PROPOSAL" ]]; then
  echo "Failed to extract remove-intent proposal address"
  exit 1
fi
echo "RemoveIntent proposal: $REMOVE_PROPOSAL"

update_payload=$(cat <<JSON
{"index":3,"file":"$UPDATE_FILE","proposers":["$SIGNER_PUBKEY"],"approvers":["$SIGNER_PUBKEY"],"threshold":1,"cancellation_threshold":1,"timelock":0}
JSON
)
request POST "/wallets/$WALLET_NAME/intents/update" "$update_payload"
UPDATE_PROPOSAL="$(extract_proposal_addr)"
if [[ -z "$UPDATE_PROPOSAL" ]]; then
  echo "Failed to extract update-intent proposal address"
  exit 1
fi
echo "UpdateIntent proposal: $UPDATE_PROPOSAL"

echo "Phase 4 checks completed for wallet: $WALLET_NAME"
echo "Executed: add-intent lifecycle. Created and validated remove/update proposal flows."
