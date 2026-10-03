# Dependency gate investigation — 3 October 2026

The Security workflow at `44cdc2bc` fails production and tooling npm audit.
CI (including production/bundles) and automatic Vercel deployment passed at that
commit. This report does not waive the Security failure.

| High root advisory | Installed path | Observed exposure |
|---|---|---|
| [GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp), http-cache-semantics <=4.2.0 | Dynamic embedded-wallet-solana4.100.3 → client1.33.3 → Ably2.17.1 → Got11.8.6 → cacheable-request7.0.4 → http-cache-semantics4.2.0 | Shared-cache reuse restrictions can be bypassed by max-stale. Dynamic imports `ably/modular`, explicitly selecting FetchRequest/WebSocketTransport. Inspected Ably Node transport also does not enable Got caching (Got defaults cache to undefined). The required shared-cache execution path was not found in these inspected integrations; this is not proof that an installed vulnerable library is harmless. |
| [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), braces <=3.0.3 | Tailwind3.4.19 → chokidar3.6.0 / micromatch4.0.8 → braces3.0.3; Next ESLint15.5.27 → fast-glob3.3.1 → micromatch → braces | Recursive AST walker stack exhaustion requires attacker-controlled deeply nested patterns. Application Tailwind content uses a fixed source glob. These are build/lint dependencies; no application endpoint accepting remote glob patterns was found. |

Prior local production output had zero affected package paths in all 116 server
NFT traces. This is local packaging evidence, not qualification of every hosted
configuration. npm advisory counts include propagated parent findings, not that
many distinct root vulnerabilities.

## Alternatives checked

Official npm registry metadata retrieved without modifying the lockfile:

- Latest Ably2.29.0 still depends on Got^11.8.5.
- Got16.0.0 uses cacheable-request^13.0.18; that package still depends on
  http-cache-semantics^4.2.0.
- Dynamic embedded-wallet-solana5.9.3 uses client1.37.0, still pinned to
  Ably2.17.1. A major Dynamic migration does not remove this dependency path.
- Latest Tailwind3 is3.4.19 and micromatch is4.0.8, still using braces^3.0.3.
- Latest Next ESLint plugin16.3.8 still uses fast-glob3.3.1. Tailwind4 alone
  would therefore not remove the other affected tooling path.
- npm currently publishes http-cache-semantics4.2.0 and braces3.0.3 as latest.
  The advisories list no fixed release. Forced audit suggestions include old
  Dynamic versions and a Tailwind major change; these have not been applied.

## Source fixes and finite remaining work

The upstream [cache PR58](https://github.com/kornelski/http-cache-semantics/pull/58)
is open, with no reviews/checks shown. It separates restrictive reuse rules
from ordinary expiration. The upstream
[braces PR72](https://github.com/micromatch/braces/pull/72) is open; a third-party
approval is visible but no merged maintainer release. It bounds parser and
caller-supplied AST depth, including compile/expand/stringify.

A real maintained local fork is a technically possible next remedy; it has NOT
been implemented or qualified here. It requires source/provenance/license
pinning, adversarial and upstream compatibility suites, full parent-library
behavior tests, clean install/lock reproducibility, and production/bundle tests.
Renaming unchanged packages or changing versions solely to escape audit matching
would not be a fix. A postinstall patch alone would leave the current version-based
audit gate red. Waiting for an upstream patched release is the other conservative
option. Neither risk acceptance nor an audit exclusion is authorized or applied.
