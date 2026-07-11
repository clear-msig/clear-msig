#!/usr/bin/env bash
set -euo pipefail

# Real destination-chain smoke for already prepared, one-of-two-approved typed
# proposals. The script intentionally requires funded proposal fixtures instead
# of generating fake success from read-only RPC probes.

: "${SOLANA_RPC_URL:?set SOLANA_RPC_URL}"
: "${PAYER_KEYPAIR:?set PAYER_KEYPAIR}"
: "${SIGNER_ONE_KEYPAIR:?set SIGNER_ONE_KEYPAIR}"
: "${SIGNER_TWO_KEYPAIR:?set SIGNER_TWO_KEYPAIR}"
: "${WALLET_NAME:?set WALLET_NAME}"
: "${DWALLET_PROGRAM_ID:?set DWALLET_PROGRAM_ID}"
: "${IKA_GRPC_URL:?set IKA_GRPC_URL}"
: "${BITCOIN_TESTNET_RPC_URL:?set BITCOIN_TESTNET_RPC_URL}"
: "${ZCASH_TESTNET_RPC_URL:?set ZCASH_TESTNET_RPC_URL}"

CLI="${CLEAR_MSIG_CLI:-target/debug/clear-msig}"

probe_rpc() {
  local url="$1"
  local label="$2"
  curl -fsS --max-time 20 -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","id":1,"method":"getblockchaininfo","params":[]}' \
    "$url" >/dev/null
  printf '%s RPC ready\n' "$label"
}

smoke_chain() {
  local label="$1"
  local chain_kind="$2"
  local proposal="$3"
  local amount_raw="$4"
  local recipient_hash="$5"
  local asset_id_hash="$6"
  local params_data_hex="$7"
  local destination_rpc="$8"

  local base=(
    --url "$SOLANA_RPC_URL"
    --keypair "$PAYER_KEYPAIR"
    proposal typed-chain-send-ika
    --wallet "$WALLET_NAME"
    --proposal "$proposal"
    --chain-kind "$chain_kind"
    --amount-raw "$amount_raw"
    --recipient-hash "$recipient_hash"
    --asset-id-hash "$asset_id_hash"
    --params-data-hex "$params_data_hex"
    --dwallet-program "$DWALLET_PROGRAM_ID"
    --grpc-url "$IKA_GRPC_URL"
    --rpc-url "$destination_rpc"
  )

  if "$CLI" --signer "$SIGNER_ONE_KEYPAIR" "${base[@]}" >/dev/null 2>&1; then
    printf '%s executed before the second approval\n' "$label" >&2
    return 1
  fi

  "$CLI" \
    --url "$SOLANA_RPC_URL" \
    --keypair "$PAYER_KEYPAIR" \
    --signer "$SIGNER_TWO_KEYPAIR" \
    proposal typed-approve \
    --wallet "$WALLET_NAME" \
    --proposal "$proposal" >/dev/null

  "$CLI" --signer "$SIGNER_ONE_KEYPAIR" "${base[@]}" --broadcast
  printf '%s two-signer broadcast complete\n' "$label"
}

probe_rpc "$BITCOIN_TESTNET_RPC_URL" "Bitcoin testnet"
probe_rpc "$ZCASH_TESTNET_RPC_URL" "Zcash testnet"

: "${BTC_PROPOSAL:?set BTC_PROPOSAL}"
: "${BTC_AMOUNT_RAW:?set BTC_AMOUNT_RAW}"
: "${BTC_RECIPIENT_HASH:?set BTC_RECIPIENT_HASH}"
: "${BTC_ASSET_ID_HASH:?set BTC_ASSET_ID_HASH}"
: "${BTC_PARAMS_DATA_HEX:?set BTC_PARAMS_DATA_HEX}"
smoke_chain \
  "Bitcoin" 2 "$BTC_PROPOSAL" "$BTC_AMOUNT_RAW" \
  "$BTC_RECIPIENT_HASH" "$BTC_ASSET_ID_HASH" "$BTC_PARAMS_DATA_HEX" \
  "$BITCOIN_TESTNET_RPC_URL"

: "${ZEC_PROPOSAL:?set ZEC_PROPOSAL}"
: "${ZEC_AMOUNT_RAW:?set ZEC_AMOUNT_RAW}"
: "${ZEC_RECIPIENT_HASH:?set ZEC_RECIPIENT_HASH}"
: "${ZEC_ASSET_ID_HASH:?set ZEC_ASSET_ID_HASH}"
: "${ZEC_PARAMS_DATA_HEX:?set ZEC_PARAMS_DATA_HEX}"
smoke_chain \
  "Zcash" 3 "$ZEC_PROPOSAL" "$ZEC_AMOUNT_RAW" \
  "$ZEC_RECIPIENT_HASH" "$ZEC_ASSET_ID_HASH" "$ZEC_PARAMS_DATA_HEX" \
  "$ZCASH_TESTNET_RPC_URL"
