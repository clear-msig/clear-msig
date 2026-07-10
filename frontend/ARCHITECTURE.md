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

## Agent feature boundaries

The agent feature uses a stricter four-layer dependency flow:

1. `features/agents/ui` contains render-only screens and components. UI receives
   controller state and callbacks; it cannot import browser infrastructure.
2. `features/agents/controllers` coordinates route state, effects, and user
   actions. Route entry points only select a controller and render a screen.
3. `features/agents/domain` owns pure presentation and reconciliation rules. It
   cannot runtime-import React, Next.js, wallet code, clients, or server modules.
4. `features/agents/infrastructure` is the single browser adapter for network,
   persistence, wallet signing, and market-data clients. Server implementations
   remain behind API handlers in `lib/agents/server*`.

Agent routes and components cannot import wallet or legacy agent client internals
directly. `check:architecture` enforces these imports and a 1,200-line maximum for
every agent feature module.

## Performance contract

- Development uses Turbopack for fast feedback. Production uses Webpack because
  its measured route payloads are materially smaller for the current wallet SDKs.
- `npm run check:architecture` enforces route size, route-layer size, client-page
  ratio, browser/server boundaries, and exclusion of diagnostic routes.
- `npm run check:bundles` deduplicates each route's manifest chunks, separates
  shared chunks from route-owned chunks, and enforces both total and route-owned
  gzip budgets without adding a shared chunk more than once per route.
- CI caches `.next/cache`, then runs the same production verification command used
  by Vercel and local releases.

## Commands

- `npm run verify`: architecture, lint, incremental typecheck, and unit tests.
- `npm run build`: architecture, lint, typecheck, tests, Webpack build, and bundle
  budgets. This is the production release gate.
- `npm run build:webpack`: Webpack production compilation only. Use this for build
  profiling; do not use it as a release gate.
- `npm run typecheck:clean`: non-incremental typecheck for toolchain debugging.
