#!/usr/bin/env bash
set -euo pipefail

required_apps=(api cli e2e settlement web)
for app in "${required_apps[@]}"; do
  if [[ ! -d "apps/$app" ]]; then
    echo "Repository boundary check failed: apps/$app is missing." >&2
    exit 1
  fi
done

for legacy in backend-api cli e2e frontend rust-settlement; do
  if [[ -e "$legacy" ]]; then
    echo "Repository boundary check failed: legacy top-level path $legacy still exists." >&2
    exit 1
  fi
done

grep -q '"apps/api"' Cargo.toml
grep -q '"apps/cli"' Cargo.toml
grep -q '"apps/e2e"' Cargo.toml
if grep -q '"apps/settlement"' Cargo.toml; then
  echo "Repository boundary check failed: the independently deployed settlement workspace entered the root dependency graph." >&2
  exit 1
fi
grep -q '^\[workspace\]$' apps/settlement/Cargo.toml

if rg -n "from [\"'](?:\.\./)*apps/(?:api|settlement)|require\\([\"'](?:\.\./)*apps/(?:api|settlement)" \
  apps/web/src; then
  echo "Repository boundary check failed: browser code imports a trusted service implementation." >&2
  exit 1
fi

if rg -n 'apps/web/src|frontend/src' apps/api/src apps/settlement/src crates programs; then
  echo "Repository boundary check failed: trusted Rust code imports browser implementation files." >&2
  exit 1
fi

if [[ -d crates/clear-msig-execution/src/quasar_client || -d apps/e2e/src/quasar_client ]]; then
  echo "Repository boundary check failed: a duplicate generated Solana client exists." >&2
  exit 1
fi

test -f programs/clear-wallet/client/src/generated/mod.rs
test -f LICENSE
if rg -n '\bAdapt\b' apps crates programs scripts examples README.md SECURITY.md CONTRIBUTING.md; then
  echo "Repository boundary check failed: a legacy product attribution remains in active source." >&2
  exit 1
fi

echo "Repository boundaries: runnable apps consolidated, trusted services isolated, one generated program client, and root licensing present."
