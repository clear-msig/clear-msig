#!/usr/bin/env bash
set -euo pipefail

if grep -En 'clear-wallet|solana-[a-z]|quasar|tokio|axum|clap' \
  crates/clear-msig-intent/Cargo.toml; then
  echo "Intent architecture check failed: chain/runtime dependencies entered the schema crate." >&2
  exit 1
fi
if grep -REn '^use (clear_wallet|solana_|quasar_|tokio|axum|clap)' \
  crates/clear-msig-intent/src; then
  echo "Intent architecture check failed: chain/runtime dependencies entered the schema crate." >&2
  exit 1
fi

while IFS= read -r file; do
  lines=$(wc -l < "$file")
  if ((lines > 500)); then
    echo "Intent architecture check failed: $file has $lines lines (limit 500)." >&2
    exit 1
  fi
done < <(find crates/clear-msig-intent/src -type f -name '*.rs' -print)

if grep -En 'pub (struct|enum) (IntentDefinitionJson|IntentTransactionJson|ChainKindJson|TxTemplateJson)' \
  programs/clear-wallet/client/src/intent_json.rs; then
  echo "Intent architecture check failed: versioned schemas moved back into the Solana client." >&2
  exit 1
fi

grep -q 'clear-msig-intent = { path = "../../../crates/clear-msig-intent" }' programs/clear-wallet/client/Cargo.toml
grep -q 'clear-msig-intent = { path = "../clear-msig-intent" }' crates/clear-msig-execution/Cargo.toml
grep -q 'clear-msig-intent = { path = "../crates/clear-msig-intent" }' e2e/Cargo.toml
grep -q 'use clear_msig_intent::IntentTransactionJson' crates/clear-msig-execution/src/commands/intent.rs
grep -q 'clear_msig_intent::render_template' crates/clear-msig-execution/src/message.rs

for file in examples/intents/*.json; do
  case "$file" in
    */registry-v1.json|*/render-vectors-v1.json) continue ;;
  esac
  grep -q '"schema_version": 1' "$file"
  grep -q '"template_id":' "$file"
done

grep -q 'npm run check:intents' frontend/package.json
grep -q '@/lib/intents/generatedRegistry' frontend/src/lib/hooks/useUpdateTimelock.ts
grep -q 'render-vectors-v1.json' frontend/src/lib/intents/__tests__/renderVectors.test.ts
grep -q 'render-vectors-v1.json' programs/clear-wallet/src/utils/message.rs

echo "Intent architecture: versioned chain-neutral schema crate, generated browser registry, and shared render vectors."
