#!/usr/bin/env bash
set -euo pipefail

if rg -n '^(solana|tokio|axum|reqwest|serde_json|quasar)[[:alnum:]_-]*[[:space:]]*=' \
  crates/clear-msig-signing/Cargo.toml; then
  echo "Signing architecture check failed: runtime or chain dependencies entered the canonical signing crate." >&2
  exit 1
fi

if rg -n '^(use|extern crate)[[:space:]]+(solana|tokio|axum|reqwest|serde_json|quasar)' \
  crates/clear-msig-signing/src; then
  echo "Signing architecture check failed: runtime or chain dependencies entered the canonical signing crate." >&2
  exit 1
fi

if rg -n 'CSIGINT4|clearsig:canonical-intent:v4|clearsig:policy-engine:v4' \
  apps/api/src apps/web/src; then
  echo "Signing architecture check failed: a transport or browser module reimplemented a v4 authority domain." >&2
  exit 1
fi

if [[ -e apps/web/src/lib/clearsign/actions.ts ]]; then
  echo "Signing architecture check failed: legacy browser authority module was reintroduced." >&2
  exit 1
fi

if rg -n 'sha256\(|clearSignPayloadHash|clearSignEnvelopeHash|summarizeClearSignAction' \
  apps/web/src/lib/clearsign/intentInput.ts apps/web/src/lib/clearsign/client.ts; then
  echo "Signing architecture check failed: browser v4 input or transport code derives authority." >&2
  exit 1
fi

if rg -n '/v1/clearsign/v3/prepare|prepareClearSignAction' apps/web/src; then
  echo "Signing architecture check failed: frontend can create legacy v3 preparation requests." >&2
  exit 1
fi

for file in crates/clear-msig-signing/src/*.rs; do
  lines="$(wc -l < "$file" | tr -d ' ')"
  if [[ "$lines" -gt 500 ]]; then
    echo "Signing architecture check failed: $file has $lines lines (limit 500)." >&2
    exit 1
  fi
done

grep -q 'clear-msig-signing' apps/api/Cargo.toml
grep -q 'clear-msig-signing' programs/clear-wallet/Cargo.toml
grep -q 'document_hash' apps/api/src/clearsign/v4.rs
grep -q 'validate_payload_shape' apps/api/src/clearsign/v4.rs
grep -q 'MAX_FIAT_ESTIMATE_AGE_SECONDS' apps/api/src/clearsign/v4.rs
grep -q 'v4_envelope_hash' apps/api/src/proposals/typed_lifecycle.rs
grep -q 'Approval is disabled' crates/clear-msig-signing/src/lib.rs
grep -q 'TemplateSupport::ReviewOnly' crates/clear-msig-signing/src/templates.rs

echo "Signing architecture: shared no-std authority codec, renderer, commitments, device profiles, and review-only fallback."
