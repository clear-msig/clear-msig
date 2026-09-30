# ClearSig local browser review — 2026-09-30

Starting commit: `7f804704f79a64489b7027da114de703b3fed14b`.
Verified tree: `a0d7c97f8a42d15ee47a94710f5e064943da5f75`.
Verified parent: `f74521ec88dca7db697053f42c23313d724ad9d0`.
The checkout was clean before a separate local refinement branch was created.
Only clear-msig/clear-msig was changed. No further push, merge, deployment,
credential provisioning, wallet signature, payment, or venue trade was performed.

## Reproduced and corrected

- Light-mode sign-in combined a light navigation bar with a hard-coded dark
  body and the light theme's dark green accent. Sign-in, its hardware-wallet
  controls, waiting state, and the product chooser now share the app's theme
  tokens. SDK modal branding no longer contains the old neon `#cf0` accent;
  the live SDK modal itself remains unverified without a configured auth service.
- Blocking the auth service left sign-in indefinitely at “Preparing sign in”.
  After twelve seconds the page now explains the delay and provides a reload
  control. It still requires the SDK to initialize before enabling sign-in.
- A 96-character approval detail overflowed the mobile owner-approval dialog:
  measured content width 1,025 px inside a 358 px dialog. Details now wrap, and
  the dialog scrolls within the available viewport. A 16-detail fixture stays
  inside 320×568, 390×640, and 1440×1000 viewports, with its actions reachable.
  This is the actual component with a simulated request, not a wallet approval.
- Bundle profiling now includes nested module records, making the large SDK
  concatenated bundles inspectable rather than reporting only opaque totals.

## Browser method and scope

Playwright 1.62.1 with installed Chromium 151.0.7922.173 ran locally over
loopback. The production build used a dummy, non-account Dynamic environment
ID and loopback backend/RPC addresses. Browser traffic to external hosts and
API routes was blocked. No auth, RPC, payment or financial backend was
simulated as successfully authenticated. Screenshots of illustrative receipts
are the real public UI, whose content is explicitly illustrative.

Desktop 1440×1000 and mobile 390×844 screenshots cover the landing (full page
and readable viewport), product chooser, and signed-out sign-in timeout.
Dark-theme captures supplement the light-theme set. Full-page screenshots use
reduced motion so below-the-fold content is readable in one image.

A separate disposable worktree contains the `/qa-fixture` component harness.
That route is not part of the application patch or production build. The
component test covers initial heading focus, Tab/Shift-Tab wrapping, Escape,
focus restoration, repeated open/cancel, busy controls and viewport scrolling.
It does not establish wallet authorization or real duplicate-submission safety.

## Performance finding and release status

The transferred tree reproduced the failing bundle gate: roughly 1,016 kB
WaaS, 1,145 kB external, 1,005 kB legacy Turnkey and a 541 kB chunk. Limits
remain 971 / 1,100 / 954 / 506 kB respectively. Production compilation succeeds;
that does not make the complete build green.

Two measured SDK tree-shaking experiments did not resolve the gate and were
removed: adding generated API/icon barrels to Next's optimizer increased the
payload, while marking unused widget modules side-effect-free saved only about
2 kB. npm dependency deduplication was subsequently measured and retained as a
reviewable lockfile change: 30 package instances removed, 2 added, and 16
reported changed. It resolves compatible ranges to shared versions, including
viem 2.55.2 → 2.46.3, ox 0.14.30 → 0.12.4, wallet primitives 1.1.24 → 1.1.10,
and eventemitter3 5.0.4 → 5.0.1. These version reductions require reviewer
attention; no override was added, and real wallet-provider integration remains
unverified. The production audit still reports zero critical/high findings and
all frontend tests pass.

Final measured maxima: WaaS **1008.7 kB**, external **1137.7 kB**, legacy
Turnkey **998.5 kB**, largest chunk **535.7 kB**. These are modest improvements,
not a passing release gate. Bundle limits, connector registration and auth
checks are unchanged. Further SDK/runtime optimization is still required.

The final nested module profile locates the 548,593-byte gzip chunk in the
SDK, not an application route. Its parsed (uncompressed, pre-minification)
contributors include sdk-react-core 5.67 MB, sdk-api-core 0.93 MB, wallet/core
0.91 MB and sdk/client 0.34 MB. These parsed sizes are diagnostic and must not
be added to the gzip budgets. Large individual modules include the domain
trie (138 kB parsed), English locale (128 kB), WaaS client (128 kB), wallet/core
(122 kB), browser wallet client (114 kB), and session/logout code (104 kB).

