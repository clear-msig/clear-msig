#!/usr/bin/env bash
#
# Seed the deployed devnet program with state that makes the live demo
# look populated for Colosseum judges. Runs against the *deployed*
# clear-msig-backend.fly.dev relayer, so it ships the same TXs the
# frontend would. No backend mutation, no schema migration — just on-
# chain calls.
#
# What it leaves behind:
#   - Demo wallet "treasury-judge" (2-of-3) with the connected payer
#     and two ephemeral signers as members.
#   - Solana chain bound (DKG via Ika devnet).
#   - One transfer intent fully approved + executed (lands in Activity).
#   - One transfer intent fully approved + a proposal mid-approval
#     (1/2 votes), so the live ApprovalBitmap visibly waits for a
#     judge to "be" the second signer.
#
# Re-runs safely: if the wallet name is taken on the deployed program,
# the script bumps to "treasury-judge-<unix>" so judges always open a
# fresh seeded state.
#
# Pre-reqs (same as cli-demo-bootstrap.sh):
#   - solana CLI on PATH
#   - clear-msig CLI built (cargo build -p clear-msig-cli) or pointed
#     to via CLEAR_MSIG_BIN env var
#   - Payer keypair funded with ≥ 2 SOL on devnet
#
# Outputs at the end: a block of judge-friendly URLs (wallet detail,
# the mid-approval proposal page) you can drop in the pitch deck.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="${DEMO_DIR:-$HOME/clear-msig-demo}"
RPC_URL="${RPC_URL:-https://solana-devnet.g.alchemy.com/v2/olIm3vyHF32h_G4dZgMPH}"
IKA_PROGRAM="${IKA_PROGRAM:-87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY}"
IKA_GRPC="${IKA_GRPC:-https://pre-alpha-dev-1.ika.ika-network.net:443}"
WALLET_BASE="${WALLET_BASE:-treasury-judge}"
EXPIRY_SECONDS="${EXPIRY_SECONDS:-1800}"
TRANSFER_LAMPORTS="${TRANSFER_LAMPORTS:-50000000}"   # 0.05 SOL per demo tx
DWALLET_FUNDING_SOL="${DWALLET_FUNDING_SOL:-0.4}"
FRONTEND_BASE="${FRONTEND_BASE:-https://clear-msig.vercel.app}"

CLI="${CLEAR_MSIG_BIN:-$ROOT_DIR/target/debug/clear-msig}"

if [[ ! -x "$CLI" ]]; then
  echo "clear-msig binary not found at $CLI"
  echo "Build it with: cargo build -p clear-msig-cli"
  exit 1
fi

mkdir -p "$DEMO_DIR"
cd "$DEMO_DIR"

step() { echo; echo "== $* =="; }

# ----------------------------------------------------------------------
step "Reuse existing keypairs (bootstrap script generates these)"
# ----------------------------------------------------------------------
for k in payer signer1 signer2 signer3 nonce-account-judge; do
  if [[ ! -f "$k.json" ]]; then
    solana-keygen new --no-bip39-passphrase --silent --outfile "$k.json"
  fi
done
PAYER=$(solana address -k payer.json)
S1=$(solana address -k signer1.json)
S2=$(solana address -k signer2.json)
S3=$(solana address -k signer3.json)
NONCE=$(solana address -k nonce-account-judge.json)

solana config set --url "$RPC_URL" --keypair "$DEMO_DIR/payer.json" >/dev/null

# Bump wallet name if today's run collides with a previous run.
WALLET_NAME="$WALLET_BASE"
if "$CLI" wallet show --name "$WALLET_NAME" >/dev/null 2>&1; then
  WALLET_NAME="${WALLET_BASE}-$(date +%s)"
  echo "  '$WALLET_BASE' already exists — using $WALLET_NAME"
fi

# ----------------------------------------------------------------------
step "Verify payer funded (need ~$(awk "BEGIN{print 0.05+$DWALLET_FUNDING_SOL+0.02}") SOL minimum)"
# ----------------------------------------------------------------------
BAL=$(solana balance | awk '{print $1}')
NEED=$(awk -v d="$DWALLET_FUNDING_SOL" 'BEGIN{print 0.05 + d + 0.02}')
if awk -v a="$BAL" -v b="$NEED" 'BEGIN{exit !(a+0 < b+0)}'; then
  echo "  payer balance $BAL SOL is below $NEED SOL"
  echo "  Fund $PAYER on devnet (https://faucet.solana.com/) and re-run."
  exit 1
fi
echo "  payer balance: $BAL SOL — proceeding"

# ----------------------------------------------------------------------
step "clear-msig CLI defaults"
# ----------------------------------------------------------------------
"$CLI" config set --url "$RPC_URL" >/dev/null
"$CLI" config set --payer "$DEMO_DIR/payer.json" >/dev/null
"$CLI" config set --signer "$DEMO_DIR/signer1.json" >/dev/null
"$CLI" config set --expiry-seconds "$EXPIRY_SECONDS" >/dev/null

# ----------------------------------------------------------------------
step "Create 2-of-3 wallet '$WALLET_NAME'"
# ----------------------------------------------------------------------
"$CLI" wallet create \
  --name "$WALLET_NAME" \
  --proposers "$S1,$S2,$S3" \
  --approvers "$S1,$S2,$S3" \
  --threshold 2 >/dev/null
