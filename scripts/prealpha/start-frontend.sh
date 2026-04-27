#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

"$ROOT_DIR/scripts/prealpha/bootstrap-frontend-env.sh"

cd "$FRONTEND_DIR"
if [[ ! -d node_modules ]]; then
  npm install
fi
npm run dev
