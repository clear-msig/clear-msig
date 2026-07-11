#!/usr/bin/env bash
#
# End-to-end CLI demo: 2-of-3 multisig wallet on Solana devnet, signed by
# Ika dWallet 2PC-MPC, transferring SOL via durable nonce.
#
# Mirrors Phase 2 of the bring-up: generate keys, configure, fund (manual step),
# create wallet, bind chain via Ika, set up nonce, add transfer intent, and run
# propose -> approve -> execute -> broadcast.
#
# Idempotent in places (skips key generation if files already exist) but each
# RUN of the flow creates a NEW wallet, intent, and proposal — devnet state
# accumulates. Wipe ~/clear-msig-demo if you want a clean slate.
#
# Pre-reqs:
#   - solana CLI on PATH
#   - clear-msig CLI built (cargo build -p clear-msig-cli) and on PATH OR
#     pointed to via CLEAR_MSIG_BIN env var
#   - Payer must be funded with at least ~0.5 SOL on devnet before script can
#     finish; script pauses for this and prints the address.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="${DEMO_DIR:-$HOME/clear-msig-demo}"
RPC_URL="${RPC_URL:-https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH}"
IKA_PROGRAM="${IKA_PROGRAM:-87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY}"
IKA_GRPC="${IKA_GRPC:-https://pre-alpha-dev-1.ika.ika-network.net:443}"
WALLET_NAME="${WALLET_NAME:-treasury-$(date +%s)}"
TRANSFER_LAMPORTS="${TRANSFER_LAMPORTS:-100000000}"  # 0.1 SOL
DWALLET_FUNDING_SOL="${DWALLET_FUNDING_SOL:-0.5}"
EXPIRY_SECONDS="${EXPIRY_SECONDS:-600}"

CLI="${CLEAR_MSIG_BIN:-$ROOT_DIR/target/debug/clear-msig}"

if [[ ! -x "$CLI" ]]; then
  echo "clear-msig binary not found at $CLI"
  echo "Build it with: cargo build -p clear-msig-cli"
  echo "Or set CLEAR_MSIG_BIN=/path/to/clear-msig"
  exit 1
fi

mkdir -p "$DEMO_DIR"
cd "$DEMO_DIR"

step() { echo; echo "== $* =="; }

# ----------------------------------------------------------------------
step "Generate keypairs (skipped if already present)"
# ----------------------------------------------------------------------
for k in payer signer1 signer2 signer3 nonce-account; do
  if [[ ! -f "$k.json" ]]; then
    solana-keygen new --no-bip39-passphrase --silent --outfile "$k.json"
    echo "  generated $k.json"
  fi
done
PAYER=$(solana address -k payer.json)
S1=$(solana address -k signer1.json)
S2=$(solana address -k signer2.json)
S3=$(solana address -k signer3.json)
NONCE=$(solana address -k nonce-account.json)
echo "  payer:   $PAYER"
echo "  signer1: $S1"
echo "  signer2: $S2"
echo "  signer3: $S3"
echo "  nonce:   $NONCE"

# ----------------------------------------------------------------------
step "Configure Solana CLI for devnet, point at payer"
# ----------------------------------------------------------------------
solana config set --url "$RPC_URL" --keypair "$DEMO_DIR/payer.json" >/dev/null
echo "  RPC: $RPC_URL"
echo "  keypair: $DEMO_DIR/payer.json"

# ----------------------------------------------------------------------
step "Wait for payer funding"
# ----------------------------------------------------------------------
NEEDED_SOL=$(awk "BEGIN { print 0.05 + $DWALLET_FUNDING_SOL + 0.01 }")
while :; do
  BAL=$(solana balance | awk '{print $1}')
  cmp=$(awk -v a="$BAL" -v b="$NEEDED_SOL" 'BEGIN { print (a+0 >= b+0) ? 1 : 0 }')
  if [[ "$cmp" == "1" ]]; then
    echo "  payer balance: $BAL SOL — proceeding"
    break
  fi
  echo "  payer balance: $BAL SOL (need >= $NEEDED_SOL)"
  echo "  Fund $PAYER on devnet: https://faucet.solana.com/"
  echo "  Press ENTER once funded (or Ctrl-C to abort)..."
  read -r
done

# ----------------------------------------------------------------------
step "Configure clear-msig CLI defaults"
# ----------------------------------------------------------------------
"$CLI" config set --url "$RPC_URL" >/dev/null
"$CLI" config set --payer "$DEMO_DIR/payer.json" >/dev/null
"$CLI" config set --signer "$DEMO_DIR/signer1.json" >/dev/null
"$CLI" config set --expiry-seconds "$EXPIRY_SECONDS" >/dev/null
echo "  defaults written to $("$CLI" config show 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["config_path"])')"

# ----------------------------------------------------------------------
step "Create 2-of-3 multisig wallet '$WALLET_NAME'"
# ----------------------------------------------------------------------
"$CLI" wallet create \
  --name "$WALLET_NAME" \
  --proposers "$S1,$S2,$S3" \
  --approvers "$S1,$S2,$S3" \
  --threshold 2 >/dev/null
WALLET_ADDR=$("$CLI" wallet show --name "$WALLET_NAME" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["address"])')
echo "  wallet PDA: $WALLET_ADDR"