WALLET_ADDR=$("$CLI" wallet show --name "$WALLET_NAME" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["address"])')
echo "  wallet PDA: $WALLET_ADDR"

# ----------------------------------------------------------------------
step "Bind Solana chain via Ika DKG (10–30s)"
# ----------------------------------------------------------------------
"$CLI" wallet add-chain \
  --wallet "$WALLET_NAME" \
  --chain solana \
  --dwallet-program "$IKA_PROGRAM" \
  --grpc-url "$IKA_GRPC" >/dev/null
DWALLET_ADDR=$("$CLI" wallet chains --wallet "$WALLET_NAME" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["chains"][0]["solana_address"])')
echo "  dWallet Solana address: $DWALLET_ADDR"

# ----------------------------------------------------------------------
step "Fund dWallet + create durable nonce"
# ----------------------------------------------------------------------
solana transfer --allow-unfunded-recipient "$DWALLET_ADDR" "$DWALLET_FUNDING_SOL" >/dev/null
solana create-nonce-account "$DEMO_DIR/nonce-account-judge.json" 0.0015 \
  --nonce-authority "$DWALLET_ADDR" >/dev/null

# ----------------------------------------------------------------------
step "Add transfer intent + propose+approve+execute (Activity row)"
# ----------------------------------------------------------------------
INTENT_FILE="$DEMO_DIR/intent-judge.json"
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

"$CLI" proposal approve --wallet "$WALLET_NAME" --proposal "$ADD_PROPOSAL" --signer "$DEMO_DIR/signer1.json" >/dev/null
"$CLI" proposal approve --wallet "$WALLET_NAME" --proposal "$ADD_PROPOSAL" --signer "$DEMO_DIR/signer2.json" >/dev/null
"$CLI" proposal execute --wallet "$WALLET_NAME" --proposal "$ADD_PROPOSAL" >/dev/null
echo "  AddIntent meta-proposal executed → transfer intent live at index 3"

NONCE_HEX=$(solana account "$NONCE" --output json | python3 -c '
import json, sys, base64
d = json.load(sys.stdin)
print(base64.b64decode(d["account"]["data"][0])[40:72].hex())
')

# Tx 1: full lifecycle, lands in Activity tab.
PROP1_OUT=$("$CLI" proposal create \
  --wallet "$WALLET_NAME" --intent-index 3 \
  --param "destination=$PAYER" \
  --param "amount=$TRANSFER_LAMPORTS" \
  --param "nonce_value=0x$NONCE_HEX" 2>&1)
PROP1=$(echo "$PROP1_OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["proposal"])')
"$CLI" proposal approve --wallet "$WALLET_NAME" --proposal "$PROP1" --signer "$DEMO_DIR/signer1.json" >/dev/null
"$CLI" proposal approve --wallet "$WALLET_NAME" --proposal "$PROP1" --signer "$DEMO_DIR/signer2.json" >/dev/null
EXEC_OUT=$("$CLI" proposal execute \
  --wallet "$WALLET_NAME" --proposal "$PROP1" \
  --dwallet-program "$IKA_PROGRAM" \
  --rpc-url "$RPC_URL" --broadcast 2>&1)
EXEC_TX=$(echo "$EXEC_OUT" | python3 -c '
import json, sys
buf = sys.stdin.read()
# Output is a multi-line CLI status with one trailing JSON object.
i = buf.find("{")
print(json.loads(buf[i:])["broadcast"]["tx_id"])
' 2>/dev/null || echo "<see CLI output>")
echo "  executed proposal $PROP1 — broadcast tx $EXEC_TX"

# Re-read nonce after the broadcast (changes each broadcast).
NONCE_HEX=$(solana account "$NONCE" --output json | python3 -c '
import json, sys, base64
d = json.load(sys.stdin)
print(base64.b64decode(d["account"]["data"][0])[40:72].hex())
')

# Tx 2: mid-approval — proposed and 1/2 approved, NOT executed. Judges
# arriving at the proposal detail page will see the live bitmap waiting
# for the second vote.
PROP2_OUT=$("$CLI" proposal create \
  --wallet "$WALLET_NAME" --intent-index 3 \
  --param "destination=$S3" \
  --param "amount=$TRANSFER_LAMPORTS" \
  --param "nonce_value=0x$NONCE_HEX" 2>&1)
PROP2=$(echo "$PROP2_OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["proposal"])')
"$CLI" proposal approve --wallet "$WALLET_NAME" --proposal "$PROP2" --signer "$DEMO_DIR/signer1.json" >/dev/null
echo "  mid-approval proposal $PROP2 — 1/2 approved"

# ----------------------------------------------------------------------
step "Judge-facing URLs — drop into the pitch deck"
# ----------------------------------------------------------------------
echo
echo "Frontend (live):"
echo "  $FRONTEND_BASE"
echo
echo "Wallet detail (Overview / Intents / Proposals / Activity tabs):"
echo "  $FRONTEND_BASE/app/wallet/$(printf '%s' "$WALLET_NAME" | sed 's| |%20|g')"
echo
echo "Mid-approval proposal (live ApprovalBitmap demo):"
echo "  $FRONTEND_BASE/app/proposals/$PROP2"
echo
echo "Recently executed transfer (Solana Explorer):"
echo "  https://explorer.solana.com/tx/$EXEC_TX?cluster=devnet"
echo
echo "Done."
