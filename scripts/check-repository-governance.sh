#!/usr/bin/env bash
set -euo pipefail

grep -q '^\* @Almils @Prozymax @Rexzy2005 @HackingSpectre$' .github/CODEOWNERS
grep -q '^/programs/clear-wallet/' .github/CODEOWNERS
grep -q '^/crates/clear-msig-execution/' .github/CODEOWNERS
grep -q '^/frontend/src/lib/agents/' .github/CODEOWNERS

if [[ -e .github/dependabot.yml ]]; then
  echo "Repository governance check failed: automated Dependabot PRs are disabled during active development." >&2
  exit 1
fi

grep -q 'github/codeql-action/init@v3' .github/workflows/security.yml
grep -q 'actions/dependency-review-action@v4' .github/workflows/security.yml
grep -q 'security-events: write' .github/workflows/security.yml
if grep -REn 'pull_request_target|permissions: write-all' .github/workflows; then
  echo "Repository governance check failed: privileged workflow trigger or write-all permission." >&2
  exit 1
fi

grep -q "GitHub's private" SECURITY.md

echo "Repository governance: code owners, manual dependency triage, CodeQL, dependency review, and private reporting policy."
