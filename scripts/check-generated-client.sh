#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GENERATED_DIR="$ROOT_DIR/target/client/rust/clear-wallet-client/src/instructions"
CHECKED_DIR="$ROOT_DIR/programs/clear-wallet/client/src/generated"

if [[ ! -d "$GENERATED_DIR" ]]; then
  echo "Generated client check failed: run 'quasar build' first." >&2
  exit 1
fi

NORMALIZED_DIR="$(mktemp -d)"
trap 'rm -rf "$NORMALIZED_DIR"' EXIT
cp -R "$CHECKED_DIR" "$NORMALIZED_DIR/checked"
cp -R "$GENERATED_DIR" "$NORMALIZED_DIR/generated"

# Quasar owns the instruction ABI but does not guarantee rustfmt ordering.
# Compare normalized source so the checked client can satisfy workspace style
# policy without masking any generated field, account, or discriminator change.
find "$NORMALIZED_DIR/checked" "$NORMALIZED_DIR/generated" -name '*.rs' -print0 \
  | xargs -0 rustfmt --edition 2021

if ! diff -ru "$NORMALIZED_DIR/checked" "$NORMALIZED_DIR/generated"; then
  echo "Generated client check failed: checked client differs from the current program." >&2
  echo "Regenerate with 'quasar build' and review the instruction ABI changes." >&2
  exit 1
fi

if [[ -d "$ROOT_DIR/crates/clear-msig-execution/src/quasar_client" || -d "$ROOT_DIR/apps/e2e/src/quasar_client" ]]; then
  echo "Generated client check failed: duplicate vendored client directory found." >&2
  exit 1
fi

echo "Generated client: one program-owned instruction source matches Quasar output."
