# Public flow verification and policy boundary — 2 October 2026

Base: `d75eaa8d3990680ad171b1b1b2a843e50dd80222`. This continuation is local only;
it does not authorize publication, enable trading, or establish live provider coverage.

## Changes

- Preserve the existing dark/lime public palette even when the saved application
  preference is light. The application theme preference itself is unchanged.
- Correct shared How it works and Products links to actual landing destinations.
- Reveal the demonstration, section introductions, three chapters, product links
  and closing progressively. Hero actions remain immediately visible. Server
  rendering, no JavaScript, reduced motion, print and keyboard focus expose content.
- Restore the five-network moving strip with pause/resume, one accessible list,
  decorative duplicate suppression, and static reduced-motion/no-JavaScript modes.
- Use accurate provider-neutral sign-in copy without promising configured methods.

## Verification

The complete production build passed: 224 Vitest suites / 1,739 tests, including
45 venue-limit manifest regressions and real loopback Redis integrations; 27
script tests; intent, metadata, architecture, lint and TypeScript checks; 50-page
production generation. The existing approved main-devnet scoped bundle gate
passed: standard authenticated maximum 998.8/999 KiB, external runtime
1123.8/1124, legacy Turnkey 990.7/991. No budget was changed in this continuation.
This local gate result is not a new hosted CI or deployment result.

Actual Chromium checks at 1440, 390 and 320 pixels exercised progressive entry,
repeat scrolling, logo movement/pause/resume, public security navigation, chooser
and connect rendering, saved light-preference isolation and horizontal overflow.
Reduced-motion and no-JavaScript checks keep content readable and the logos
static. Captures were inspected; an initial harness-only connect failure was
found in pixels and corrected before the final run.

The browser fixture copies production components and replaces external wallet
provider boundaries with a disconnected context. Connect's SDK hook is explicitly
synthetic and unavailable, never a successful authentication simulation. External
requests are blocked. No live login, MFA, device, wallet, payment or venue action
was performed. All production build tests use the real repository, not the fixture.
Root Rust/SBF source is unchanged by this continuation; it was not rerun.

## Signed-limit work already present and verified

`venueLimitsManifest.ts` and its specification define version 1, strict required
fields, deterministic domain-separated commitments, exact six-decimal USD values,
immutable allowlists and binding to canonical deployment, wallet, agent, governance
intent and threshold. Unknown/missing fields, changed commitments and disabled or
paused policies fail closed. A commitment alone is not signed authority and never
enables external execution. No invented amounts or default authorizations are added.

## Decisions, code and external blockers

Only two economic choices remain from the requested schema work:

1. One active execution per wallet with full-close settlement versus concurrent
   executions with an explicit partial-allocation ledger. Neither mode is silently
   selected or enabled.
2. An explicit wallet daily-loss reset timezone. Server/browser local midnight is
   not reliable policy. UTC is an option, not an assigned default.

Existing saved trade-size, leverage, markets, position count, session duration,
cooldown, daily loss and take-profit controls supply the remaining inputs. Gross
realized net-PnL aggregation and entry-fill cooldown preserve current semantics.
Strict stop protection remains required.

Technical work still needed is canonical descriptor/parser/signer rendering and
finalized limit resolution, then exact opening/closing allocation, child-order
reconciliation, separately authorized close/emergency actions, reviewed binding
rotation and authenticated route composition. These are implementation tasks, not
a request for the user to design a signed schema. The manifest changes no on-chain
layout. Encoding limits and cross-language protocol tests must precede any protocol
change; deploying a changed program requires separate authorization.

Native atomic protection remains an external capability blocker. The official
[Hyperliquid TP/SL documentation](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/take-profit-and-stop-loss-orders-tp-sl),
rechecked on 2 October, says partially filled parent orders can have children not
yet placed, and cancellation can cancel those children. Grouping alone therefore
does not establish the approved protected-entry invariant. Credentials do not fix
that gap; no compensation-based replacement or venue switch is implemented.

Configuration/live-test gates remain trusted pinned RPC/program identities,
reviewed dedicated venue bindings, durable shared Redis, provider authentication,
executable settlement quote/auth configuration and trusted deposit evidence.
Paystack/Korapay remain unchanged. Supplying configuration cannot bypass the
capability or authority gates. Full application end-to-end coverage is not claimed.
