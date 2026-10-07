# Connected UI review fixtures

These scripts render the real app routes with deterministic provider-boundary
reads. They are not proof of authentication, chain authority, signing, device
support or payment execution. Never publish the generated app copy.

From `apps/web`, with locked dependencies installed:

```sh
node scripts/browser-regressions/prepareConnectedReview.cjs /tmp/clearsig-connected-review
cd /tmp/clearsig-connected-review
NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=00000000-0000-4000-8000-000000000000 ./node_modules/.bin/next dev --hostname 127.0.0.1 --port 3105
```

The preparer refuses an existing destination or one inside the source app. It
records the source commit and whether the frontend worktree contains changes.
Only the isolated copy gets provider aliases and the signing-review fixture route.

In another terminal, from `apps/web`, run `matrix.cjs`, then `interactions.cjs`,
then `narrow-dark.cjs` from this directory using Node. Playwright must be
resolvable (for an external installation, set `NODE_PATH`) and Chromium must be
available at `/usr/bin/chromium`. Set `CLEARSIG_REVIEW_OUTPUT` to a writable
artifact directory. The matrix creates its `final` screenshot subdirectory;
run it first. `CLEARSIG_REVIEW_URL` defaults to `http://127.0.0.1:3105`.

The scripts block nonlocal requests, local API submissions and WebSockets.
Signing and unmapped reads reject. Synthetic account labels stay visible.
Do not remove these protections to make a failing fixture pass. SDK-hosted
authentication, hardware/OS dialogs and hosted checkout remain external pixels.

Coverage: 52 route/state cases, 16 desktop/mobile interaction flows and 12
narrow/dark checks. These are representative cases, not every route permutation.

For a focused matrix retry, set `CLEARSIG_REVIEW_FAMILY` (for example `send`)
and a separate output directory so the original failure evidence is preserved.

## Expanded route review

Use `node scripts/browser-regressions/prepareExpandedReview.cjs /tmp/clearsig-expanded-review`
to create a separate expanded copy. Start Next there on port 3106 with the same
all-zero test-only environment ID. This variant replaces the server public
registry read boundary as well as client reads, so actual public-profile builders
and views can render without a live RPC or registry. `ExpandedProvider` preserves
the selected fixture scenario through real redirects.

Run `expandedRoutes.cjs` with Playwright available. It seeds synthetic scoped
agent/profile and policy-authoring storage, and visits the 85 entries from the
implementation map at 390/1440 in the existing dark theme. Set
`CLEARSIG_REVIEW_OUTPUT` and `CLEARSIG_REVIEW_URL` for custom locations.
`REVIEW_IDS=r65,r66,r67 REVIEW_STATE=setup` exercises the not-yet-configured setup
forms rather than their already-configured redirects. `modalAndOnboarding.cjs`
and `signingClearance.cjs` check whole-shell modal isolation and scroll-end action
clearance in both themes, including a reduced-height viewport. The latter is a
viewport simulation, not a real mobile keyboard/device test.

Synthetic descriptors are for display only; they are not validated canonical
execution plans. Signing, account/device creation and financial submissions stay
blocked. The seed's default program ID is a local scope namespace, not evidence
of deployment identity. Do not enable live requests to make the fixtures pass.

For compiled expanded review, build and start the isolated copy with `NEXT_PUBLIC_BACKEND_API_URL=http://127.0.0.1:9` and the test-only Dynamic environment ID. The browser blocks API/external requests. A missing production configuration screen is a failed review, never a rendered app pass. Use `next build` then `next start` to avoid development-server memory restarts truncating chunks during a long route sweep.

For focused budget/Bitcoin regression coverage, use `REVIEW_IDS=r42,r59 REVIEW_WIDTHS=320,390,1440`. The runner checks each weekly-limit input and suffix against its own card, and verifies Bitcoin input→review→action order, repeated-edit state retention, review updates and the empty-UTXO submission guard. All signing remains blocked.
