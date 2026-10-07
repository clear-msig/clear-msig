# Public authentication dependency: exact-base comparison

Read-only diagnosis, 7 October 2026. Source unchanged during diagnosis.

Base ae1b817b5a0939e62b72800bf509c2db982da67a was checked out in an isolated detached worktree and built successfully with the same installed dependency tree, NODE_ENV production, NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=00000000-0000-0000-0000-000000000000 and NEXT_PUBLIC_BACKEND_API_URL=https://backend.invalid as local 7761f04e. Both servers received the same environment. Each browser route used a fresh unauthenticated context, 1180×900 viewport, reduced motion, and blocked all external/API/WebSocket requests. Observations were recorded five seconds after network idle.

Both builds: / and /choose render one h1 and readable public content; /personal, /security and /changelog return HTTP 200 with zero h1, no body text, one main and one loading dot. The three gated-route result objects match exactly, excluding label and localhost port. Each reports Failed to fetch after blocked Dynamic configuration startup. No live login or account actions occurred. This proves the same blocked-provider failure on the exact base, not a claim that correctly configured deployed pages always fail.

Identical Git blobs in base and current:
- AppProviders.tsx b494eacabc3d95b98fdcd99dead9a4ef0b2e43da
- PublicAuthRedirectBoundary.tsx b995fddf015dace34eb76366475ba4b21025e4eb
- DynamicProviderTree.tsx 326c3adc9ccab166eeb70ca59ad075d3b7f1ef97
- DynamicWalletRuntimeProvider.tsx 990e753e8ff2b75e164c1756e0e7a94b65027656
- useWalletGate.ts 401d6300c1aff37aef0a9dadf2de6e2ec9d50af9

Causal chain:
1. AppProviders needsPublicAuthRedirect (lines 97–110) includes these public routes.
2. Lines 195–228 require and wrap them in the selected Dynamic runtime plus PublicAuthRedirectBoundary.
3. DynamicWalletRuntimeProvider line 360 defines connecting as !sdkHasLoaded.
4. PublicAuthRedirectBoundary lines 22–26 suppress children while connecting, connected or loggedInWithoutSolana. The connecting case never releases content when SDK startup cannot complete; only a dot is shown (lines 29–33).

The public informational components do not consume wallet hooks. Auth startup here supports signed-in convenience redirection, not access control for public text. Therefore the content has an unnecessary availability dependency. The smallest robust prospective change would keep public content outside the optional lazy redirect runtime and mount a silent redirect observer beside it, preserving existing connected/non-Solana redirect decisions and all protected-route gates. Merely showing children while connecting removes the SDK-settings failure symptom but does not address failure to load the lazy runtime chunk itself. No such change was made in this read-only diagnosis.

Smallest verification path: bounded public-route browser test with SDK settings/chunk requests blocked; assert content remains visible and links usable. Separately test existing signed-in, signed-out, connecting and non-Solana redirect states with controlled boundary mocks and retain protected-route tests. Then, if a valid preview with approved existing configuration is available, perform signed-out read-only visits to /personal, /security and /changelog; no login or wallet action required. Do not substitute the synthetic redirect tests for live-provider validation.

Evidence: base-public-auth.json, current-public-auth.json, base-auth-build.log and matching screenshots in this directory.
