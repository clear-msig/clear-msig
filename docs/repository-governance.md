# Repository governance

`main` is the release branch. Changes must arrive through pull requests after
this hardening release.

## Required controls

- One approving review from someone other than the author.
- Code-owner review for security-critical paths.
- Dismiss stale approvals when the reviewed commit changes.
- Require conversation resolution and linear history.
- Block force pushes and branch deletion.
- Require the four CI jobs, CodeQL, and dependency review.
- Require branches to be current with `main` before merge.
- Enable dependency graph and Dependabot alerts without automated update PRs,
  plus secret scanning, push protection, CodeQL upload, and private
  vulnerability reporting.

Administrators are subject to the same rules. Emergency changes use a pull
request with the smallest possible diff and a second maintainer review; there
is no undocumented direct-push exception.

## Ownership

`.github/CODEOWNERS` assigns the repository and explicitly repeats ownership
for the Solana program, signing/execution crates, backend, Agent Vault,
workflows, deployment definitions, and program deployment scripts. Multiple
maintainers are listed so the author cannot satisfy their own review.

Automated Dependabot pull requests are disabled during active development.
Dependabot security alerts remain enabled for explicit manual triage. Framework,
Solana, cryptography, and CI runtime updates require planned migration reviews
with focused compatibility and security tests.

## Release evidence

Every release records the commit SHA, CI run, artifact checksum, program
deployment signature when bytecode changes, Railway/Vercel deployment records,
and live smoke result. Repository governance increases review assurance; it
does not replace an external protocol audit.