# ----------------------------------------------------------------------
step "Bind Solana chain via Ika DKG"
# ----------------------------------------------------------------------
ADDCHAIN_OUT=$("$CLI" wallet add-chain \
  --wallet "$WALLET_NAME" \
  --chain solana \
  --dwallet-program "$IKA_PROGRAM" \
  --grpc-url "$IKA_GRPC" 2>&1)
echo "$ADDCHAIN_OUT" | tail -5
DWALLET_ADDR=$("$CLI" wallet chains --wallet "$WALLET_NAME" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["chains"][0]["solana_address"])')
echo "  dWallet Solana address: $DWALLET_ADDR"

# ----------------------------------------------------------------------
step "Fund dWallet and create durable nonce account"
# ----------------------------------------------------------------------
solana transfer --allow-unfunded-recipient "$DWALLET_ADDR" "$DWALLET_FUNDING_SOL" >/dev/null
echo "  funded dWallet with $DWALLET_FUNDING_SOL SOL"
solana create-nonce-account "$DEMO_DIR/nonce-account.json" 0.0015 \
  --nonce-authority "$DWALLET_ADDR" >/dev/null
echo "  nonce $NONCE created with authority=$DWALLET_ADDR"

# ----------------------------------------------------------------------
step "Add transfer intent (AddIntent meta-proposal -> approve x2 -> execute)"
# ----------------------------------------------------------------------
INTENT_FILE="$DEMO_DIR/intent-solana-transfer.json"
cat > "$INTENT_FILE" <<JSON
{
  "chain": "solana",
  "tx_template": { "solana": { "nonce_account": "$NONCE" } },
  "params": [
    { "name": "destination", "type": "address" },
    { "name": "amount",      "type": "u64" },
    { "name": "nonce_value", "type": "bytes32" }
  ],
  "template": "transfer {1} lamports to {0}"
}
JSON

ADD_OUT=$("$CLI" intent add \
  --wallet "$WALLET_NAME" \
  --file "$INTENT_FILE" \
  --proposers "$S1,$S2,$S3" \
  --approvers "$S1,$S2,$S3" \
  --threshold 2 2>&1)
ADD_PROPOSAL=$(echo "$ADD_OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["proposal"])')
echo "  AddIntent proposal: $ADD_PROPOSAL"

"$CLI" proposal approve --wallet "$WALLET_NAME" --proposal "$ADD_PROPOSAL" --signer "$DEMO_DIR/signer1.json" >/dev/null
"$CLI" proposal approve --wallet "$WALLET_NAME" --proposal "$ADD_PROPOSAL" --signer "$DEMO_DIR/signer2.json" >/dev/null
"$CLI" proposal execute --wallet "$WALLET_NAME" --proposal "$ADD_PROPOSAL" >/dev/null
echo "  AddIntent executed — transfer intent live at index 3"

# ----------------------------------------------------------------------
step "Read durable nonce value (needed as proposal param)"
# ----------------------------------------------------------------------
NONCE_HEX=$(solana account "$NONCE" --output json | python3 -c '
import json, sys, base64
d = json.load(sys.stdin)
print(base64.b64decode(d["account"]["data"][0])[40:72].hex())
')
echo "  nonce value (hex): $NONCE_HEX"

# ----------------------------------------------------------------------
step "Propose 0.1 SOL transfer dWallet -> payer"
# ----------------------------------------------------------------------
PROP_OUT=$("$CLI" proposal create \
  --wallet "$WALLET_NAME" --intent-index 3 \
  --param "destination=$PAYER" \
  --param "amount=$TRANSFER_LAMPORTS" \
  --param "nonce_value=0x$NONCE_HEX" 2>&1)
PROPOSAL=$(echo "$PROP_OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["proposal"])')
echo "  transfer proposal: $PROPOSAL"

# ----------------------------------------------------------------------
step "Approve x2 and execute (Ika 2PC-MPC sign + Solana broadcast)"
# ----------------------------------------------------------------------
"$CLI" proposal approve --wallet "$WALLET_NAME" --proposal "$PROPOSAL" --signer "$DEMO_DIR/signer1.json" >/dev/null
"$CLI" proposal approve --wallet "$WALLET_NAME" --proposal "$PROPOSAL" --signer "$DEMO_DIR/signer2.json" >/dev/null
EXEC_OUT=$("$CLI" proposal execute \
  --wallet "$WALLET_NAME" --proposal "$PROPOSAL" \
  --dwallet-program "$IKA_PROGRAM" \
  --rpc-url "$RPC_URL" --broadcast 2>&1)
TXID=$(echo "$EXEC_OUT" | python3 -c '
import json, sys
for line in sys.stdin:
  if line.strip().startswith("{"):
    sys.stdin = open("/dev/null")
    rest = line + sys.stdin.read()
    print(json.loads(rest)["broadcast"]["tx_id"])
    break
' 2>/dev/null || echo "<see output>")
echo
echo "  broadcast tx: $TXID"
echo "  https://explorer.solana.com/tx/$TXID?cluster=devnet"

# ----------------------------------------------------------------------
step "Final balances"
# ----------------------------------------------------------------------
echo "  payer:   $(solana balance "$PAYER")"
echo "  dWallet: $(solana balance "$DWALLET_ADDR")"

echo
echo "Done."
