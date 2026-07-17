#!/usr/bin/env bash
set -euo pipefail

patterns=(
  'g\.alchemy\.com/v2/[A-Za-z0-9_-]{16,}'
  'quiknode\.pro/[A-Fa-f0-9]{16,}'
  '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----'
  '(KEYPAIR|SIGNER|MNEMONIC|SEED|REDIS_REST_TOKEN)_(BASE64|TOKEN)?=[A-Za-z0-9+/=_-]{24,}'
  'UPSTASH_REDIS_REST_TOKEN=[A-Za-z0-9_-]{24,}'
)

failed=0
for pattern in "${patterns[@]}"; do
  matches="$(git grep -nEI -e "$pattern" -- ':!scripts/check-secrets.sh' || true)"
  matches="$(printf '%s\n' "$matches" | grep -Ev 'YOUR_|<[^>]+>|example\.invalid' || true)"
  if [[ -n "$matches" ]]; then
    printf '%s\n' "$matches"
    failed=1
  fi
done

if [[ "$failed" -ne 0 ]]; then
  echo "Secret scan failed: a tracked file appears to contain a credential or private key." >&2
  exit 1
fi

echo "Secret scan: no tracked provider credentials or private key material detected."