Compared with the original base, sdk-react-core advanced 4.92.3 → 4.100.3,
wallet/core 1.0.46/1.0.48 → 1.1.10, sdk/client 1.18.0 → 1.33.3 and Next
15.5.20 → 15.5.27. The secured snapshot already consolidated wallet/core.
Its two generated API clients (0.16.0 and 0.40.0) belong to incompatible
pre-1.0 dependency ranges; they were not forcibly aliased. The SDK wrapper
still needs DynamicContextProvider on every authenticated route, so moving
that wrapper into another immediate dynamic import would only disguise the
payload. Ledger, price runtime, sidebar and notifications already have lazy
boundaries. ENS uses a fetch proxy rather than importing a large EVM client.

A further Motion inspection found that Toast uses layout animation. The
[official lightweight API](https://motion.dev/docs/react-reduce-bundle-size)
excludes layout from domAnimation; replacing all motion imports without
preserving that feature would alter behavior. No such change was retained.

Concrete next options for the owner:

1. Ask the SDK maintainer for a supported provider/headless entry that defers
   unused widgets and generated API surfaces, then validate session restoration,
   logout, external wallets, WaaS and legacy Turnkey against configured services.
   This targets the largest shared contributor without removing wallet support.
2. Develop an explicit custom-auth/headless integration as a separate product
   change with a complete provider regression environment. That is broader than
   an import-only fix and should not be represented as a safe automatic swap.

Neither chunk splitting alone nor disabling connectors resolves actual transfer
cost while meeting the requested functionality. The budgets remain blockers;
there is no claim that the current local branch is release-ready.

## Verification boundaries

The transferred security/core changes retain the original report's local Rust
and settlement evidence. They were not independently revalidated here: Rust,
Cargo and Solana tools were absent, and the official Rust installer returned
HTTP 403. No current Rust/SBF/Clippy pass is claimed for this executor.

Real authenticated navigation, account switching, hardware/passkeys, wallet
signatures, Paystack/Korapay, settlement database concurrency, external venues,
and deployed devnet/mainnet programs remain untested here. The Paystack and
Korapay implementations are unchanged and retained. No devnet auth bypass was
introduced. The original report's configuration/migration/release prerequisites
remain in force.

The existing Vercel preview failure is being investigated separately. These
local results do not establish its cause or authorize another deployment.

## Artifact transfer

Local screenshots, browser scripts/results, test logs and portable patches are
preserved in the accompanying handoff archive. The supported Library batch
upload failed before any upload: `hosted apps tools/list request failed:
network`. One authorized retry failed identically before upload. No confirmed Library IDs exist for these deliverables, and no
unsupported transfer route was substituted.

## Completed local checks

- Frontend intent, metadata, architecture, ESLint and TypeScript checks passed.
- 175 Vitest files / 1,026 tests and 14 Node script tests passed after deduplication.
- Production build compilation, page generation and tracing completed (exit 0);
  final bundle gate exited 1 with the maxima above. The earlier full build
  wrapper likewise terminated at the bundle gate.
- Production dependency audit: zero critical/high findings.
- Repository architecture, governance, execution, signing, secret gates and
  whitespace checks passed. Python executor: 12 tests; JS examples: 11 tests.
- Public browser checks at 1440, 390 and 320 px: skip-link focus, repeated
  disclosure open/close, back/forward, no horizontal overflow, and no-JS
  landing content passed.
- Approval dialog fixture at 1440×1000, 390×640 and 320×568: bounded scrolling,
  long-string wrapping, initial focus, Tab/Shift-Tab, Escape/focus return,
  repeated cancellation and disabled busy controls passed.
- Public landing and chooser have no page errors in the captured light/dark
  sessions. Sign-in emits the expected failed fetch from the blocked SDK
  service; the twelve-second recovery message is visible. This is failure
  handling evidence, not successful provider initialization.

- Final production browser extension: desktop/mobile normal-motion scroll reveals,
  switching reduced motion on during the session, all four product choices,
  back navigation during SDK loading, and reloading into another recoverable
  SDK timeout passed. This did not simulate a successful login.

## Visual direction

The existing calm-interface design is retained: ClearSig mark, sage accents,
neutral surfaces, readable type and progressive landing sections. Refinements
address observed contrast, consistency and overflow rather than changing the
brand. OpenAI's [official design guidance](https://openai.com/brand/) informed
spacing and hierarchy; no OpenAI marks or typeface assets were copied. Apple's
[layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout)
was consulted, but its article was JavaScript-only in this executor's web reader;
no claim of a full Apple HIG conformance audit is made.
