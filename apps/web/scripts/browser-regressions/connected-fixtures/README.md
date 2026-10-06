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
