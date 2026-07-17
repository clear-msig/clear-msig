#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_LOCAL="$ROOT_DIR/apps/web/.env.local"
ENV_EXAMPLE="$ROOT_DIR/apps/web/.env.example"

if [[ ! -f "$ENV_LOCAL" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_LOCAL"
  echo "Created $ENV_LOCAL from template."
fi

echo "Frontend env ready: $ENV_LOCAL"
