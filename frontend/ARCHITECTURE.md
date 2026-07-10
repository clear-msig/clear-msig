# Frontend architecture

The frontend is organized around route entry points, product features, shared UI,
and typed domain libraries. Keep dependencies flowing down this list.

## Layers

1. `src/app` owns routing, layouts, metadata, and API handlers. Page files should
   be thin server wrappers unless browser-only route orchestration is unavoidable.
2. `src/features` owns complete product workflows. Route implementations belong in
   a feature's `routes` directory; reusable feature components and hooks stay next
   to the workflow that owns them.
3. `src/components` owns reusable visual primitives and cross-feature app chrome.
   Components must not import route modules.
4. `src/lib` owns typed domain behavior, adapters, data access, and pure policy
   logic. Browser modules must not import server runtimes except with `import type`.

API handlers validate transport input and delegate to server-side domain modules.
Client components consume typed client adapters or hooks; they do not reach into
server persistence directly.

## Performance contract

- Development uses Turbopack for fast feedback. Production uses Webpack because
  its measured route payloads are materially smaller for the current wallet SDKs.
- `npm run check:architecture` enforces route size, route-layer size, client-page
  ratio, browser/server boundaries, and exclusion of diagnostic routes.
- `npm run check:bundles` measures every built route's gzip payload from the Next
  manifest and rejects regressions beyond the public and authenticated budgets.
- CI caches `.next/cache`, then runs lint, architecture checks, typecheck, tests,
  the production build, and bundle budgets.

## Commands

- `npm run verify`: architecture, lint, incremental typecheck, and unit tests.
- `npm run build`: architecture gate, production build, and bundle gate.
- `npm run typecheck:clean`: non-incremental typecheck for toolchain debugging.
