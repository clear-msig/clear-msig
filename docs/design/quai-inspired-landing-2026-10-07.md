# ClearSig landing review — 7 October 2026

Base: `82dadff78d12e69179ee9532bed395c4a2c3ac1b`, the current main fetched before work. The two newer remote commits were fast-forwarded without replacing local/untracked work. This candidate is local only; no push or deployment.

## Direction and scope

Adapt the independently observed Quai desktop language—cinematic scale, technical labels, fine outlines, geometric illustration, section markers and generous editorial spacing—to ClearSig. The existing ClearSig mark, fonts, black/lime palette, product claims and destinations remain. No copied assets, new font licenses, dependencies, WebGL, loading gate or scroll locking.

- Wide desktop hero: a lightweight SVG vault/quorum illustration above an oversized two-line promise, with primary action and devnet disclosure immediately available.
- Mobile: message and action first, then a reflowed illustration; no desktop screenshot shrink or fixed-height scene.
- Editorial section retains the restored three-card approval illustration and explains its relationship to policy and owners.
- Three-column action/rules/people narrative and product options become stacked sections on small screens.
- Native diamond anchor navigation tracks the current visible section on desktop; it remains ordinary links without JavaScript. Observer cleanup is explicit.
- Existing accessible progressive reveals, reduced motion, skip link, policy disclosure and local repeatable approval demonstration are retained. Static hero content renders without JavaScript.

Only landing-route styles/components changed. App routes, signing/security behavior, wallet/provider configuration and dependency/bundle policies were not modified.

## Reference evidence boundary

The independent cloud browser observed Quai desktop chrome, headline, editorial sections and its WebGL-failure fallback. Full WebGL choreography and mobile reference behavior were not verified. In this executor Chromium desktop/mobile requests fail with `ERR_TUNNEL_CONNECTION_FAILED`; an explicit network-permission retry also returns proxy CONNECT 403.

Supplied reference images: `libfile_8e094adc0428819182c3182238bd2b6d` and `libfile_f1a7678e77a48191a89b288f705ce2cd`. Supported Library materialization and one fresh consumer-local retry both failed to download. Image reading reported “Native image pixels were unavailable; returned extracted text only.” Therefore this candidate follows the independent visual observations, not a claimed direct pixel comparison. Parent review against those images remains necessary.

## Verification

- ESLint and TypeScript passed.
- Seven relevant tests passed across landing experience, approval-document data and product-surface rendering.
- Development-browser matrix: 8/8 passed. Widths 1440/390/320 with normal and reduced motion, plus no-JavaScript at 1440/320. Covered keyboard skip link, anchor clearance, repeated demo/reset, policy disclosure, section navigation, reveals, animation pause where applicable, no script errors and no horizontal overflow.
- Production build/bundle results and final compiled-browser evidence recorded below after terminal completion.

Browser scope is signed-out local marketing content. Auth uses an inert all-zero test environment ID; backend URL is unreachable loopback `http://127.0.0.1:9`, and browser network routing blocks external hosts. No login, signing, provider account, payment or transaction was attempted. The first local renders correctly exposed missing configuration; they were not used as landing-page screenshot evidence.

Final production build completed successfully. Landing output: 8.79 kB route / 122 kB first-load JS. Unchanged bundle gates passed: external-wallet 1123.5/1124 kB; legacy Turnkey 979.4/991 kB. No limits changed.

Final **compiled-server browser matrix: 8/8 passed**, covering all the cases above. No recorded page errors or horizontal overflow. Evidence: `/workspace/scratch/quai-study/verification.json`; reusable local runner `/workspace/scratch/quai-study/verify.cjs`; production logs `production-final.log` and `bundles-final.log` in the same directory. Full Rust/app-wide suites were not repeated for this landing-only change.

Review board: Library **`libfile_1e9992748098819192c805a6d23e3245`**, version 0; file `file_000000001dd082468a6f4bcd32eafbd4`. Filename `clearsig-quai-inspired-landing-review.png`, 1920×2755, 926,979 bytes. SHA-256 `86e2271f64b11e74a5a7b49ce0de4d2836c72c3f96540a90cd06bddd6c70aa57`. Library creation and local identity persistence both succeeded. The board was inspected as actual pixels before upload.
